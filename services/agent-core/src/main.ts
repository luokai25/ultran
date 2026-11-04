/**
 * Experimental loopback control surface for @ultron/agent-core.
 *
 * Android owns model discovery, verification, loading, and inference through
 * its native llama.cpp runtime. This process intentionally has no bundled
 * model provider; model endpoints fail closed until a backend is registered.
 */
import { createServer } from 'node:http';
import { BrainRuntime } from './brain/runtime.js';

const PORT = Number(process.env.ULTRON_PORT ?? 7700);
const HOST = '127.0.0.1';
const brain = new BrainRuntime({ backends: [] });
const backendUnavailable = {
  error: 'No inference backend is registered. Use the Android native model manager for local GGUF inference.',
};

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && req.url === '/health') {
    send(200, { service: '@ultron/agent-core', ...(await brain.health()) });
    return;
  }

  if (
    (req.method === 'GET' && req.url === '/models') ||
    (req.method === 'POST' && (req.url === '/models/load' || req.url === '/infer'))
  ) {
    send(503, backendUnavailable);
    return;
  }

  send(404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[agent-core] listening on http://${HOST} (inference backend not registered)`);
});
