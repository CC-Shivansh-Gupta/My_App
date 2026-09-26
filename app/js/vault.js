// Obsidian vault connection: reads the vault's Markdown from its private GitHub repo (the same
// repo the FIT plugin syncs to every device), caches it for offline use, and writes quick
// captures to raw/inbox/ and Daybook snapshots to raw/daybook/.
// The token is kept per device in localStorage; it never goes into the synced data.

import * as D from './dates.js';
import { noteTitle, noteBody } from './graph.js';

const CFG_KEY = 'daybook.vault';
const API = 'https://api.github.com';
const listeners = new Set();

let files = new Map(); // path → { sha, text }
let state = { loading: false, error: '', lastSync: 0, progress: '' };
let loaded = false;
let lastAttempt = 0;

// ---- Config -------------------------------------------------------------------------------------------------
function ls() { try { return globalThis.localStorage || null; } catch { return null; } }

export function config() {
  try { return JSON.parse(ls()?.getItem(CFG_KEY) || 'null'); } catch { return null; }
}

function saveConfig(cfg) {
  try { if (cfg) ls()?.setItem(CFG_KEY, JSON.stringify(cfg)); else ls()?.removeItem(CFG_KEY); } catch { /* private mode */ }
}

export const connected = () => Boolean(config()?.token && config()?.repo);
export const status = () => ({ ...state, connected: connected(), count: files.size, repo: config()?.repo || '' });
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const fn of listeners) fn(); };
const set = (patch) => { state = { ...state, ...patch }; emit(); };

