#!/usr/bin/env node
/** Ultran local Termux bridge. No arbitrary shell execution; write operations require explicit confirmation. */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const HOST = '127.0.0.1';
const PORT = Number(process.env.ULTRAN_BRIDGE_PORT || 8765);
const TOKEN = process.env.ULTRAN_BRIDGE_TOKEN || crypto.randomBytes(24).toString('hex');
const ROOT = path.resolve(process.env.ULTRAN_FILES_ROOT || path.join(os.homedir(), 'storage', 'shared', 'Ultran'));
const MAX_READ = 256 * 1024;
const ALLOWED_ORIGINS = new Set(['http://localhost', 'https://localhost', 'capacitor://localhost', 'http://127.0.0.1']);

await fs.mkdir(ROOT, { recursive: true, mode: 0o700 });
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };
function safePath(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative)) throw new Error('Provide a relative path inside the Ultran folder.');
  const target = path.resolve(ROOT, relative);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) throw new Error('Path escapes the Ultran folder.');
  return target;
}
async function body(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16_384) throw new Error('Request too large.'); }
  return raw ? JSON.parse(raw) : {};
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin'); res.setHeader('access-control-allow-headers', 'content-type, x-ultran-token, x-ultran-approval'); res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS'); }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
  if (req.headers['x-ultran-token'] !== TOKEN) return json(res, 401, { error: 'Pairing token is missing or invalid.' });
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, name: 'Ultran Termux Bridge', version: 1, filesRoot: ROOT, capabilities: ['device-info', 'list-files', 'read-text', 'write-text-approved'] });
    if (req.method === 'GET' && url.pathname === '/v1/device') return json(res, 200, { platform: 'android-termux', arch: process.arch, release: os.release(), hostname: os.hostname(), uptimeSeconds: os.uptime(), freeMemoryBytes: os.freemem(), totalMemoryBytes: os.totalmem(), home: os.homedir() });
    if (req.method === 'POST' && url.pathname === '/v1/files/list') {
      const input = await body(req); const target = safePath(input.path || '.'); const entries = await fs.readdir(target, { withFileTypes: true });
      const files = await Promise.all(entries.slice(0, 200).map(async entry => { const p = path.join(target, entry.name); let size = 0; try { if (entry.isFile()) size = (await fs.stat(p)).size; } catch {} return { name: entry.name, type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other', sizeBytes: size }; }));
      return json(res, 200, { path: path.relative(ROOT, target) || '.', files });
    }
    if (req.method === 'POST' && url.pathname === '/v1/files/read') {
      const input = await body(req); const target = safePath(input.path); const stat = await fs.stat(target);
      if (!stat.isFile() || stat.size > MAX_READ) return json(res, 413, { error: 'Only regular text files up to 256 KiB can be read.' });
      const content = await fs.readFile(target, 'utf8'); if (content.includes('\ufffd')) return json(res, 415, { error: 'File does not appear to be UTF-8 text.' });
      return json(res, 200, { path: input.path, sizeBytes: stat.size, content });
    }
    if (req.method === 'POST' && url.pathname === '/v1/files/write') {
      const input = await body(req);
      if (req.headers['x-ultran-approval'] !== 'approved') return json(res, 403, { error: 'Write denied. Ultran must show the exact path and content and obtain explicit user approval first.' });
      if (typeof input.content !== 'string' || Buffer.byteLength(input.content) > MAX_READ) return json(res, 413, { error: 'Text content must be at most 256 KiB.' });
      const target = safePath(input.path); await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const temp = `${target}.ultran-${crypto.randomBytes(6).toString('hex')}.partial`;
      await fs.writeFile(temp, input.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); await fs.rename(temp, target);
      return json(res, 200, { ok: true, path: input.path, sizeBytes: Buffer.byteLength(input.content) });
    }
    return json(res, 404, { error: 'Unknown bridge route.' });
  } catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : 'Request failed.' }); }
});
server.listen(PORT, HOST, () => { console.log(`Ultran Termux Bridge listening on http://${HOST}:${PORT}`); console.log(`Files sandbox: ${ROOT}`); console.log(`Pairing token (keep private): ${TOKEN}`); console.log('Press Ctrl+C to stop.'); });
