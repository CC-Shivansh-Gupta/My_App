// Local-first data store. Everything lives in localStorage as collections of
// records keyed by id. Every record carries `updatedAt`; deletes leave a
// tombstone so they can sync. Merging two copies keeps the newest record per id.

export const COLLECTIONS = ['events', 'todos', 'tasks', 'reading', 'habits', 'habitLogs',
  'expenses', 'newsMarks', 'prefs', 'notes', 'workouts', 'templates', 'exercises', 'measurements', 'goals', 'taskGroups',
  'learnings', 'watch', 'routine', 'routineLogs', 'timelog', 'screentime'];

const KEY = 'daybook.data.v1';
const TOMBSTONE_TTL = 120 * 86400000;

let db = emptyDb();
let clock = 0;
const listeners = new Set();

function emptyDb() {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, {}]));
}

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function load() {
  const ls = storage();
  if (!ls) return;
  try {
    const raw = ls.getItem(KEY);
    if (raw) db = { ...emptyDb(), ...JSON.parse(raw) };
  } catch (e) {
    console.error('Could not read saved data', e);
  }
}

function persist() {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.error('Could not save data', e);
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(source) {
  for (const fn of listeners) fn(source);
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Strictly increasing timestamps so two edits in the same millisecond still order.
function stamp() {
  clock = Math.max(Date.now(), clock + 1);
  return clock;
}

export function all(col) {
  return Object.values(db[col] || {}).filter((r) => !r.deleted);
}

export function get(col, id) {
  const r = db[col]?.[id];
  return r && !r.deleted ? r : null;
}

// `silent` saves (and syncs) without re-rendering the screen — used while typing
// into a live workout so inputs don't get rebuilt under your fingers.
export function put(col, rec, { silent = false } = {}) {
  const id = rec.id || uid();
  const prev = db[col][id];
  const base = prev && !prev.deleted ? prev : { createdAt: Date.now() };
  const next = { ...base, ...rec, id, updatedAt: stamp() };
  delete next.deleted;
  db[col][id] = next;
  persist();
  emit(silent ? 'silent' : 'local');
  return next;
}

export function remove(col, id) {
  const prev = db[col][id];
  if (!prev || prev.deleted) return null;
  db[col][id] = { id, deleted: true, updatedAt: stamp() };
  persist();
  emit('local');
  return prev;
}

// Put back a record exactly as it was (used by "Undo").
export function restore(col, rec) {
  return put(col, rec);
}

// Preferences are stored one record per key so each merges independently.
export function pref(key, fallback) {
  const r = get('prefs', key);
  return r ? r.value : fallback;
}

export function setPref(key, value) {
  put('prefs', { id: key, value });
}

export function snapshot() {
  return db;
}

// Merge a remote copy into ours. Returns whether local data changed and
// whether the remote is missing anything we have (i.e. needs a push).
export function merge(remote, { now = Date.now() } = {}) {
  let localChanged = false;
  let remoteStale = false;
  for (const col of COLLECTIONS) {
    const mine = db[col];
    const theirs = (remote && remote[col]) || {};
    for (const [id, r] of Object.entries(theirs)) {
      const m = mine[id];
      if (!m || r.updatedAt > m.updatedAt) {
        mine[id] = r;
        localChanged = true;
        clock = Math.max(clock, r.updatedAt || 0);
      } else if (m.updatedAt > r.updatedAt) {
        remoteStale = true;
      }
    }
    for (const id of Object.keys(mine)) {
      if (!(id in theirs)) remoteStale = true;
    }
    // Forget old tombstones.
    for (const [id, r] of Object.entries(mine)) {
      if (r.deleted && now - r.updatedAt > TOMBSTONE_TTL) {
        delete mine[id];
        if (id in theirs) remoteStale = true;
      }
    }
  }
  if (localChanged) {
    persist();
    emit('remote');
  }
  return { localChanged, remoteStale };
}

// Replace everything (used by tests and by "erase all data").
export function reset(data = emptyDb()) {
  db = { ...emptyDb(), ...data };
  persist();
  emit('local');
}
