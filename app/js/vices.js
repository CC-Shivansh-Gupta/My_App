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

export function startDate(v) {
  return D.toStr(new Date(v.createdAt || Date.now()));
}

// Days since the last slip (or since you started tracking).
export function cleanStreak(v, today = D.today()) {
  const slips = slipsFor(v.id);
  const last = slips.length ? slips[slips.length - 1].date : null;
  return Math.max(0, D.diffDays(last || startDate(v), today));
}

export function bestClean(v, today = D.today()) {
  const dates = [startDate(v), ...slipsFor(v.id).map((s) => s.date), today];
  let best = 0;
  for (let i = 1; i < dates.length; i++) best = Math.max(best, D.diffDays(dates[i - 1], dates[i]));
  return best;
}
