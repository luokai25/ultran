"""Minimal local OpenAI-compatible API for AirLLM on Windows.
This bridge is a companion runtime, not a replacement for Ultran policy.
"""
import os, time, uuid
from typing import Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

MODEL_ID = os.environ.get("ULTRAN_AIRLLM_MODEL", "Qwen/Qwen2.5-1.5B-Instruct")
HOST = os.environ.get("ULTRAN_AIRLLM_HOST", "127.0.0.1")
PORT = int(os.environ.get("ULTRAN_AIRLLM_PORT", "11435"))
MAX_NEW_TOKENS = int(os.environ.get("ULTRAN_AIRLLM_MAX_NEW_TOKENS", "256"))
app = FastAPI(title="Ultran AirLLM Bridge", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"], allow_credentials=False, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type", "Authorization"])
_model = None
_tokenizer = None
_load_error = None

class Message(BaseModel):
    role: str = "user"
    content: str

class ChatRequest(BaseModel):
    model: str | None = None
    messages: list[Message] = Field(min_length=1)
    max_tokens: int | None = Field(default=None, ge=1, le=2048)
    temperature: float | None = Field(default=0.2, ge=0, le=2)

def load_model():
    global _model, _tokenizer, _load_error
    if _model is not None:
        return
    try:
        from airllm import AutoModel
        from transformers import AutoTokenizer
        _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=False)
        _model = AutoModel.from_pretrained(MODEL_ID, compression=None)
        _load_error = None
    except Exception as exc:
        _load_error = "{}: {}".format(type(exc).__name__, exc)
        raise

def cuda_available():
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False

@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ready" if _model is not None else ("error" if _load_error else "not_loaded"), "model": MODEL_ID, "host": HOST, "port": PORT, "error": _load_error, "device": "cuda" if cuda_available() else "cpu"}

@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "local"}]}

@app.post("/v1/chat/completions")
def chat_completions(request: ChatRequest):
    try:
        load_model()
        import torch
        messages = [{"role": m.role, "content": m.content} for m in request.messages]
        if hasattr(_tokenizer, "apply_chat_template"):
            prompt = _tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        else:
            prompt = "\n".join("{}: {}".format(m["role"], m["content"]) for m in messages) + "\nassistant:"
        inputs = _tokenizer(prompt, return_tensors="pt")
        device = "cuda" if cuda_available() else "cpu"
        inputs = {key: value.to(device) for key, value in inputs.items()}
        token_limit = min(request.max_tokens or MAX_NEW_TOKENS, 2048)
        started = time.time()
        with torch.inference_mode():
            output = _model.generate(**inputs, max_new_tokens=token_limit, do_sample=(request.temperature or 0) > 0, temperature=max(request.temperature or 0.2, 0.01))
        generated = output[0][inputs["input_ids"].shape[-1]:]
        answer = _tokenizer.decode(generated, skip_special_tokens=True)
        return {"id": "chatcmpl-" + uuid.uuid4().hex, "object": "chat.completion", "created": int(time.time()), "model": MODEL_ID, "choices": [{"index": 0, "message": {"role": "assistant", "content": answer}, "finish_reason": "stop"}], "usage": {"prompt_tokens": int(inputs["input_ids"].shape[-1]), "completion_tokens": int(generated.shape[-1]), "total_tokens": int(output.shape[-1])}, "x_ultran_elapsed_seconds": round(time.time() - started, 2)}
    except Exception as exc:
        raise HTTPException(status_code=503, detail="AirLLM request failed: {}: {}".format(type(exc).__name__, exc)) from exc

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
