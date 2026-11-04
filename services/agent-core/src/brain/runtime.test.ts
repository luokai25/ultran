import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BrainRuntime } from './runtime.js';
import type { BrainBackend, InferenceRequest, LoadOptions, ModelHandle, ModelRef, Token } from './types.js';

class FakeBackend implements BrainBackend {
  readonly kind = 'llama.cpp' as const;
  loaded = 0;
  unloaded = 0;
  async load(ref: ModelRef, _opts: LoadOptions = {}): Promise<ModelHandle> {
    this.loaded += 1;
    return { ref: { ...ref }, loadedAt: Date.now(), tokensIn: 0, tokensOut: 0 };
  }
  async *infer(_handle: ModelHandle, req: InferenceRequest): AsyncIterable<Token> {
    yield { text: req.prompt, done: true, index: 0 };
  }
  async embed(_handle: ModelHandle, texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => Float32Array.from([0.1, 0.2]));
  }
  async unload(_handle: ModelHandle): Promise<void> { this.unloaded += 1; }
}

const digest = 'a'.repeat(64);
const ref: ModelRef = { id: 'qwen-test-q4', backend: 'llama.cpp', sha256: digest, contextWindow: 2048 };

test('refuses to load model weights without a SHA-256 digest', async () => {
  const runtime = new BrainRuntime({ backends: [new FakeBackend()] });
  await assert.rejects(() => runtime.load({ ...ref, sha256: undefined }), /no sha256 digest/);
});

test('loads a verified model and caches only the same backend and digest', async () => {
  const backend = new FakeBackend();
  const runtime = new BrainRuntime({ backends: [backend] });
  const first = await runtime.load(ref);
  const second = await runtime.load(ref);
  assert.equal(first, second);
  assert.equal(backend.loaded, 1);
  await assert.rejects(() => runtime.load({ ...ref, sha256: 'b'.repeat(64) }), /different backend or SHA-256 digest/);
});

test('streams tokens and tracks model output usage', async () => {
  const runtime = new BrainRuntime({ backends: [new FakeBackend()] });
  await runtime.load(ref);
  const tokens = [];
  for await (const token of runtime.infer(ref.id, { prompt: 'hello' })) tokens.push(token);
  assert.equal(tokens[0]?.text, 'hello');
  assert.equal((await runtime.health()).loadedModels[0]?.tokensOut, 1);
});

test('delegates embeddings and unloads models', async () => {
  const backend = new FakeBackend();
  const runtime = new BrainRuntime({ backends: [backend] });
  await runtime.load(ref);
  const vectors = await runtime.embed(ref.id, ['one', 'two']);
  assert.equal(vectors.length, 2);
  assert.ok(vectors[0] instanceof Float32Array);
  await runtime.unload(ref.id);
  assert.equal(backend.unloaded, 1);
  await assert.rejects(async () => {
    for await (const _token of runtime.infer(ref.id, { prompt: 'no model' })) { /* no-op */ }
  }, /not loaded/);
});
