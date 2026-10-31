import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

import { BUILTIN_CONNECTORS, ConnectorRegistry, validateManifest } from './index.js';
import type { ConnectorManifest } from './index.js';

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
  assert.equal(registry.listTools().length, 19);
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
