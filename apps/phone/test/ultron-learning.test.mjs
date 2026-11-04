import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/ultron-learning.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Date, Math, Set, Number, String, Boolean, Array, Object, RegExp });
const learning = module.exports;

test('learning events store bounded metadata and reject raw prompt-sized payloads', () => {
  let ledger = learning.createLearningLedger();
  const event = { id:'event-001', signal:'task_failure', category:'attachments', summary:'Attachment preview overflowed the composer.', severity:'medium', source:'runtime', evidenceIds:[] };
  const saved = learning.recordLearningEvent(ledger, event);
  assert.equal(saved.accepted, true);
  ledger = saved.ledger;
  assert.equal(ledger.events.length, 1);
  assert.equal(learning.recordLearningEvent(ledger, { ...event, id:'event-002', summary:'x'.repeat(501) }).accepted, false);
});

test('improvement proposals require existing evidence and testable hypotheses', () => {
  let ledger = learning.createLearningLedger();
  const recorded = learning.recordLearningEvent(ledger, { id:'event-101', signal:'verification_failure', category:'memory', summary:'A superseded memory remained active.', severity:'high', source:'test', evidenceIds:[] });
  ledger = recorded.ledger;
  const proposal = learning.proposeLearningImprovement(ledger, { id:'proposal-101', title:'Fix memory supersession', hypothesis:'Ensure an expired replacement cannot hide its still-valid predecessor.', category:'memory', evidenceIds:['missing-101'], impact:.8, confidence:.9, risk:.1 });
  assert.equal(proposal.accepted, false);
  const valid = learning.proposeLearningImprovement(ledger, { id:'proposal-102', title:'Fix memory supersession', hypothesis:'Ensure an expired replacement cannot hide its still-valid predecessor.', category:'memory', evidenceIds:['event-101'], impact:.8, confidence:.9, risk:.1 });
  assert.equal(valid.accepted, true);
  assert.equal(valid.proposal.status, 'proposed');
});

test('repeated observations merge into one proposal and increase recurrence priority', () => {
  let ledger = learning.createLearningLedger();
  for (let i = 1; i <= 2; i++) ledger = learning.recordLearningEvent(ledger, { id:`event-20${i}`, signal:'tool_failure', category:'runtime', summary:`Runtime issue ${i}.`, severity:'medium', source:'runtime', evidenceIds:[] }).ledger;
  const first = learning.proposeLearningImprovement(ledger, { id:'proposal-201', title:'Improve runtime retry handling', hypothesis:'Retry transient failures once with bounded backoff and preserve error context.', category:'runtime', evidenceIds:['event-201'], impact:.7, confidence:.8, risk:.2 });
  const second = learning.proposeLearningImprovement(first.ledger, { id:'proposal-202', title:'Improve runtime retry handling', hypothesis:'Retry transient failures once with bounded backoff and preserve error context.', category:'runtime', evidenceIds:['event-202'], impact:.7, confidence:.8, risk:.2 });
  assert.equal(second.ledger.proposals.length, 1);
  assert.ok(second.proposal.recurrence > first.proposal.recurrence);
});

test('approval and implementation are tied to the exact proposal; verification requires evidence', () => {
  let ledger = learning.createLearningLedger();
  ledger = learning.recordLearningEvent(ledger, { id:'event-301', signal:'user_correction', category:'response', summary:'The response ignored the requested language.', severity:'medium', source:'user_feedback', evidenceIds:[] }).ledger;
  ledger = learning.proposeLearningImprovement(ledger, { id:'proposal-301', title:'Respect response language', hypothesis:'Check the latest user message language before constructing the response contract.', category:'response', evidenceIds:['event-301'], impact:.8, confidence:.9, risk:.1 }).ledger;
  const token = 'ultron-learning:proposal-301:response::respect response language';
  assert.equal(learning.approveLearningProposal(ledger, 'proposal-301', token, 'other-token').accepted, false);
  ledger = learning.approveLearningProposal(ledger, 'proposal-301', token, token).ledger;
  assert.equal(learning.transitionLearningProposal(ledger, 'proposal-301', 'implemented', { approvalFingerprint:'wrong' }).accepted, false);
  ledger = learning.transitionLearningProposal(ledger, 'proposal-301', 'implemented', { approvalFingerprint:token }).ledger;
  assert.equal(learning.transitionLearningProposal(ledger, 'proposal-301', 'verified').accepted, false);
  const verified = learning.transitionLearningProposal(ledger, 'proposal-301', 'verified', { evidence:'Unit tests passed and regression reproduced as fixed.' });
  assert.equal(verified.proposal.status, 'verified');
});

test('learning ledger import drops malformed records and prompt context never claims proposals are implemented', () => {
  const imported = learning.validateLearningLedger({ version:1, events:[null, { id:'ok-event', at:Date.now(), summary:'short', category:'x', evidenceIds:[] }], proposals:[], updatedAt:Date.now() });
  assert.equal(imported.events.length, 1);
  assert.equal(learning.buildLearningContext(imported), '');
});
