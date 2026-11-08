import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../app/js/store.js';
import * as D from '../app/js/dates.js';
import * as V from '../app/js/vices.js';

const MON = '2026-09-07'; // a Monday; weeks start on Monday by default
const at = (date) => Date.parse(`${date}T09:00:00`);
const day = (n) => D.addDays(MON, n);

test('habits to break: fill in or clear any past day', () => {
  store.reset();
  const v = store.put('vices', { name: 'Doomscrolling', penalty: 10, createdAt: at(MON) });
  V.setSlips(v, day(3), 2);
  assert.equal(V.slipsOn(v.id, day(3)).length, 2);
  const gone = V.setSlips(v, day(3), 0);
  assert.equal(gone.length, 2);
  assert.equal(V.slipsOn(v.id, day(3)).length, 0);
  gone.forEach((r) => store.restore('slips', r)); // Undo
  assert.equal(V.slipsOn(v.id, day(3)).length, 2);
});

test('habits to break: a slip filled in before it was added moves the start back', () => {
  store.reset();
  const v = store.put('vices', { name: 'Snoozing', createdAt: at(MON) });
  assert.equal(V.startDate(v), MON);
  V.logSlip(v, day(-5));
  assert.equal(V.startDate(v), day(-5));
});

test('habits to break: clean runs, streaks, history and weekdays agree', () => {
  store.reset();
  const v = store.put('vices', { name: 'Junk food', createdAt: at(MON) });
  V.logSlip(v, day(4)); // Friday
  V.logSlip(v, day(11)); // next Friday
  V.logSlip(v, day(11));
  const t = day(20);
  assert.equal(V.cleanStreak(v, t), 9);
  assert.equal(V.bestClean(v, t), 9);
  const runs = V.cleanRuns(v, t);
  assert.deepEqual(runs.map((r) => r.n), [4, 6, 9]);
  assert.deepEqual([runs[0].from, runs[0].to], [MON, day(3)]);
  assert.deepEqual([runs[1].from, runs[1].to], [day(5), day(10)]);
  assert.equal(runs[2].to, t);
  assert.equal(V.cleanStreak(v, day(11)), 0); // slipped that day
  assert.deepEqual(V.slipHistory(v, 'week', 3, t).map((r) => r.value), [1, 2, 0]);
  assert.equal(V.weekdaySlips(v)[5], 3);
});

test('habits to break: added today with no slips is clean today, not "slipped"', () => {
  store.reset();
  const v = store.put('vices', { name: 'Sugar', createdAt: at(MON) });
  assert.equal(V.cleanStreak(v, MON), 1);
  assert.equal(V.cleanStreak(v, day(2)), 3);
});
