// Friends: share progress, compete and swap recommendations with people you invite.
//
// Everyone's own data stays on their own device. To see each other, the app
// publishes a small *summary* (level, XP, streaks, counts — never money amounts
// or raw entries) plus anything you explicitly share, to a group in a free
// Firebase Realtime Database that the group creator sets up once. Friends join
// with an invite link — no accounts needed.
//
// Database layout:  groups/{gid}/info · members/{memberId} · feed/{postId} · challenges/{id}

import * as store from './store.js';
import * as D from './dates.js';
import * as X from './gamify.js';

const CACHE_KEY = 'daybook.social.cache.v1';
const SEEN_KEY = 'daybook.social.seen.v1';
const LAST_KEY = 'daybook.social.last.v1';

export const METRICS = {
  xp: { label: 'XP', emoji: '⭐', better: 'high', fmt: (v) => `${Math.round(v).toLocaleString()} XP` },
  workouts: { label: 'Workouts', emoji: '🏋️', better: 'high', fmt: (v) => `${v} workout${v === 1 ? '' : 's'}` },
  habits: { label: 'Habit ticks', emoji: '✅', better: 'high', fmt: (v) => `${v} ticks` },
  todos: { label: 'To-dos done', emoji: '☑️', better: 'high', fmt: (v) => `${v} done` },
  learnings: { label: 'Learnings', emoji: '💡', better: 'high', fmt: (v) => `${v} learned` },
  routine: { label: 'Routine blocks', emoji: '⏰', better: 'high', fmt: (v) => `${v} blocks` },
  screen: { label: 'Screen time', emoji: '📵', better: 'low', fmt: (v) => fmtMin(v) + '/day' },
};

const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);
const rid = (n = 20) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
// Time-ordered ids so the feed sorts by key.
export const postId = () => `${Date.now().toString(36).padStart(9, '0')}${rid(6)}`;

// ---- Identity & config (prefs sync across your own devices) -----------------------------------------------
export function me() {
  let m = store.pref('me', null);
  if (!m) { m = { id: rid(16), name: '', emoji: '🙂' }; store.setPref('me', m); }
  return m;
}

export function setMe(patch) {
  store.setPref('me', { ...me(), ...patch });
}

export function groups() {
  return store.pref('groups', []);
}

export function shareSettings() {
  return { habits: true, gym: true, reading: true, watch: true, learnings: true, screen: false, autoPost: true, ...store.pref('shareSettings', {}) };
}

// ---- Firebase Realtime Database over REST --------------------------------------------------------------------
export function normalizeDb(url) {
  let u = (url || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//.test(u)) u = `https://${u}`;
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)$/i.test(u)) return null;
  return u;
}

