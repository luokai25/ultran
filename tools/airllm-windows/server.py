"""Local OpenAI-compatible API for AirLLM on Windows. Loopback-only by default."""
import os, re, time, uuid, threading
from typing import Any
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
import json
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
DEFAULT_MODEL=os.environ.get("ULTRAN_AIRLLM_MODEL","Qwen/Qwen2.5-1.5B-Instruct")
HOST=os.environ.get("ULTRAN_AIRLLM_HOST","127.0.0.1")
PORT=int(os.environ.get("ULTRAN_AIRLLM_PORT","11435"))
MAX_NEW_TOKENS=int(os.environ.get("ULTRAN_AIRLLM_MAX_NEW_TOKENS","256"))
app=FastAPI(title="Ultran AirLLM Bridge",version="0.2.0")
app.add_middleware(CORSMiddleware,allow_origins=["http://localhost:3000","http://127.0.0.1:3000","file://"],allow_credentials=False,allow_methods=["GET","POST","OPTIONS"],allow_headers=["Content-Type","Authorization"])
_model=None
_tokenizer=None
_model_id=None
_load_error=None
_model_lock=threading.Lock()
class Message(BaseModel):
    role:str="user"
    content:str
class ChatRequest(BaseModel):
    model:str|None=None
    request_id:str|None=None
    messages:list[Message]=Field(min_length=1,max_length=80)
    max_tokens:int|None=Field(default=None,ge=1,le=2048)
    temperature:float|None=Field(default=0.2,ge=0,le=2)
def cuda_available():
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False
def load_model(model_id:str):
    global _model,_tokenizer,_model_id,_load_error
    if not model_id or len(model_id)>180 or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+",model_id):
        raise ValueError("Model must be a Hugging Face repository ID, for example Qwen/Qwen2.5-1.5B-Instruct.")
    if _model is not None and _model_id==model_id:
        return
    try:
        from airllm import AutoModel
        from transformers import AutoConfig, AutoTokenizer
        # AirLLM currently resolves architectures with trust_remote_code=True.
        # Preflight the repository with remote code disabled and reject custom
        # code mappings before allowing AirLLM to load the same cached config.
        config=AutoConfig.from_pretrained(model_id,trust_remote_code=False)
        if getattr(config,"auto_map",None):
            raise ValueError("This model requires custom repository code. Ultran blocks remote model code for safety.")
        tokenizer=AutoTokenizer.from_pretrained(model_id,trust_remote_code=False)
        model=AutoModel.from_pretrained(model_id,compression=None)
        _tokenizer,_model,_model_id,_load_error=tokenizer,model,model_id,None
    except Exception as exc:
        _load_error="{}: {}".format(type(exc).__name__,exc)
        raise
@app.get("/health")
def health()->dict[str,Any]:
    return {"status":"ready" if _model is not None else ("error" if _load_error else "not_loaded"),"model":_model_id or DEFAULT_MODEL,"host":HOST,"port":PORT,"error":_load_error,"device":"cuda" if cuda_available() else "cpu"}
@app.get("/v1/models")
def models():
    return {"object":"list","data":[{"id":_model_id or DEFAULT_MODEL,"object":"model","owned_by":"local"}]}
_cancel_events:dict[str,threading.Event]={}
_cancel_lock=threading.Lock()
def sse(payload:dict[str,Any])->str:
    return "data: "+json.dumps(payload,ensure_ascii=False)+"\n\n"
@app.post("/v1/chat/completions")
def chat_completions(request:ChatRequest):
    global _load_error
    request_id=request.request_id or uuid.uuid4().hex
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}",request_id):
        raise HTTPException(status_code=400,detail="Invalid request ID.")
    cancel_event=threading.Event()
    with _cancel_lock:
        if request_id in _cancel_events:
            raise HTTPException(status_code=409,detail="Duplicate request ID.")
        _cancel_events[request_id]=cancel_event
    def generate_stream():
        started=time.time()
        try:
            from transformers import TextIteratorStreamer,StoppingCriteria,StoppingCriteriaList
            import torch
            class StopOnCancel(StoppingCriteria):
                def __call__(self,input_ids,scores,**kwargs):
                    return cancel_event.is_set()
            requested_model=request.model or _model_id or DEFAULT_MODEL
            with _model_lock:
                if cancel_event.is_set():
                    yield sse({"type":"cancelled","request_id":request_id})
                    return
                load_model(requested_model)
                messages=[{"role":m.role,"content":m.content} for m in request.messages]
                prompt=_tokenizer.apply_chat_template(messages,tokenize=False,add_generation_prompt=True) if hasattr(_tokenizer,"apply_chat_template") else "\n".join("{}: {}".format(m["role"],m["content"]) for m in messages)+"\nassistant:"
                encoded=_tokenizer(prompt,return_tensors="pt")
                input_ids=encoded["input_ids"]
                if cuda_available(): input_ids=input_ids.cuda()
                streamer=TextIteratorStreamer(_tokenizer,skip_prompt=True,skip_special_tokens=True,timeout=None)
                token_limit=min(request.max_tokens or MAX_NEW_TOKENS,2048)
                generation_error=[]
                def run_generation():
                    try:
                        with torch.inference_mode():
                            _model.generate(input_ids,max_new_tokens=token_limit,use_cache=True,streamer=streamer,stopping_criteria=StoppingCriteriaList([StopOnCancel()]))
                    except Exception as exc:
                        generation_error.append(exc)
                        try: streamer.end()
                        except Exception: pass
                worker=threading.Thread(target=run_generation,daemon=True)
                worker.start()
                for chunk in streamer:
                    if chunk:
                        yield sse({"type":"token","request_id":request_id,"token":chunk})
                    if cancel_event.is_set() and not worker.is_alive(): break
                worker.join(timeout=2)
                if generation_error:
                    raise generation_error[0]
                if cancel_event.is_set():
                    yield sse({"type":"cancelled","request_id":request_id,"elapsed_seconds":round(time.time()-started,2)})
                else:
                    yield sse({"type":"done","request_id":request_id,"model":_model_id,"elapsed_seconds":round(time.time()-started,2)})
        except Exception as exc:
            _load_error="{}: {}".format(type(exc).__name__,exc)
            yield sse({"type":"error","request_id":request_id,"error":"AirLLM streaming failed: "+_load_error})
        finally:
            with _cancel_lock: _cancel_events.pop(request_id,None)
    return StreamingResponse(generate_stream(),media_type="text/event-stream",headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})
@app.post("/v1/chat/cancel/{request_id}")
def cancel_generation(request_id:str):
    with _cancel_lock:
        event=_cancel_events.get(request_id)
        if event is None: return {"cancelled":False,"request_id":request_id}
        event.set()
        return {"cancelled":True,"request_id":request_id}
if __name__=="__main__":
    import uvicorn
    uvicorn.run(app,host=HOST,port=PORT,log_level="info")
