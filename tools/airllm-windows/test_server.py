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
        server._loading_model_id = None
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
        chunks = [chunk async for chunk in response.body_iterator]
        return [chunk.encode("utf-8") if isinstance(chunk, str) else chunk for chunk in chunks]

    def request(self, request_id):
        return server.ChatRequest(
            model="example/model",
            request_id=request_id,
            messages=[server.Message(role="user", content="test")],
            max_tokens=8,
        )

    def test_health_exposes_model_loading_state(self):
        server._loading_model_id = "example/model"
        status = server.health()
        self.assertEqual(status["status"], "loading")
        self.assertEqual(status["loading_model"], "example/model")

    def test_health_exposes_model_load_error_state(self):
        server._load_error = "RuntimeError: test failure"
        status = server.health()
        self.assertEqual(status["status"], "error")
        self.assertEqual(status["error"], "RuntimeError: test failure")

    def test_health_includes_runtime_and_disk_diagnostics(self):
        status = server.health()
        self.assertTrue(status["python_version"])
        self.assertGreaterEqual(status["cpu_count"], 1)
        self.assertTrue(status["cache_path"])
        self.assertGreater(status["free_disk_bytes"], 0)
        self.assertGreater(status["total_disk_bytes"], 0)

    def test_streams_tokens_and_finishes(self):
        response = server.chat_completions(self.request("stream-test"))
        chunks = asyncio.run(self.consume(response))
        payload = b"".join(chunks).decode("utf-8")
        self.assertIn('"type": "token"', payload)
        self.assertIn('"token": "hello"', payload)
        self.assertIn('"type": "done"', payload)
        self.assertTrue(self.model.generate_called)
        self.assertEqual(server.health()["status"], "ready")
        self.assertIsNone(server.health()["loading_model"])

    def test_cancellation_during_model_load_skips_generation(self):
        load_started = threading.Event()
        finish_load = threading.Event()

        def delayed_load(model_id):
            server._loading_model_id = model_id
            load_started.set()
            finish_load.wait(timeout=2)
            server._tokenizer = self.tokenizer
            server._model = self.model
            server._model_id = model_id
            server._loading_model_id = None

        response = server.chat_completions(self.request("load-cancel-test"))

        async def run():
            with patch.object(server, "load_model", side_effect=delayed_load):
                task = asyncio.create_task(self.consume(response))
                for _ in range(200):
                    if load_started.is_set():
                        break
                    await asyncio.sleep(0.005)
                self.assertTrue(load_started.is_set(), "model loading did not begin")
                result = server.cancel_generation("load-cancel-test")
                finish_load.set()
                chunks = await task
                return result, chunks

        result, chunks = asyncio.run(run())
        payload = b"".join(chunks).decode("utf-8")
        self.assertTrue(result["cancelled"])
        self.assertIn('"type": "cancelled"', payload)
        self.assertFalse(self.model.generate_called)

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
        first = first.encode("utf-8") if isinstance(first, str) else first
        rest = [chunk.encode("utf-8") if isinstance(chunk, str) else chunk for chunk in rest]
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
        self.assertIsNone(server._loading_model_id)
        self.assertEqual(server.health()["status"], "error")

    def test_rejects_path_like_request_ids(self):
        with self.assertRaises(server.HTTPException):
            server.chat_completions(self.request("bad/request/id"))


    def test_rejects_oversized_combined_message_content(self):
        request = server.ChatRequest(
            model="example/model",
            request_id="oversized-test",
            messages=[server.Message(role="user", content="x" * 50000) for _ in range(6)],
            max_tokens=8,
        )
        with self.assertRaises(server.HTTPException) as error:
            server.chat_completions(request)
        self.assertEqual(error.exception.status_code, 413)

    def test_message_roles_are_restricted(self):
        with self.assertRaises(Exception):
            server.Message(role="system-admin", content="test")

    def test_message_content_has_a_per_message_limit(self):
        with self.assertRaises(Exception):
            server.Message(role="user", content="x" * 50001)

if __name__ == "__main__":
    unittest.main()