async function fb(db, path, { method = 'GET', body, query } = {}) {
  const res = await fetch(`${db}/${path}.json${query ? `?${query}` : ''}`, {
    method, cache: 'no-store',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    if (res.status === 401 || /permission/i.test(msg)) msg = 'Permission denied — check the database rules (see setup steps).';
    if (res.status === 404) msg = 'Database not found — check the URL.';
    throw new Error(msg);
  }
  return res.json();
}

// ---- Groups ----------------------------------------------------------------------------------------------------
export async function createGroup(dbUrl, name) {
  const db = normalizeDb(dbUrl);
  if (!db) throw new Error('That doesn’t look like a Firebase database URL (…firebaseio.com or …firebasedatabase.app).');
  const gid = rid(20);
  await fb(db, `groups/${gid}/info`, { method: 'PUT', body: { name: name || 'Friends', createdAt: Date.now(), createdBy: me().id } });
  return joinGroup({ db, gid, name: name || 'Friends' });
}

export async function joinGroup({ db, gid, name }) {
  const info = await fb(db, `groups/${gid}/info`);
  if (!info) throw new Error('This invite link is no longer valid.');
  const g = { db, gid, name: info.name || name || 'Friends' };
  store.setPref('groups', [...groups().filter((x) => x.gid !== gid), g]);
  await publish(true);
  await refresh(g);
  return g;
}

export async function leaveGroup(g) {
  try { await fb(g.db, `groups/${g.gid}/members/${me().id}`, { method: 'DELETE' }); } catch { /* offline is fine */ }
  store.setPref('groups', groups().filter((x) => x.gid !== g.gid));
  const c = cache(); delete c[g.gid]; saveCache(c);
}

export function inviteLink(g) {
  const base = location.href.split('#')[0];
  return `${base}#/friends?join=${encodeURIComponent(JSON.stringify({ db: g.db, gid: g.gid, name: g.name }))}`;
}

export function parseInvite(text) {
  try {
    const m = String(text).match(/join=([^&\s]+)/);
    const obj = JSON.parse(decodeURIComponent(m ? m[1] : text));
    const db = normalizeDb(obj.db);
    if (db && /^[a-z0-9]{10,}$/.test(obj.gid)) return { db, gid: obj.gid, name: obj.name || 'Friends' };
  } catch { /* fall through */ }
  return null;
}

// ---- Your published summary ------------------------------------------------------------------------------------
export function buildProfile() {
  const s = X.summary();
  const share = shareSettings();
  const m = me();
  const t = D.today();
  const days = Array.from({ length: 35 }, (_, i) => D.addDays(t, i - 34));
  const habitsById = Object.fromEntries(store.all('habits').filter((x) => !x.archived).map((x) => [x.id, x]));
  const daily = {};
  for (const d of days) {
    const row = { xp: s.byDay[d] || 0, gain: s.gains[d] || 0 };
    if (share.habits) row.habits = store.all('habitLogs').filter((l) => l.date === d && l.done && habitsById[l.habit]).length;
    if (share.gym) row.workouts = store.all('workouts').filter((w) => w.endedAt && w.date === d).length;
    if (share.learnings) row.learnings = store.all('learnings').filter((l) => D.toStr(new Date(l.createdAt)) === d).length;
    row.todos = store.all('todos').filter((x) => x.done && (x.doneAt ? D.toStr(new Date(x.doneAt)) : x.date) === d).length;
    row.routine = store.all('routineLogs').filter((l) => l.done && l.date === d).length;
    if (share.screen) {
      const e = store.all('screentime').filter((x) => x.date === d);
      if (e.length) row.screen = e.reduce((a, b) => a + b.minutes, 0);
    }
    if (Object.values(row).some(Boolean)) daily[d] = row;
  }
  const scheduled = Object.values(habitsById).filter((hb) => !hb.days?.length || hb.days.includes(D.weekday(t)));
  const unlocked = X.achievements(s).filter((a) => a.done);
  const profile = {
    id: m.id, name: m.name || 'Friend', emoji: m.emoji || '🙂', updatedAt: Date.now(),
    level: s.level.level, rank: s.level.rank, total: s.total, frac: Math.round(s.level.frac * 100) / 100,
    streak: s.streak, bestStreak: s.bestStreak, weekGain: s.weekGain, weekLoss: s.weekLoss,
    attrs: s.attrs, badges: unlocked.map((a) => a.id), daily,
    today: { habitsDone: share.habits ? scheduled.filter((hb) => store.get('habitLogs', `${hb.id}|${t}`)?.done).length : null, habitsTotal: share.habits ? scheduled.length : null,
      quests: X.quests().filter((q) => q.done).length },
  };
  if (share.reading) profile.reading = store.all('reading').filter((r) => r.status === 'reading').slice(0, 3).map((r) => r.title);
  if (share.watch) profile.watching = store.all('watch').filter((w) => w.status === 'watching').slice(0, 3).map((w) => w.title);
  return profile;
}

let lastPublished = '';
export async function publish(force = false) {
  const gs = groups();
  if (!gs.length || !me().name) return;
  const p = buildProfile();
  const key = JSON.stringify({ ...p, updatedAt: 0 });
  if (!force && key === lastPublished) return;
  await Promise.all(gs.map((g) => fb(g.db, `groups/${g.gid}/members/${p.id}`, { method: 'PUT', body: p }).catch(() => null)));
  lastPublished = key;
  await autoPosts(p).catch(() => {});
}

// ---- Reading the group -------------------------------------------------------------------------------------------
function cache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}
function saveCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export function groupData(gid) {
  return cache()[gid] || null;
}

export async function refresh(g) {
  const [members, feed, challenges] = await Promise.all([
    fb(g.db, `groups/${g.gid}/members`),
    fb(g.db, `groups/${g.gid}/feed`, { query: 'orderBy=%22%24key%22&limitToLast=100' }),
    fb(g.db, `groups/${g.gid}/challenges`),
  ]);
  const data = { members: members || {}, feed: feed || {}, challenges: challenges || {}, fetchedAt: Date.now() };
  const c = cache(); c[g.gid] = data; saveCache(c);
  return data;
}

export async function refreshAll() {
  const out = await Promise.allSettled(groups().map((g) => refresh(g)));
  return out.some((r) => r.status === 'fulfilled');
}

export function unseenCount() {
  let seen = 0;
  try { seen = Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { /* ignore */ }
  const myId = store.pref('me', {})?.id;
  let n = 0;
  for (const g of groups()) {
    const d = groupData(g.gid);
    if (!d) continue;
    for (const p of Object.values(d.feed || {})) if (p.by !== myId && p.ts > seen) n++;
  }
  return n;
}

export function markSeen() {
  try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* ignore */ }
}

