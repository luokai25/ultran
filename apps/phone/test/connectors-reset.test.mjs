import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the phone connector marketplace exposes GitHub and unified Google Workspace', () => {
  const catalog = JSON.parse(readFileSync(path.join(root, 'src/connectors.catalog.json'), 'utf8'));
  assert.deepEqual(catalog.map((entry) => entry.id), ['github', 'googlesuper']);
  assert.equal(catalog[0].auth, 'oauth2');
  assert.ok(catalog[0].actions.some((action) => action.toLowerCase().includes('repository')));\n  assert.equal(catalog[1].name, 'Google Workspace');\n  assert.equal(catalog[1].auth, 'oauth2');\n  assert.ok(catalog[1].actions.some((action) => action.includes('Gmail')));\n  assert.match(catalog[1].description, /Google OAuth consent screen/);
});

test('the connector screen is branded as a unified gateway and explains approval boundaries', () => {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(root, 'src/connectors-ui.ts'), 'utf8');
  assert.match(html, /ULTRON CONNECTOR GATEWAY/);
  assert.match(html, /CONNECTED PROVIDER ACCOUNTS/);
  assert.match(ui, /github-capability-list/);
  assert.match(ui, /separate approval/);\n  assert.match(ui, /Google authorization page/);
});
