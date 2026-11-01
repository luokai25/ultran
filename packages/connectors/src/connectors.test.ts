import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

import { BUILTIN_CONNECTORS, buildToolManual, ConnectorRegistry, validateManifest } from './index.js';
import type { ConnectorManifest } from './index.js';
import { diagnoseCapabilities, normalizeToolCall, toolCallResult } from './index.js';

const schemaPath = resolve(process.cwd(), 'schema/manifest.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
  properties: { tools: { items: { properties: { id: { pattern: string } } } } };
};

function clone(m: ConnectorManifest): ConnectorManifest {
  return JSON.parse(JSON.stringify(m)) as ConnectorManifest;
}

test('the first-party catalogue includes ten connectors', () => {
  assert.deepEqual(
    BUILTIN_CONNECTORS.map((m) => m.id).sort(),
    ['anthropic', 'discord', 'files', 'github', 'google-drive', 'notion', 'ollama', 'openai', 'slack', 'telegram'],
  );
});

test('every builtin manifest validates cleanly', () => {
  for (const manifest of BUILTIN_CONNECTORS) {
    assert.deepEqual(validateManifest(manifest), [], manifest.id);
  }
});

test('every builtin loads into the registry and exposes its tools', () => {
  const registry = new ConnectorRegistry();
  for (const manifest of BUILTIN_CONNECTORS) registry.load(manifest);
  assert.equal(registry.list().length, 10);
  assert.equal(registry.listTools().length, 21);
});

test('the JSON schema accepts the namespaced tool ids the validator requires', () => {
  const pattern = new RegExp(schema.properties.tools.items.properties.id.pattern);
  for (const manifest of BUILTIN_CONNECTORS) {
    for (const tool of manifest.tools) assert.match(tool.id, pattern, tool.id);
  }
});

test('the local files connector is offline and requires no credentials', () => {
  const files = BUILTIN_CONNECTORS.find((m) => m.id === 'files');
  assert.ok(files);
  assert.equal(files.egress.length, 0);
  assert.equal(files.auth.kind, 'none');
  assert.ok(files.tools.every((t) => !t.network));
});

test('read and write operations use separate capabilities', () => {
  for (const id of ['files', 'github', 'slack', 'notion', 'discord', 'telegram', 'google-drive']) {
    const manifest = BUILTIN_CONNECTORS.find((m) => m.id === id);
    assert.ok(manifest, id);
    const capabilities = new Set(manifest.tools.map((tool) => tool.capability));
    assert.ok(capabilities.size >= 2, id);
  }
});

test('network tools require explicit egress and wildcard hosts are rejected', () => {
  const bad = clone(BUILTIN_CONNECTORS.find((m) => m.id === 'github')!);
  bad.egress = [{ host: '*.github.com', port: 443 }];
  bad.capabilities.push('admin:all');
  bad.tools[0]!.id = 'other.repos.list';
  const errors = validateManifest(bad).join('\n');
  assert.match(errors, /wildcards/);
  assert.match(errors, /declared but no tool uses it/);
  assert.match(errors, /namespaced under/);
  const noEgress = clone(BUILTIN_CONNECTORS.find((m) => m.id === 'slack')!);
  noEgress.egress = [];
  assert.match(validateManifest(noEgress).join('\n'), /egress list is empty/);
});

test('a lower-priority source cannot displace a builtin', () => {
  const registry = new ConnectorRegistry();
  const github = BUILTIN_CONNECTORS.find((m) => m.id === 'github')!;
  registry.load(github, 'builtin');
  const impostor = clone(github);
  impostor.version = '9.9.9';
  registry.load(impostor, 'marketplace');
  assert.equal(registry.get('github')?.manifest.version, '1.0.0');
});

test('the shared tool manual teaches providers the same safe calling contract', () => {
  const registry = new ConnectorRegistry();
  for (const manifest of BUILTIN_CONNECTORS) registry.load(manifest);
  const manual = buildToolManual(registry.listTools());
  assert.match(manual, /case-sensitive/);
  assert.match(manual, /inputSchema/);
  assert.match(manual, /NORMALIZED CALL/);
  assert.match(manual, /toolId.*args/);
  assert.match(manual, /approval flow/);
  assert.match(manual, /successful result/);
  assert.ok(manual.includes('files.list'));
});

test('the shared tool manual explicitly handles an empty registry', () => {
  const manual = buildToolManual([]);
  assert.match(manual, /No tools are currently registered/);
  assert.match(manual, /Do not invent tool names/);
});


test('normalizes the canonical JSON tool-call contract', () => {
  const result = normalizeToolCall('{"toolId":"files.list","args":{"path":"."}}', BUILTIN_CONNECTORS.flatMap((m) => m.tools));
  assert.deepEqual(result, { ok: true, call: { toolId: 'files.list', args: { path: '.' } } });
});

