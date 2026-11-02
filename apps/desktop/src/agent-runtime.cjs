'use strict';

const crypto = require('node:crypto');

const DEFAULT_LIMITS = Object.freeze({ maxRounds: 8, maxCalls: 16, maxOutputChars: 12000 });

function createAgentRuntime({ tools, planner, approve, onEvent = () => {}, limits = {} }) {
  if (!tools || typeof tools !== 'object' || typeof planner !== 'function' || typeof approve !== 'function') {
    throw new TypeError('Agent runtime requires tools, planner, and approval adapters.');
  }
  const config = { ...DEFAULT_LIMITS, ...limits };
  for (const [key, value] of Object.entries(config)) {
    if (!Number.isInteger(value) || value < 1) throw new TypeError('Invalid agent limit: ' + key);
  }

  async function run({ goal, context = [], priorFingerprints = [], signal, metadata = {} }) {
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 12000) throw new Error('Invalid agent goal.');
    const history = Array.isArray(context) ? context.slice(-20) : [];
    const seen = new Set(Array.isArray(priorFingerprints) ? priorFingerprints.filter(value => typeof value === "string").slice(-100) : []);
    const journal = [];
    let calls = 0;
    let rounds = 0;
    const emit = (type, data = {}) => { try { onEvent({ type, ...data }); } catch {} };
    const finish = (status, answer = '', reason = null) => ({ status, answer, reason, calls, rounds, journal });

    for (let round = 1; round <= config.maxRounds; round++) {
      rounds = round;
      if (signal?.aborted) return finish('cancelled', '', 'aborted');
      emit('round', { round, maxRounds: config.maxRounds });
      let decision;
      try { decision = await planner({ goal, history: history.slice(), journal: journal.slice(), round, signal, metadata }); }
      catch (error) { return finish('failed', '', 'planner_error: ' + String(error?.message || error).slice(0, 300)); }
      if (signal?.aborted) return finish('cancelled', '', 'aborted');
      if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return finish('failed', '', 'invalid_planner_response');
      if (decision.type === 'final') {
        if (typeof decision.answer !== 'string' || !decision.answer.trim()) return finish('failed', '', 'empty_final_answer');
        emit('complete', { answer: decision.answer });
        return finish('completed', decision.answer);
      }
      if (decision.type !== 'tool' || typeof decision.name !== 'string' || decision.name.length > 80 ||
          !decision.args || typeof decision.args !== 'object' || Array.isArray(decision.args)) return finish('failed', '', 'invalid_action');
      if (calls >= config.maxCalls) return finish('limit_reached', '', 'tool_call_budget_exhausted');

      const tool = tools[decision.name];
      if (!tool || typeof tool.execute !== 'function') {
        journal.push({ name: decision.name, status: 'rejected', reason: 'unknown_tool' });
        history.push({ role: 'tool', name: decision.name, ok: false, error: 'Tool unavailable.' });
        emit('tool_rejected', { name: decision.name, reason: 'unknown_tool' });
        continue;
      }
      let argsText;
      try { argsText = JSON.stringify(decision.args); } catch { return finish('failed', '', 'invalid_tool_arguments'); }
      const fingerprint = crypto.createHash('sha256').update(decision.name + ':' + argsText).digest('hex');
      if (seen.has(fingerprint)) {
        journal.push({ name: decision.name, status: 'skipped', reason: 'repeated_exact_call' });
        history.push({ role: 'tool', name: decision.name, ok: false, error: 'Repeated identical call skipped.' });
        emit('tool_skipped', { name: decision.name });
        continue;
      }
      seen.add(fingerprint);
      const capability = ['read', 'write', 'external', 'unknown'].includes(tool.capability) ? tool.capability : 'unknown';
      const request = { name: decision.name, description: String(tool.description || decision.name).slice(0, 300), capability, args: decision.args };
      emit('approval_required', { name: request.name, capability, description: request.description });
      let allowed = false;
      try { allowed = await approve(request) === true; } catch {}
      if (!allowed) {
        journal.push({ name: decision.name, status: 'denied', capability });
        history.push({ role: 'tool', name: decision.name, ok: false, error: 'User denied this action. Do not retry it.' });
        emit('tool_denied', { name: decision.name });
        continue;
      }
      if (signal?.aborted) return finish('cancelled', '', 'aborted');
      calls++;
      emit('tool_started', { name: decision.name, fingerprint, call: calls, maxCalls: config.maxCalls });
      try {
        const result = await tool.execute(decision.args, { signal, metadata });
        let output;
        try { output = JSON.stringify(result); } catch { output = String(result); }
        output = String(output ?? 'null').slice(0, config.maxOutputChars);
        journal.push({ name: decision.name, status: 'succeeded', capability, output });
        history.push({ role: 'tool', name: decision.name, ok: true, output });
        emit('tool_finished', { name: decision.name, ok: true, output });
      } catch (error) {
        const message = String(error?.message || error).slice(0, 500);
        journal.push({ name: decision.name, status: 'failed', capability, error: message });
        history.push({ role: 'tool', name: decision.name, ok: false, error: message });
        emit('tool_finished', { name: decision.name, ok: false, error: message });
      }
    }
    return finish('limit_reached', '', 'round_budget_exhausted');
  }

  return Object.freeze({ run });
}

module.exports = { createAgentRuntime, DEFAULT_LIMITS };
