'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSkillLibrary, parseSkill } = require('./skill-library.cjs');

test('parses skill metadata and rejects missing descriptions', () => {
  assert.deepEqual(parseSkill('---\nname: python-expert\ndescription: Expert Python guidance\n---\n# Python', 'python-expert/SKILL.md').name, 'python-expert');
  assert.equal(parseSkill('---\nname: bad\n---\n# no description', 'bad/SKILL.md'), null);
});

test('indexes, searches, installs, enables and loads only relevant skills', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ultran-skill-library-'));
  const source = path.join(root, 'source'); const installed = path.join(root, 'installed');
  try {
    await fs.mkdir(path.join(source, 'python-expert'), { recursive: true });
    await fs.mkdir(path.join(source, 'security-review'), { recursive: true });
    await fs.writeFile(path.join(source, 'python-expert', 'SKILL.md'), '---\nname: python-expert\ndescription: Python programming and debugging\n---\nUse tests and type checks.');
    await fs.writeFile(path.join(source, 'security-review', 'SKILL.md'), '---\nname: security-review\ndescription: Security audits and threat modeling\n---\nReview trust boundaries.');
    const library = createSkillLibrary({ getSourcePath: () => source, getInstalledPath: () => installed });
    const found = await library.search('python debugging');
    assert.equal(found.totalIndexed, 2); assert.equal(found.results[0].name, 'python-expert');
    await library.install(found.results[0].id);
    assert.equal((await library.listInstalled()).length, 1);
    assert.equal((await library.contextFor('help debug Python code')).length, 1);
    await library.setEnabled(found.results[0].id, false);
    assert.equal((await library.contextFor('help debug Python code')).length, 0);
    await assert.rejects(() => library.install('../etc/passwd'), /identifier/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('requires an explicitly selected skills source', async () => {
  const library = createSkillLibrary({ getSourcePath: () => null, getInstalledPath: () => '/tmp/ultran-skills-test' });
  await assert.rejects(() => library.search('python'), /Choose a skills repository/);
});