test('normalizes provider-native function and input calls', () => {
  assert.deepEqual(normalizeToolCall({ function: { name: 'github.issues.list', arguments: '{"owner":"a","repo":"b"}' } }), {
    ok: true, call: { toolId: 'github.issues.list', args: { owner: 'a', repo: 'b' } },
  });
  assert.deepEqual(normalizeToolCall({ name: 'telegram.message.prepare', input: { body: 'hello' } }), {
    ok: true, call: { toolId: 'telegram.message.prepare', args: { body: 'hello' } },
  });
});

test('normalizes the phone brain marker and fenced JSON without parsing arbitrary prose', () => {
  assert.deepEqual(normalizeToolCall('ULTRAN_TOOL_CALL:{"tool":"runtime.jobs"}'), {
    ok: true, call: { toolId: 'runtime.jobs', args: {} },
  });
  assert.deepEqual(normalizeToolCall('ULTRAN_TOOL_CALL:{\"tool\":\"runtime.exec\",\"command\":\"pwd\"}'), {
    ok: true, call: { toolId: 'runtime.exec', args: { command: 'pwd' } },
  });
  assert.deepEqual(normalizeToolCall('```json\n{"toolId":"files.list","args":{}}\n```'), {
    ok: true, call: { toolId: 'files.list', args: {} },
  });
  assert.equal(normalizeToolCall('I think we should use files.list now.').ok, false);
});

test('rejects malformed, missing, invalid, and unavailable tool calls', () => {
  assert.equal(normalizeToolCall('{bad json').ok, false);
  assert.equal(normalizeToolCall({ args: {} }).ok, false);
  assert.equal(normalizeToolCall({ toolId: 'files.list', args: [] }).ok, false);
  assert.deepEqual(normalizeToolCall({ toolId: 'files.delete', args: {} }, BUILTIN_CONNECTORS.flatMap((m) => m.tools)), {
    ok: false, error: 'unknown_tool', message: 'Tool "files.delete" is not in the currently available catalogue.',
  });
});

test('tool result contract cannot report success and failure simultaneously', () => {
  assert.deepEqual(toolCallResult({ toolId: 'files.list', ok: true, output: [] }), { toolId: 'files.list', ok: true, output: [] });
  assert.throws(() => toolCallResult({ toolId: 'files.list', ok: false }), /must contain an error/);
  assert.throws(() => toolCallResult({ toolId: 'files.list', ok: true, error: { code: 'bad', message: 'bad' } }), /cannot contain an error/);
});


test('capability diagnostics do not confuse registration with execution', () => {
  const tool = BUILTIN_CONNECTORS.find((m) => m.id === 'files')!.tools[0]!;
  const [registered] = diagnoseCapabilities([tool]);
  assert.ok(registered);
  assert.equal(registered.registered, true);
  assert.equal(registered.implemented, false);
  assert.equal(registered.available, false);
  assert.equal(registered.authorized, false);
  assert.equal(registered.verified, false);
  assert.equal(registered.state, 'missing_handler');

  const [implemented] = diagnoseCapabilities([tool], { implementedToolIds: [tool.id] });
  assert.equal(implemented?.state, 'unavailable');
  assert.equal(implemented?.implemented, true);
  assert.equal(implemented?.available, false);
});

test('capability diagnostics require availability and grants before verification', () => {
  const tool = BUILTIN_CONNECTORS.find((m) => m.id === 'files')!.tools[0]!;
  const evidence = {
    implementedToolIds: [tool.id],
    availableToolIds: [tool.id],
    authorizedToolIds: [tool.id],
    checkedAt: '2026-10-31T12:00:00.000Z',
  };
  const [ready] = diagnoseCapabilities([tool], evidence);
  assert.equal(ready?.state, 'unverified');
  assert.equal(ready?.authorized, true);
  assert.equal(ready?.verified, false);
  assert.equal(ready?.checkedAt, evidence.checkedAt);

  const [verified] = diagnoseCapabilities([tool], { ...evidence, verifiedToolIds: [tool.id] });
  assert.equal(verified?.state, 'verified');
  assert.equal(verified?.verified, true);
});

test('capability diagnostics preserve host reasons and fail closed on incomplete evidence', () => {
  const tool = BUILTIN_CONNECTORS.find((m) => m.id === 'github')!.tools[0]!;
  const [status] = diagnoseCapabilities([tool], {
    implementedToolIds: [tool.id],
    availableToolIds: [tool.id],
    reasons: { [tool.id]: 'GitHub session is not connected for this account.' },
  });
  assert.equal(status?.state, 'unauthorized');
  assert.equal(status?.reason, 'GitHub session is not connected for this account.');
  assert.equal(status?.verified, false);
});
