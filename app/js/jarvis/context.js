// What Jarvis knows about your day when it asks an AI: a compact, plain-text snapshot of
// your data (a few hundred tokens), plus notes and learnings that match what you said.
// Small on purpose: fewer tokens is faster on-device and cheaper (or free-tier friendly) in the cloud.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import * as X from '../gamify.js';
import * as V from '../vices.js';
import * as G from '../gym/model.js';
import * as R from '../views/routine.js';
import { overlap } from './memory.js';

const cut = (s, n = 60) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const list = (xs, n = 6) => xs.slice(0, n).join('; ') + (xs.length > n ? `; +${xs.length - n} more` : '');

export function snapshot(t = D.today(), now = new Date()) {
  const out = [];
  const tomorrow = D.addDays(t, 1);
  const cur = store.pref('currency', '₹');

  const ev = M.eventsOn(t).map((e) => `${M.eventTimeLabel(e)} ${cut(e.title, 40)}`);
  const evT = M.eventsOn(tomorrow).map((e) => `${M.eventTimeLabel(e)} ${cut(e.title, 40)}`);
  out.push(`Calendar today: ${ev.length ? list(ev) : 'nothing'}. Tomorrow: ${evT.length ? list(evT) : 'nothing'}.`);

  const todos = M.todosOn(t).filter((x) => !x.done).map((x) => cut(x.title, 40));
  const late = M.unfinishedBefore(t).map((x) => cut(x.title, 40));
  out.push(`To-dos today: ${todos.length ? list(todos, 8) : 'none'}${late.length ? `. Unfinished from earlier: ${list(late, 4)}` : ''}.`);

  const tasks = M.openTasks().sort(M.taskSort);
  if (tasks.length) {
    const over = tasks.filter((x) => x.due && x.due < t).map((x) => cut(x.title, 40));
    const top = tasks.slice(0, 6).map((x) => `${cut(x.title, 40)}${x.due ? ` (due ${x.due})` : ''}${x.priority === 3 ? ' !' : ''}`);
    out.push(`Open tasks (${tasks.length}): ${top.join('; ')}${over.length ? `. Overdue: ${list(over, 4)}` : ''}.`);
  }
  const heads = M.taskHeadings().map((x) => x.name);
  if (heads.length) out.push(`Task headings: ${heads.join(', ')}.`);

  const hb = M.habits().filter((x) => M.scheduledOn(x, t));
  if (hb.length) {
    out.push(`Habits today: ${hb.map((x) => `${x.name} ${M.isDone(x.id, t) ? 'done' : 'not done'}${M.streak(x, t) > 1 ? ` (${M.streak(x, t)}-day streak)` : ''}`).join('; ')}.`);
  }
  const vs = V.vices();
  if (vs.length) out.push(`Habits they are breaking: ${vs.map((v) => `${v.name} (${V.cleanStreak(v, t)} days clean)`).join('; ')}.`);

  const month = M.expensesBetween(t.slice(0, 8) + '01', t);
  const spentToday = M.sum(M.expensesBetween(t, t));
  const budget = Number(store.pref('budget', 0));
  const byCat = {};
  for (const e of month) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, v]) => `${c} ${cur}${Math.round(v)}`);
  out.push(`Money: spent ${cur}${Math.round(spentToday)} today, ${cur}${Math.round(M.sum(month))} this month${budget ? ` of a ${cur}${budget} budget` : ''}${top.length ? ` (${top.join(', ')})` : ''}.`);

  const goals = store.all('goals').filter((g) => g.status === 'active' && (g.horizon === 'life' || g.period === t.slice(0, 7) || g.period === t.slice(0, 4)));
  if (goals.length) out.push(`Active goals: ${list(goals.map((g) => `${cut(g.title, 40)} (${g.horizon}${g.mode === 'number' && g.target ? `, ${g.current || 0}/${g.target}` : ''})`), 5)}.`);

  const reading = store.all('reading').filter((r) => r.status === 'reading').map((r) => `${cut(r.title, 40)} ${r.progress || 0}%`);
  if (reading.length) out.push(`Reading now: ${list(reading, 3)}.`);
  const watch = store.all('watch').filter((w) => w.status !== 'done').map((w) => cut(w.title, 30));
  if (watch.length) out.push(`Watch list: ${list(watch, 4)}.`);

  const minute = now.getHours() * 60 + now.getMinutes();
  const rn = R.blocks().length ? R.nowAndNext(t, minute) : null;
  const tracking = R.running();
  if (rn?.now || rn?.next || tracking) {
    out.push(`Routine: ${rn?.now ? `now ${rn.now.block.title} until ${rn.now.block.end}` : 'free time now'}${rn?.next ? `, next ${rn.next.block.title} at ${rn.next.block.start}` : ''}${tracking ? `. Tracking ${tracking.title} since ${tracking.start}` : ''}.`);
  }
  const tpl = G.templates().map((x) => x.name);
  const w = G.activeWorkout();
  if (tpl.length || w) out.push(`Workouts: ${w ? `in progress (${w.name}). ` : ''}${tpl.length ? `templates ${list(tpl, 6)}` : ''}.`);

  try {
    const s = X.summary();
    out.push(`Level ${s.level.level} (${s.level.rank}), ${s.total} XP, ${s.streak}-day streak.`);
  } catch { /* stats are optional */ }
  return out.join('\n');
}

// Notes and learnings that share words with what was said (the AI can quote them).
export function related(text, n = 3) {
  const pool = [
    ...store.all('notes').map((x) => ({ kind: 'Note', text: x.text })),
    ...store.all('learnings').map((x) => ({ kind: 'Learning', text: [x.text, x.details].filter(Boolean).join(' — ') })),
  ];
  return pool.map((x) => ({ ...x, s: overlap(text, x.text) }))
    .filter((x) => x.s >= 0.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => `${x.kind}: ${cut(x.text, 220)}`);
}
