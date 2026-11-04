import test from 'node:test';
import assert from 'node:assert/strict';

const [{ readFile }, ts, vm] = await Promise.all([
  import('node:fs/promises'),
  import('typescript'),
  import('node:vm'),
]);
const source = await readFile(new URL('../src/cloud-pagination.ts', import.meta.url), 'utf8');
const compiled = ts.transpile(source, {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
});
const helperModule = { exports: {} };
vm.runInNewContext(compiled, {
  module: helperModule,
  exports: helperModule.exports,
});
const { fetchAllPages } = helperModule.exports;

test('fetches full and partial pages in stable order', async () => {
  const requested = [];
  const result = await fetchAllPages(async (from, to) => {
    requested.push([from, to]);
    return from === 0 ? ['a', 'b', 'c'] : ['d', 'e'];
  }, 3);

  assert.deepEqual(Array.from(result), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(requested, [[0, 2], [3, 5]]);
});

test('checks one final empty page when the total is an exact page multiple', async () => {
  const requested = [];
  const pages = new Map([[0, [1, 2]], [2, [3, 4]], [4, []]]);
  const result = await fetchAllPages(async (from, to) => {
    requested.push([from, to]);
    return pages.get(from) ?? [];
  }, 2);

  assert.deepEqual(Array.from(result), [1, 2, 3, 4]);
  assert.deepEqual(requested, [[0, 1], [2, 3], [4, 5]]);
});

test('rejects invalid page sizes', async () => {
  await assert.rejects(fetchAllPages(async () => [], 0), /positive safe integer/);
});

test('propagates page retrieval errors instead of returning partial data', async () => {
  await assert.rejects(
    fetchAllPages(async () => { throw new Error('network unavailable'); }, 2),
    /network unavailable/,
  );
});
