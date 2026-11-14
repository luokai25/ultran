import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Transpile the real TypeScript adapters (and the Cohere parser they import) and load them as ESM.
const toDataUrl = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const transpile = (name) => ts.transpileModule(readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
async function load() {
  const cohere = toDataUrl(transpile("cohere-sse.ts"));
  return import(toDataUrl(transpile("provider-adapters.ts").replace('"./cohere-sse"', JSON.stringify(cohere))));
}
const adapters = await load();
const {
  DIRECT_PROVIDERS, ProviderHttpError, parseModelList, parseRetryAfterMs, extractProviderError,
  buildChatRequest, buildModelsRequest, createOpenAiSseDecoder, verifyProviderKey, streamProviderChat,
} = adapters;

const ALL = ["openrouter", "mistral", "cerebras", "groq", "cohere", "google_ai_studio", "github_models", "huggingface", "nvidia"];

function fakeTransport({ request, stream } = {}) {
  const calls = [];
  return {
    calls,
    async request(req, signal) { calls.push({ kind: "request", req }); return request ? request(req, signal) : { status: 200, body: "{}", retryAfterMs: null }; },
    async stream(req, onChunk, signal) { calls.push({ kind: "stream", req }); return stream ? stream(req, onChunk, signal) : { status: 200, body: "", retryAfterMs: null }; },
  };
}

test("every provider the key vault supports has a direct adapter", () => {
  assert.deepEqual(Object.keys(DIRECT_PROVIDERS).sort(), [...ALL].sort());
  for (const id of ALL) {
    for (const url of [DIRECT_PROVIDERS[id].modelsUrl, DIRECT_PROVIDERS[id].chatUrl]) assert.match(url, /^https:\/\//, `${id} must use https`);
  }
});

test("every adapter host is in the native Android allowlist, and nothing else is", () => {
  const java = readFileSync(new URL("../android/app/src/main/java/app/ultron/mobile/UltronProviderHttpPlugin.java", import.meta.url), "utf8");
  const block = java.match(/ALLOWED_HOSTS = new HashSet<>\(Arrays\.asList\(([\s\S]*?)\)\);/)?.[1] ?? "";
  const allowed = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  const used = [...new Set(ALL.flatMap((id) => [DIRECT_PROVIDERS[id].modelsUrl, DIRECT_PROVIDERS[id].chatUrl, DIRECT_PROVIDERS[id].verifyUrl].filter(Boolean).map((u) => new URL(u).hostname)))].sort();
  assert.deepEqual(allowed, used);
  assert.match(java, /"https"\.equalsIgnoreCase\(url\.getProtocol\(\)\)/);
  assert.match(java, /ALLOWED_HEADERS/);
  const main = readFileSync(new URL("../android/app/src/main/java/app/ultron/mobile/MainActivity.java", import.meta.url), "utf8");
  assert.match(main, /registerPlugin\(UltronProviderHttpPlugin\.class\)/);
});

test("model lists parse OpenAI, Cohere and Google shapes and drop non-chat models", () => {
  assert.deepEqual(parseModelList({ data: [{ id: "llama-3.3-70b" }, { id: "whisper-large-v3" }, { id: "text-embedding-3" }, { id: "llama-3.3-70b" }] }), ["llama-3.3-70b"]);
  assert.deepEqual(parseModelList({ models: [{ name: "command-a-03-2025" }, { name: "embed-v4.0" }, { name: "rerank-v3.5" }] }), ["command-a-03-2025"]);
  assert.deepEqual(parseModelList({ data: [{ id: "models/gemini-2.5-flash" }, { id: "models/gemini-live-2.5" }] }), ["gemini-2.5-flash"]);
  assert.deepEqual(parseModelList(null), []);
  assert.deepEqual(parseModelList({ data: "nope" }), []);
});

test("requests carry the key only in an auth header and never in the URL or body", () => {
  const key = "sk-test-SECRET-123456";
  for (const id of ALL) {
    const gemini = DIRECT_PROVIDERS[id].format === "gemini";
    const models = buildModelsRequest(id, key);
    assert.equal(models.method, "GET");
    if (gemini) assert.equal(models.headers["x-goog-api-key"], key); else assert.equal(models.headers.Authorization, `Bearer ${key}`);
    assert.ok(!models.url.includes("SECRET"));
    const chat = buildChatRequest(id, key, { model: "m", messages: [{ role: "user", content: "hi" }], maxTokens: 512, temperature: 0.3 });
    assert.equal(chat.method, "POST");
    assert.ok(!chat.url.includes("SECRET") && !chat.body.includes("SECRET"));
    const body = JSON.parse(chat.body);
    if (gemini) { assert.equal(body.generationConfig.maxOutputTokens, 512); assert.ok(chat.url.includes("/models/m:streamGenerateContent?alt=sse")); assert.ok(!chat.headers.Authorization); }
    else { assert.equal(body.stream, true); assert.equal(body.model, "m"); assert.equal(body.max_tokens, 512); }
  }
  assert.equal(buildChatRequest("cohere", "k", { model: "m", messages: [], maxTokens: 1, temperature: 9 }).url, "https://api.cohere.com/v2/chat");
  const clamped = JSON.parse(buildChatRequest("groq", "k", { model: "m", messages: [], maxTokens: 1, temperature: 9 }).body);
  assert.equal(clamped.max_tokens, 64);
  assert.equal(clamped.temperature, 2);
});

test("Gemini: new AQ. keys use the native endpoint with x-goog-api-key, and a model name cannot escape the URL path", () => {
  const req = buildChatRequest("google_ai_studio", "AQ.Ab8RN6exampleexampleexample", { model: "gemini-2.5-flash", messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }, { role: "assistant", content: "hello" }, { role: "user", content: "a" }, { role: "user", content: "b" }], maxTokens: 300, temperature: 0.3 });
  assert.equal(req.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse");
  assert.equal(req.headers["x-goog-api-key"], "AQ.Ab8RN6exampleexampleexample");
  const body = JSON.parse(req.body);
  assert.deepEqual(body.systemInstruction, { parts: [{ text: "Be brief." }] });
  assert.deepEqual(body.contents.map((c) => c.role), ["user", "model", "user"]);
  assert.equal(body.contents[2].parts[0].text, "a\n\nb");
  assert.throws(() => buildChatRequest("google_ai_studio", "k", { model: "../x?key=1", messages: [], maxTokens: 100, temperature: 0.3 }), /not valid/);
  assert.deepEqual(parseModelList({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }, { name: "models/aqa", supportedGenerationMethods: ["generateAnswer"] }] }), ["gemini-2.5-flash"]);
});

