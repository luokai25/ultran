/**
 * Process entry for @ultran/agent-core.
 *
 * Binds to loopback by default. The local brain uses Ollama when available;
 * models must be explicitly loaded with a SHA-256 digest before inference.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { BrainRuntime } from './brain/runtime.js';
import { OllamaBackend } from './brain/ollama-backend.js';
import type { ModelRef } from './brain/types.js';
import { InMemoryGrantStore } from './sandbox/grants.js';
import { ToolSandbox } from './sandbox/sandbox.js';
import { UsageLedger } from './monetization/ledger.js';
import { PolicyGate } from './monetization/policy-gate.js';

const PORT = Number(process.env.ULTRAN_PORT ?? 7700);
// Keep this unauthenticated local control surface loopback-only.
const HOST = '127.0.0.1';
const OLLAMA_URL = process.env.ULTRAN_OLLAMA_URL ?? 'http://127.0.0.1:11434';

const ollama = new OllamaBackend({ endpoint: OLLAMA_URL });
const brain = new BrainRuntime({ backends: [ollama] });
const grants = new InMemoryGrantStore();
const sandbox = new ToolSandbox(grants);
const ledger = new UsageLedger();
const policyGate = new PolicyGate(ledger, {
  plan: 'free',
  limits: { 'tokens.in': 250_000, 'tool.calls': 500 },
  features: [],
  expiresAt: Date.now() + 24 * 60 * 60 * 1000,
});
void sandbox;
void policyGate;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > 1_048_576) throw new Error('request body exceeds 1 MiB limit');
    chunks.push(part);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  try {
    if (req.method === 'GET' && req.url === '/health') {
      send(200, { service: '@ultran/agent-core', ...(await brain.health()) });
      return;
    }

    if (req.method === 'GET' && req.url === '/models') {
      send(200, { models: await ollama.listModels() });
      return;
    }

    if (req.method === 'POST' && req.url === '/models/load') {
      const body = await readJson(req);
      if (typeof body.id !== 'string' || typeof body.sha256 !== 'string') {
        send(400, { error: 'id and sha256 are required strings' });
        return;
      }
      const contextWindow = typeof body.contextWindow === 'number' ? body.contextWindow : 8192;
      if (!Number.isInteger(contextWindow) || contextWindow < 1 || contextWindow > 1_000_000) {
        send(400, { error: 'contextWindow must be a positive integer no greater than 1000000' });
        return;
      }
      const ref: ModelRef = { id: body.id.trim(), backend: 'ollama', sha256: body.sha256, contextWindow };
      if (!ref.id) {
        send(400, { error: 'id must not be empty' });
        return;
      }
      const handle = await brain.load(ref);
      send(200, { loaded: true, model: handle.ref, loadedAt: handle.loadedAt });
      return;
    }

    if (req.method === 'POST' && req.url === '/infer') {
      const body = await readJson(req);
      if (typeof body.modelId !== 'string' || typeof body.prompt !== 'string' || !body.prompt.trim()) {
        send(400, { error: 'modelId and a non-empty prompt are required' });
        return;
      }
      const maxTokens = typeof body.maxTokens === 'number' ? body.maxTokens : 512;
      const temperature = typeof body.temperature === 'number' ? body.temperature : 0.2;
      if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) {
        send(400, { error: 'maxTokens must be an integer between 1 and 8192' });
        return;
      }
      if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
        send(400, { error: 'temperature must be between 0 and 2' });
        return;
      }
      const tokens: string[] = [];
      for await (const token of brain.infer(body.modelId, {
        prompt: body.prompt,
        ...(typeof body.system === 'string' ? { system: body.system } : {}),
        maxTokens,
        temperature,
      })) tokens.push(token.text);
      const output = tokens.join('');
      send(200, {
        modelId: body.modelId,
        text: output,
        tokensIn: Math.max(1, Math.ceil(body.prompt.length / 4)),
        tokensOut: Math.max(1, Math.ceil(output.length / 4)),
      });
      return;
    }

    send(404, { error: 'not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'internal error';
    const status = /request body|JSON|must be|required|between|positive integer|exceeds 1 MiB|empty/i.test(message) ? 400 : 503;
    send(status, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[agent-core] listening on http://${HOST}:${PORT}; Ollama: ${OLLAMA_URL}`);
});
