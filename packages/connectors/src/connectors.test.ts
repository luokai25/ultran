import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

import { BUILTIN_CONNECTORS, ConnectorRegistry, validateManifest } from './index.js';
import type { ConnectorManifest } from './index.js';

// `npm test` runs from the package root, wherever the compiled test lands.
const schemaPath = resolve(process.cwd(), 'schema/manifest.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
  properties: { tools: { items: { properties: { id: { pattern: string } } } } };
};

function clone(m: ConnectorManifest): ConnectorManifest {
  return JSON.parse(JSON.stringify(m)) as ConnectorManifest;
}

test('there are three first-party connectors', () => {
  assert.deepEqual(
    BUILTIN_CONNECTORS.map((m) => m.id).sort(),
    ['files', 'github', 'slack'],
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
  assert.equal(registry.list().length, 3);
  assert.equal(registry.listTools().length, 7);
});

test('the JSON schema accepts the namespaced tool ids the validator requires', () => {
  const pattern = new RegExp(schema.properties.tools.items.properties.id.pattern);
  for (const manifest of BUILTIN_CONNECTORS) {
    for (const tool of manifest.tools) assert.match(tool.id, pattern, tool.id);
  }
});

test('the files connector is provably offline', () => {
  const files = BUILTIN_CONNECTORS.find((m) => m.id === 'files');
  assert.ok(files);
  assert.equal(files.egress.length, 0);
  assert.equal(files.auth.kind, 'none');
  assert.ok(files.tools.every((t) => !t.network));
});

test('reads and writes are separate capabilities', () => {
  const files = BUILTIN_CONNECTORS.find((m) => m.id === 'files');
  const slack = BUILTIN_CONNECTORS.find((m) => m.id === 'slack');
  assert.ok(files && slack);
  assert.notEqual(files.tools.find((t) => t.id === 'files.read')?.capability, files.tools.find((t) => t.id === 'files.write')?.capability);
  assert.notEqual(slack.tools.find((t) => t.id === 'slack.channels.list')?.capability, slack.tools.find((t) => t.id === 'slack.messages.post')?.capability);
});

test('validator rejects wildcard egress, unused capabilities and bad namespacing', () => {
  const bad = clone(BUILTIN_CONNECTORS[0]!);
  bad.egress = [{ host: '*.github.com', port: 443 }];
  bad.capabilities.push('admin:all');
  bad.tools[0]!.id = 'other.repos.list';
  const errors = validateManifest(bad).join('\n');
  assert.match(errors, /wildcards/);
  assert.match(errors, /declared but no tool uses it/);
  assert.match(errors, /namespaced under/);
});

test('a network tool with no egress is rejected', () => {
  const bad = clone(BUILTIN_CONNECTORS.find((m) => m.id === 'slack')!);
  bad.egress = [];
  assert.match(validateManifest(bad).join('\n'), /egress list is empty/);
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