test("Gemini SSE streams text across chunk boundaries, skips thought parts, and surfaces blocks and errors", async () => {
  const stream = 'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\r\n\r\ndata: {"candidates":[{"content":{"parts":[{"text":"hidden","thought":true},{"text":"lo"}]}}]}\n\n';
  for (const size of [1, 5, 17, stream.length]) {
    const seen = [];
    const transport = fakeTransport({ stream: async (_r, onChunk) => { for (let i = 0; i < stream.length; i += size) onChunk(stream.slice(i, i + size)); return { status: 200, body: "", retryAfterMs: null }; } });
    const text = await streamProviderChat("google_ai_studio", "k", { model: "gemini-2.5-flash", messages: [{ role: "user", content: "x" }], maxTokens: 100, temperature: 0.3 }, transport, (t) => seen.push(t));
    assert.equal(text, "Hello", `chunk size ${size}`);
  }
  const blocked = fakeTransport({ stream: async (_r, onChunk) => { onChunk('data: {"promptFeedback":{"blockReason":"SAFETY"}}\n'); return { status: 200, body: "", retryAfterMs: null }; } });
  await assert.rejects(() => streamProviderChat("google_ai_studio", "k", { model: "m", messages: [{ role: "user", content: "x" }], maxTokens: 100, temperature: 0.3 }, blocked, () => undefined), /blocked this prompt/);
  const bad = fakeTransport({ stream: async () => ({ status: 401, body: JSON.stringify({ error: { message: "API key not valid" } }), retryAfterMs: null }) });
  await assert.rejects(() => streamProviderChat("google_ai_studio", "k", { model: "m", messages: [{ role: "user", content: "x" }], maxTokens: 100, temperature: 0.3 }, bad, () => undefined), (e) => e.status === 401 && /not valid/.test(e.message));
});

test("OpenAI-compatible SSE decodes across arbitrary chunk boundaries and ignores comments", () => {
  const stream = ": OPENROUTER PROCESSING\n\n" +
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":[{"text":"lo"}]}}]}\r\n\r\n' +
    'data: {"choices":[{"delta":{}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n';
  for (const size of [1, 2, 3, 7, 19, stream.length]) {
    const decoder = createOpenAiSseDecoder();
    let text = "";
    for (let i = 0; i < stream.length; i += size) text += decoder.push(stream.slice(i, i + size)).join("");
    text += decoder.push("", true).join("");
    assert.equal(text, "Hello world", `chunk size ${size}`);
  }
});

test("a final event without a trailing newline is flushed", () => {
  const decoder = createOpenAiSseDecoder();
  assert.deepEqual(decoder.push('data: {"choices":[{"delta":{"content":"end"}}]}'), []);
  assert.deepEqual(decoder.push("", true), ["end"]);
});

test("provider error events and corrupt events fail loudly instead of being swallowed", () => {
  assert.throws(() => createOpenAiSseDecoder().push('data: {"error":{"message":"quota exceeded"}}\n'), /quota exceeded/);
  assert.throws(() => createOpenAiSseDecoder().push("data: {not json}\n"), /invalid event/);
});

