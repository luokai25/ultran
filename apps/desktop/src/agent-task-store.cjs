'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function createAgentTaskStore({ getFilePath }) {
  if (typeof getFilePath !== 'function') throw new TypeError('Agent task store requires a path provider.');
  let queue = Promise.resolve();

  async function readFile(file) {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tasks)) throw new Error('Invalid agent task store.');
    return parsed.tasks.map(task => { const events = Array.isArray(task.events) ? task.events : []; const hasLegacyActions = events.some(event => ['tool_started', 'tool_denied', 'tool_skipped'].includes(event.type)); const hasFingerprintHistory = Array.isArray(task.fingerprints); const effectLedger = Array.isArray(task.effectLedger) ? task.effectLedger : migrateEffectLedger(events); return { ...task, events, effectLedger, fingerprints: hasFingerprintHistory ? task.fingerprints : [], fingerprintsTruncated: task.fingerprintsTruncated === true || (!hasFingerprintHistory && hasLegacyActions) }; });
  }

  async function load() {
    const file = getFilePath();
    try { return { tasks: await readFile(file), recovered: false }; }
    catch (error) {
      if (error.code === 'ENOENT') {
        try { return { tasks: await readFile(file + '.bak'), recovered: true }; }
        catch (backupError) { if (backupError.code === 'ENOENT') return { tasks: [], recovered: false }; throw backupError; }
      }
      try { return { tasks: await readFile(file + '.bak'), recovered: true }; }
      catch (backupError) { throw new Error('Agent task history is damaged and no valid backup is available: ' + backupError.message); }
    }
  }

  async function mutate(fn) {
    const operation = queue.then(async () => {
      const file = getFilePath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      let tasks = [];
      try { tasks = await readFile(file); }
      catch (error) {
        if (error.code !== 'ENOENT') {
          try { tasks = await readFile(file + '.bak'); }
          catch (backupError) { if (backupError.code !== 'ENOENT') throw backupError; }
        }
      }
      const result = await fn(tasks);
      const temp = file + '.tmp.' + crypto.randomUUID();
      const backupTemp = file + '.bak.tmp.' + crypto.randomUUID();
      try {
        const handle = await fs.open(temp, 'wx');
        try {
          await handle.writeFile(JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), tasks: tasks.slice(0, 50) }), 'utf8');
          await handle.sync();
        } finally { await handle.close(); }
        try {
          await readFile(file);
          await fs.copyFile(file, backupTemp);
          const backupHandle = await fs.open(backupTemp, 'r+');
          try { await backupHandle.sync(); } finally { await backupHandle.close(); }
          await fs.rename(backupTemp, file + '.bak');
        } catch (error) {
          if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        }
        await fs.rename(temp, file);
      } finally {
        await Promise.all([temp, backupTemp].map(item => fs.rm(item, { force: true }).catch(() => {})));
      }
      return result;
    });
    queue = operation.catch(() => {});
    return operation;
  }

  async function create({ id, goal, model, authorityGrants = [] }) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || typeof goal !== 'string' || !goal.trim() || goal.length > 12000 ||
        typeof model !== 'string' || !model.trim() || model.length > 200 || !Array.isArray(authorityGrants) || authorityGrants.some(value => !['read', 'write', 'external'].includes(value))) throw new Error('Invalid agent task record.');
    return mutate(tasks => {
      if (tasks.some(task => task.id === id)) throw new Error('Duplicate agent task ID.');
      const now = new Date().toISOString();
      tasks.unshift({ id, goal: goal.slice(0, 12000), model: model.slice(0, 200), authorityGrants: [...new Set(authorityGrants)], status: 'running', createdAt: now, updatedAt: now, events: [], effectLedger: [], fingerprints: [], fingerprintsTruncated: false, result: null });
      return { created: true, id };
    });
  }

  async function append(id, event) {
    if (!event || typeof event.type !== 'string') return { saved: false };
    const safe = JSON.parse(JSON.stringify(event));
    if (typeof safe.output === 'string') safe.output = safe.output.slice(0, 2500);
    if (typeof safe.answer === 'string') safe.answer = safe.answer.slice(0, 2500);
    if (typeof safe.error === 'string') safe.error = safe.error.slice(0, 500);
    return mutate(tasks => {
      const task = tasks.find(item => item.id === id);
      if (!task) return { saved: false };
      const eventRecord = { at: new Date().toISOString(), ...safe };
      task.events.push(eventRecord);
      if (safe.type === 'tool_started' && safe.effect && ['write', 'external'].includes(safe.effect.capability) && typeof safe.fingerprint === 'string') {
        task.effectLedger = Array.isArray(task.effectLedger) ? task.effectLedger : [];
        task.effectLedger = task.effectLedger.filter(item => item.fingerprint !== safe.fingerprint);
        task.effectLedger.push({ fingerprint: safe.fingerprint, name: safe.name, capability: safe.effect.capability, startedAt: eventRecord.at });
      }
      if (safe.type === 'effect_outcome' && typeof safe.id === 'string') task.effectLedger = (task.effectLedger || []).filter(item => item.fingerprint !== safe.id);
      if (safe.type === 'tool_finished' && safe.ok === false && typeof safe.fingerprint === 'string') task.effectLedger = (task.effectLedger || []).filter(item => item.fingerprint !== safe.fingerprint);
      task.events = task.events.slice(-250);
      if (["tool_started", "tool_denied", "tool_skipped"].includes(safe.type) && typeof safe.fingerprint === "string" && !task.fingerprints.includes(safe.fingerprint)) {
        if (task.fingerprints.length < 1000) task.fingerprints.push(safe.fingerprint);
        else task.fingerprintsTruncated = true;
      }
      task.updatedAt = new Date().toISOString();
      return { saved: true };
    });
  }

  function migrateEffectLedger(events) {
    const ledger = new Map();
    for (const event of events || []) {
      if (event.type === 'tool_started' && event.effect && ['write', 'external'].includes(event.effect.capability) && typeof event.fingerprint === 'string') ledger.set(event.fingerprint, { fingerprint: event.fingerprint, name: event.name, capability: event.effect.capability, startedAt: event.at });
      if (event.type === 'effect_outcome' && typeof event.id === 'string') ledger.delete(event.id);
      if (event.type === 'tool_finished' && event.ok === false && typeof event.fingerprint === 'string') ledger.delete(event.fingerprint);
    }
    return [...ledger.values()];
  }

  function unresolvedEffects(task) { return Array.isArray(task.effectLedger) ? task.effectLedger : migrateEffectLedger(task.events); }

  async function resume(id) {
    return mutate(tasks => {
      const task = tasks.find(item => item.id === id);
      if (!task || !['interrupted', 'failed', 'cancelled', 'limit_reached'].includes(task.status)) throw new Error('This task cannot be resumed.');
      if (unresolvedEffects(task).length) throw new Error('This task has an action with an uncertain outcome. Review the affected resource before resuming.');
      task.status = 'running';
      task.updatedAt = new Date().toISOString();
      task.events.push({ at: task.updatedAt, type: 'resumed' });
      return { resumed: true, id };
    });
  }

  async function markInterrupted() {
    return mutate(tasks => {
      let count = 0;
      for (const task of tasks) if (task.status === 'running') {
        task.status = 'interrupted';
        task.updatedAt = new Date().toISOString();
        task.events.push({ at: task.updatedAt, type: 'interrupted', reason: 'Ultran closed before the task completed.' });
        task.events = task.events.slice(-250);
        count++;
      }
      return { interrupted: count };
    });
  }

  async function finish(id, result) {
    return mutate(tasks => {
      const task = tasks.find(item => item.id === id);
      if (!task) return { saved: false };
      task.status = ['completed', 'cancelled', 'failed', 'limit_reached'].includes(result?.status) ? result.status : 'failed';
      task.result = {
        answer: typeof result?.answer === 'string' ? result.answer.slice(0, 6000) : '',
        reason: typeof result?.reason === 'string' ? result.reason.slice(0, 500) : null,
        calls: Number.isInteger(result?.calls) ? result.calls : 0,
        rounds: Number.isInteger(result?.rounds) ? result.rounds : 0
      };
      task.updatedAt = new Date().toISOString();
      return { saved: true };
    });
  }

  async function list() {
    await queue;
    const result = await load();
    return result.tasks.slice(0, 50).map(task => ({
      id: task.id, goal: task.goal, model: task.model, status: task.status,
      createdAt: task.createdAt, updatedAt: task.updatedAt, result: task.result,
      eventCount: Array.isArray(task.events) ? task.events.length : 0, unresolvedEffects: unresolvedEffects(task), resumable: ['interrupted', 'failed', 'cancelled', 'limit_reached'].includes(task.status) && task.fingerprintsTruncated !== true && unresolvedEffects(task).length === 0
    }));
  }

  async function clear() {
    await queue;
    const file = getFilePath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await Promise.all([file, file + '.bak'].map(item => fs.rm(item, { force: true })));
    return { cleared: true };
  }

  async function get(id) {
    await queue;
    const result = await load();
    return result.tasks.find(task => task.id === id) || null;
  }

  return Object.freeze({ create, append, resume, markInterrupted, finish, list, get, clear, unresolvedEffects });
}

module.exports = { createAgentTaskStore };
