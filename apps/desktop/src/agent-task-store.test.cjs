'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAgentTaskStore } = require('./agent-task-store.cjs');

test('persists task lifecycle and bounded events across store instances', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ultran-task-store-'));
  const file = path.join(dir, 'agent-tasks.json');
  try {
    const store = createAgentTaskStore({ getFilePath: () => file });
    await store.create({ id: 'task-1', goal: 'Inspect project', model: 'local-model' });
    await store.append('task-1', { type: 'tool_started', name: 'workspace.write_file', fingerprint: 'stable-hash' });\n    await store.append('task-1', { type: 'tool_finished', name: 'workspace.list_projects', fingerprint: 'stable-hash', output: 'demo' });
    await store.finish('task-1', { status: 'completed', answer: 'Found demo.', calls: 1, rounds: 2 });
    const reloaded = createAgentTaskStore({ getFilePath: () => file });
    const task = await reloaded.get('task-1');
    assert.equal(task.status, 'completed');
    assert.equal(task.events.length, 2);\n    assert.deepEqual(task.fingerprints, ['stable-hash']);
    assert.equal(task.result.answer, 'Found demo.');
    assert.equal((await reloaded.list())[0].id, 'task-1');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('recovers task history from backup after primary corruption', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ultran-task-recovery-'));
  const file = path.join(dir, 'agent-tasks.json');
  try {
    const store = createAgentTaskStore({ getFilePath: () => file });
    await store.create({ id: 'task-2', goal: 'Preserve history', model: 'local-model' });
    await store.append('task-2', { type: 'round', round: 1 });
    await store.append('task-2', { type: 'round', round: 2 });
    await fs.writeFile(file, '{broken');
    const loaded = await store.list();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'task-2');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('rejects invalid task IDs and oversized goals', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ultran-task-validation-'));
  try {
    const store = createAgentTaskStore({ getFilePath: () => path.join(dir, 'tasks.json') });
    await assert.rejects(store.create({ id: '../bad', goal: 'x', model: 'm' }));
    await assert.rejects(store.create({ id: 'valid', goal: 'x'.repeat(12001), model: 'm' }));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('marks running tasks interrupted and allows explicit resumption', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ultran-task-resume-'));
  const file = path.join(dir, 'agent-tasks.json');
  try {
    const store = createAgentTaskStore({ getFilePath: () => file });
    await store.create({ id: 'task-resume', goal: 'Continue safely', model: 'local-model' });
    const recovered = await store.markInterrupted();
    assert.equal(recovered.interrupted, 1);
    assert.equal((await store.get('task-resume')).status, 'interrupted');
    await store.resume('task-resume');
    assert.equal((await store.get('task-resume')).status, 'running');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
