import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { OllamaBackend } from './ollama-backend.js';
import type { ModelRef } from './types.js';

const digest = 'a'.repeat(64);
const ref: ModelRef = {
  id: 'qwen2.5:3b',
  backend: 'ollama',
  sha256: digest,
  contextWindow: 8192,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('loads only a locally installed model with the expected digest', async () => {
  const backend = new OllamaBackend({
    fetcher: async () => jsonResponse({ models: [{ name: ref.id, digest: `sha256:${digest}` }] }),
  });
  const handle = await backend.load(ref);
  assert.equal(handle.ref.id, ref.id);
  assert.equal(handle.tokensIn, 0);
});

test('rejects a digest mismatch before loading the model', async () => {
  const backend = new OllamaBackend({
    fetcher: async () => jsonResponse({ models: [{ name: ref.id, digest: 'b'.repeat(64) }] }),
  });
  await assert.rejects(() => backend.load(ref), /SHA-256 mismatch/);
});

test('rejects a missing digest', async () => {
  const backend = new OllamaBackend({
    fetcher: async () => jsonResponse({ models: [{ name: ref.id, digest }] }),
  });
  await assert.rejects(() => backend.load({ ...ref, sha256: undefined }), /SHA-256 digest is required/);
});

test('streams response chunks from Ollama chat NDJSON', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        '{"message":{"content":"Hello"},"done":false}\n{"message":{"content":" world"},"done":true}\n',
      ));
      controller.close();
    },
  });
  const backend = new OllamaBackend({
    fetcher: async () => new Response(stream, { status: 200 }),
  });
  const handle = { ref, loadedAt: Date.now(), tokensIn: 0, tokensOut: 0 };
  const tokens = [];
  for await (const token of backend.infer(handle, { prompt: 'Say hello' })) tokens.push(token);
  assert.deepEqual(tokens.map((token) => token.text), ['Hello', ' world']);
  assert.equal(tokens.at(-1)?.done, true);
});

test('converts embeddings to Float32Array and checks response shape', async () => {
  const backend = new OllamaBackend({
    fetcher: async () => jsonResponse({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }),
  });
  const handle = { ref, loadedAt: Date.now(), tokensIn: 0, tokensOut: 0 };
  const embeddings = await backend.embed(handle, ['one', 'two']);
  assert.equal(embeddings.length, 2);
  assert.ok(embeddings[0] instanceof Float32Array);
  assert.equal(embeddings[1]?.[1], Math.fround(0.4));
});

test('lists installed models with normalized SHA-256 digests', async () => {
  const backend = new OllamaBackend({
    fetcher: async () => jsonResponse({
      models: [
        { name: 'qwen2.5:3b', digest: `sha256:${digest}` },
        { name: 'broken:latest', digest: 'not-a-digest' },
      ],
    }),
  });
  assert.deepEqual(await backend.listModels(), [{ id: 'qwen2.5:3b', sha256: digest }]);
});
