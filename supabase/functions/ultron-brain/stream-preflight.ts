/**
 * Provider stream preflight for ultron-brain.
 *
 * A provider can answer HTTP 200 and still fail the generation: OpenRouter sends
 * `data: {"error": ...}` as the first SSE event for upstream 429/5xx, gateways
 * can keep an idle connection open while a free model is queued, and some
 * models finish immediately with no text. Returning that stream to the browser
 * produces a blank or "completed without returning any text" turn even though
 * another key could have answered.
 *
 * `preflightStream` reads only until the first real sign of generation (text,
 * reasoning or tool-call delta), an error event, end-of-stream or the deadline.
 * On success the buffered bytes are replayed in front of the live stream, so
 * the caller forwards an unmodified provider stream. On failure the upstream
 * reader is cancelled and the caller can fall through to the next key.
 */

export type PreflightProtocol = "openai" | "cohere";

export type PreflightResult =
  | { ok: true; response: Response }
  | { ok: false; reason: string; providerStatus: number | null };

type Json = Record<string, unknown>;
type Verdict = { kind: "progress" } | { kind: "error"; reason: string; status: number | null } | { kind: "ignore" };

const isObject = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
const hasText = (value: unknown): boolean => typeof value === "string" && value.length > 0;
const IGNORE: Verdict = { kind: "ignore" };

function errorVerdict(error: unknown, fallbackStatus: unknown): Verdict {
  const message = typeof error === "string" ? error : isObject(error) && typeof error.message === "string" ? error.message : "Provider reported an error.";
  const rawCode = isObject(error) ? error.code ?? error.status : fallbackStatus;
  const code = Number(rawCode);
  return { kind: "error", reason: message.slice(0, 240), status: Number.isInteger(code) && code >= 100 && code <= 599 ? code : null };
}

export function inspectProviderEvent(protocol: PreflightProtocol, event: unknown): Verdict {
  if (!isObject(event)) return IGNORE;
  if (event.error) return errorVerdict(event.error, event.status);
  if (protocol === "cohere") {
    if (event.type === "error") return errorVerdict(event.message ?? "Provider reported an error.", event.status);
    const delta = isObject(event.delta) ? event.delta : {};
    const message = isObject(delta.message) ? delta.message : {};
    const content = isObject(message.content) ? message.content : {};
    return hasText(content.text) || hasText(delta.text) ? { kind: "progress" } : IGNORE;
  }
  const choice = Array.isArray(event.choices) && isObject(event.choices[0]) ? event.choices[0] : null;
  if (!choice) return IGNORE;
  const delta = isObject(choice.delta) ? choice.delta : isObject(choice.message) ? choice.message : {};
  const content = delta.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => isObject(part) && typeof part.text === "string" ? part.text : "").join("") : "";
  if (text.length > 0 || hasText(delta.reasoning) || hasText(delta.reasoning_content) || (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0)) return { kind: "progress" };
  if (hasText(choice.text)) return { kind: "progress" };
  return IGNORE;
}

const TIMED_OUT = Symbol("preflight_timeout");

async function readWithin(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number): Promise<ReadableStreamReadResult<Uint8Array> | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), Math.max(1, ms)); });
  try { return await Promise.race([reader.read(), timeout]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function preflightStream(
  upstream: Response,
  protocol: PreflightProtocol,
  options: { timeoutMs: number },
): Promise<PreflightResult> {
  if (!upstream.body) return { ok: false, reason: "Provider returned no response stream.", providerStatus: null };
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const buffered: Uint8Array[] = [];
  const deadline = Date.now() + options.timeoutMs;
  let pending = "";
  let rawText = "";

  const fail = async (reason: string, providerStatus: number | null): Promise<PreflightResult> => {
    await reader.cancel().catch(() => undefined);
    return { ok: false, reason, providerStatus };
  };
  const inspectLine = (line: string): Verdict => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return IGNORE;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return IGNORE;
    try { return inspectProviderEvent(protocol, JSON.parse(data)); } catch { return IGNORE; }
  };

  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array> | typeof TIMED_OUT;
    try { chunk = await readWithin(reader, deadline - Date.now()); }
    catch (error) { return fail(error instanceof Error ? error.message.slice(0, 240) : "Provider stream failed.", null); }
    if (chunk === TIMED_OUT) return fail("Model produced no output in time.", null);
    if (chunk.done) {
      // Some OpenAI-compatible gateways ignore stream=true and return one JSON body.
      const verdict = ((): Verdict => {
        const tail = inspectLine(pending);
        if (tail.kind !== "ignore") return tail;
        try { return inspectProviderEvent(protocol, JSON.parse(rawText)); } catch { return IGNORE; }
      })();
      if (verdict.kind === "error") return { ok: false, reason: verdict.reason, providerStatus: verdict.status };
      if (verdict.kind !== "progress") return { ok: false, reason: "Model returned an empty response.", providerStatus: null };
      return { ok: true, response: replay(upstream, reader, buffered) };
    }
    buffered.push(chunk.value);
    const text = decoder.decode(chunk.value, { stream: true });
    if (rawText.length < 200_000) rawText += text;
    pending += text;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const verdict = inspectLine(line);
      if (verdict.kind === "error") return fail(verdict.reason, verdict.status);
      if (verdict.kind === "progress") return { ok: true, response: replay(upstream, reader, buffered) };
    }
  }
}

function replay(upstream: Response, reader: ReadableStreamDefaultReader<Uint8Array>, buffered: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of buffered) controller.enqueue(chunk); },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) controller.close();
      else if (value) controller.enqueue(value);
    },
    cancel(reason) { return reader.cancel(reason).catch(() => undefined); },
  });
  return new Response(stream, { status: upstream.status, headers: new Headers(upstream.headers) });
}
