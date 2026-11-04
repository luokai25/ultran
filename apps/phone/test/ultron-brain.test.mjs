import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/ultron-brain.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Date, Set, Math, RegExp, String, Boolean, Number });
const brain = module.exports;

test('ULTRON handles greetings and simple questions without invoking tools', () => {
  assert.equal(brain.classifyUltronTask('Hello').intent, 'conversation');
  assert.equal(brain.classifyUltronTask('What is photosynthesis?').toolDecision, 'not_needed');
  assert.equal(brain.createUltronPlan('What is 2 + 2?').length, 2);
});

test('ULTRON distinguishes making a file from taking an external action', () => {
  assert.equal(brain.classifyUltronTask('Create a PDF explaining gravity').intent, 'creation');
  assert.equal(brain.classifyUltronTask('Send this PDF to my colleague').intent, 'external_action');
});

test('ULTRON scales depth and verification for implementation and high-impact tasks', () => {
  const implementation = brain.classifyUltronTask('Build and test a connector integration');
  assert.equal(implementation.depth, 'deep');
  assert.equal(implementation.requiresVerification, true);
  const critical = brain.classifyUltronTask('Delete all production customer data');
  assert.equal(critical.risk, 'critical');
  assert.equal(critical.toolDecision, 'approval_required');
});

test('ULTRON plans complex work with a verification stage', () => {
  const profile = brain.classifyUltronTask('Implement a complete offline model importer and test every path');
  const plan = brain.createUltronPlan('Implement a complete offline model importer and test every path', profile);
  assert.ok(plan.some(step => step.kind === 'verify'));
  assert.ok(plan.some(step => step.kind === 'reason'));
});

test('ULTRON ranks relevant memories and labels them as untrusted evidence', () => {
  const ranked = brain.rankUltronMemory('Ultron offline model importer', [
    { id: 'a', text: 'Ultron offline model importer design', kind: 'project', confidence: .9 },
    { id: 'b', text: 'Favourite recipes and cooking notes', kind: 'topic' },
  ]);
  assert.equal(ranked[0].item.id, 'a');
  assert.match(brain.buildUltronMemoryContext(ranked), /untrusted contextual evidence/);
});

test('ULTRON blocks unavailable tools and requires approval for consequential actions', () => {
  const profile = brain.classifyUltronTask('Send a message to the customer');
  const blocked = brain.assessUltronTool('Send a message to the customer', profile, { id:'mail', name:'Mail', description:'send mail', readOnly:false, requiresApproval:true, available:false }, true);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.decision, 'blocked');
  const approval = brain.assessUltronTool('Send a message to the customer', profile, { id:'mail', name:'Mail', description:'send mail', readOnly:false, requiresApproval:true, available:true }, true);
  assert.equal(approval.decision, 'approval_required');
});

test('ULTRON approval is bound to the exact pending action fingerprint', () => {
  assert.equal(brain.isUltronApprovalForAction('Yes, do it', 'send:alice:hello', 'send:alice:hello'), true);
  assert.equal(brain.isUltronApprovalForAction('Yes, do it', 'delete:all', 'send:alice:hello'), false);
});

test('ULTRON validates empty drafts and suspicious claims of external success', () => {
  assert.equal(brain.validateUltronDraft('Explain this', '', brain.classifyUltronTask('Explain this')).accepted, false);
  const result = brain.validateUltronDraft('Send this email', 'I successfully sent the email.', brain.classifyUltronTask('Send this email'));
  assert.ok(result.issues.some(issue => issue.code === 'unverified-action-claim'));
});

test('ULTRON runtime contract identifies the imported model as brain and avoids multi-agent overhead', () => {
  const prompt = brain.buildUltronBrainContract({ model:'Qwen local', task:'Explain gravity' });
  assert.match(prompt, /ULTRON PROGRAMMED IDENTITY RUNTIME/);
  assert.match(prompt, /Qwen local/);
  assert.match(prompt, /Do not add agent loops/);
});

