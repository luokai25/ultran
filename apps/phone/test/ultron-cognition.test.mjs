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
