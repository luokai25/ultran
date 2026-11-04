import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the phone connector marketplace exposes GitHub only', () => {
  const catalog = JSON.parse(readFileSync(path.join(root, 'src/connectors.catalog.json'), 'utf8'));
  assert.deepEqual(catalog.map((entry) => entry.id), ['github']);
  assert.equal(catalog[0].auth, 'oauth2');
  assert.ok(catalog[0].actions.some((action) => action.toLowerCase().includes('repository')));
});

test('the connector screen is branded for GitHub and explains approval boundaries', () => {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = readFileSync(path.join(root, 'src/connectors-ui.ts'), 'utf8');
  assert.match(html, /ULTRON CONNECTOR · 01/);
  assert.match(html, /GITHUB ACCOUNT/);
  assert.match(ui, /github-capability-list/);
  assert.match(ui, /separate approval showing the exact repository and action/);
});
