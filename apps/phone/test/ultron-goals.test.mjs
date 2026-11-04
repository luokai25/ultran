import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/ultron-goals.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Date, Map, Set, Math, RegExp, String, Boolean, Number, Array });
const goals = module.exports;

const plan = [
  { id: 'understand', objective: 'Understand the goal', kind: 'understand', completionSignal: 'Constraints captured' },
  { id: 'reason', objective: 'Solve the task', kind: 'reason', completionSignal: 'Solution exists' },
  { id: 'verify', objective: 'Verify the result', kind: 'verify', completionSignal: 'Evidence checked' },
];

test('goal graph builds valid dependencies from a plan', () => {
  const graph = goals.createUltronGoalGraph('g1', 'Build a feature', plan, ['Use main branch']);
  const result = goals.validateUltronGoalGraph(graph);
  assert.equal(result.valid, true);
  assert.equal(result.topologicalOrder.join(','), 'understand,reason,verify');
  assert.equal(graph.goals[1].dependsOn[0], 'understand');
});

test('goal graph detects cycles and missing dependencies', () => {
  const graph = goals.createUltronGoalGraph('g2', 'Build a feature', plan);
  graph.goals[0].dependsOn = ['verify'];
  assert.equal(goals.validateUltronGoalGraph(graph).valid, false);
  graph.goals[0].dependsOn = ['missing'];
  assert.ok(goals.validateUltronGoalGraph(graph).errors.some(error => error.includes('missing dependency')));
});

test('ready goal selection respects dependencies and priority', () => {
  const graph = goals.createUltronGoalGraph('g3', 'Build a feature', plan);
  const ready = goals.getReadyUltronGoals(graph);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].id, 'understand');
});

test('goal completion requires evidence and cannot skip prerequisites', () => {
  let graph = goals.createUltronGoalGraph('g4', 'Build a feature', plan);
  const skipped = goals.transitionUltronGoal(graph, 'reason', 'active');
  assert.equal(skipped.ok, false);
  let transition = goals.transitionUltronGoal(graph, 'understand', 'active');
  graph = transition.graph;
  transition = goals.transitionUltronGoal(graph, 'understand', 'completed');
  assert.equal(transition.ok, false);
  transition = goals.transitionUltronGoal(graph, 'understand', 'completed', { evidence: 'The goal and constraints were extracted.' });
  assert.equal(transition.ok, true);
  assert.equal(goals.getReadyUltronGoals(transition.graph)[0].id, 'reason');
});

test('blocked goals require a concrete blocker and stop downstream execution', () => {
  let graph = goals.createUltronGoalGraph('g5', 'Build a feature', plan);
  let transition = goals.transitionUltronGoal(graph, 'understand', 'active');
  graph = transition.graph;
  transition = goals.transitionUltronGoal(graph, 'understand', 'blocked');
  assert.equal(transition.ok, false);
  transition = goals.transitionUltronGoal(graph, 'understand', 'blocked', { blocker: 'Missing project permission' });
  assert.equal(transition.ok, true);
  assert.equal(goals.getReadyUltronGoals(transition.graph).length, 0);
  assert.equal(transition.graph.status, 'blocked');
});

test('new hard constraints advance the graph revision without duplicating entries', () => {
  const graph = goals.createUltronGoalGraph('g6', 'Build a feature', plan);
  const changed = goals.addUltronGoalConstraint(graph, 'Only use main');
  const unchanged = goals.addUltronGoalConstraint(changed, 'Only use main');
  assert.equal(changed.revision, 2);
  assert.equal(unchanged.revision, 2);
});

test('goal prompt exposes dependency and evidence requirements', () => {
  const graph = goals.createUltronGoalGraph('g7', 'Build a feature', plan);
  const prompt = goals.buildUltronGoalPrompt(graph);
  assert.match(prompt, /ULTRON GOAL GRAPH/);
  assert.match(prompt, /after understand/);
  assert.match(prompt, /concrete evidence/);
});
