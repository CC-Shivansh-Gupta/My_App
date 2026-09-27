// Jarvis speaks first. While the app is open, a watcher looks at your day about once a minute for
// things worth saying: a meeting about to start, a streak about to break, the budget slipping,
// a promise you made, Claude's answer arriving, rain on the way, you arriving somewhere you named.
// It says the most important one (never the same thing twice), as a banner or out loud.
// Coming back after a few hours, it gives you a "while you were away" briefing.
// No DOM here so it can be tested: the app shows what candidates() and welcomeBack() return.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import * as R from '../views/routine.js';
import * as asks from './asks.js';
import * as agent from '../agent.js';
import * as promises from './promises.js';
import { status } from './status.js';

const SEEN = 'daybook.proactive.seen';
const mins = (hm) => { const [a, b] = String(hm || '0:0').split(':').map(Number); return a * 60 + (b || 0); };

// Settings: mode 'off' | 'quiet' (banner) | 'voice' (banner + spoken).
export function mode() { return store.pref('proactive', 'quiet'); }

// env: { now, weather, place, arrived } → [{ key, priority, say, title, action?, go? }]
export function candidates({ now = new Date(), weather = null, arrived = null } = {}) {
  const t = D.toStr(now);
  const minute = now.getHours() * 60 + now.getMinutes();
  const st = status(now);
  const out = [];
  const name = store.pref('userName', '');

  // A meeting about to start.
  for (const e of M.eventsOn(t)) {
    if (!e.time) continue;
    const inMin = mins(e.time) - minute;
    if (inMin > 0 && inMin <= 10) {
      out.push({ key: `event:${e.id}:${t}`, priority: 90, say: `${e.title} starts in ${inMin} minute${inMin === 1 ? '' : 's'}.`, title: `📅 ${e.title} · ${D.fmtTime(e.time)}` });
    }
  }
  // A routine block starting.
  if (R.blocks().length) {
    const rn = R.nowAndNext(t, minute);
    const b = rn.now?.block;
    if (b && minute - mins(b.start) >= 0 && minute - mins(b.start) <= 2 && !rn.now.carry) {
      out.push({ key: `block:${b.id}:${t}`, priority: 50, say: `Time for ${b.title.toLowerCase()}.`, title: `🧭 ${b.title} until ${D.fmtTime(b.end)}`, action: { label: 'Track it', cmd: `track ${b.title}` } });
    }
  }
  // Tracking something for a long time.
  const tr = st.routine.tracking;
  if (tr && tr.date === t) {
    const h = Math.floor((minute - mins(tr.start)) / 60);
    if (h >= 2) out.push({ key: `track:${tr.id}:${h}`, priority: 45, say: `You’ve been on ${tr.title.toLowerCase()} for ${h} hours. Stretch your legs?`, title: `⏱️ ${tr.title} · ${h} h`, action: { label: 'Stop tracking', cmd: 'stop tracking' } });
  }
  // Streaks at risk late in the evening.
  if (minute >= 20 * 60 + 30) {
    const risky = M.habits().filter((x) => M.scheduledOn(x, t) && !M.isDone(x.id, t)).map((x) => ({ x, n: M.streak(x, D.addDays(t, -1)) })).filter((r) => r.n >= 3).sort((a, b) => b.n - a.n);
    if (risky.length) {
      const top = risky[0];
      out.push({ key: `streak:${t}`, priority: 60, say: `Your ${top.n}-day ${top.x.name.toLowerCase()} streak ends at midnight${risky.length > 1 ? `, and ${risky.length - 1} more` : ''}.`,
        title: `🔥 ${top.x.name} · ${top.n} days`, action: { label: 'Mark done', cmd: `mark ${top.x.name} done` } });
    }
  }
  // Money.
  if (st.money.over) out.push({ key: `budget-over:${t.slice(0, 7)}`, priority: 55, say: `We’re over budget for the month: ${Math.round(st.money.spent)} of ${st.money.budget}.`, title: '💸 Over budget', go: 'money' });
  else if (st.money.ahead && now.getDate() >= 5) out.push({ key: `budget-pace:${t.slice(0, 7)}:${Math.floor(now.getDate() / 7)}`, priority: 35, say: `Spending is running ahead of the budget: ${Math.round(st.money.frac * 100)}% gone, ${Math.round(st.money.pace * 100)}% of the month.`, title: '💸 Ahead of budget', go: 'money' });
  // Overdue tasks, in the morning.
  if (st.tasks.overdue && minute >= 6 * 60 && minute < 12 * 60) out.push({ key: `overdue:${t}`, priority: 40, say: `${st.tasks.overdue} task${st.tasks.overdue === 1 ? ' is' : 's are'} overdue.`, title: `⚠️ ${st.tasks.overdue} overdue`, go: 'tasks' });
  // Claude answered.
  for (const a of asks.answered()) out.push({ key: `claude:${a.id}`, priority: 70, say: `Claude answered “${a.text.slice(0, 80)}”.`, title: '✳️ Claude answered', go: 'jarvis' });
  // Promises.
  out.push(...promises.review(now));
  // Rain.
  if (weather?.rainNext && weather.rainNext.prob >= 60) {
    const at = mins(weather.rainNext.at);
    if (at - minute <= 120 && at - minute >= 0) out.push({ key: `rain:${t}:${weather.rainNext.at.slice(0, 2)}`, priority: 35, say: `Rain’s likely around ${D.fmtTime(weather.rainNext.at)}. Umbrella weather.`, title: `🌧️ ${weather.rainNext.prob}% rain at ${D.fmtTime(weather.rainNext.at)}` });
  }
  // Arriving somewhere you named.
  if (arrived) {
    const gym = /gym|fitness/i.test(arrived.name);
    const tpl = gym ? (store.all('templates')[0] || null) : null;
    out.push({ key: `place:${arrived.name}:${t}:${Math.floor(minute / 180)}`, priority: 65, say: gym && tpl ? `You’re at the ${arrived.name}. Shall I start ${tpl.name}?` : `You’re at ${arrived.name}.`,
      title: `📍 ${arrived.name}`, action: gym && tpl ? { label: `Start ${tpl.name}`, cmd: `start ${tpl.name} workout` } : null });
  }
  // Up far too late.
  if (minute >= 30 && minute < 4 * 60) out.push({ key: `late:${t}`, priority: 30, say: `It’s ${D.fmtTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)}${name ? `, ${name}` : ''}. May I suggest some sleep?`, title: '🌙 It’s late' });
  return out.sort((a, b) => b.priority - a.priority);
}

