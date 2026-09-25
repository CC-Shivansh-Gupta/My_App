// Free cross-device sync through a secret GitHub Gist.
// Each device holds a GitHub token (classic, "gist" scope only). On sync we
// pull the gist, merge it into local data (newest edit wins per item), and
// push back if the gist is missing anything.

import * as store from './store.js';

const CFG_KEY = 'daybook.sync.v1';
const FILE = 'daybook-data.json';
const API = 'https://api.github.com';

let cfg = loadCfg();
let running = null;
let again = false;
let timer = null;
const listeners = new Set();

function loadCfg() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
}

function saveCfg() {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  for (const fn of listeners) fn(status());
}

export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function status() {
  return {
    enabled: Boolean(cfg.token && cfg.gistId),
    gistId: cfg.gistId,
    lastSync: cfg.lastSync || null,
    error: cfg.error || null,
    busy: Boolean(running),
    user: cfg.user || null,
  };
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${opts.token || cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
    if (res.status === 401) msg = 'GitHub rejected the token (expired or wrong?)';
    if (res.status === 404 && path.startsWith('/gists/')) msg = 'Sync gist not found (deleted?)';
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// Connect with a token: find the existing sync gist on this account or create one.
export async function connect(token) {
  token = token.trim();
  const user = await api('/user', { token });
  let gistId = null;
  for (let page = 1; page <= 10 && !gistId; page++) {
    const gists = await api(`/gists?per_page=100&page=${page}`, { token });
    const hit = gists.find((g) => g.files && g.files[FILE]);
    if (hit) gistId = hit.id;
    if (gists.length < 100) break;
  }
  if (!gistId) {
    const created = await api('/gists', {
      token,
      method: 'POST',
      body: JSON.stringify({
        description: 'Daybook sync data — do not delete (personal tracker)',
        public: false,
        files: { [FILE]: { content: JSON.stringify(payload()) } },
      }),
    });
    gistId = created.id;
  }
  cfg = { token, gistId, user: user.login, lastSync: null, error: null };
  saveCfg();
  await syncNow();
}

export function disconnect() {
  cfg = {};
  saveCfg();
}

function payload() {
  return { app: 'daybook', version: 1, savedAt: new Date().toISOString(), data: store.snapshot() };
}

export async function syncNow() {
  if (!cfg.token || !cfg.gistId) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (running) { again = true; return running; }
  running = (async () => {
    saveCfg();
    try {
      const gist = await api(`/gists/${cfg.gistId}`);
      const file = gist.files[FILE];
      let text = file ? file.content : '';
      if (file && file.truncated) text = await (await fetch(file.raw_url, { cache: 'no-store' })).text();
      let remote = {};
      try { remote = text ? JSON.parse(text).data || {} : {}; } catch { remote = {}; }
      const { remoteStale } = store.merge(remote);
      if (remoteStale || !file) {
        await api(`/gists/${cfg.gistId}`, {
          method: 'PATCH',
          body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(payload()) } } }),
        });
      }
      cfg.lastSync = Date.now();
      cfg.error = null;
    } catch (e) {
      cfg.error = e.message || String(e);
    } finally {
      running = null;
      saveCfg();
    }
    if (again) { again = false; await syncNow(); }
  })();
  return running;
}

// Push soon after local edits; pull when the app comes back to the foreground.
export function start() {
  store.subscribe((source) => {
    if (source === 'remote' || !cfg.token) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 1500);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
    else if (timer) { clearTimeout(timer); syncNow(); }
  });
  window.addEventListener('online', () => syncNow());
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 120000);
  syncNow();
}
