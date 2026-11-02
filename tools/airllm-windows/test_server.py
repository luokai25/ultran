"""Behavioral tests for the local bridge using a deterministic fake model.

These tests exercise the FastAPI streaming and cancellation control flow without
downloading model weights or requiring a GPU. Real AirLLM compatibility remains
covered separately by upstream API inspection and Windows runtime smoke tests.
"""
import asyncio
import importlib
import pathlib
import sys
import threading
import time
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
server = importlib.import_module("server")


class FakeStreamer:
    def __init__(self, *_args, **_kwargs):
        self.items = []
        self.ready = threading.Condition()
        self.ended = False

    def put(self, value):
        with self.ready:
            self.items.append(value)
            self.ready.notify_all()

    def end(self):
        with self.ready:
            self.ended = True
            self.ready.notify_all()

    def __iter__(self):
        while True:
            with self.ready:
                while not self.items and not self.ended:
                    self.ready.wait(timeout=1)
                if self.items:
                    item = self.items.pop(0)
                elif self.ended:
                    return
                else:
                    continue
            yield item


class FakeStoppingCriteria:
    pass


class FakeStoppingCriteriaList(list):
    pass


class FakeTokenizer:
    def apply_chat_template(self, *_args, **_kwargs):
        return "fake prompt"

    def __call__(self, *_args, **_kwargs):
        return {"input_ids": object()}


class FakeModel:
    def __init__(self):
        self.generate_called = False
        self.wait_for_cancel = False

    def generate(self, *_args, **kwargs):
        self.generate_called = True
        streamer = kwargs["streamer"]
        stopping = kwargs["stopping_criteria"]
        streamer.put("hello")
        if self.wait_for_cancel:
            while not stopping[0](None, None):
                time.sleep(0.005)
        streamer.end()


class BridgeTests(unittest.TestCase):
    def setUp(self):
        server._model = None
        server._tokenizer = None
        server._model_id = None
        server._load_error = None
        self.model = FakeModel()
        self.tokenizer = FakeTokenizer()
        self.auto_map = None

        airllm = types.ModuleType("airllm")
        airllm.AutoModel = types.SimpleNamespace(from_pretrained=self.load_fake_model)

        transformers = types.ModuleType("transformers")
        transformers.AutoConfig = types.SimpleNamespace(from_pretrained=self.load_fake_config)
        transformers.AutoTokenizer = types.SimpleNamespace(from_pretrained=lambda *_a, **_k: self.tokenizer)
        transformers.TextIteratorStreamer = FakeStreamer
        transformers.StoppingCriteria = FakeStoppingCriteria
        transformers.StoppingCriteriaList = FakeStoppingCriteriaList

        torch = types.ModuleType("torch")
        torch.cuda = types.SimpleNamespace(is_available=lambda: False)
        torch.inference_mode = lambda: __import__("contextlib").nullcontext()

        self.modules = {"airllm": airllm, "transformers": transformers, "torch": torch}
        self.patch = patch.dict(sys.modules, self.modules)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def load_fake_config(self, *_args, **_kwargs):
        return types.SimpleNamespace(auto_map=self.auto_map)

    def load_fake_model(self, *_args, **_kwargs):
        return self.model

    @staticmethod
    async def consume(response):
        return [chunk async for chunk in response.body_iterator]

    def request(self, request_id):
        return server.ChatRequest(
            model="example/model",
            request_id=request_id,
            messages=[server.Message(role="user", content="test")],
            max_tokens=8,
        )

    def test_streams_tokens_and_finishes(self):
        response = server.chat_completions(self.request("stream-test"))
        chunks = asyncio.run(self.consume(response))
        payload = b"".join(chunks).decode("utf-8")
        self.assertIn('"type": "token"', payload)
        self.assertIn('"token": "hello"', payload)
        self.assertIn('"type": "done"', payload)
        self.assertTrue(self.model.generate_called)

    def test_mid_generation_cancellation_reaches_stopping_criteria(self):
        self.model.wait_for_cancel = True
        response = server.chat_completions(self.request("cancel-test"))

        async def run():
            iterator = response.body_iterator.__aiter__()
            first = await iterator.__anext__()
            result = server.cancel_generation("cancel-test")
            rest = [chunk async for chunk in iterator]
            return first, result, rest

        first, result, rest = asyncio.run(run())
        payload = (first + b"".join(rest)).decode("utf-8")
        self.assertTrue(result["cancelled"])
        self.assertIn('"type": "token"', payload)
        self.assertIn('"type": "cancelled"', payload)
        self.assertTrue(self.model.generate_called)

    def test_blocks_models_that_require_remote_custom_code(self):
        self.auto_map = {"AutoModel": "custom.module.Model"}
        with self.assertRaisesRegex(ValueError, "blocks remote model code"):
            server.load_model("example/model")
        self.assertIsNone(server._model)

    def test_rejects_path_like_request_ids(self):
        with self.assertRaises(server.HTTPException):
            server.chat_completions(self.request("bad/request/id"))


if __name__ == "__main__":
    unittest.main()
