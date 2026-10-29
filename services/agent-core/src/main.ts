/**
 * Process entry for @ultran/agent-core.
 *
 * Binds a loopback-only HTTP surface. There is no remote path into the brain
 * or the sandbox: the listener binds 127.0.0.1, and every mutation is
 * validated against the active grant set.
 */

import { createServer } from 'node:http';
import { BrainRuntime } from './brain/runtime.js';
import { InMemoryGrantStore } from './sandbox/grants.js';
import { ToolSandbox } from './sandbox/sandbox.js';
import { UsageLedger } from './monetization/ledger.js';
import { PolicyGate } from './monetization/policy-gate.js';

const PORT = Number(process.env.ULTRAN_PORT ?? 7700);
const HOST = '127.0.0.1';

const brain = new BrainRuntime({ backends: [] });
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

const server = createServer((req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && req.url === '/health') {
    void brain.health().then((health) => send(200, health));
    return;
  }

  send(404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[agent-core] listening on http://${HOST}:${PORT}`);
});
