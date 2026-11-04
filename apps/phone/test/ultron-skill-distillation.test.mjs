import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/ultron-skill-distillation.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Date, Set, Map, Math, RegExp, String, Boolean, Number, Array });
const skills = module.exports;
const base = {
  taskClass:'implementation',
  actions:['github.repos.list'],
  procedure:['Inspect the repository and its active constraints.','Apply the smallest compatible change and verify the resulting state.'],
  evidenceIds:['evidence-understand','evidence-verify'],
  correlationId:'conversation-001',
  verified:true,
  now:1_000_000_000,
};

test('unverified or evidence-free outcomes cannot create skills', () => {
  const empty = skills.createSkillStore();
  assert.equal(skills.distillVerifiedSkill(empty, {...base, verified:false}).accepted, false);
  assert.equal(skills.distillVerifiedSkill(empty, {...base, evidenceIds:[]}).accepted, false);
});

test('a verified run creates a provisional package without raw task or source code', () => {
  const result = skills.distillVerifiedSkill(skills.createSkillStore(), base);
  assert.equal(result.accepted, true);
  assert.equal(result.skill.status, 'provisional');
  assert.equal(result.skill.verifiedRuns, 1);
  assert.equal(JSON.stringify(result.skill).includes('conversation-001'), true);
  assert.equal(JSON.stringify(result.skill).includes('private prompt text'), false);
  assert.equal(skills.buildDistilledSkillContext('implement a GitHub repository change', result.store), '');
});

test('independent successful runs promote the same skill to verified', () => {
  const first = skills.distillVerifiedSkill(skills.createSkillStore(), base);
  const second = skills.distillVerifiedSkill(first.store, {...base, correlationId:'conversation-002', evidenceIds:['evidence-reason','evidence-deliver'], now:1_000_000_100});
  assert.equal(second.accepted, true);
  assert.equal(second.skill.status, 'verified');
  assert.equal(second.skill.verifiedRuns, 2);
  assert.match(skills.buildDistilledSkillContext('GitHub repos list', second.store), /verified procedural hints/);
});

test('one conversation cannot inflate the independent success count', () => {
  const first = skills.distillVerifiedSkill(skills.createSkillStore(), base);
  const duplicate = skills.distillVerifiedSkill(first.store, {...base, now:1_000_000_100});
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.skill.verifiedRuns, 1);
});

test('a test-verified bug fix can be promoted immediately', () => {
  const result = skills.distillVerifiedSkill(skills.createSkillStore(), {...base, verifiedBugfix:true});
  assert.equal(result.skill.status, 'verified');
  assert.equal(result.skill.confidence, .9);
});

test('credential-like material is rejected from distilled procedure content', () => {
  const result = skills.distillVerifiedSkill(skills.createSkillStore(), {...base, procedure:['Use api_key: abcdefghijklmnop to connect.','Verify the response.']});
  assert.equal(result.accepted, false);
});

test('runtime distills only the independently verified completion path', () => {
  const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.ok(main.includes('outcome.status === "verified_success"'));
  assert.match(main, /distillVerifiedSkill\(skillStore/);
  assert.ok(main.includes('buildDistilledSkillContext(task, skillStore)'));
});
