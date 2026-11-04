import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/ultron-voice.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
const module = { exports: {} };
vm.runInNewContext(js, { module, exports: module.exports, Date, Math, Number, String, Array, Object, Boolean, RegExp });
const voice = module.exports;

test('voice model choices remain explicit, local-first, and licence-aware', () => {
  assert.ok(voice.VOICE_MODEL_CANDIDATES.some(x => x.family === 'kokoro'));
  assert.ok(voice.VOICE_MODEL_CANDIDATES.some(x => x.family === 'piper_vits'));
  assert.ok(voice.VOICE_MODEL_CANDIDATES.every(x => x.sha256 && Object.keys(x.sha256).length === 0));
  assert.ok(voice.VOICE_MODEL_CANDIDATES.every(x => /verif/i.test(x.license)));
});

test('voice status never mislabels system TTS as ULTRON neural voice', () => {
  assert.match(voice.describeVoiceRuntime({ engine: 'android_offline_tts', state: 'ready', offline: true }), /neural voice model is not installed/i);
  assert.match(voice.describeVoiceRuntime({ engine: 'sherpa_onnx_local', state: 'ready', modelId: 'voice-1', offline: true }), /Local neural voice ready/);
  assert.match(voice.describeVoiceRuntime({ engine: 'web_speech', state: 'ready', offline: false }), /Network use depends/);
});

test('VAD cannot run before explicit microphone start and permission', () => {
  assert.equal(voice.mayRunVoiceActivityDetection({ microphoneSessionStartedByUser: false, microphonePermissionGranted: true, quietMode: false }), false);
  assert.equal(voice.mayRunVoiceActivityDetection({ microphoneSessionStartedByUser: true, microphonePermissionGranted: false, quietMode: false }), false);
  assert.equal(voice.mayRunVoiceActivityDetection({ microphoneSessionStartedByUser: true, microphonePermissionGranted: true, quietMode: true }), false);
  assert.equal(voice.mayRunVoiceActivityDetection({ microphoneSessionStartedByUser: true, microphonePermissionGranted: true, quietMode: false }), true);
});

test('telemetry speech is bounded and removes code and raw URLs', () => {
  const text = voice.prepareTelemetrySpeech('Build failed. See https://example.com/logs\n```js\nsecret code\n```', 100);
  assert.doesNotMatch(text, /https:\/\//);
  assert.doesNotMatch(text, /secret code/);
  assert.ok(text.length <= 100);
});
