export const config = { maxDuration: 60 };

type Provider = "openrouter" | "mistral" | "cerebras" | "groq" | "cohere" | "google_ai_studio";
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type RequestBody = {
  action?: string;
  provider?: Provider;
  model_id?: string;
  api_key?: string;
  messages?: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
};

const PROVIDERS: Record<Provider, { models: string; chat: string; cohere?: boolean }> = {
  openrouter: { models: "https://openrouter.ai/api/v1/models", chat: "https://openrouter.ai/api/v1/chat/completions" },
  mistral: { models: "https://api.mistral.ai/v1/models", chat: "https://api.mistral.ai/v1/chat/completions" },
  cerebras: { models: "https://api.cerebras.ai/v1/models", chat: "https://api.cerebras.ai/v1/chat/completions" },
  groq: { models: "https://api.groq.com/openai/v1/models", chat: "https://api.groq.com/openai/v1/chat/completions" },
  cohere: { models: "https://api.cohere.com/v2/models?endpoint=chat&limit=100", chat: "https://api.cohere.com/v2/chat", cohere: true },
  google_ai_studio: { models: "https://generativelanguage.googleapis.com/v1beta/openai/models", chat: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" },
};

type VercelRequest = AsyncIterable<Uint8Array> & {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};
type VercelResponse = {
  status(code: number): VercelResponse;
  setHeader(name: string, value: string): void;
  write(chunk: string | Uint8Array): boolean;
  once(event: "drain", listener: () => void): void;
  end(chunk?: string): void;
};

const allowedOrigin = (origin: string) =>
  origin === "https://localhost" ||
  origin === "capacitor://localhost" ||
  origin === "http://localhost:5173" ||
  origin === "http://localhost" ||
  origin === "http://127.0.0.1:5173" ||
  /^https:\/\/[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app$/i.test(origin) ||
  origin === "https://ultron-pied-gamma.vercel.app" ||
  origin === "https://ultron-luokai25s-projects.vercel.app";

function sendJson(res: VercelResponse, status: number, value: unknown): void {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

async function readBody(req: VercelRequest): Promise<RequestBody> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > 1_000_000) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes)) as RequestBody;
}

function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

function compatibleModels(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown[]; models?: unknown[] }).data ??
    (payload as { models?: unknown[] }).models ?? [];
  return [...new Set(data.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { id?: unknown; name?: unknown };
    const id = String(row.id ?? row.name ?? "").replace(/^models\//, "").trim();
    if (!id || id.length > 180 || /embed|moderation|whisper|audio|tts|speech|transcri|live|realtime|bidi|image|rerank|classify/i.test(id)) return [];
    return [id];
  }))].sort();
}

async function handle(req: VercelRequest, res: VercelResponse): Promise<void> {
  const origin = String(req.headers.origin ?? "");
  if (origin && !allowedOrigin(origin)) {
    sendJson(res, 403, { error: "origin_not_allowed" });
    return;
  }
  res.setHeader("Vary", "Origin");
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, accept");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { sendJson(res, 405, { error: "method_not_allowed" }); return; }

  let body: RequestBody;
  try { body = await readBody(req); }
  catch (error) {
    sendJson(res, 400, { error: error instanceof Error && error.message === "request_too_large" ? "request_too_large" : "invalid_json" });
    return;
  }

  if (!isProvider(body.provider)) { sendJson(res, 400, { error: "unsupported_provider" }); return; }
  const provider = body.provider;
  const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : "";
  if (apiKey.length < 8 || apiKey.length > 8192) { sendJson(res, 400, { error: "api_key_required" }); return; }
  const config = PROVIDERS[provider];

  if (body.action === "verify_key" || body.action === "models") {
    try {
      const upstream = await fetch(config.models, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      const raw = await upstream.text();
      if (!upstream.ok) {
        sendJson(res, upstream.status, { error: "provider_rejected_key", message: raw.slice(0, 400) });
        return;
      }
      let payload: unknown;
      try { payload = JSON.parse(raw); } catch { sendJson(res, 502, { error: "provider_invalid_json" }); return; }
      sendJson(res, 200, { ok: true, models: compatibleModels(payload) });
    } catch {
      sendJson(res, 502, { error: "provider_unreachable" });
    }
    return;
  }

  if (body.action !== "chat") { sendJson(res, 400, { error: "unsupported_action" }); return; }
  const model = typeof body.model_id === "string" ? body.model_id.trim().slice(0, 180) : "";
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!model || !messages.length || messages.length > 100 ||
      messages.some((message) => !message || !["system", "user", "assistant"].includes(message.role) ||
        typeof message.content !== "string" || message.content.length > 24_000) ||
      !messages.some((message) => message.role === "user")) {
    sendJson(res, 400, { error: "valid_chat_request_required" });
    return;
  }

  let upstream: Response;
  try {
    const maxTokens = Math.max(64, Math.min(16_384, Number(body.max_tokens ?? 2048) || 2048));
    const temperature = Math.max(0, Math.min(2, Number(body.temperature ?? 0.3) || 0.3));
    upstream = await fetch(config.chat, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
        ...(provider === "openrouter" ? { "HTTP-Referer": "https://ultron-pied-gamma.vercel.app", "X-Title": "ULTRON" } : {}),
      },
      body: JSON.stringify(config.cohere
        ? { model, messages, stream: true, max_tokens: maxTokens, temperature }
        : { model, messages, stream: true, max_tokens: maxTokens, temperature }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    sendJson(res, 502, { error: "provider_unreachable", message: "The model provider could not be reached." });
    return;
  }

  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => "")).slice(0, 600);
    sendJson(res, upstream.status, { error: "provider_request_failed", message: detail });
    return;
  }
  if (!upstream.body) { sendJson(res, 502, { error: "provider_stream_unavailable" }); return; }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  const reader = upstream.body.getReader();
  try {
    if (!config.cohere) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) await new Promise<void>((resolve) => res.once("drain", resolve));
      }
    } else {
      const decoder = new TextDecoder();
      let buffer = "";
      const emitLine = async (rawLine: string): Promise<void> => {
        const line = rawLine.replace(/\r$/, "").trim();
        if (!line.startsWith("data:")) return;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") return;
        try {
          const event = JSON.parse(raw) as { type?: string; delta?: { message?: { content?: { text?: string } }; text?: string } };
          const token = event.delta?.message?.content?.text ?? event.delta?.text ?? "";
          if (token) {
            const chunk = "data: " + JSON.stringify({ choices: [{ delta: { content: token } }] }) + "\\n\\n";
            if (!res.write(chunk)) await new Promise<void>((resolve) => res.once("drain", resolve));
          }
        } catch { /* Ignore non-JSON Cohere event payloads. */ }
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          await emitLine(line);
          newline = buffer.indexOf("\n");
        }
        if (done) {
          if (buffer.length) await emitLine(buffer);
          break;
        }
      }
      res.write("data: [DONE]\n\n");
    }
    res.end();
  } catch {
    try { await reader.cancel(); } catch { /* client disconnected */ }
    res.end();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await handle(req, res);
}
