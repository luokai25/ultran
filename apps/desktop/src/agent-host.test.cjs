'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJson } = require('./agent-host.cjs');

test('parses a strict planner JSON object', () => {
  assert.deepEqual(extractJson('{"type":"final","answer":"done"}'), { type: 'final', answer: 'done' });
});

test('extracts a JSON object from surrounding model chatter', () => {
  assert.deepEqual(extractJson('Here is the next step:\n{"type":"tool","name":"workspace.list_projects","args":{}}'), {
    type: 'tool', name: 'workspace.list_projects', args: {}
  });
});

test('rejects planner output without a JSON object', () => {
  assert.throws(() => extractJson('I will inspect the files now.'), /JSON action/);
});

test('rejects malformed planner JSON', () => {
  assert.throws(() => extractJson('prefix {"type": tool} suffix'));
});