test('ULTRON decision trace is bounded and can be cleared', () => {
  const trace = new brain.UltronDecisionTrace(2);
  trace.record({ phase:'classify', code:'a', detail:'one' });
  trace.record({ phase:'plan', code:'b', detail:'two' });
  trace.record({ phase:'tool', code:'c', detail:'three' });
  assert.equal(trace.snapshot().length, 2);
  trace.clear();
  assert.equal(trace.snapshot().length, 0);
});


test('ULTRON task ledger enforces dependencies and evidence-backed completion', () => {
  let ledger = brain.createUltronTaskLedger('task-1', 'Implement and test a local connector');
  const first = brain.nextUltronLedgerStep(ledger);
  assert.equal(first.id, 'understand');
  let transition = brain.transitionUltronLedger(ledger, 'understand', 'running');
  assert.equal(transition.ok, true);
  ledger = transition.ledger;
  transition = brain.transitionUltronLedger(ledger, 'understand', 'completed', { summary:'Constraints captured' });
  assert.equal(transition.ok, false, 'cannot complete without evidence');
  transition = brain.transitionUltronLedger(ledger, 'understand', 'completed', { summary:'Constraints captured', evidence:'Task and constraints were extracted from the current user message.' });
  assert.equal(transition.ok, true);
  ledger = transition.ledger;
  assert.equal(brain.nextUltronLedgerStep(ledger).id, 'reason');
});

test('ULTRON ledger refuses invalid transitions and keeps completed work immutable', () => {
  const ledger = brain.createUltronTaskLedger('task-2', 'Explain a concept');
  const completed = brain.transitionUltronLedger(ledger, 'understand', 'completed', { evidence:'Reviewed the user request.' });
  assert.equal(completed.ok, false, 'cannot skip the running state');
  const running = brain.transitionUltronLedger(ledger, 'understand', 'running');
  const done = brain.transitionUltronLedger(running.ledger, 'understand', 'completed', { evidence:'Reviewed the user request.' });
  const changed = brain.transitionUltronLedger(done.ledger, 'understand', 'failed');
  assert.equal(changed.ok, false);
});

test('ULTRON memory admission rejects sensitive, weak, expired and stale facts', () => {
  const now = Date.now();
  const base = { id:'preferred-language', value:'English', confidence:.95, source:'user statement', observedAt:now, sensitivity:'ordinary' };
  assert.equal(brain.admitUltronMemoryFact({ ...base, sensitivity:'sensitive' }, []).accepted, false);
  assert.equal(brain.admitUltronMemoryFact({ ...base, confidence:.4 }, []).accepted, false);
  assert.equal(brain.admitUltronMemoryFact({ ...base, expiresAt:now-1000 }, []).accepted, false);
  assert.equal(brain.admitUltronMemoryFact({ ...base, observedAt:now-100 }, [base]).accepted, false);
});

test('ULTRON memory conflicts require explicit supersession and system constraints stay highest priority', () => {
  const now = Date.now();
  const oldFact = { id:'theme-v1', key:'theme', value:'gold', confidence:.9, source:'old preference', observedAt:now-1000, sensitivity:'ordinary' };
  const conflict = { ...oldFact, id:'theme-v2', value:'red', source:'new statement', observedAt:now };
  assert.equal(brain.admitUltronMemoryFact(conflict, [oldFact]).accepted, false);
  const accepted = brain.admitUltronMemoryFact({ ...conflict, supersedes:'theme-v1' }, [oldFact]);
  assert.equal(accepted.accepted, true);
  assert.deepEqual(brain.activeUltronMemoryFacts([oldFact, accepted.fact]).map(fact => fact.id), ['theme-v2']);
  const resolved = brain.resolveUltronConstraints([
    { id:'privacy', description:'old user preference', source:'prior_user', priority:10, hard:false },
    { id:'privacy', description:'current privacy request', source:'current_user', priority:1, hard:true },
    { id:'privacy', description:'system privacy rule', source:'system', priority:1, hard:true },
  ]);
  assert.equal(resolved[0].source, 'system');
});
