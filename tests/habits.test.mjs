import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../app/js/store.js';
import * as D from '../app/js/dates.js';
import * as M from '../app/js/models.js';
import * as X from '../app/js/gamify.js';
import { readName, describe } from '../app/js/views/habit-form.js';

const MON = '2026-09-07'; // a Monday; weeks start on Monday by default
const at = (date) => Date.parse(`${date}T09:00:00`);
const day = (n) => D.addDays(MON, n);

test('count habits: partial amounts, done at the target', () => {
  store.reset();
  const hb = M.addHabit({ name: 'Drink water', kind: 'count', target: 8, unit: 'glasses', createdAt: at(MON) });
  M.setValue(hb, MON, 3);
  assert.equal(M.isDone(hb.id, MON), false);
  assert.equal(M.valueOn(hb, MON), 3);
  M.setValue(hb, MON, 8);
  assert.equal(M.isDone(hb.id, MON), true);
  M.setDone(hb.id, day(1), true); // "I drank my water" by voice fills the target
  assert.equal(M.valueOn(hb, day(1)), 8);
  M.setDone(hb.id, day(1), false);
  assert.equal(M.valueOn(hb, day(1)), 0);
  assert.deepEqual(M.habitTotals(hb), { days: 1, amount: 8 });
});

test('older habits without the new fields still read as daily yes/no habits', () => {
  store.reset();
  const hb = store.put('habits', { name: 'Meditate', emoji: '🧘', days: [1, 3, 5], createdAt: at(MON) });
  assert.equal(M.isCount(hb), false);
  assert.equal(M.isWeekly(hb), false);
  assert.equal(M.scheduledOn(hb, MON), true);
  assert.equal(M.scheduledOn(hb, day(1)), false);
  M.setDone(hb.id, MON, true);
  M.setDone(hb.id, day(2), true);
  assert.equal(M.streak(hb, day(3)), 2); // Tuesday and Thursday are rest days
});

test('a skipped day neither counts nor breaks the streak', () => {
  store.reset();
  const hb = M.addHabit({ name: 'Run', createdAt: at(MON) });
  M.setDone(hb.id, MON, true);
  M.setSkip(hb.id, day(1), true);
  M.setDone(hb.id, day(2), true);
  assert.equal(M.isSkipped(hb.id, day(1)), true);
  assert.equal(M.scheduledOn(hb, day(1)), false);
  assert.equal(M.streak(hb, day(2)), 2);
  assert.equal(M.completionRate(hb, 3, day(2)), 1);
  M.setDone(hb.id, day(1), true); // ticking a skipped day un-skips it
  assert.equal(M.isSkipped(hb.id, day(1)), false);
  assert.equal(M.streak(hb, day(2)), 3);
});

test('notes stay with the day', () => {
  store.reset();
  const hb = M.addHabit({ name: 'Journal', createdAt: at(MON) });
  M.setNote(hb.id, MON, 'Wrote about the trip');
  M.setDone(hb.id, MON, true);
  assert.equal(M.habitLog(hb.id, MON).note, 'Wrote about the trip');
  assert.deepEqual(M.habitNotes(hb).map((l) => l.date), [MON]);
});

test('weekly habits: due until the week’s quota is met, streaks in weeks', () => {
  store.reset();
  const hb = M.addHabit({ name: 'Gym', freq: 'week', perWeek: 3, createdAt: at(MON) });
  for (const n of [0, 2, 4]) M.setDone(hb.id, day(n), true); // Mon, Wed, Fri
  assert.equal(M.scheduledOn(hb, day(3)), true); // 2 of 3 so far
  assert.equal(M.scheduledOn(hb, day(4)), true); // done that day
  assert.equal(M.scheduledOn(hb, day(5)), false); // quota met
  assert.equal(M.weekCount(hb, day(6)), 3);
  for (const n of [7, 8, 9]) M.setDone(hb.id, day(n), true);
  M.setDone(hb.id, day(14), true); // third week: only 1 of 3
  assert.equal(M.streak(hb, day(15)), 2); // this week isn't over, so it doesn't break the run
  assert.equal(M.streak(hb, day(22)), 0); // ...until it ends short
  assert.equal(M.bestStreak(hb, day(22)), 2);
  assert.equal(M.completionRate(hb, 21, day(20)), 1); // the third week is still open on its last day
  assert.equal(M.completionRate(hb, 21, day(21)), 7 / 9);
});

test('the week a weekly habit starts asks only for the days left', () => {
  store.reset();
  const hb = M.addHabit({ name: 'Call family', freq: 'week', perWeek: 3, createdAt: at(day(5)) }); // a Saturday
  assert.equal(M.weekQuota(hb, day(5)), 2);
  M.setDone(hb.id, day(5), true);
  M.setDone(hb.id, day(6), true);
  assert.equal(M.streak(hb, day(6)), 1);
});

