import { inspectProviderEvent, preflightStream } from "./stream-preflight.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const encoder = new TextEncoder();

/** Build an SSE Response that emits each frame after an optional delay, then closes (or stays open). */
function sse(frames: Array<string | number>, options: { keepOpen?: boolean } = {}): Response {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) {
        if (typeof frame === "number") { await new Promise((resolve) => setTimeout(resolve, frame)); continue; }
        if (cancelled) return;
        controller.enqueue(encoder.encode(frame));
      }
      if (!options.keepOpen && !cancelled) controller.close();
    },
    cancel() { cancelled = true; },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
const data = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

Deno.test("inspectProviderEvent distinguishes progress, errors and empty role frames", () => {
  assert(inspectProviderEvent("openai", { choices: [{ delta: { role: "assistant", content: "" } }] }).kind === "ignore", "empty role frame is not progress");
  assert(inspectProviderEvent("openai", { choices: [{ delta: { content: "Hi" } }] }).kind === "progress", "text delta is progress");
  assert(inspectProviderEvent("openai", { choices: [{ delta: { reasoning: "thinking" } }] }).kind === "progress", "reasoning delta is progress");
  const error = inspectProviderEvent("openai", { error: { message: "Provider returned error", code: 429 } });
  assert(error.kind === "error" && error.status === 429, "error event carries provider status");
  assert(inspectProviderEvent("cohere", { type: "content-delta", delta: { message: { content: { text: "Hi" } } } }).kind === "progress", "cohere delta is progress");
});

Deno.test("preflight replays buffered bytes in front of the live stream", async () => {
  const upstream = sse([": OPENROUTER PROCESSING\n\n", data({ choices: [{ delta: { role: "assistant", content: "" } }] }), data({ choices: [{ delta: { content: "Hel" } }] }), data({ choices: [{ delta: { content: "lo" } }] }), "data: [DONE]\n\n"]);
  const result = await preflightStream(upstream, "openai", { timeoutMs: 2000 });
  assert(result.ok, "stream with content should pass");
  const body = await result.response.text();
  assert(body.includes("OPENROUTER PROCESSING") && body.includes('"Hel"') && body.includes('"lo"') && body.trimEnd().endsWith("[DONE]"), "every byte, including comments and the tail, must be replayed in order");
});

Deno.test("preflight rejects a 200 stream whose first event is a provider error", async () => {
  const result = await preflightStream(sse([data({ error: { message: "Rate limit exceeded", code: 429 } })]), "openai", { timeoutMs: 2000 });
  assert(!result.ok && result.providerStatus === 429 && /rate limit/i.test(result.reason), "error event must fail with its provider status");
});

Deno.test("preflight rejects an empty completion", async () => {
  const result = await preflightStream(sse([data({ choices: [{ delta: { role: "assistant", content: "" } }] }), data({ choices: [{ delta: {}, finish_reason: "stop" }] }), "data: [DONE]\n\n"]), "openai", { timeoutMs: 2000 });
  assert(!result.ok && /empty/i.test(result.reason), "stream with no text must fail so another key can answer");
});

Deno.test("preflight times out on keepalive-only streams and cancels the upstream", async () => {
  const result = await preflightStream(sse([": keepalive\n\n", 400, ": keepalive\n\n"], { keepOpen: true }), "openai", { timeoutMs: 150 });
  assert(!result.ok && /in time/i.test(result.reason), "keepalives alone are not progress");
});

Deno.test("preflight accepts gateways that ignore stream=true and return one JSON body", async () => {
  const response = new Response(JSON.stringify({ choices: [{ message: { content: "Complete answer" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  const result = await preflightStream(response, "openai", { timeoutMs: 2000 });
  assert(result.ok, "single JSON completion should pass");
  assert((await result.response.text()).includes("Complete answer"), "JSON body must be replayed intact");
});

Deno.test("preflight handles events split across network chunks", async () => {
  const frame = data({ choices: [{ delta: { content: "split" } }] });
  const result = await preflightStream(sse([frame.slice(0, 12), 20, frame.slice(12)]), "openai", { timeoutMs: 2000 });
  assert(result.ok, "a data line spanning two chunks must still be recognized");
  assert((await result.response.text()) === frame, "replayed bytes must equal the original frame");
});
