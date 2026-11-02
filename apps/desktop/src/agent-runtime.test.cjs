'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentRuntime } = require('./agent-runtime.cjs');

test('executes a bounded multi-step plan and returns a planner final answer', async () => {
  let step = 0;
  const runtime = createAgentRuntime({
    tools: { 'test.read': { capability: 'read', execute: async () => ({ value: 42 }) } },
    approve: async request => request.capability === 'read',
    planner: async ({ history }) => {
      step++;
      if (step === 1) return { type: 'tool', name: 'test.read', args: { key: 'answer' } };
      assert.match(history.at(-1).output, /42/);
      return { type: 'final', answer: 'The value is 42.' };
    }
  });
  const result = await runtime.run({ goal: 'Read the answer' });
  assert.equal(result.status, 'completed');
  assert.equal(result.calls, 1);
  assert.equal(result.journal[0].status, 'succeeded');
});

test('denied write action never executes', async () => {
  let executed = false;
  const runtime = createAgentRuntime({
    tools: { 'test.write': { capability: 'write', execute: async () => { executed = true; } } },
    approve: async () => false,
    planner: async ({ history }) => history.length
      ? { type: 'final', answer: 'No change was made.' }
      : { type: 'tool', name: 'test.write', args: { value: 'x' } }
  });
  const result = await runtime.run({ goal: 'Write a value' });
  assert.equal(executed, false);
  assert.equal(result.journal[0].status, 'denied');
});

test('unknown tools fail closed', async () => {
  const runtime = createAgentRuntime({
    tools: {}, approve: async () => true,
    planner: async ({ history }) => history.length
      ? { type: 'final', answer: 'Unavailable.' }
      : { type: 'tool', name: 'host.shell', args: { command: 'whoami' } }
  });
  const result = await runtime.run({ goal: 'Run a command' });
  assert.equal(result.journal[0].reason, 'unknown_tool');
  assert.equal(result.calls, 0);
});

test('suppresses repeated exact calls and enforces round budget', async () => {
  let count = 0;
  const runtime = createAgentRuntime({
    tools: { 'test.read': { capability: 'read', execute: async () => { count++; return 'ok'; } } },
    approve: async () => true,
    limits: { maxRounds: 3, maxCalls: 4, maxOutputChars: 100 },
    planner: async () => ({ type: 'tool', name: 'test.read', args: { same: true } })
  });
  const result = await runtime.run({ goal: 'Repeat' });
  assert.equal(count, 1);
  assert.equal(result.status, 'limit_reached');
  assert.ok(result.journal.some(item => item.reason === 'repeated_exact_call'));
});

test('cancellation after approval prevents tool dispatch', async () => {
  const controller = new AbortController();
  let executed = false;
  const runtime = createAgentRuntime({
    tools: { 'test.read': { capability: 'read', execute: async () => { executed = true; } } },
    approve: async () => { controller.abort(); return true; },
    planner: async () => ({ type: 'tool', name: 'test.read', args: {} })
  });
  const result = await runtime.run({ goal: 'Cancel', signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.equal(executed, false);
});