test('strength rises with every tick and only dips for a miss', () => {
  store.reset();
  const hb = M.addHabit({ name: 'Read', createdAt: at(MON) });
  for (let i = 0; i < 40; i++) if (i !== 30) M.setDone(hb.id, day(i), true);
  const s = M.strengthSeries(hb, day(39));
  assert.equal(s.length, 40);
  assert.ok(s[29].score > s[10].score);
  assert.ok(s[30].score < s[29].score); // the missed day
  assert.ok(s[30].score > s[29].score * 0.9); // ...is only a dent
  assert.ok(M.strength(hb, day(39)) > 0.8);
  // Today doesn't count against you before it's over.
  assert.equal(M.strength(hb, day(40)), M.strength(hb, day(39)));
});

test('count habits get partial credit toward strength', () => {
  store.reset();
  const full = M.addHabit({ name: 'Water', kind: 'count', target: 8, createdAt: at(MON) });
  const half = M.addHabit({ name: 'Water 2', kind: 'count', target: 8, createdAt: at(MON) });
  for (let i = 0; i < 10; i++) { M.setValue(full, day(i), 8); M.setValue(half, day(i), 4); }
  const a = M.strength(full, day(10)); // day 10 is "today": not counted yet for either
  const b = M.strength(half, day(10));
  assert.ok(b > 0 && Math.abs(b - a / 2) < 0.001);
});

test('streak runs and history', () => {
  store.reset();
  const hb = M.addHabit({ name: 'Pages', kind: 'count', target: 10, unit: 'pages', createdAt: at(MON) });
  for (const n of [0, 1, 2, 5, 6, 7, 8]) M.setValue(hb, day(n), 10);
  M.setValue(hb, day(9), 4);
  const runs = M.streakRuns(hb, day(10));
  assert.deepEqual(runs.map((r) => [r.from, r.n]), [[MON, 3], [day(5), 4]]);
  const weeks = M.habitHistory(hb, 'week', 2, day(10));
  assert.deepEqual(weeks.map((w) => [w.from, w.value]), [[MON, 50], [day(7), 24]]);
  const wd = M.weekdayStats(hb, day(10));
  assert.deepEqual(wd[1], { day: 1, planned: 2, done: 2 }); // Mondays
  assert.deepEqual(wd[3], { day: 3, planned: 2, done: 1 }); // Wednesdays
});

test('XP: weekly habits are judged when the week ends; skipped days aren’t penalised', () => {
  store.reset();
  const t = D.today();
  const lastWeek = D.addDays(M.weekOf(t), -7);
  const hb = M.addHabit({ name: 'Swim', freq: 'week', perWeek: 3, createdAt: at(D.addDays(lastWeek, -7)) });
  M.setDone(hb.id, D.addDays(lastWeek, -7), true);
  M.setDone(hb.id, D.addDays(lastWeek, -6), true);
  M.setDone(hb.id, D.addDays(lastWeek, -5), true); // the week before: all 3
  M.setDone(hb.id, lastWeek, true); // last week: 1 of 3
  const miss = X.events().filter((e) => e.kind === 'habitMiss');
  assert.deepEqual(miss.map((e) => [e.date, e.xp]), [[D.addDays(lastWeek, 6), -6]]);

  store.reset();
  const daily = M.addHabit({ name: 'Floss', createdAt: at(D.addDays(t, -2)) });
  M.setSkip(daily.id, D.addDays(t, -2), true);
  assert.equal(X.events().filter((e) => e.kind === 'habitMiss').length, 1); // yesterday only
});

test('typing a habit in plain words fills in the form', () => {
  assert.deepEqual(readName('read 20 pages on weekdays'), { freq: 'days', days: [1, 2, 3, 4, 5], name: 'Read 20 pages', kind: 'count', target: 20, unit: 'pages' });
  assert.deepEqual(readName('gym 3 times a week'), { freq: 'week', perWeek: 3, name: 'Gym' });
  assert.deepEqual(readName('call mom twice a week'), { freq: 'week', perWeek: 2, name: 'Call mom' });
  assert.equal(readName('meditate 10 minutes every morning').unit, 'min');
  assert.deepEqual(readName('Floss'), { name: 'Floss' });
  assert.equal(describe({ kind: 'count', target: 8, unit: 'glasses', days: [0, 1, 2, 3, 4, 5, 6], when: 'morning' }), '8 glasses · Every day · Mornings');
  assert.equal(describe({ freq: 'week', perWeek: 3 }), '3× a week');
});