// "github.com/me/second-brain", "https://github.com/me/second-brain.git" or "me/second-brain" → "me/second-brain"
export function parseRepo(s) {
  const m = String(s || '').trim().replace(/\.git$/, '').replace(/\/+$/, '').match(/(?:github\.com[/:])?([\w.-]+)\/([\w.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : '';
}

async function gh(path, { method = 'GET', body, raw = false, token = config()?.token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) {
    let msg = `GitHub said ${res.status}`;
    try { msg = (await res.json()).message || msg; } catch { /* not JSON */ }
    if (res.status === 401) msg = 'The token was rejected. It may have expired: make a new one and reconnect.';
    if (res.status === 404) msg = 'Repo or file not found. Check the repo name, and that the token has access to it.';
    if (res.status === 403 && /rate limit/i.test(msg)) msg = 'GitHub rate limit reached. Try again in a few minutes.';
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return raw ? res.text() : res.json();
}

export async function connect({ repo, token, vaultName }) {
  const name = parseRepo(repo);
  if (!name) throw new Error('Enter the repo as owner/name, e.g. me/second-brain.');
  if (!token?.trim()) throw new Error('Paste a GitHub token.');
  const info = await gh(`/repos/${name}`, { token: token.trim() });
  saveConfig({ repo: name, token: token.trim(), branch: info.default_branch || 'main', vaultName: (vaultName || '').trim() || name.split('/')[1] });
  if (!info.private) set({ error: 'Warning: this repo is public. Anyone can read your notes. Make it private in its GitHub settings.' });
  files = new Map();
  await cacheClear();
  return refresh();
}

export async function disconnect() {
  saveConfig(null);
  files = new Map();
  loaded = true;
  await cacheClear();
  set({ error: '', lastSync: 0, progress: '' });
}

export function setVaultName(vaultName) {
  const cfg = config();
  if (cfg) saveConfig({ ...cfg, vaultName: vaultName.trim() || cfg.repo.split('/')[1] });
  emit();
}

// ---- Reading ------------------------------------------------------------------------------------------------
// Tooling and instruction files that would only clutter the map.
export function isNote(path) {
  if (!/\.md$/i.test(path)) return false;
  if (/(^|\/)[._]/.test(path)) return false; // .obsidian, .agents, .github, _fit, …
  if (/^(templates|scripts|output)\//i.test(path)) return false;
  const base = path.split('/').pop();
  return !/^(README|AGENTS|CLAUDE|GEMINI)\.md$/i.test(base);
}

export function all() {
  return [...files].map(([path, f]) => ({ path, text: f.text }));
}

export const get = (path) => files.get(path)?.text ?? null;

// Load the offline copy once; then pull changes from GitHub.
export async function load() {
  if (!loaded) {
    loaded = true;
    const cached = await cacheGet();
    if (cached && cached.repo === config()?.repo) {
      files = new Map(Object.entries(cached.files));
      state.lastSync = cached.at || 0;
      emit();
    }
  }
  // At most one automatic pull every 5 minutes, whether or not the last one worked.
  if (connected() && Date.now() - lastAttempt > 5 * 60000) refresh().catch(() => {});
}

let inflight = null;
export function refresh() {
  if (!connected()) return Promise.resolve(false);
  if (!inflight) inflight = doRefresh().finally(() => { inflight = null; });
  return inflight;
}

async function doRefresh() {
  const { repo, branch } = config();
  lastAttempt = Date.now();
  set({ loading: true, error: state.error.startsWith('Warning') ? state.error : '', progress: 'Checking for changes…' });
  try {
    const tree = await gh(`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const wanted = tree.tree.filter((t) => t.type === 'blob' && isNote(t.path));
    const next = new Map();
    const todo = [];
    for (const t of wanted) {
      const have = files.get(t.path);
      if (have && have.sha === t.sha) next.set(t.path, have);
      else todo.push(t);
    }
    let done = 0;
    const worker = async () => {
      while (todo.length) {
        const t = todo.shift();
        const text = await gh(`/repos/${repo}/git/blobs/${t.sha}`, { raw: true });
        next.set(t.path, { sha: t.sha, text });
        done++;
        if (done % 10 === 0) set({ progress: `Downloading notes… ${done}` });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const changed = next.size !== files.size || [...next].some(([p, f]) => files.get(p)?.sha !== f.sha);
    files = next;
    set({ loading: false, lastSync: Date.now(), progress: tree.truncated ? 'Vault is very large; some files were skipped.' : '' });
    await cachePut({ repo, at: state.lastSync, files: Object.fromEntries(files) });
    return changed;
  } catch (e) {
    set({ loading: false, error: e.message, progress: '' });
    throw e;
  }
}

// ---- Writing ------------------------------------------------------------------------------------------------
function b64(text) {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function shaOf(path) {
  try { return (await gh(`/repos/${config().repo}/contents/${encPath(path)}?ref=${encodeURIComponent(config().branch)}`)).sha; } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function writeFile(path, text, message) {
  const { repo, branch } = config();
  const sha = await shaOf(path);
  const res = await gh(`/repos/${repo}/contents/${encPath(path)}`, { method: 'PUT', body: { message, content: b64(text), branch, ...(sha ? { sha } : {}) } });
  if (isNote(path)) { files.set(path, { sha: res.content.sha, text }); emit(); }
  return res;
}

export function slug(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'note';
}

// A quick thought → raw/inbox/2026-09-26-0915-some-title.md, for an assistant to file later.
export function inboxFile(text, now = new Date()) {
  const title = noteTitle(text);
  const stamp = `${D.toStr(now)}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const body = noteBody(text);
  return {
    path: `raw/inbox/${stamp}-${slug(title)}.md`,
    text: `---\ncaptured: ${now.toISOString()}\nfrom: daybook\n---\n\n# ${title}\n${body ? `\n${body}\n` : ''}`,
  };
}

export async function capture(text) {
  const f = inboxFile(text);
  await writeFile(f.path, f.text, `inbox: ${noteTitle(text)}`);
  return f.path;
}

// ---- Daybook → raw/daybook/ ---------------------------------------------------------------------------------
const stars = (n) => (n ? ` · ${'★'.repeat(n)}` : '');
const clean = (s) => String(s || '').replace(/\r/g, '').trim();
const indent = (s) => clean(s).split('\n').map((l) => `  ${l}`).join('\n');

// data: { notes, learnings, reading, watch, goals } → { path: markdown }
export function daybookMarkdown(data, today = D.today()) {
  const head = (title, what) => `---\ntype: daybook-export\nexported: ${today}\n---\n\n# ${title}\n\n${what} Exported from Daybook; the next export replaces this file.\n`;
  const out = {};

  const learnings = [...(data.learnings || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  out['raw/daybook/learnings.md'] = head('Daybook learnings', `${learnings.length} things I've learned, newest first.`) + learnings.map((l) => {
    const meta = [l.type, D.toStr(new Date(l.createdAt || Date.now())), ...(l.topics || []).map((t) => `#${String(t).replace(/\s+/g, '-')}`), l.source ? `source: ${l.source}` : ''].filter(Boolean).join(' · ');
    return `\n- **${clean(l.text)}**\n  ${meta}${l.details ? `\n${indent(l.details)}` : ''}`;
  }).join('');

  const statusName = { reading: 'Reading now', toread: 'Up next', done: 'Finished', watching: 'Watching', towatch: 'Up next' };
  const byStatus = (items, order, row) => order.map((st) => {
    const xs = items.filter((x) => x.status === st);
    return xs.length ? `\n## ${statusName[st] || st}\n${xs.map(row).join('')}` : '';
  }).join('');
  const reading = data.reading || [];
  out['raw/daybook/reading.md'] = head('Daybook reading list', `${reading.length} books, articles and papers.`) + byStatus(reading, ['reading', 'toread', 'done'], (r) =>
    `\n- **${clean(r.title)}**${r.author ? ` by ${clean(r.author)}` : ''}${r.type && r.type !== 'book' ? ` (${r.type})` : ''}${r.status === 'reading' ? ` · ${r.progress || 0}%` : ''}${r.finishedAt ? ` · finished ${r.finishedAt}` : ''}${stars(r.rating)}${r.url ? ` · ${r.url}` : ''}${r.notes ? `\n${indent(r.notes)}` : ''}`);

  const watch = data.watch || [];
  out['raw/daybook/watch.md'] = head('Daybook watch list', `${watch.length} movies, shows and videos.`) + byStatus(watch, ['watching', 'towatch', 'done'], (w) =>
    `\n- **${clean(w.title)}** (${w.type || 'movie'})${w.platform ? ` · ${w.platform}` : ''}${w.finishedAt ? ` · watched ${w.finishedAt}` : ''}${stars(w.rating)}${w.recommendedBy ? ` · recommended by ${w.recommendedBy}` : ''}${w.notes ? `\n${indent(w.notes)}` : ''}`);

  const goals = data.goals || [];
  const title = Object.fromEntries(goals.map((g) => [g.id, g.title]));
  out['raw/daybook/goals.md'] = head('Daybook goals', `${goals.length} goals.`) + ['life', 'year', 'month'].map((hz) => {
    const xs = goals.filter((g) => g.horizon === hz);
    return xs.length ? `\n## ${hz === 'life' ? 'Life' : hz === 'year' ? 'Yearly' : 'Monthly'}\n${xs.map((g) =>
      `\n- **${clean(g.title)}**${g.period ? ` (${g.period})` : ''} · ${g.status || 'active'}${g.mode === 'number' ? ` · ${g.current || 0}/${g.target} ${g.unit || ''}`.trimEnd() : ''}${g.area ? ` · ${g.area}` : ''}${g.parent && title[g.parent] ? ` · supports: ${title[g.parent]}` : ''}${g.notes ? `\n${indent(g.notes)}` : ''}`).join('')}` : '';
  }).join('');

  const notes = [...(data.notes || [])].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  out['raw/daybook/notes.md'] = head('Daybook notes', `${notes.length} quick notes.`) + notes.map((n) =>
    `\n## ${noteTitle(n.text)}\n\n${noteBody(n.text) || '_(no body)_'}\n`).join('');
  return out;
}

// Writes only the files whose content changed. Returns how many were written.
export async function exportDaybook(data) {
  let n = 0;
  for (const [path, text] of Object.entries(daybookMarkdown(data))) {
    if (files.get(path)?.text === text) continue;
    await writeFile(path, text, `daybook: update ${path.split('/').pop()}`);
    n++;
  }
  return n;
}

// ---- Links out ----------------------------------------------------------------------------------------------
export function obsidianUrl(path) {
  const cfg = config();
  return `obsidian://open?vault=${encodeURIComponent(cfg?.vaultName || '')}&file=${encodeURIComponent(path.replace(/\.md$/i, ''))}`;
}

export function githubUrl(path) {
  const cfg = config();
  return `https://github.com/${cfg.repo}/blob/${encodeURIComponent(cfg.branch)}/${encPath(path)}`;
}

// ---- Offline cache (IndexedDB; falls back to nothing) -------------------------------------------------------
function idb() {
  return new Promise((resolve) => {
    try {
      if (!globalThis.indexedDB) return resolve(null);
      const req = indexedDB.open('daybook-vault', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function tx(mode, fn) {
  const db = await idb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => resolve(req?.result ?? null);
      t.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

const cacheGet = () => tx('readonly', (s) => s.get('vault'));
const cachePut = (v) => tx('readwrite', (s) => s.put(v, 'vault'));
const cacheClear = () => tx('readwrite', (s) => s.delete('vault'));
