import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://me.github.io/My_App/#/friends' };
const store = await import('../app/js/store.js');
const D = await import('../app/js/dates.js');
const X = await import('../app/js/gamify.js');
const V = await import('../app/js/vices.js');
const S = await import('../app/js/social.js');

const t = D.today();
const ago = (n) => Date.parse(D.addDays(t, -n) + 'T09:00:00');

test('penalties: missed habits, overdue tasks, undone to-dos', () => {
  store.reset();
  store.put('habits', { name: 'Meditate', days: [0, 1, 2, 3, 4, 5, 6], createdAt: ago(3) });
  store.put('tasks', { title: 'Report', due: D.addDays(t, -2), done: false });
  store.put('todos', { title: 'Call', date: D.addDays(t, -1), done: false });
  const ev = X.events();
  const sum = (k) => ev.filter((e) => e.kind === k).reduce((a, e) => a + e.xp, 0);
  assert.equal(sum('habitMiss'), -9); // 3 past days missed
  assert.equal(sum('lateTask'), -5);
  assert.equal(sum('todoMiss'), -2);
  assert.equal(X.summary().total, 0); // never below zero
  store.setPref('penaltyLevel', 'off');
  assert.equal(X.events().filter((e) => e.xp < 0).length, 0);
  store.setPref('penaltyLevel', 'hardcore');
  assert.equal(X.events().filter((e) => e.kind === 'lateTask')[0].xp, -10);
});

test('habits to break: slips cost XP, clean days earn it back', () => {
  store.reset();
  const v = store.put('vices', { name: 'Smoking', penalty: 25, attr: 'str', createdAt: ago(5) });
  V.logSlip(v, D.addDays(t, -2));
  const ev = X.events();
  assert.equal(ev.filter((e) => e.kind === 'slip').reduce((a, e) => a + e.xp, 0), -25);
  assert.equal(ev.filter((e) => e.kind === 'clean').length, 4); // 5 tracked past days, 1 slip
  assert.equal(V.cleanStreak(v, t), 2);
  V.logSlip(v, t);
  assert.equal(V.cleanStreak(v, t), 0);
});

test('invite links round-trip and DB URLs are validated', () => {
  const g = { db: 'https://daybook-1-default-rtdb.firebaseio.com', gid: 'abcdefghij0123456789', name: 'Us two' };
  assert.deepEqual(S.parseInvite(S.inviteLink(g)), g);
  assert.equal(S.normalizeDb('daybook-1-default-rtdb.europe-west1.firebasedatabase.app/'), 'https://daybook-1-default-rtdb.europe-west1.firebasedatabase.app');
  assert.equal(S.normalizeDb('https://evil.example.com'), null);
  assert.equal(S.parseInvite('nonsense'), null);
});

test('leaderboard standings', () => {
  const d = t;
  const members = {
    a: { id: 'a', name: 'A', total: 500, streak: 3, daily: { [d]: { xp: 40, workouts: 1, screen: 300 } } },
    b: { id: 'b', name: 'B', total: 900, streak: 1, daily: { [d]: { xp: 90, workouts: 0, screen: 120 } } },
    c: { id: 'c', name: 'C', total: 100, streak: 9, daily: { [d]: { xp: 40 } } },
  };
  const xp = S.standings(members, 'xp', D.addDays(d, -6), d);
  assert.deepEqual(xp.map((r) => [r.member.id, r.rank]), [['b', 1], ['a', 2], ['c', 2]]);
  assert.equal(S.standings(members, 'screen', d, d)[0].member.id, 'b'); // lowest wins, C excluded
  assert.equal(S.standings(members, 'screen', d, d).length, 2);
  assert.equal(S.standings(members, 'level', d, d)[0].member.id, 'b');
});

test('profile summary never includes money', () => {
  store.reset();
  store.setPref('me', { id: 'me1', name: 'Me', emoji: '🙂' });
  store.put('expenses', { amount: 999, note: 'secret', category: 'Fun', date: t });
  const p = JSON.stringify(S.buildProfile());
  assert.ok(!p.includes('999') && !p.includes('secret'));
});
