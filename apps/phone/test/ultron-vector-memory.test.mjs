import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/ultron-vector-memory.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Date, Map, Set, Math, RegExp, String, Boolean, Number, Array });
const memory = module.exports;

test('local feature vectors are normalized and cosine similarity is bounded', () => {
  const a = memory.embedMemoryText('ULTRON local model importer');
  const b = memory.embedMemoryText('ULTRON local model importer');
  assert.equal(a.length, 96);
  assert.ok(Math.abs(memory.cosineSimilarity(a, b) - 1) < 0.00001);
  assert.ok(memory.cosineSimilarity(a, memory.embedMemoryText('gardening and cooking')) < 0.8);
});

test('semantic graph records are synchronized into hot warm cold tiers', () => {
  const base = memory.createVectorMemoryStore();
  const rows = Array.from({ length: 600 }, (_, index) => ({ id:`node-${index}`, text:`ULTRON architecture module ${index}`, kind:'project', confidence:.9, source:'session-a', updatedAt:1_000_000_000 - index * 86_400_000 }));
  const store = memory.syncVectorMemory(base, rows, 1_000_000_000);
  const stats = memory.vectorMemoryStats(store);
  assert.equal(stats.total, 600);
  assert.equal(stats.hot, 80);
  assert.equal(stats.warm, 420);
  assert.equal(stats.cold, 100);
});

test('retrieval uses cosine and lexical evidence, then promotes accessed memories', () => {
  const now = 1_000_000_000;
  const store = memory.syncVectorMemory(memory.createVectorMemoryStore(), [
    { id:'repo-memory', text:'ULTRON GitHub repository connector architecture and OAuth permissions', kind:'project', confidence:.95, source:'chat-1', updatedAt:now },
    { id:'food-memory', text:'Favourite recipes, cooking and vegetables', kind:'concept', confidence:.9, source:'chat-2', updatedAt:now },
  ], now);
  const result = memory.retrieveVectorMemory(store, 'GitHub repository connector', 4, now + 1000);
  assert.equal(result.matches[0].item.id, 'repo-memory');
  assert.equal(result.store.records.find((row) => row.id === 'repo-memory').tier, 'hot');
  assert.equal(result.store.records.find((row) => row.id === 'repo-memory').accessCount, 1);
  assert.match(memory.buildVectorMemoryContext(result.matches), /cosine similarity/);
});

test('memory import rejects malformed vectors and duplicate ids', () => {
  const clean = memory.syncVectorMemory(memory.createVectorMemoryStore(), [{ id:'valid-node', text:'Useful architecture note', confidence:.8 }]);
  const raw = { ...clean, records:[...clean.records, { ...clean.records[0], vector:[1,2,3] }] };
  const restored = memory.validateVectorMemoryStore(raw);
  assert.equal(restored.records.length, 1);
});

test('runtime integrates tiered vector retrieval instead of the old lexical-only ranker', () => {
  const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /retrieveVectorMemory\(vectorMemory/);
  assert.match(main, /buildVectorMemoryContext\(memoryMatches\)/);
  assert.match(main, /ultron\.vector-memory\.v1/);
});
