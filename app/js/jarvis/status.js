// "Systems status": the numbers HUD mode shows, worked out from your data in one pass.
// No DOM here so it can be tested.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import * as X from '../gamify.js';
import * as R from '../views/routine.js';
import * as asks from './asks.js';
import * as agent from '../agent.js';

const mins = (hm) => { const [a, b] = String(hm || '0:0').split(':').map(Number); return a * 60 + (b || 0); };
const clamp = (x) => Math.max(0, Math.min(1, x));

export function status(now = new Date()) {
  const t = D.toStr(now);
  const minute = now.getHours() * 60 + now.getMinutes();

  const events = M.eventsOn(t);
  const timed = events.filter((e) => e.time).sort((a, b) => mins(a.time) - mins(b.time));
  const upcoming = timed.filter((e) => mins(e.endTime || e.time) >= minute);
  const next = upcoming.find((e) => mins(e.time) >= minute) || null;
  const current = timed.find((e) => mins(e.time) <= minute && e.endTime && mins(e.endTime) > minute) || null;

  const todos = M.todosOn(t);
  const habits = M.habits().filter((h) => M.scheduledOn(h, t));
  const habitsDone = habits.filter((h) => M.isDone(h.id, t)).length;
  const tasks = M.openTasks();
  const overdue = tasks.filter((x) => x.due && x.due < t).length;

  const monthStart = `${t.slice(0, 8)}01`;
  const spent = M.sum(M.expensesBetween(monthStart, t));
  const budget = Number(store.pref('budget', 0)) || 0;
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const pace = now.getDate() / dim;

  let xp = null;
  try {
    const s = X.summary();
    xp = { level: s.level.level, rank: s.level.rank, frac: clamp(s.level.frac), total: s.total, today: s.today, streak: s.streak };
  } catch { /* stats are optional */ }

  const rn = R.blocks().length ? R.nowAndNext(t, minute) : null;
  const tracking = R.running();
  const streaks = M.habits().map((h) => ({ name: h.name, emoji: h.emoji || '✅', n: M.streak(h, t) })).filter((x) => x.n > 1).sort((a, b) => b.n - a.n).slice(0, 3);

  return {
    date: t, minute,
    day: clamp((minute - 6 * 60) / (18 * 60)), // 6am → midnight
    events: { total: events.length, upcoming: upcoming.slice(0, 4), next, current },
    todos: { done: todos.filter((x) => x.done).length, total: todos.length, left: todos.filter((x) => !x.done).map((x) => x.title).slice(0, 4) },
    habits: { done: habitsDone, total: habits.length, left: habits.filter((h) => !M.isDone(h.id, t)).map((h) => h.name) },
    tasks: { open: tasks.length, overdue },
    money: { spent, budget, frac: budget ? spent / budget : 0, pace, over: budget > 0 && spent > budget, ahead: budget > 0 && spent / budget > pace + 0.1 },
    xp, streaks,
    routine: { now: rn?.now?.block || null, next: rn?.next?.block || null, tracking },
    waiting: { claude: asks.answered().length, agent: agent.pending().length },
  };
}
