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

test('prior action fingerprints prevent replay after task resumption', async () => {
  let executed = false;
  const runtime = createAgentRuntime({
    tools: { 'test.write': { capability: 'write', execute: async () => { executed = true; } } },
    approve: async () => true,
    planner: async ({ round }) => round === 1
      ? { type: 'tool', name: 'test.write', args: { file: 'note.md' } }
      : { type: 'final', answer: 'The prior action was not repeated.' }
  });
  const crypto = require('node:crypto');
  const fingerprint = crypto.createHash('sha256').update('test.write:' + JSON.stringify({ file: 'note.md' })).digest('hex');
  const result = await runtime.run({
    goal: 'Resume safely',
    context: [{ role: 'tool', name: 'test.write', ok: false, error: 'Prior attempt outcome unknown.' }],
    priorFingerprints: [fingerprint]
  });
  assert.equal(executed, false);
  assert.equal(result.status, 'completed');
  assert.ok(result.journal.some(item => item.reason === 'repeated_exact_call'));
});

test('waits for durable started-event recording before executing a side effect', async () => {
  let journalSaved = false;
  let executed = false;
  const runtime = createAgentRuntime({
    tools: { 'test.write': { capability: 'write', execute: async () => { assert.equal(journalSaved, true); executed = true; } } },
    approve: async () => true,
    planner: async () => ({ type: 'tool', name: 'test.write', args: { value: 1 } }),
    limits: { maxRounds: 1, maxCalls: 1 },
    onEvent: async event => {
      if (event.type === 'tool_started') {
        await new Promise(resolve => setTimeout(resolve, 5));
        journalSaved = true;
      }
    }
  });
  const result = await runtime.run({ goal: 'Write safely' });
  assert.equal(executed, true);
  assert.equal(result.status, 'limit_reached');
});

test('cancellation during local model planning is reported as cancelled', async () => {
  const controller = new AbortController();
  const runtime = createAgentRuntime({
    tools: {}, approve: async () => false,
    planner: async () => { controller.abort(); throw new Error('fetch aborted'); }
  });
  const result = await runtime.run({ goal: 'Cancel planning', signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.reason, 'aborted');
});

test('records effect outcomes as verified only when the tool supplies verification evidence', async () => {
  const events = [];
  let step = 0;
  const runtime = createAgentRuntime({
    tools: {
      'test.write_unverified': { capability: 'write', execute: async () => ({ saved: true }) },
      'test.write_verified': { capability: 'write', execute: async () => ({ saved: true, verified: true }) }
    },
    approve: async () => true,
    planner: async () => {
      step++;
      if (step === 1) return { type: 'tool', name: 'test.write_unverified', args: {} };
      if (step === 2) return { type: 'tool', name: 'test.write_verified', args: {} };
      return { type: 'final', answer: 'Finished.' };
    },
    onEvent: async event => events.push(event)
  });
  const result = await runtime.run({ goal: 'Write two files' });
  assert.equal(result.effects[0].state, 'acknowledged_unverified');
  assert.equal(result.effects[1].state, 'verified');
  assert.equal(events.filter(event => event.type === 'effect_outcome').length, 2);
});

test('records failed side effects as uncertain rather than silently successful', async () => {
  const runtime = createAgentRuntime({
    tools: { 'test.write': { capability: 'write', execute: async () => { throw new Error('disk failure'); } } },
    approve: async () => true,
    planner: async ({ round }) => round === 1
      ? { type: 'tool', name: 'test.write', args: {} }
      : { type: 'final', answer: 'Unable to complete.' }
  });
  const result = await runtime.run({ goal: 'Write a file' });
  assert.equal(result.effects[0].state, 'failed_or_uncertain');
});
