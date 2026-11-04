import test from 'node:test';
import assert from 'node:assert/strict';
const [{ readFile }, ts, vm] = await Promise.all([
  import('node:fs/promises'),
  import('typescript'),
  import('node:vm'),
]);
const source = await readFile(new URL('../src/cloud-workspace.ts', import.meta.url), 'utf8');
const compiled = ts.transpile(source, {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
});
const workspaceModule = { exports: {} };
vm.runInNewContext(compiled, { module: workspaceModule, exports: workspaceModule.exports });
const { mergeCloudWorkspace } = workspaceModule.exports;

const conversation = (id, updatedAt, messages = [], extra = {}) => ({
  id, title: id, updatedAt, messages, ...extra,
});
const message = (id, content, sequenceNo) => ({
  id, role: 'user', content, sequenceNo,
});

test('preserves local-only conversations and adds remote-only conversations', () => {
  const result = mergeCloudWorkspace(
    [conversation('local', 20)],
    [conversation('remote', 30)],
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'remote');
  assert.equal(result[1].id, 'local');
});

test('deduplicates by stable message ID and orders by cloud sequence number', () => {
  const result = mergeCloudWorkspace(
    [conversation('chat', 10, [
      message('m2', 'second', undefined),
      message('m1', 'first', undefined),
    ])],
    [conversation('chat', 10, [
      message('m1', 'first', 1),
      message('m2', 'second', 2),
      message('m3', 'third', 3),
    ])],
  );
  assert.equal(result[0].messages.length, 3);
  assert.deepEqual(result[0].messages.map((item) => item.id), ['m1', 'm2', 'm3']);
  assert.deepEqual(result[0].messages.map((item) => item.sequenceNo), [1, 2, 3]);
});

test('newer remote state updates matching message content and conversation title', () => {
  const result = mergeCloudWorkspace(
    [conversation('chat', 10, [message('m1', 'old text', 1)])],
    [conversation('chat', 20, [message('m1', 'edited remotely', 1)], { title: 'Remote title' })],
  );
  assert.equal(result[0].title, 'Remote title');
  assert.equal(result[0].messages[0].content, 'edited remotely');
  assert.equal(result[0].updatedAt, 20);
});

test('older remote state cannot overwrite newer local message content', () => {
  const result = mergeCloudWorkspace(
    [conversation('chat', 30, [message('m1', 'local newer', 1)])],
    [conversation('chat', 20, [message('m1', 'remote stale', 1)], { title: 'Stale title' })],
  );
  assert.equal(result[0].title, 'chat');
  assert.equal(result[0].messages[0].content, 'local newer');
  assert.equal(result[0].updatedAt, 30);
});

test('remote tombstones delete only the matching conversation', () => {
  const result = mergeCloudWorkspace(
    [conversation('keep', 20), conversation('remove', 10)],
    [conversation('remove', 30, [], { deleted: true })],
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'keep');
});
