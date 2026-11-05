import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');

test('Prometheus goal loop audits capability, adapts compute, verifies milestones and resumes checkpoints', () => {
  const start = source.indexOf('PROMETHEUS GOAL LOOP:');
  const end = source.indexOf('ULTRON SELF-EXTENSION AND CLOUD RUNTIME:', start);
  assert.ok(start >= 0 && end > start, 'Prometheus protocol must be part of the shared agent system prompt');
  const prompt = source.slice(start, end);
  assert.match(source, /return \[resolveIdentityPrompt\(identityState\), core, PROMETHEUS_GOAL_LOOP_PROMPT/);
  assert.match(source, /const PROMETHEUS_GOAL_LOOP_PROMPT =/);
  for (const phrase of [
    'concrete success condition',
    'connected provider keys',
    'fall back across eligible keys and providers',
    'checkpoint durable progress',
    'create a versioned ULTRON-owned tool or skill',
    'without repeating an unchanged failure',
    'genuine blocker',
    'capabilities.checkpoint_run',
    'Never claim a goal is guaranteed or completed without evidence',
  ]) assert.ok(prompt.includes(phrase), `missing Prometheus behavior: ${phrase}`);
});

test('Supabase cloud brain ranks model capacity by task complexity and keeps provider-key fallback', async () => {
  const backend = await readFile(new URL('../../../supabase/functions/ultron-brain/index.ts', import.meta.url), 'utf8');
  assert.match(backend, /function taskComplexity\(messages: Json\[\]\)/);
  assert.match(backend, /function modelCapabilityScore\(model: string, complexity: number\)/);
  assert.match(backend, /bestFreeModel\(provider, key\.models \?\? \[\], complexity\)/);
  assert.match(backend, /b\.modelScore - a\.modelScore \|\| b\.key\.priority - a\.key\.priority/);
  assert.match(backend, /for \(const candidate of candidates\.slice\(0, 8\)\)/);
});
