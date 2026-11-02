"""Run a real local AirLLM inference through Ultran's streaming API.

Run after installing the Windows runtime. The default smoke model is intentionally
small; set ULTRAN_AIRLLM_MODEL to test another compatible Hugging Face model.
"""
import asyncio
import json
import os
import time

from server import ChatRequest, Message, chat_completions

MODEL = os.environ.get("ULTRAN_AIRLLM_MODEL", "Qwen/Qwen2.5-0.5B-Instruct")


async def run():
    request_id = "ultran-real-inference-smoke"
    request = ChatRequest(
        model=MODEL,
        request_id=request_id,
        messages=[Message(role="user", content="Reply with the single word READY.")],
        max_tokens=8,
        temperature=0,
    )
    started = time.time()
    print("Loading model and running a real local inference:", MODEL, flush=True)
    response = chat_completions(request)
    tokens = []
    terminal = None
    async for chunk in response.body_iterator:
        if isinstance(chunk, bytes):
            chunk = chunk.decode("utf-8", errors="replace")
        for frame in chunk.split("\n\n"):
            line = next((item for item in frame.splitlines() if item.startswith("data: ")), None)
            if not line:
                continue
            event = json.loads(line[6:])
            if event.get("type") == "token":
                tokens.append(event.get("token", ""))
                print(event.get("token", ""), end="", flush=True)
            elif event.get("type") in {"done", "cancelled", "error"}:
                terminal = event
    print()
    if terminal is None:
        raise RuntimeError("The local bridge ended without a terminal event.")
    if terminal.get("type") == "error":
        raise RuntimeError(terminal.get("error", "AirLLM inference failed."))
    if terminal.get("type") != "done":
        raise RuntimeError("The smoke inference did not complete: " + str(terminal))
    output = "".join(tokens).strip()
    if not output:
        raise RuntimeError("AirLLM completed but returned no generated text.")
    print("PASS: real AirLLM inference completed in {:.1f}s.".format(time.time() - started))
    print("Model: {}".format(MODEL))
    print("Output: {}".format(output))


if __name__ == "__main__":
    asyncio.run(run())