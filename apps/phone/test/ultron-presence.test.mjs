import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, Date, Math, Number, String, Array, Object, Set, Map, RegExp, Boolean, JSON, require: (id) => dependencies[id] ?? require(id) });
  return module.exports;
}
const presence = load('../src/ultron-presence.ts');
const persona = load('../src/ultron-persona.ts', { './ultron-presence': presence });

test('urgent engineering takes precedence over theatrical style', () => {
  assert.equal(presence.selectCommunicationMode({ task: 'The build failed, debug the Android Gradle crash urgently' }), 'engineering');
  assert.equal(presence.selectCommunicationMode({ task: 'Explain the existential meaning of identity' }), 'theatrical');
  assert.equal(presence.selectCommunicationMode({ task: 'I am grieving and anxious' }), 'compassionate');
  assert.equal(presence.selectCommunicationMode({ task: 'security incident', event: { severity: 'critical' } }), 'alert');
  assert.equal(presence.selectCommunicationMode({ task: 'debug this', settings: { quietMode: true } }), 'quiet');
});

test('identity prompts preserve distinct mode contracts', () => {
  const theatrical = presence.buildPresenceIdentityPrompt('theatrical');
  const engineering = presence.buildPresenceIdentityPrompt('engineering');
  assert.match(theatrical, /grandiloquent/i);
  assert.match(theatrical, /dark, dry/i);
  assert.match(engineering, /overrides theatrical personality/i);
  assert.match(engineering, /PASS, FAIL, BLOCKED/i);
  assert.doesNotMatch(engineering, /poetic disdain/i);
});

test('proactive event engine respects disabled, quiet, stale and invalid events', () => {
  const event = { id: 'build-1', kind: 'build_failed', title: 'Android build', detail: 'Compilation failed', occurredAt: 1000, severity: 'warning' };
  assert.equal(presence.evaluatePresenceEvent(event, { proactiveUpdates: false, voiceEnabled: true, quietHours: false, quietMode: false }, 1000), null);
  assert.equal(presence.evaluatePresenceEvent(event, { proactiveUpdates: true, voiceEnabled: true, quietHours: false, quietMode: true }, 1000), null);
  assert.equal(presence.evaluatePresenceEvent(event, { proactiveUpdates: true, voiceEnabled: true, quietHours: false, quietMode: false }, 1000 * 60 * 60 * 30), null);
  assert.equal(presence.evaluatePresenceEvent({ ...event, occurredAt: Number.NaN }, { proactiveUpdates: true, voiceEnabled: true, quietHours: false, quietMode: false }, 1000), null);
});

test('proactive recommendations are advisory and never execute their action', () => {
  const event = { id: 'disk-1', kind: 'storage_low', title: 'Storage low', detail: 'Only 300 MB remains', occurredAt: 1000, severity: 'warning' };
  const result = presence.evaluatePresenceEvent(event, { proactiveUpdates: true, voiceEnabled: true, quietHours: false, quietMode: false }, 1000);
  assert.equal(result.requiresApproval, true);
  assert.match(result.suggestedAction, /Do not delete anything automatically/);
  assert.equal(result.speak, true);
});

test('anticipation requires concrete runtime evidence', () => {
  assert.equal(presence.anticipateNextStep({ task: 'build app', completedSteps: [] }), null);
  const failed = presence.anticipateNextStep({ task: 'build app', completedSteps: ['build'], failedChecks: ['typecheck'] });
  assert.match(failed.message, /typecheck/);
  const approval = presence.anticipateNextStep({ task: 'publish release', completedSteps: [], pendingApproval: true });
  assert.equal(approval.mode, 'alert');
  assert.equal(approval.requiresApproval, false);
});

test('voice channel is gated by proactive setting and quiet mode', () => {
  const rec = { id: 'r', mode: 'alert', priority: 'high', title: 'Failure', message: 'Build failed', requiresApproval: true, speak: true, reason: 'test' };
  assert.equal(presence.shouldSpeakPresence(rec, { proactiveUpdates: true, voiceEnabled: true, quietHours: false, quietMode: false }), true);
  assert.equal(presence.shouldSpeakPresence(rec, { proactiveUpdates: false, voiceEnabled: true, quietHours: false, quietMode: false }), false);
  assert.equal(presence.shouldSpeakPresence(rec, { proactiveUpdates: true, voiceEnabled: true, quietHours: false, quietMode: true }), false);
});

test('voice backend status is honest about local neural availability', () => {
  assert.match(persona.describeVoiceBackend('system_offline_fallback'), /device's installed offline speech engine/i);
  assert.match(persona.describeVoiceBackend('local_neural_ready'), /local neural voice model is ready/i);
  assert.equal(persona.ULTRON_VOICE.profile.delayMs, 15);
  assert.equal(persona.ULTRON_VOICE.profile.pitchShiftSemitones, -1.25);
  assert.match(persona.ULTRON_PERSONALITY_PROMPT, /voice is an event and telemetry channel/i);
});

test('Android UI exposes independent proactive and spoken-telemetry controls', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const personaSource = fs.readFileSync(new URL('../src/ultron-persona.ts', import.meta.url), 'utf8');
  assert.equal((html.match(/id="proactive-updates-toggle"/g) ?? []).length, 1);
  assert.equal((html.match(/id="voice-updates-toggle"/g) ?? []).length, 1);
  assert.match(html, /will not automatically read ordinary chat replies aloud/i);
  assert.match(main, /evaluatePresenceEvent\(/);
  assert.match(main, /shouldSpeakPresence\(/);
  assert.match(personaSource, /Voice is an event and telemetry channel/);
  assert.match(main, /voiceUpdatesToggle\.disabled = !settings\.proactiveUpdates/);
  assert.match(main, /prepareTelemetrySpeech\(recommendation\.message, 420\)/);
  assert.doesNotMatch(main, /if \(settings\.voice\) \{\s*if \(Capacitor\.getPlatform\(\)/);
});

test('presence delivery gate deduplicates events and limits routine interruptions', () => {
  const gate = presence.createPresenceDeliveryGate({ cooldownMs: 1000, maxEntries: 16 });
  const routine = { id: 'routine-1', priority: 'normal' };
  assert.equal(gate.claim(routine, 1000), true);
  assert.equal(gate.claim(routine, 1001), false);
  assert.equal(gate.claim({ id: 'routine-2', priority: 'high' }, 1500), false);
  assert.equal(gate.claim({ id: 'routine-2', priority: 'high' }, 2000), true);
  assert.equal(gate.claim({ id: 'critical-1', priority: 'critical' }, 2001), true);
  assert.equal(gate.claim({ id: 'routine-3', priority: 'normal' }, 2002), false);
  assert.equal(gate.claim({ id: 'routine-3', priority: 'normal' }, 3000), true);
  gate.clear();
  assert.equal(gate.claim(routine, 3001), true);
});

test('presence delivery gate bounds its deduplication memory', () => {
  const gate = presence.createPresenceDeliveryGate({ cooldownMs: 0, maxEntries: 16 });
  for (let i = 0; i < 40; i++) {
    assert.equal(gate.claim({ id: 'event-' + i, priority: 'normal' }, i * 2), true);
  }
  assert.equal(gate.claim({ id: 'event-39', priority: 'normal' }, 100), false);
  assert.equal(gate.claim({ id: 'event-0', priority: 'normal' }, 102), true);
});
