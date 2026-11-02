"""Local OpenAI-compatible API for AirLLM on Windows. Loopback-only by default."""
import os, re, time, uuid, threading
from typing import Any
from fastapi import FastAPI, HTTPException
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
        from transformers import AutoTokenizer
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
@app.post("/v1/chat/completions")
def chat_completions(request:ChatRequest):
    global _load_error
    requested_model=request.model or _model_id or DEFAULT_MODEL
    try:
        with _model_lock:
            load_model(requested_model)
            import torch
            messages=[{"role":m.role,"content":m.content} for m in request.messages]
            if hasattr(_tokenizer,"apply_chat_template"):
                prompt=_tokenizer.apply_chat_template(messages,tokenize=False,add_generation_prompt=True)
            else:
                prompt="\n".join("{}: {}".format(m["role"],m["content"]) for m in messages)+"\nassistant:"
            encoded=_tokenizer(prompt,return_tensors="pt")
            input_ids=encoded["input_ids"]
            if cuda_available():
                input_ids=input_ids.cuda()
            token_limit=min(request.max_tokens or MAX_NEW_TOKENS,2048)
            started=time.time()
            with torch.inference_mode():
                result=_model.generate(input_ids,max_new_tokens=token_limit,use_cache=True,return_dict_in_generate=True)
            sequences=result.sequences if hasattr(result,"sequences") else result
            generated=sequences[0][input_ids.shape[-1]:]
            answer=_tokenizer.decode(generated,skip_special_tokens=True)
            return {"id":"chatcmpl-"+uuid.uuid4().hex,"object":"chat.completion","created":int(time.time()),"model":_model_id,"choices":[{"index":0,"message":{"role":"assistant","content":answer},"finish_reason":"stop"}],"usage":{"prompt_tokens":int(input_ids.shape[-1]),"completion_tokens":int(generated.shape[-1]),"total_tokens":int(sequences.shape[-1])},"x_ultran_elapsed_seconds":round(time.time()-started,2)}
    except Exception as exc:
        _load_error="{}: {}".format(type(exc).__name__,exc)
        raise HTTPException(status_code=503,detail="AirLLM request failed: {}".format(_load_error)) from exc
if __name__=="__main__":
    import uvicorn
    uvicorn.run(app,host=HOST,port=PORT,log_level="info")