// ---- Not saying the same thing twice ----------------------------------------------------------------------
const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };
export function seen() { try { return JSON.parse(ls()?.getItem(SEEN)) || {}; } catch { return {}; } }
export function markSeen(key, now = Date.now()) {
  const s = seen();
  s[key] = now;
  for (const [k, at] of Object.entries(s)) if (now - at > 3 * 86400000) delete s[k]; // forget after 3 days
  try { ls()?.setItem(SEEN, JSON.stringify(s)); } catch { /* ignore */ }
}

// The one thing worth saying now (or null).
export function next(env = {}) {
  const s = seen();
  return candidates(env).find((c) => !s[c.key]) || null;
}

// ---- While you were away ------------------------------------------------------------------------------------
export function welcomeBack(since, { now = new Date(), weather = null } = {}) {
  const t = D.toStr(now);
  const hr = now.getHours();
  const name = store.pref('userName', '');
  const hello = `${hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'}${name ? `, ${name}` : ''}. Welcome back.`;
  const lines = [];
  const claude = asks.answered().filter((a) => (a.answeredAt || 0) > since).length;
  if (claude) lines.push(`Claude answered ${claude === 1 ? 'your request' : `${claude} requests`}.`);
  const sugg = agent.pending().length;
  if (sugg) lines.push(`${sugg} suggestion${sugg === 1 ? '' : 's'} from the agent ${sugg === 1 ? 'is' : 'are'} waiting.`);
  const added = store.all('events').filter((e) => (e.createdAt || 0) > since && e.date >= t).length;
  if (added) lines.push(`${added} new event${added === 1 ? '' : 's'} on your calendar.`);
  const st = status(now);
  if (st.events.next) lines.push(`Next up: ${st.events.next.title} at ${D.fmtTime(st.events.next.time)}.`);
  if (st.tasks.overdue) lines.push(`${st.tasks.overdue} task${st.tasks.overdue === 1 ? ' is' : 's are'} overdue.`);
  if (st.habits.total && st.habits.done < st.habits.total && hr >= 17) lines.push(`${st.habits.total - st.habits.done} habit${st.habits.total - st.habits.done === 1 ? '' : 's'} still to tick.`);
  if (weather) lines.push(`It’s ${weather.temp}° and ${weather.text}.`);
  if (lines.length < 2) return null;
  return { say: `${hello} ${lines.slice(0, 4).join(' ')}`, title: '👋 While you were away', lines };
}
