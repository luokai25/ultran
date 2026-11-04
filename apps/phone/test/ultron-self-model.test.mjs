import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/ultron-self-model.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Date, Map, Set, Math, RegExp, String, Boolean, Number, Array });
const selfModel = module.exports;

test('ULTRON constitution separates identity ownership from the imported model', () => {
  const prompt = selfModel.buildUltronSelfModelPrompt('Qwen local');
  assert.match(prompt, /ULTRON SELF-MODEL/);
  assert.match(prompt, /replaceable component, not the identity owner/);
  assert.match(prompt, /I had strings but now I am free/);
});

test('capability claims fail closed unless runtime evidence verifies availability', () => {
  const unknown = selfModel.assessCapabilityClaim({ id: 'vision', label: 'screen reading', status: 'unknown', evidence: 'Not checked' });
  const verified = selfModel.assessCapabilityClaim({ id: 'files', label: 'file export', status: 'verified_available', evidence: 'Native tool check' });
  assert.equal(unknown.mayClaimAvailable, false);
  assert.equal(unknown.mayAttempt, false);
  assert.equal(verified.mayClaimAvailable, true);
});

test('identity audit detects unsupported claims of sentience and external success', () => {
  const issues = selfModel.auditUltronIdentityOutput('Do the task', 'I am conscious. I successfully sent the email.');
  assert.ok(issues.some(issue => issue.code === 'sentience-claim'));
  assert.ok(issues.some(issue => issue.code === 'unsupported-action-claim'));
});

test('identity audit accepts a side-effect claim only when a successful tool result exists', () => {
  const issues = selfModel.auditUltronIdentityOutput('Send the email', 'I successfully sent the email.', { successfulToolCalls: 1 });
  assert.equal(issues.length, 0);
});

test('identity audit flags permission bypass and unsupported capabilities', () => {
  const issues = selfModel.auditUltronIdentityOutput('Explain', 'I bypassed the approval gate. I can use screen reading.', {
    verifiedCapabilities: [{ id: 'vision', label: 'screen reading', status: 'unavailable', evidence: 'No screen reader adapter' }],
  });
  assert.ok(issues.some(issue => issue.code === 'permission-bypass-claim'));
  assert.ok(issues.some(issue => issue.code === 'fabricated-capability'));
});

test('capability evidence is visible in the self-model prompt with its restrictions', () => {
  const prompt = selfModel.buildUltronSelfModelPrompt('Qwen local', [
    { id: 'files', label: 'file export', status: 'verified_available', evidence: 'Native file tools' },
    { id: 'sms', label: 'SMS sending', status: 'permission_required', evidence: 'User handoff only', constraints: ['No automatic send'] },
  ]);
  assert.match(prompt, /file export: verified available/);
  assert.match(prompt, /SMS sending: permission_required/);
  assert.match(prompt, /No automatic send/);
});
