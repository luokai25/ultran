import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/ultron-cognition.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Date, Map, Set, Math, RegExp, String, Boolean, Number, Array });
const cognition = module.exports;

test('cognitive profile keeps simple turns cheap and expands complex turns', () => {
  const direct = cognition.analyzeCognitiveProfile('Hello');
  const complex = cognition.analyzeCognitiveProfile('Compare these options and build the complete workflow', { hasAttachments: true });
  assert.equal(direct.mode, 'direct');
  assert.equal(direct.reasoningPasses, 1);
  assert.equal(complex.mode, 'deliberate');
  assert.ok(complex.needsCompletionAudit);
  assert.ok(complex.signals.includes('multiple_objectives'));
});

test('critical tasks receive evidence and impact controls', () => {
  const profile = cognition.analyzeCognitiveProfile('Deploy to production and delete old customer data');
  const instructions = cognition.buildCognitiveInstructions(profile);
  assert.equal(profile.mode, 'critical');
  assert.match(instructions, /IMPACT CONTROL/);
  assert.match(instructions, /EVIDENCE DISCIPLINE/);
});

test('evidence assessments preserve provenance and expose inference limitations', () => {
  const result = cognition.assessCognitiveEvidence({ id: 'i1', claim: 'A likely cause', kind: 'model_inference', source: 'reasoning' });
  assert.equal(result.status, 'weak');
  assert.ok(result.limitations.some(item => item.includes('inference')));
});

test('decision ranking accounts for missing criteria rather than rewarding missing data', () => {
  const ranked = cognition.rankDecisionOptions(
    [{ id: 'quality', weight: 2, direction: 'maximize' }, { id: 'cost', weight: 1, direction: 'minimize' }],
    [{ id: 'a', label: 'A', scores: { quality: 90, cost: 20 } }, { id: 'b', label: 'B', scores: { quality: 100 } }],
  );
  assert.equal(ranked[0].option.id, 'a');
  assert.equal(Array.from(ranked[1].missingCriteria).join(','), 'cost');
});

test('conflicting facts remain visible with source and priority', () => {
  const conflicts = cognition.detectCognitiveConflicts([
    { key: 'runtime', value: 'local', source: 'user', priority: 2 },
    { key: 'runtime', value: 'cloud', source: 'old note', priority: 1 },
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].alternatives[0].value, 'local');
});

test('completion gate refuses unverified work and stops on a real blocker', () => {
  const verify = cognition.evaluateCognitiveCompletion({ required: 3, completed: 2, verified: 1, blocked: 0, failed: 0, unresolvedRisks: 0, deliverableExists: true });
  assert.equal(verify.next, 'verify');
  const blocked = cognition.evaluateCognitiveCompletion({ required: 3, completed: 1, verified: 1, blocked: 1, failed: 0, unresolvedRisks: 0, deliverableExists: false });
  assert.equal(blocked.stop, true);
  assert.equal(blocked.next, 'report_blocker');
});

test('completion gate accepts only a present, fully verified deliverable', () => {
  const done = cognition.evaluateCognitiveCompletion({ required: 2, completed: 2, verified: 2, blocked: 0, failed: 0, unresolvedRisks: 0, deliverableExists: true });
  assert.equal(done.complete, true);
  assert.equal(done.next, 'deliver');
});


test('continuations and corrections become explicit cognitive state signals', () => {
  const continued = cognition.analyzeCognitiveProfile('Continue the implementation', { continuation: true });
  const corrected = cognition.analyzeCognitiveProfile('Correction: I meant the local runtime', { priorCorrection: true });
  assert.ok(continued.signals.includes('continuation'));
  assert.ok(corrected.signals.includes('correction'));
  assert.equal(continued.needsCompletionAudit, true);
});


test('adaptive reasoning escalates only after repeated verified failures in the same task class', () => {
  const baseline = cognition.analyzeCognitiveProfile('Hello');
  const now = 1_000_000_000;
  const history = [
    { taskClass:'implementation', status:'verified_failure', verified:true, confidence:.9, at:now - 3_000 },
    { taskClass:'implementation', status:'verified_failure', verified:true, confidence:.88, at:now - 2_000 },
    { taskClass:'implementation', status:'verified_success', verified:true, confidence:.95, at:now - 1_000 },
    { taskClass:'research', status:'verified_failure', verified:true, confidence:.99, at:now },
    { taskClass:'implementation', status:'verified_failure', verified:false, confidence:1, at:now },
    { taskClass:'implementation', status:'verified_failure', verified:true, confidence:.5, at:now },
  ];
  const result = cognition.calibrateReasoningDepth(baseline, history, 'implementation', now);
  assert.equal(result.adjustment, 'escalated');
  assert.equal(result.sampleCount, 3);
  assert.equal(result.failureCount, 2);
  assert.equal(result.profile.mode, 'deliberate');
  assert.equal(result.profile.reasoningPasses, 3);
  assert.equal(result.profile.needsCompletionAudit, true);
});

test('adaptive reasoning ignores confidence-only, unverified, stale and cross-class signals', () => {
  const baseline = cognition.analyzeCognitiveProfile('Hello');
  const now = 1_000_000_000;
  const result = cognition.calibrateReasoningDepth(baseline, [
    { taskClass:'implementation', status:'verified_failure', verified:false, confidence:1, at:now },
    { taskClass:'implementation', status:'verified_failure', verified:true, confidence:.7, at:now },
    { taskClass:'research', status:'verified_failure', verified:true, confidence:.99, at:now },
    { taskClass:'implementation', status:'verified_failure', verified:true, confidence:.99, at:now - 100 * 86_400_000 },
  ], 'implementation', now);
  assert.equal(result.adjustment, 'baseline');
  assert.equal(result.sampleCount, 0);
  assert.equal(result.profile.reasoningPasses, baseline.reasoningPasses);
});

test('sustained verified success clears escalation without reducing baseline reasoning depth', () => {
  const baseline = cognition.analyzeCognitiveProfile('Hello');
  const now = 1_000_000_000;
  const history = Array.from({ length:5 }, (_, index) => ({ taskClass:'question', status:'verified_success', verified:true, confidence:.95, at:now - index * 1_000 }));
  const result = cognition.calibrateReasoningDepth(baseline, history, 'question', now);
  assert.equal(result.adjustment, 'recovered');
  assert.equal(result.profile.reasoningPasses, baseline.reasoningPasses);
});

test('runtime feeds verified outcome history into task-class reasoning calibration', () => {
  const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /calibrateReasoningDepth\(cognitiveProfile/);
  assert.match(main, /outcome\." \+ profile\.intent/);
  assert.match(main, /outcome\." \+ finalProfile\.intent/);
  assert.match(main, /calibrationContext/);
});

test('adaptive reasoning counts one outcome per conversation correlation', () => {
  const baseline = cognition.analyzeCognitiveProfile('Hello');
  const now = 1_000_000_000;
  const history = [
    { id:'a', correlationId:'same-chat', taskClass:'implementation', status:'verified_failure', verified:true, confidence:.9, at:now - 2_000 },
    { id:'b', correlationId:'same-chat', taskClass:'implementation', status:'verified_failure', verified:true, confidence:.9, at:now - 1_000 },
    { id:'c', correlationId:'other-chat', taskClass:'implementation', status:'verified_failure', verified:true, confidence:.9, at:now },
  ];
  const result = cognition.calibrateReasoningDepth(baseline, history, 'implementation', now);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.adjustment, 'baseline');
});
