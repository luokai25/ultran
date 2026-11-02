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
    await store.append('task-1', { type: 'tool_started', name: 'workspace.write_file', fingerprint: 'stable-hash' });
    await store.append('task-1', { type: 'tool_finished', name: 'workspace.list_projects', fingerprint: 'stable-hash', output: 'demo' });
    await store.finish('task-1', { status: 'completed', answer: 'Found demo.', calls: 1, rounds: 2 });
    const reloaded = createAgentTaskStore({ getFilePath: () => file });
    const task = await reloaded.get('task-1');
    assert.equal(task.status, 'completed');
    assert.equal(task.events.length, 2);
    assert.deepEqual(task.fingerprints, ['stable-hash']);
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

test('clear removes task history and its recovery backup', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ultran-task-clear-'));
  const file = path.join(dir, 'agent-tasks.json');
  try {
    const store = createAgentTaskStore({ getFilePath: () => file });
    await store.create({ id: 'task-clear', goal: 'Private task', model: 'local-model' });
    await store.append('task-clear', { type: 'note', output: 'sensitive snippet' });
    await store.finish('task-clear', { status: 'completed', answer: 'done' });
    assert.equal(await fs.access(file).then(() => true, () => false), true);
    assert.equal(await fs.access(file + '.bak').then(() => true, () => false), true);
    await store.clear();
    assert.deepEqual(await store.list(), []);
    assert.equal(await fs.access(file).then(() => true, () => false), false);
    assert.equal(await fs.access(file + '.bak').then(() => true, () => false), false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('legacy task journals without action fingerprints cannot be resumed safely', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ultran-task-legacy-'));
  const file = path.join(dir, 'agent-tasks.json');
  try {
    await fs.writeFile(file, JSON.stringify({ version: 1, tasks: [{
      id: 'legacy-task', goal: 'Old task', model: 'local-model', status: 'interrupted',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      events: [{ at: new Date().toISOString(), type: 'tool_started', name: 'workspace.write_file' }]
    }] }));
    const store = createAgentTaskStore({ getFilePath: () => file });
    const listed = await store.list();
    assert.equal(listed[0].resumable, false);
    assert.equal((await store.get('legacy-task')).fingerprintsTruncated, true);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('task creation persists the original capability authority snapshot', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ultran-task-authority-'));
  const file = path.join(dir, 'agent-tasks.json');
  try {
    const store = createAgentTaskStore({ getFilePath: () => file });
    await store.create({ id: 'authority-task', goal: 'Review project', model: 'local-model', authorityGrants: ['read'] });
    const task = await store.get('authority-task');
    assert.deepEqual(task.authorityGrants, ['read']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('blocks resuming a task with an unresolved external side effect', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ultran-task-uncertain-'));
  const file = path.join(dir, 'agent-tasks.json');
  try {
    const store = createAgentTaskStore({ getFilePath: () => file });
    await store.create({ id: 'uncertain-task', goal: 'Edit project', model: 'local-model' });
    await store.append('uncertain-task', { type: 'tool_started', name: 'workspace.write_file', fingerprint: 'effect-1', effect: { id: 'effect-1', capability: 'write' } });
    await store.finish('uncertain-task', { status: 'failed', answer: 'Interrupted.' });
    const listed = (await store.list())[0];
    assert.equal(listed.resumable, false);
    assert.equal(listed.unresolvedEffects.length, 1);
    await assert.rejects(() => store.resume('uncertain-task'), /uncertain outcome/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('allows resuming after a durable effect outcome has been recorded', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ultran-task-resolved-'));
  const file = path.join(dir, 'agent-tasks.json');
  try {
    const store = createAgentTaskStore({ getFilePath: () => file });
    await store.create({ id: 'resolved-task', goal: 'Edit project', model: 'local-model' });
    await store.append('resolved-task', { type: 'tool_started', name: 'workspace.write_file', fingerprint: 'effect-2', effect: { id: 'effect-2', capability: 'write' } });
    await store.append('resolved-task', { type: 'effect_outcome', id: 'effect-2', state: 'verified' });
    await store.finish('resolved-task', { status: 'failed', answer: 'Stopped.' });
    assert.equal((await store.list())[0].resumable, true);
    await store.resume('resolved-task');
    assert.equal((await store.get('resolved-task')).status, 'running');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
