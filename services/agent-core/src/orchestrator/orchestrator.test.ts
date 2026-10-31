import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConnectorRegistry, type ConnectorManifest } from '@ultran/connectors';
import { BrainRuntime } from '../brain/runtime.js';
import { OllamaBackend } from '../brain/ollama-backend.js';
import { InMemoryGrantStore } from '../sandbox/grants.js';
import { ToolSandbox } from '../sandbox/sandbox.js';
import { UsageLedger } from '../monetization/ledger.js';
import { PolicyGate } from '../monetization/policy-gate.js';
import { Orchestrator } from './orchestrator.js';

const digest = 'a'.repeat(64);
const modelRef = { id: 'test-model', backend: 'ollama' as const, sha256: digest, contextWindow: 4096 };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function makeBrain() {
  const backend = new OllamaBackend({
    fetcher: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) return jsonResponse({ models: [{ name: modelRef.id, digest }] });
      const request = JSON.parse(String(init?.body ?? '{}')) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const system = request.messages?.find((message) => message.role === 'system')?.content ?? '';
      const prompt = request.messages?.find((message) => message.role === 'user')?.content ?? '';
      let content: string;
      if (system.includes('MODE: PLAN')) {
        content = JSON.stringify({ steps: [{
          id: 'step-1',
          candidates: ['demo.echo'],
          dependsOn: [],
          description: 'Echo the requested text using the demo tool',
        }] });
      } else if (system.includes('MODE: ACT')) {
        content = JSON.stringify({ toolId: 'demo.echo', args: { text: 'hello' } });
      } else if (prompt.includes('Actual outcomes:')) {
        content = prompt.includes('No human-approval resolver is configured')
          ? 'The task was not executed because approval was unavailable.'
          : 'The demo tool completed successfully and returned hello.';
      } else {
        content = 'The task is complete.';
      }
      const line = JSON.stringify({ message: { content }, done: true }) + '\n';
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(line));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
    },
  });
  const brain = new BrainRuntime({ backends: [backend] });
  return { brain, backend };
}

function makeRegistry() {
  const registry = new ConnectorRegistry();
  const manifest: ConnectorManifest = {
    id: 'demo',
    version: '1.0.0',
    displayName: 'Demo connector',
    capabilities: ['demo:read'],
    auth: { kind: 'none' },
    egress: [],
    tools: [{
      id: 'demo.echo',
      description: 'Return the supplied text',
      capability: 'demo:read',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
    }],
  };
  registry.load(manifest);
  return registry;
}

async function waitForRun(orchestrator: Orchestrator, runId: string) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const state = orchestrator.get(runId);
    if (state && state.status !== 'running') return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('orchestrator run did not finish before timeout');
}

test('orchestrator plans, selects, approves, executes, meters, and reflects through a replaceable brain', async () => {
  const { brain } = makeBrain();
  await brain.load(modelRef);
  const registry = makeRegistry();
  const grants = new InMemoryGrantStore();
  const sandbox = new ToolSandbox(grants);
  let invocations = 0;
  sandbox.register('demo', {
    exec: async (_toolId, args) => {
      invocations += 1;
      return { echoed: args.text };
    },
  });
  const ledger = new UsageLedger();
  const policyGate = new PolicyGate(ledger, {
    plan: 'test',
    limits: { 'tool.calls': 10 },
    features: [],
    expiresAt: Date.now() + 60_000,
  });
  const orchestrator = new Orchestrator({
    brain, registry, sandbox, policyGate, planModelId: modelRef.id,
    authorizeTool: async (request) => grants.issue({
      runId: request.runId,
      capabilities: [request.capability],
      expiresAt: Date.now() + 60_000,
      singleUse: true,
    }).id,
  });
  const runId = await orchestrator.start('Echo hello');
  const state = await waitForRun(orchestrator, runId);
  assert.equal(state.status, 'completed');
  assert.match(state.result ?? '', /completed successfully/);
  assert.equal(invocations, 1);
  assert.equal(ledger.totals().totals['tool.calls'], 1);
  assert.ok(state.events.some((event) => event.type === 'approval.required'));
  assert.ok(state.events.some((event) => event.type === 'tool.result' && event.ok));
});

test('orchestrator fails closed when no human approval resolver is connected', async () => {
  const { brain } = makeBrain();
  await brain.load(modelRef);
  const registry = makeRegistry();
  const grants = new InMemoryGrantStore();
  const sandbox = new ToolSandbox(grants);
  let invocations = 0;
  sandbox.register('demo', { exec: async () => { invocations += 1; return { ok: true }; } });
  const policyGate = new PolicyGate(new UsageLedger(), {
    plan: 'test', limits: { 'tool.calls': 10 }, features: [], expiresAt: Date.now() + 60_000,
  });
  const orchestrator = new Orchestrator({ brain, registry, sandbox, policyGate, planModelId: modelRef.id });
  const runId = await orchestrator.start('Echo hello');
  const state = await waitForRun(orchestrator, runId);
  assert.equal(state.status, 'cancelled');
  assert.equal(invocations, 0);
  assert.ok(state.events.some((event) => event.type === 'approval.required'));
  assert.match(state.result ?? '', /not invoked|approval/i);
});

test('policy gate accounts for the next call and stable meter keys prevent duplicate charges', async () => {
  const ledger = new UsageLedger();
  const gate = new PolicyGate(ledger, {
    plan: 'test', limits: { 'tool.calls': 2 }, features: [], expiresAt: Date.now() + 60_000,
  });
  assert.equal(await gate.check('run', 'tool.calls', 1), 'allow');
  assert.equal(gate.recordUsage('run', 'tool.calls', 1, 'run:step-1:tool.calls'), true);
  assert.equal(gate.recordUsage('run', 'tool.calls', 1, 'run:step-1:tool.calls'), false);
  assert.equal(await gate.check('run', 'tool.calls', 1), 'degrade');
  gate.recordUsage('run', 'tool.calls', 1, 'run:step-2:tool.calls');
  assert.equal(await gate.check('run', 'tool.calls', 1), 'deny');
});