// ---- Posting ---------------------------------------------------------------------------------------------------------
export async function post(g, item) {
  const m = me();
  const id = postId();
  const body = { ...item, by: m.id, name: m.name || 'Friend', emoji: m.emoji || '🙂', ts: Date.now() };
  await fb(g.db, `groups/${g.gid}/feed/${id}`, { method: 'PUT', body });
  const c = cache(); if (c[g.gid]) { c[g.gid].feed = { ...(c[g.gid].feed || {}), [id]: body }; saveCache(c); }
  return id;
}

export async function postToAll(item) {
  await Promise.all(groups().map((g) => post(g, item).catch(() => null)));
}

export async function react(g, postKey, emoji) {
  const path = `groups/${g.gid}/feed/${postKey}/reactions/${me().id}`;
  const cur = groupData(g.gid)?.feed?.[postKey]?.reactions?.[me().id];
  if (cur === emoji) await fb(g.db, path, { method: 'DELETE' });
  else await fb(g.db, path, { method: 'PUT', body: emoji });
}

export async function deletePost(g, postKey) {
  await fb(g.db, `groups/${g.gid}/feed/${postKey}`, { method: 'DELETE' });
  const c = cache(); if (c[g.gid]?.feed) { delete c[g.gid].feed[postKey]; saveCache(c); }
}

export async function saveChallenge(g, ch) {
  const id = ch.id || postId();
  await fb(g.db, `groups/${g.gid}/challenges/${id}`, { method: 'PUT', body: { ...ch, id } });
  return id;
}

export async function deleteChallenge(g, id) {
  await fb(g.db, `groups/${g.gid}/challenges/${id}`, { method: 'DELETE' });
}

// Milestones are shared automatically (level ups, badges, workouts, finished books, achieved goals).
async function autoPosts(p) {
  if (!shareSettings().autoPost) return;
  let last = null;
  try { last = JSON.parse(localStorage.getItem(LAST_KEY)); } catch { /* ignore */ }
  const books = store.all('reading').filter((r) => r.status === 'done').map((r) => r.id);
  const goalsDone = store.all('goals').filter((g) => g.status === 'done').map((g) => g.id);
  const workouts = store.all('workouts').filter((w) => w.endedAt).map((w) => w.id);
  const now = { level: p.level, badges: p.badges, books, goals: goalsDone, workouts };
  try { localStorage.setItem(LAST_KEY, JSON.stringify(now)); } catch { /* ignore */ }
  if (!last) return; // first run: set a baseline, don't spam the feed with history
  const posts = [];
  if (p.level > last.level) posts.push({ type: 'levelup', title: `Reached level ${p.level}`, body: p.rank });
  const badgeDefs = Object.fromEntries(X.achievements().map((a) => [a.id, a]));
  for (const b of p.badges) if (!last.badges.includes(b) && badgeDefs[b]) posts.push({ type: 'badge', title: `${badgeDefs[b].emoji} ${badgeDefs[b].name}`, body: badgeDefs[b].desc });
  if (shareSettings().reading) for (const id of books) if (!last.books.includes(id)) { const r = store.get('reading', id); if (r) posts.push({ type: 'book', title: r.title, author: r.author, url: r.url, kind: r.type, body: `Finished it${r.rating ? ` · ${'★'.repeat(r.rating)}` : ''}` }); }
  for (const id of goalsDone) if (!last.goals.includes(id)) { const g = store.get('goals', id); if (g) posts.push({ type: 'goalDone', title: g.title, body: g.horizon === 'life' ? 'Life goal achieved!' : g.horizon === 'year' ? 'Yearly goal achieved' : 'Monthly goal achieved' }); }
  if (shareSettings().gym) for (const id of workouts) if (!last.workouts.includes(id)) { const w = store.get('workouts', id); if (w) posts.push({ type: 'workout', title: w.name, body: `${Math.round((w.endedAt - w.startedAt) / 60000)} min · ${w.exercises.reduce((n, e) => n + e.sets.length, 0)} sets` }); }
  for (const item of posts.slice(0, 5)) await postToAll(item);
}

// ---- Leaderboards (pure) -------------------------------------------------------------------------------------------
export function metricValue(member, metric, from, to) {
  if (metric === 'level') return member.total || 0;
  if (metric === 'streak') return member.streak || 0;
  const rows = Object.entries(member.daily || {}).filter(([d]) => d >= from && d <= to).map(([, r]) => r);
  if (metric === 'screen') {
    const vals = rows.map((r) => r.screen).filter((v) => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return rows.reduce((a, r) => a + (Number(r[metric]) || 0), 0);
}

export function standings(members, metric, from, to) {
  const better = METRICS[metric]?.better || 'high';
  const rows = Object.values(members || {}).map((m) => ({ member: m, value: metricValue(m, metric, from, to) }))
    .filter((r) => r.value !== null);
  rows.sort((a, b) => (better === 'low' ? a.value - b.value : b.value - a.value));
  let rank = 0; let prev = null;
  return rows.map((r, i) => { if (r.value !== prev) rank = i + 1; prev = r.value; return { ...r, rank }; });
}
