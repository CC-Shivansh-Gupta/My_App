// Habits to break ("vices"): things you want to do less of. Logging a slip costs
// XP; every clean day earns a little. Slips are stored one record per event.

import * as store from './store.js';
import * as D from './dates.js';

export const PENALTIES = [[5, 'Small'], [10, 'Medium'], [25, 'Big'], [50, 'Serious']];
export const SUGGESTIONS = [['🚬', 'Smoking', 25, 'str'], ['🍔', 'Junk food', 10, 'str'], ['📱', 'Doomscrolling', 10, 'dis'],
  ['🍺', 'Drinking too much', 25, 'str'], ['⏰', 'Snoozing the alarm', 5, 'dis'], ['💸', 'Impulse buying', 25, 'wlt'],
  ['🍬', 'Sugar binge', 10, 'str'], ['😡', 'Losing my temper', 10, 'wis'], ['🎮', 'Gaming binge', 10, 'dis'], ['🌙', 'Sleeping after 1am', 10, 'str']];

export function vices() {
  return store.all('vices').filter((v) => !v.archived).sort((a, b) => a.createdAt - b.createdAt);
}

export function slipsFor(viceId) {
  return store.all('slips').filter((s) => s.vice === viceId).sort((a, b) => a.date.localeCompare(b.date));
}

export function logSlip(v, date = D.today(), note = '') {
  return store.put('slips', { vice: v.id, date, note, ts: Date.now() });
}

// First day it's tracked from: when you added it, or an earlier slip you filled in.
export function startDate(v) {
  const added = D.toStr(new Date(v.createdAt || Date.now()));
  const first = slipsFor(v.id)[0]?.date;
  return first && first < added ? first : added;
}

export function slipsOn(viceId, date) {
  return slipsFor(viceId).filter((s) => s.date === date);
}

// Make a day hold exactly n slips (filling in or clearing past days). Returns the removed records, for Undo.
export function setSlips(v, date, n) {
  const have = slipsOn(v.id, date);
  for (let i = have.length; i < n; i++) logSlip(v, date);
  const gone = have.slice(n);
  for (const s of gone) store.remove('slips', s.id);
  return gone;
}

// Days in a row without a slip, up to and including today (0 if you slipped today).
export function cleanStreak(v, today = D.today()) {
  const last = cleanRuns(v, today).at(-1);
  return last && last.to === today ? last.n : 0;
}

export function bestClean(v, today = D.today()) {
  return Math.max(0, ...cleanRuns(v, today).map((r) => r.n));
}

// Runs of days without a slip, oldest first: [{from, to, n}]. A run still going ends today.
export function cleanRuns(v, today = D.today()) {
  const runs = [];
  const add = (from, to) => { if (from <= to) runs.push({ from, to, n: D.diffDays(from, to) + 1 }); };
  let from = startDate(v);
  for (const d of new Set(slipsFor(v.id).map((s) => s.date).filter((x) => x <= today))) {
    add(from, D.addDays(d, -1));
    from = D.addDays(d, 1);
  }
  add(from, today);
  return runs;
}

// Slips per week or month, the last n of them ending with the one holding `end`.
export function slipHistory(v, unit = 'week', n = 12, end = D.today()) {
  const slips = slipsFor(v.id);
  const week = D.addDays(end, -((D.weekday(end) - store.pref('weekStart', 1) + 7) % 7));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const from = unit === 'month' ? D.addMonths(`${end.slice(0, 7)}-01`, -i) : D.addDays(week, -7 * i);
    const next = unit === 'month' ? D.addMonths(from, 1) : D.addDays(from, 7);
    out.push({ from, to: D.addDays(next, -1), value: slips.filter((s) => s.date >= from && s.date < next).length });
  }
  return out;
}

// Slips by weekday (0 = Sunday).
export function weekdaySlips(v) {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (const s of slipsFor(v.id)) out[D.weekday(s.date)]++;
  return out;
}
