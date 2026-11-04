import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { assessRepairFailure, repairUnactivatedCandidate } from './generated-tool-repair.js';

test('security, permission and authentication failures never auto-retry', () => {
  for (const message of ['sandbox escape blocked', 'permission denied', 'invalid api key 401']) {
    const result = assessRepairFailure(message, { executionNotStarted: true, operation: 'read_only', repairAttempts: 0 });
    assert.equal(result.retryable, false);
    assert.equal(result.action, 'stop');
  }
});

test('ambiguous writes and timeouts are never replayed', () => {
  const result = assessRepairFailure('connection reset', { executionNotStarted: false, operation: 'write', repairAttempts: 0 });
  assert.equal(result.category, 'ambiguous_side_effect');
  assert.equal(result.retryable, false);
});

test('dependency changes require approval', () => {
  const result = assessRepairFailure('Module not found: pandas', { executionNotStarted: true, operation: 'unknown', repairAttempts: 0 });
  assert.equal(result.action, 'request_dependency_approval');
  assert.equal(result.retryable, false);
});

test('only pre-execution syntax/schema defects receive at most two candidate repairs', () => {
  assert.equal(assessRepairFailure('SyntaxError: invalid syntax', { executionNotStarted: true, operation: 'unknown', repairAttempts: 0 }).retryable, true);
  assert.equal(assessRepairFailure('SyntaxError: invalid syntax', { executionNotStarted: false, operation: 'unknown', repairAttempts: 0 }).retryable, false);
  assert.equal(assessRepairFailure('SyntaxError: invalid syntax', { executionNotStarted: true, operation: 'unknown', repairAttempts: 2 }).retryable, false);
});

test('read-only network retry requires a fresh grant and is bounded to one', () => {
  assert.equal(assessRepairFailure('ENOTFOUND host', { executionNotStarted: false, operation: 'read_only', repairAttempts: 0 }).action, 'retry_read_only_with_fresh_grant');
  assert.equal(assessRepairFailure('ENOTFOUND host', { executionNotStarted: false, operation: 'read_only', repairAttempts: 1 }).retryable, false);
  assert.equal(assessRepairFailure('ENOTFOUND host', { executionNotStarted: false, operation: 'unknown', repairAttempts: 0 }).retryable, false);
});

test('candidate repair returns only reviewed and isolated-test-passing candidate pending approval', async () => {
  let generated = 0;
  let tested = 0;
  const result = await repairUnactivatedCandidate('def run(payload):', 'SyntaxError: invalid syntax', {
    generate: async () => { generated += 1; return 'corrected-source'; },
    review: async (source) => ({ source }),
    testInIsolatedWorker: async () => { tested += 1; return { passed: true, report: 'ok' }; },
    buildCandidate: (reviewed) => reviewed,
  });
  assert.equal(generated, 1);
  assert.equal(tested, 1);
  assert.equal(result.status, 'awaiting_approval');
  assert.deepEqual(result.candidate, { source: 'corrected-source' });
  assert.match(result.report, /approval is still required/);
});

test('failed isolated tests consume bounded repair attempts and never activate', async () => {
  let generated = 0;
  const result = await repairUnactivatedCandidate('source', 'SyntaxError: invalid syntax', {
    generate: async () => { generated += 1; return 'candidate-' + generated; },
    review: async (source) => source,
    testInIsolatedWorker: async () => ({ passed: false, report: 'regression' }),
    buildCandidate: (reviewed) => reviewed,
  });
  assert.equal(generated, 2);
  assert.equal(result.status, 'rejected');
  assert.equal(result.attempts, 2);
});
