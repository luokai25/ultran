import test from 'node:test';
import assert from 'node:assert/strict';
const [{ readFile }, ts, vm] = await Promise.all([
  import('node:fs/promises'),
  import('typescript'),
  import('node:vm'),
]);
const source = await readFile(new URL('../src/ultron-outcome-evaluator.ts', import.meta.url), 'utf8');
const compiled = ts.transpile(source, {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
});
const outcomeModule = { exports: {} };
vm.runInNewContext(compiled, {
  module: outcomeModule,
  exports: outcomeModule.exports,
});
const { evaluateUltronOutcome } = outcomeModule.exports;

const plan = [
  { id: 'step-understand', objective: 'Understand request', kind: 'understand', requiresTool: false, approval: false, completionSignal: 'scope known' },
  { id: 'step-act', objective: 'Perform action', kind: 'act', requiresTool: true, approval: false, completionSignal: 'action result' },
];
const base = {
  taskId: 'task-123',
  profile: { intent: 'external_action', requiresVerification: true },
  plan,
  validation: [],
  finalText: 'The requested action was completed and verified.',
};

test('does not mistake a confident final answer for verified success', () => {
  const result = evaluateUltronOutcome(base);
  assert.equal(result.status, 'unverified');
  assert.equal(result.cause, 'unknown');
  assert.equal(result.shouldRecord, false);
});

test('classifies a tool failure without duplicating the existing tool-failure event', () => {
  const result = evaluateUltronOutcome({ ...base, tools: [{ id: 'tool-123', ok: false }] });
  assert.equal(result.cause, 'tool_execution');
  assert.equal(result.status, 'failed');
  assert.equal(result.shouldRecord, false);
});

test('recognizes an approval boundary rather than calling it a reasoning error', () => {
  const result = evaluateUltronOutcome({ ...base, tools: [{ id: 'tool-123', ok: false, approvalRequired: true }] });
  assert.equal(result.cause, 'permission_boundary');
  assert.equal(result.status, 'blocked');
});

test('recognizes verified action only with successful tool evidence', () => {
  const result = evaluateUltronOutcome({ ...base, tools: [{ id: 'tool-123', ok: true, sideEffectVerified: true }] });
  assert.equal(result.cause, 'positive_strategy');
  assert.equal(result.status, 'verified_success');
});

test('classifies explicit failed plan steps as reasoning errors', () => {
  const result = evaluateUltronOutcome({ ...base, steps: [
    { id: 'step-understand', status: 'failed', evidenceId: 'evidence-1' },
    { id: 'step-act', status: 'completed', evidenceId: 'evidence-2' },
  ] });
  assert.equal(result.cause, 'reasoning_error');
  assert.equal(result.confidence, 0.86);
});

test('does not infer reasoning errors from missing plan telemetry', () => {
  const result = evaluateUltronOutcome({ ...base, profile: { intent: 'question', requiresVerification: true } });
  assert.equal(result.cause, 'unknown');
});

test('detects incomplete explicitly tracked plans', () => {
  const result = evaluateUltronOutcome({ ...base, steps: [
    { id: 'step-understand', status: 'completed', evidenceId: 'evidence-1' },
    { id: 'step-act', status: 'pending' },
  ] });
  assert.equal(result.cause, 'incomplete_result');
  assert.equal(result.status, 'partial');
});

test('validation warnings prevent success classification', () => {
  const result = evaluateUltronOutcome({ ...base, tools: [{ id: 'tool-123', ok: true }], validation: [{ code: 'claim', severity: 'warning', message: 'Needs verification' }] });
  assert.equal(result.cause, 'verification_gap');
  assert.equal(result.status, 'unverified');
});

test('a successful read-only tool cannot verify an external side effect', () => {
  const result = evaluateUltronOutcome({ ...base, tools: [{ id: 'tool-123', ok: true }] });
  assert.equal(result.status, 'unverified');
  assert.equal(result.cause, 'unknown');
});


test('an external action remains incomplete while its tracked verification step is pending', () => {
  const actionPlan = [
    { id:'step-understand', objective:'Understand request', kind:'understand' },
    { id:'step-act', objective:'Perform action', kind:'act' },
    { id:'step-verify', objective:'Verify action result', kind:'verify' },
    { id:'step-deliver', objective:'Deliver result', kind:'deliver' },
  ];
  const result = evaluateUltronOutcome({
    ...base,
    plan: actionPlan,
    tools: [{ id:'tool-123', ok:true, sideEffectVerified:true }],
    steps: [
      { id:'step-understand', status:'completed', evidenceId:'evidence-understand' },
      { id:'step-act', status:'completed', evidenceId:'evidence-act' },
      { id:'step-verify', status:'pending' },
      { id:'step-deliver', status:'pending' },
    ],
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.cause, 'incomplete_result');
});

test('a fully evidenced task ledger can establish a verified outcome', () => {
  const simplePlan = [
    { id:'step-understand', objective:'Understand request', kind:'understand' },
    { id:'step-answer', objective:'Answer request', kind:'deliver' },
  ];
  const result = evaluateUltronOutcome({
    ...base,
    profile: { intent:'question', requiresVerification:false },
    plan: simplePlan,
    steps: [
      { id:'step-understand', status:'completed', evidenceId:'evidence-understand' },
      { id:'step-answer', status:'completed', evidenceId:'evidence-answer' },
    ],
  });
  assert.equal(result.status, 'verified_success');
  assert.equal(result.cause, 'positive_strategy');
});

test('a successful tool alone never proves a non-action task was completed', () => {
  const result = evaluateUltronOutcome({
    ...base,
    profile: { intent: 'research', requiresVerification: false },
    tools: [{ id: 'tool-123', ok: true }],
  });
  assert.equal(result.status, 'unverified');
  assert.equal(result.cause, 'unknown');
});
