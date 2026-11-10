import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const capabilities = await readFile(new URL('../../../supabase/functions/ultron-capabilities/index.ts', import.meta.url), 'utf8');
const brain = await readFile(new URL('../../../supabase/functions/ultron-brain/index.ts', import.meta.url), 'utf8');
const jobs = await readFile(new URL('../../../supabase/functions/ultron-jobs/index.ts', import.meta.url), 'utf8');

test('Prometheus Supabase provider runs a bounded tool loop with durable checkpoints', () => {
  assert.match(source, /PROMETHEUS GOAL LOOP:/);
  assert.match(source, /usePrometheus \? basePrompt \+ "\\n\\n" \+ LOCAL_AGENT_SYSTEM_PROMPT/);
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
  assert.match(brain, /bestFreeModel\(provider, usableModels\(provider, key\), complexity\)/);
  assert.match(brain, /b\.modelScore - a\.modelScore \|\| b\.key\.priority - a\.key\.priority/);
  assert.match(brain, /for \(const candidate of candidates\)/);
  assert.doesNotMatch(brain, /candidates\.slice\(0,\s*8\)/);
  assert.match(brain, /fallbackGroups = new Map/);
  assert.ok(brain.includes('if (/(?:audio|tts|speech|transcri|live|realtime|bidi)/i.test(id)) return false;'), 'chat routing must exclude non-chat audio and realtime models');
  assert.ok(brain.includes('only supports.{0,100}(real.?time|bidirectional|websocket)'), 'modality-incompatible HTTP 400 responses must block the model rather than poison the API key');
  assert.ok(jobs.includes('if (/(?:audio|tts|speech|transcri|live|realtime|bidi)/i.test(id)) return false;'), 'background memory routing must exclude non-chat audio and realtime models');
});
