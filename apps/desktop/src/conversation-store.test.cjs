const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createConversationStore } = require('./conversation-store.cjs');

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length > 100) throw new Error('Invalid history');
  return messages.map(message => {
    if (!message || !['user', 'assistant', 'system'].includes(message.role) || typeof message.content !== 'string') throw new Error('Invalid message');
    return { role: message.role, content: message.content };
  });
}
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ultran-history-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'conversations.json');
  return { file, store: createConversationStore({ getFilePath: () => file, validateMessages: validMessages }) };
}

test('saves versioned history and reads it back', async t => {
  const { file, store } = await fixture(t);
  const messages = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }];
  await store.save(messages);
  assert.deepEqual((await store.load()).messages, messages);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).version, 1);
});

test('migrates the legacy bare-array format on next save', async t => {
  const { file, store } = await fixture(t);
  const legacy = [{ role: 'user', content: 'old history' }];
  await fs.writeFile(file, JSON.stringify(legacy));
  assert.deepEqual((await store.load()).messages, legacy);
  await store.save(legacy);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).version, 1);
});

test('recovers a corrupt primary file from the last good backup', async t => {
  const { file, store } = await fixture(t);
  const previous = [{ role: 'user', content: 'previous good save' }];
  await store.save(previous);
  await store.save([{ role: 'user', content: 'new save' }]);
  await fs.writeFile(file, '{truncated');
  const loaded = await store.load();
  assert.equal(loaded.recovered, true);
  assert.deepEqual(loaded.messages, previous);
});

test('keeps writes serialized and does not leave temporary files', async t => {
  const { file, store } = await fixture(t);
  await Promise.all(Array.from({ length: 12 }, (_, index) => store.save([{ role: 'user', content: String(index) }])));
  assert.equal((await store.load()).messages.length, 1);
  const names = await fs.readdir(path.dirname(file));
  assert.equal(names.some(name => name.includes('.tmp.')), false);
});

test('rejects invalid history without replacing the last good file', async t => {
  const { file, store } = await fixture(t);
  await store.save([{ role: 'user', content: 'safe' }]);
  await assert.rejects(store.save([{ role: 'root', content: 'bad' }]));
  assert.deepEqual((await store.load()).messages, [{ role: 'user', content: 'safe' }]);
});


test('does not overwrite a valid backup with a corrupt primary during recovery save', async t => {
  const { file, store } = await fixture(t);
  const good = [{ role: 'user', content: 'last known good' }];
  await store.save(good);
  await store.save([{ role: 'user', content: 'newer save' }]);
  await fs.writeFile(file, '{broken primary');
  const recovered = await store.load();
  assert.deepEqual(recovered.messages, good);
  await store.save(recovered.messages);
  await fs.writeFile(file, '{broken again');
  assert.deepEqual((await store.load()).messages, good);
});


test('clear removes primary history and its recovery backup', async t => {
  const { file, store } = await fixture(t);
  await store.save([{ role: 'user', content: 'first' }]);
  await store.save([{ role: 'user', content: 'second' }]);
  await store.clear();
  assert.deepEqual((await store.load()).messages, []);
  await assert.rejects(fs.access(file));
  await assert.rejects(fs.access(file + '.bak'));
});
