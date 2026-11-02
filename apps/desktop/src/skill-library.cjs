'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_INDEX_FILES = 30000;
const MAX_SKILL_BYTES = 65536;
const SKILL_FILE = 'SKILL.md';
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.cache']);

function parseSkill(markdown, relativePath) {
  const text = String(markdown || '');
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  const front = match ? match[1] : '';
  const field = key => {
    const found = front.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
    return found ? found[1].trim().replace(/^['"]|['"]$/g, '') : '';
  };
  const folderName = path.basename(path.dirname(relativePath));
  const name = field('name') || folderName;
  const description = field('description');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,100}$/.test(name) || !description) return null;
  return { name, description, relativePath, contentBytes: Buffer.byteLength(text), hasFrontmatter: Boolean(match) };
}

function createSkillLibrary({ getSourcePath, getInstalledPath }) {
  if (typeof getSourcePath !== 'function' || typeof getInstalledPath !== 'function') throw new TypeError('Skill library paths are required.');
  let cache = null;

  async function walk(root, dir = root, output = []) {
    if (output.length >= MAX_INDEX_FILES) return output;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return output; }
    for (const entry of entries) {
      if (output.length >= MAX_INDEX_FILES) break;
      if (entry.name.startsWith('.') || (entry.isDirectory() && SKIP_DIRS.has(entry.name)) || entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(root, absolute, output);
      else if (entry.isFile() && entry.name.toLowerCase() === SKILL_FILE.toLowerCase()) {
        const relativePath = path.relative(root, absolute);
        try {
          const stat = await fs.stat(absolute);
          if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) continue;
          const content = await fs.readFile(absolute, 'utf8');
          const metadata = parseSkill(content, relativePath);
          if (metadata) output.push({ id: crypto.createHash('sha256').update(relativePath).digest('hex').slice(0, 20), ...metadata });
        } catch {}
      }
    }
    return output;
  }

  async function index(force = false) {
    const source = getSourcePath();
    if (typeof source !== 'string' || !source.trim()) throw new Error('Choose a skills repository folder first.');
    const root = path.resolve(source);
    if (!force && cache?.root === root) return cache.skills;
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) throw new Error('Skills source must be a folder.');
    const skills = await walk(root);
    cache = { root, skills, indexedAt: new Date().toISOString() };
    return skills;
  }

  async function search(query, limit = 30) {
    if (typeof query !== 'string' || query.length > 300) throw new Error('Invalid skill search.');
    const skills = await index();
    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 12);
    const ranked = skills.map(skill => {
      const name = skill.name.toLowerCase();
      const desc = skill.description.toLowerCase();
      const pathText = skill.relativePath.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (name === term) score += 12;
        else if (name.includes(term)) score += 7;
        if (desc.includes(term)) score += 3;
        if (pathText.includes(term)) score += 2;
      }
      return { ...skill, score };
    }).filter(item => !terms.length || item.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return { totalIndexed: skills.length, results: ranked.slice(0, Math.max(1, Math.min(100, limit))).map(({ score, ...skill }) => skill) };
  }

  async function readFrom(root, relativePath) {
    const base = await fs.realpath(root);
    const candidate = path.resolve(base, relativePath);
    if (candidate !== base && !candidate.startsWith(base + path.sep)) throw new Error('Skill path escapes its library.');
    const real = await fs.realpath(candidate);
    if (!real.startsWith(base + path.sep) || path.basename(real).toLowerCase() !== SKILL_FILE.toLowerCase()) throw new Error('Invalid skill file path.');
    const stat = await fs.stat(real);
    if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) throw new Error('Skill exceeds the 64 KB loading limit.');
    return fs.readFile(real, 'utf8');
  }


  async function copySkillAssets(sourceDir, destinationDir) {
    let files = 0, bytes = 0;
    async function copy(from, to, depth = 0) {
      if (depth > 8) return;
      for (const entry of await fs.readdir(from, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
        const src = path.join(from, entry.name), dst = path.join(to, entry.name);
        if (entry.isDirectory()) { await fs.mkdir(dst, { recursive: true }); await copy(src, dst, depth + 1); continue; }
        if (!entry.isFile()) continue;
        const stat = await fs.stat(src);
        if (++files > 200 || bytes + stat.size > 10 * 1024 * 1024) throw new Error('Skill package exceeds the 200-file or 10 MB installation limit.');
        bytes += stat.size;
        await fs.copyFile(src, dst, require('node:fs').constants.COPYFILE_EXCL);
      }
    }
    await fs.mkdir(destinationDir, { recursive: true });
    await copy(sourceDir, destinationDir);
    return { files, bytes };
  }

  async function install(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{20}$/.test(id)) throw new Error('Invalid skill identifier.');
    const skills = await index();
    const skill = skills.find(item => item.id === id);
    if (!skill) throw new Error('Skill was not found in the selected library.');
    const content = await readFrom(getSourcePath(), skill.relativePath);
    const sourceDirectory = path.dirname(path.join(getSourcePath(), skill.relativePath));
    const destinationRoot = path.resolve(getInstalledPath());
    await fs.mkdir(destinationRoot, { recursive: true });
    const destination = path.join(destinationRoot, id);
    await fs.rm(destination, { recursive: true, force: true });
    await copySkillAssets(sourceDirectory, destination);
    const target = path.join(destination, SKILL_FILE);
    const temp = target + '.tmp-' + crypto.randomUUID();
    await fs.rm(target, { force: true });
    try {
      const handle = await fs.open(temp, 'wx');
      try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temp, target);
    } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    const metadata = parseSkill(content, skill.relativePath);
    const record = { id, name: metadata.name, description: metadata.description, source: skill.relativePath, installedAt: new Date().toISOString(), enabled: true };
    const manifest = path.join(destinationRoot, 'manifest.json');
    let items = [];
    try { items = JSON.parse(await fs.readFile(manifest, 'utf8')); if (!Array.isArray(items)) items = []; } catch {}
    items = items.filter(item => item.id !== id);
    items.push(record);
    const manifestTemp = manifest + '.tmp-' + crypto.randomUUID();
    try { await fs.writeFile(manifestTemp, JSON.stringify(items, null, 2), { flag: 'wx' }); await fs.rename(manifestTemp, manifest); }
    finally { await fs.rm(manifestTemp, { force: true }).catch(() => {}); }
    return record;
  }

  async function listInstalled() {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(getInstalledPath(), 'manifest.json'), 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  async function setEnabled(id, enabled) {
    if (typeof id !== 'string' || typeof enabled !== 'boolean') throw new Error('Invalid skill setting.');
    const manifest = path.join(getInstalledPath(), 'manifest.json');
    const items = await listInstalled();
    const item = items.find(skill => skill.id === id);
    if (!item) throw new Error('Installed skill not found.');
    item.enabled = enabled;
    const temp = manifest + '.tmp-' + crypto.randomUUID();
    try { await fs.writeFile(temp, JSON.stringify(items, null, 2), { flag: 'wx' }); await fs.rename(temp, manifest); }
    finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    return item;
  }

  async function contextFor(goal, maxSkills = 3) {
    const installed = (await listInstalled()).filter(item => item.enabled);
    const terms = String(goal || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 20);
    const ranked = installed.map(item => ({ item, score: terms.reduce((n, term) => n + (item.name.toLowerCase().includes(term) ? 5 : 0) + (item.description.toLowerCase().includes(term) ? 2 : 0), 0) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(0, Math.min(5, maxSkills)));
    const chunks = [];
    for (const { item } of ranked) {
      try {
        const content = await readFrom(path.join(getInstalledPath(), item.id), SKILL_FILE);
        chunks.push({ name: item.name, source: item.source, content: content.slice(0, 14000) });
      } catch {}
    }
    return chunks;
  }

  return Object.freeze({ index, search, install, listInstalled, setEnabled, contextFor });
}

module.exports = { createSkillLibrary, parseSkill };