test("verifyProviderKey returns models and maps provider failures to typed HTTP errors", async () => {
  const ok = fakeTransport({ request: async () => ({ status: 200, body: JSON.stringify({ data: [{ id: "a" }, { id: "b-embed" }] }), retryAfterMs: null }) });
  assert.deepEqual(await verifyProviderKey("groq", "gsk_x", ok), ["a"]);
  assert.equal(ok.calls[0].req.url, "https://api.groq.com/openai/v1/models");

  const rejected = fakeTransport({ request: async () => ({ status: 401, body: JSON.stringify({ error: { message: "Invalid API Key" } }), retryAfterMs: null }) });
  await assert.rejects(() => verifyProviderKey("mistral", "bad", rejected), (error) => error instanceof ProviderHttpError && error.status === 401 && /Invalid API Key/.test(error.message));

  const limited = fakeTransport({ request: async () => ({ status: 429, body: "slow down", retryAfterMs: 30000 }) });
  await assert.rejects(() => verifyProviderKey("cohere", "k", limited), (error) => error.status === 429 && error.retryAfterMs === 30000);

  const garbage = fakeTransport({ request: async () => ({ status: 200, body: "<html>", retryAfterMs: null }) });
  await assert.rejects(() => verifyProviderKey("cerebras", "k", garbage), (error) => error instanceof ProviderHttpError && error.status === 502);
});

test("streamProviderChat streams OpenAI-compatible tokens live and returns the full text", async () => {
  const seen = [];
  const transport = fakeTransport({ stream: async (_req, onChunk) => {
    onChunk('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choic');
    onChunk('es":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]\n\n');
    return { status: 200, body: "", retryAfterMs: null };
  } });
  const text = await streamProviderChat("openrouter", "sk-or-v1-x", { model: "m:free", messages: [{ role: "user", content: "x" }], maxTokens: 256, temperature: 0.3 }, transport, (t) => seen.push(t));
  assert.equal(text, "Hi there");
  assert.deepEqual(seen, ["Hi", " there"]);
  assert.equal(transport.calls[0].req.headers["X-Title"], "ULTRON");
});

test("streamProviderChat streams Cohere v2 events through the Cohere parser", async () => {
  const transport = fakeTransport({ stream: async (_req, onChunk) => {
    onChunk('event: content-delta\ndata: {"type":"content-delta","delta":{"message":{"content":{"text":"Hel"}}}}\n\n');
    onChunk('event: content-delta\ndata: {"type":"content-delta","delta":{"message":{"content":{"text":"lo"}}}}\n\nevent: message-end\ndata: {"type":"message-end"}');
    return { status: 200, body: "", retryAfterMs: null };
  } });
  const text = await streamProviderChat("cohere", "k", { model: "command-a-03-2025", messages: [{ role: "user", content: "x" }], maxTokens: 256, temperature: 0.3 }, transport, () => undefined);
  assert.equal(text, "Hello");
});

test("streamProviderChat reports a failed status as a typed error and emits no tokens", async () => {
  let emitted = 0;
  const transport = fakeTransport({ stream: async () => ({ status: 403, body: JSON.stringify({ message: "model only available on paid plan" }), retryAfterMs: null }) });
  await assert.rejects(
    () => streamProviderChat("groq", "k", { model: "m", messages: [{ role: "user", content: "x" }], maxTokens: 256, temperature: 0.3 }, transport, () => { emitted++; }),
    (error) => error instanceof ProviderHttpError && error.status === 403 && /paid plan/.test(error.message),
  );
  assert.equal(emitted, 0);
});

test("retry-after and error extraction helpers", () => {
  assert.equal(parseRetryAfterMs("12"), 12000);
  assert.equal(parseRetryAfterMs(""), null);
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(extractProviderError(JSON.stringify({ error: "plain string" })), "plain string");
  assert.equal(extractProviderError("x".repeat(900)).length, 400);
  assert.equal(extractProviderError(""), "");
});

test("the chat path no longer depends on any hosted ULTRON gateway", () => {
  const cloud = readFileSync(new URL("../src/cloud-llm.ts", import.meta.url), "utf8");
  assert.match(cloud, /streamProviderChat/);
  assert.match(cloud, /verifyProviderKey/);
  assert.match(cloud, /defaultProviderTransport/);
  assert.doesNotMatch(cloud, /vercel|ultron-brain|API_PATH|invokeVercelBrain|VITE_ULTRON_BRAIN_URL/i);
  assert.doesNotMatch(cloud, /@supabase|ULTRON_SUPABASE|functions\/v1/);
  assert.match(cloud, /if \(emitted\) throw failed/, "a provider failure after tokens were shown must not splice in another provider's answer");
});
