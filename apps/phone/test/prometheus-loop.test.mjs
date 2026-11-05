import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const capabilities = await readFile(new URL('../../../supabase/functions/ultron-capabilities/index.ts', import.meta.url), 'utf8');
const brain = await readFile(new URL('../../../supabase/functions/ultron-brain/index.ts', import.meta.url), 'utf8');

test('Prometheus Supabase provider runs a bounded tool loop with durable checkpoints', () => {
  assert.match(source, /PROMETHEUS GOAL LOOP:/);
  assert.match(source, /if \(cloudBrainActive\)[\s\S]*?for \(let modelTurn = 0; modelTurn <= iterationLimit; modelTurn\+\+\)/);
  assert.match(source, /await runApprovedLocalTool\(request\)/);
  assert.match(source, /savePrometheusCheckpoint\("tool_completed", "running"\)/);
  assert.match(source, /send “continue” to resume from the last checkpoint/i);
  assert.match(source, /invokeUltronCapabilities\("get_run"/);
  assert.match(capabilities, /body\.action === "get_run"/);
  assert.match(capabilities, /\.eq\("id", body\.id\)\.eq\("owner_id", owner_id\)/);
});

test('Supabase cloud brain ranks eligible free models by task complexity and falls back across keys', () => {
  assert.match(brain, /function taskComplexity\(messages: Json\[\]\)/);
  assert.match(brain, /messages\.filter\(\(message\) => message\.role === "user"\)/);
  assert.match(brain, /function modelCapabilityScore\(model: string, complexity: number\)/);
  assert.match(brain, /bestFreeModel\(provider, key\.models \?\? \[\], complexity\)/);
  assert.match(brain, /b\.modelScore - a\.modelScore \|\| b\.key\.priority - a\.key\.priority/);
  assert.match(brain, /for \(const candidate of candidates\.slice\(0, 8\)\)/);
});
