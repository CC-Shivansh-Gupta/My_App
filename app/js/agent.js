// The Daybook agent: a small team of scheduled jobs (agent/run.mjs, run by
// GitHub Actions in the private second-brain repo) that read your synced data,
// write briefs, and suggest changes. Suggestions wait in the inbox until you
// approve them, unless you've told it to just do that kind of thing (see
// `autonomy`). No DOM code here: the app and the Node job share this file.
//
// Jobs: morning brief (every morning), evening check-in (every evening, only
// notifies when something is missing), weekly review (Sunday evening).

import * as store from './store.js';
import * as D from './dates.js';
import * as M from './models.js';
import { events as xpEvents } from './gamify.js';
import { progress as goalProgress } from './views/goals.js';

// The only things the agent can ever change. Anything else in a suggestion is ignored.
export const ACTIONS = {
  planTask: { label: 'Plan tasks for a day (overdue, or next week’s priorities)', emoji: '📋' },
  moveTodos: { label: 'Move unfinished to-dos to another day', emoji: '☑️' },
  addTodo: { label: 'Add a to-do for a goal running out of time', emoji: '🎯' },
  addTask: { label: 'Add tasks (from your notes or the weekly review)', emoji: '📝' },
};

export const JOBS = {
  'morning-brief': { title: 'Morning brief', emoji: '☀️' },
  'evening-checkin': { title: 'Evening check-in', emoji: '🌙' },
  'weekly-review': { title: 'Weekly review', emoji: '🗓' },
};

const KEEP_DAYS = 30;

// ---- Autonomy: "ask" (default) waits for you, "act" lets the agent do it and log it --------------
export function autonomy(type) {
  return store.pref('agentAutonomy', {})[type] === 'act' ? 'act' : 'ask';
}

export function setAutonomy(type, level) {
  store.setPref('agentAutonomy', { ...store.pref('agentAutonomy', {}), [type]: level });
}

// ---- AI switches (off until you turn them on; the agent also needs an AI key) ------------------
export function aiSettings() {
  const s = store.pref('agentAI', {});
  return { summary: Boolean(s.summary), notes: Boolean(s.notes) };
}

export function setAI(key, on) {
  store.setPref('agentAI', { ...store.pref('agentAI', {}), [key]: on });
}

// ---- Inbox and log -------------------------------------------------------------------------------
export function pending() {
  return store.all('agentInbox').filter((s) => s.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
}

export function decided(limit = 10) {
  return store.all('agentInbox').filter((s) => s.decidedAt).sort((a, b) => b.decidedAt - a.decidedAt).slice(0, limit);
}

export function runs(limit = 20) {
  return store.all('agentLog').sort((a, b) => b.at - a.at).slice(0, limit);
}

export function latestRun(job, since = '') {
  return runs(100).find((r) => (r.job || 'morning-brief') === job && r.date >= since) || null;
}

export function latestBrief(date = D.today()) {
  const r = latestRun('morning-brief', date);
  return r && r.date === date && r.brief ? r : null;
}

// Carry out one action. Returns what was done, or null if there was nothing to do.
export function apply(action) {
  if (!action || !ACTIONS[action.type]) return null;
  if (action.type !== 'addTask' && !/^\d{4}-\d{2}-\d{2}$/.test(action.date || '')) return null;
  if (action.type === 'planTask') {
    const t = store.get('tasks', action.taskId);
    if (!t || t.done || t.planned === action.date) return null;
    store.put('tasks', { ...t, planned: action.date });
    return `Planned “${t.title}” for ${D.fmtDate(action.date)}`;
  }
  if (action.type === 'moveTodos') {
    const list = (action.ids || []).map((id) => store.get('todos', id)).filter((t) => t && !t.done && t.date < action.date);
    for (const t of list) store.put('todos', { ...t, date: action.date });
    return list.length ? `Moved ${list.length} ${list.length === 1 ? 'to-do' : 'to-dos'} to ${D.fmtDate(action.date)}` : null;
  }
  if (action.type === 'addTodo') {
    const title = cleanTitle(action.title);
    if (!title || M.todosOn(action.date).some((t) => t.title === title)) return null;
    M.addTodo(title, action.date);
    return `Added to-do “${title}”`;
  }
  if (action.type === 'addTask') {
    const title = cleanTitle(action.title);
    const due = /^\d{4}-\d{2}-\d{2}$/.test(action.due || '') ? action.due : null;
    if (!title || M.openTasks().some((t) => t.title.toLowerCase() === title.toLowerCase())) return null;
    M.addTask({ title, date: due });
    return `Added task “${title}”${due ? ` (due ${D.fmtDate(due)})` : ''}`;
  }
  return null;
}

function cleanTitle(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function approve(s) {
  const did = apply(s.action);
  store.put('agentInbox', { ...s, status: 'approved', decidedAt: Date.now(), result: did });
  return did;
}

export function dismiss(s) {
  store.put('agentInbox', { ...s, status: 'dismissed', decidedAt: Date.now() });
}

// ---- Helpers -------------------------------------------------------------------------------------
function daysInMonth(date) {
  const d = D.parse(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function nextWeekday(date, wd) {
  let d = D.addDays(date, 1);
  while (D.weekday(d) !== wd) d = D.addDays(d, 1);
  return d;
}

function hm(min) {
  return min >= 60 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m` : `${Math.round(min)}m`;
}

const dayOf = (ts) => (ts ? D.toStr(new Date(ts)) : null);
const recent = (col, date, days) => store.all(col).some((r) => r.date >= D.addDays(date, -days) && r.date < date);

// ---- Morning brief -------------------------------------------------------------------------------
// What the brief says and what it suggests, without changing anything.
export function morningBrief(date = D.today()) {
  const lines = [];
  const counts = [];
  const suggestions = [];

  const events = M.eventsOn(date);
  if (events.length) {
    lines.push(`📅 ${plural(events.length, 'event')}: ${events.slice(0, 3).map((e) => `${M.eventTimeLabel(e)} ${e.title}`).join(', ')}${events.length > 3 ? '…' : ''}`);
    counts.push(plural(events.length, 'event'));
  }

  const todos = M.todosOn(date).filter((t) => !t.done);
  const carry = M.unfinishedBefore(date);
  if (todos.length || carry.length) {
    lines.push(`☑️ ${plural(todos.length, 'to-do')} for today${carry.length ? `, ${carry.length} unfinished from earlier` : ''}`);
    counts.push(plural(todos.length + carry.length, 'to-do'));
  }
  if (carry.length) {
    suggestions.push({
      id: `${date}:move`, title: `Move ${plural(carry.length, 'unfinished to-do')} to today`,
      why: `Oldest is from ${D.fmtDate(carry[0].date)}`,
      action: { type: 'moveTodos', ids: carry.map((t) => t.id), date },
    });
  }

  const overdue = M.tasksForDay(date).filter((t) => t.due && t.due < date);
  if (overdue.length) {
    lines.push(`⏰ ${plural(overdue.length, 'overdue task')}: ${overdue.slice(0, 3).map((t) => t.title).join(', ')}${overdue.length > 3 ? '…' : ''}`);
    counts.push(`${overdue.length} overdue`);
    for (const t of overdue.filter((x) => x.planned !== date).slice(0, 3)) {
      suggestions.push({
        id: `${date}:plan:${t.id}`, title: `Plan “${t.title}” for today`,
        why: `Overdue since ${D.fmtDate(t.due)}`,
        action: { type: 'planTask', taskId: t.id, date },
      });
    }
  }

  const habitsLeft = M.habits().filter((hb) => M.scheduledOn(hb, date) && !M.isDone(hb.id, date));
  const atRisk = habitsLeft.map((hb) => [hb, M.streak(hb, date)]).filter(([, n]) => n >= 3);
  if (habitsLeft.length) {
    lines.push(`✅ ${plural(habitsLeft.length, 'habit')} to tick${atRisk.length ? ` — keep your streaks: ${atRisk.map(([hb, n]) => `${hb.emoji || ''}${hb.name} 🔥${n}`).join(', ')}` : ''}`);
    if (atRisk.length) counts.push(`🔥 ${plural(atRisk.length, 'streak')} at risk`);
  }

  const due = store.all('learnings').filter((l) => !l.noReview && (l.due || '') <= date).length;
  if (due) lines.push(`🔁 ${plural(due, 'learning')} due for review`);

  const budget = Number(store.pref('budget', 0)) || 0;
  const dayOfMonth = Number(date.slice(8));
  if (budget && dayOfMonth > 1) {
    const monthStart = date.slice(0, 8) + '01';
    const spent = M.sum(M.expensesBetween(monthStart, D.addDays(date, -1)));
    const expected = budget * (dayOfMonth - 1) / daysInMonth(date);
    if (spent > expected * 1.1) {
      const cur = store.pref('currency', '₹');
      lines.push(`💸 ${cur}${Math.round(spent)} of your ${cur}${budget} budget spent — ${Math.round((spent / expected - 1) * 100)}% ahead of pace`);
      counts.push('over budget pace');
    }
  }

  const daysLeft = daysInMonth(date) - dayOfMonth;
  const behind = store.all('goals').filter((g) => g.horizon === 'month' && g.period === date.slice(0, 7)
    && g.status !== 'done' && goalProgress(g) < 1);
  if (behind.length && daysLeft <= 7) {
    lines.push(`🎯 ${plural(behind.length, 'monthly goal')} open with ${plural(daysLeft, 'day')} left`);
    for (const g of behind.slice(0, 2)) {
      suggestions.push({
        id: `${date}:goal:${g.id}`, title: `Add a to-do: work on “${g.title}”`,
        why: `${Math.round(goalProgress(g) * 100)}% done, ${plural(daysLeft, 'day')} left this month`,
        action: { type: 'addTodo', title: `Work on goal: ${g.title}`, date },
      });
    }
  }

  if (!lines.length) lines.push('Nothing needs you this morning. Enjoy the day.');
  return {
    job: 'morning-brief', date, lines, counts, suggestions,
    notification: { title: 'Your morning brief', url: '#/agent', tag: 'daybook-brief' },
  };
}

// ---- Evening check-in: only speaks up when something wasn't logged ------------------------------
export function eveningCheckin(date = D.today()) {
  const lines = [];
  const counts = [];
  const suggestions = [];

  if (recent('expenses', date, 14) && !store.all('expenses').some((e) => e.date === date)) {
    lines.push('💸 No spending logged today. Nothing, or forgot?');
    counts.push('Log today’s spending?');
  }
  if (recent('screentime', date, 14) && !store.all('screentime').some((e) => e.date === date)) {
    lines.push('📱 Screen time isn’t logged for today');
    counts.push('Screen time?');
  }
  const unticked = M.habits().filter((hb) => M.scheduledOn(hb, date) && !M.isDone(hb.id, date));
  if (unticked.length) {
    lines.push(`✅ Still to tick: ${unticked.map((hb) => `${hb.emoji || ''}${hb.name}`).join(', ')}`);
    counts.push(`${plural(unticked.length, 'habit')} unticked`);
  }
  const left = M.todosOn(date).filter((t) => !t.done);
  if (left.length) {
    const tomorrow = D.addDays(date, 1);
    lines.push(`☑️ ${plural(left.length, 'to-do')} left today`);
    counts.push(`${plural(left.length, 'to-do')} left`);
    suggestions.push({
      id: `${date}:tomorrow`, title: `Move ${plural(left.length, 'unfinished to-do')} to tomorrow`,
      why: 'Start tomorrow with them already on the list',
      action: { type: 'moveTodos', ids: left.map((t) => t.id), date: tomorrow },
    });
  }

  if (!lines.length) lines.push('Everything’s logged. Good day.');
  return {
    job: 'evening-checkin', date, lines, counts, suggestions,
    notification: { title: 'Evening check-in', url: '#/today', tag: 'daybook-evening', quietIfEmpty: true },
  };
}

// ---- Weekly review: the 7 days ending `date`, and a few suggestions for next week ---------------
export function weeklyReview(date = D.today()) {
  const from = D.addDays(date, -6);
  const prevFrom = D.addDays(date, -13);
  const prevTo = D.addDays(date, -7);
  const inWeek = (d) => d && d >= from && d <= date;
  const inPrev = (d) => d && d >= prevFrom && d <= prevTo;
  const cur = store.pref('currency', '₹');
  const lines = [];
  const counts = [];
  const suggestions = [];

  let gain = 0; let loss = 0;
  for (const e of xpEvents()) if (inWeek(e.date)) { if (e.xp > 0) gain += e.xp; else loss += e.xp; }
  lines.push(`⭐ +${gain} XP this week${loss ? ` (${loss} in penalties)` : ''}`);
  counts.push(`+${gain + loss} XP`);

  const habitRows = M.habits().map((hb) => {
    let sched = 0; let done = 0;
    for (let d = from; d <= date; d = D.addDays(d, 1)) {
      if (d < M.habitStart(hb)) continue;
      if (M.scheduledOn(hb, d)) sched++;
      if (M.isDone(hb.id, d)) done++;
    }
    return { hb, sched, done: Math.min(done, sched) };
  }).filter((r) => r.sched);
  if (habitRows.length) {
    const rate = habitRows.reduce((s, r) => s + r.done, 0) / habitRows.reduce((s, r) => s + r.sched, 0);
    const sorted = [...habitRows].sort((a, b) => b.done / b.sched - a.done / a.sched);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const name = (r) => `${r.hb.emoji || ''}${r.hb.name} ${r.done}/${r.sched}`;
    lines.push(`✅ Habits ${Math.round(rate * 100)}%${habitRows.length > 1 ? ` · best ${name(best)}${worst.done / worst.sched < 0.6 ? ` · slipping ${name(worst)}` : ''}` : ''}`);
    counts.push(`habits ${Math.round(rate * 100)}%`);
  }

  const workouts = store.all('workouts').filter((w) => w.endedAt);
  const wNow = workouts.filter((w) => inWeek(w.date)).length;
  const wPrev = workouts.filter((w) => inPrev(w.date)).length;
  if (wNow || wPrev) {
    lines.push(`🏋️ ${plural(wNow, 'workout')} (last week ${wPrev})`);
    counts.push(plural(wNow, 'workout'));
  }

  const todosDone = store.all('todos').filter((t) => t.done && inWeek(dayOf(t.doneAt) || t.date)).length;
  const tasksDone = store.all('tasks').filter((t) => t.done && inWeek(dayOf(t.doneAt))).length;
  if (todosDone || tasksDone) lines.push(`☑️ ${plural(todosDone, 'to-do')} and ${plural(tasksDone, 'task')} done`);

  const spent = M.sum(M.expensesBetween(from, date));
  const spentPrev = M.sum(M.expensesBetween(prevFrom, prevTo));
  if (spent || spentPrev) {
    const change = spentPrev ? Math.round((spent / spentPrev - 1) * 100) : null;
    lines.push(`💸 ${cur}${Math.round(spent)} spent (last week ${cur}${Math.round(spentPrev)}${change !== null ? `, ${change >= 0 ? '+' : ''}${change}%` : ''})`);
  }
  const budget = Number(store.pref('budget', 0)) || 0;
  if (budget) {
    const mtd = M.sum(M.expensesBetween(date.slice(0, 8) + '01', date));
    lines.push(`💰 ${cur}${Math.round(mtd)} of ${cur}${budget} budget used this month (${Math.round(mtd / budget * 100)}%, ${Math.round(Number(date.slice(8)) / daysInMonth(date) * 100)}% of the month gone)`);
  }

  const screen = store.all('screentime').filter((s) => inWeek(s.date));
  if (screen.length) {
    const days = new Set(screen.map((s) => s.date)).size;
    lines.push(`📱 Screen time ${hm(screen.reduce((s, x) => s + (Number(x.minutes) || 0), 0) / days)} a day on average`);
  }

  const learned = store.all('learnings').filter((l) => inWeek(dayOf(l.createdAt))).length;
  const books = store.all('reading').filter((r) => r.status === 'done' && inWeek(r.finishedAt)).length;
  if (learned || books) lines.push(`💡 ${plural(learned, 'learning')} logged${books ? `, ${plural(books, 'book')} finished` : ''}`);

  // Suggestions for next week.
  const monday = nextWeekday(date, 1);
  const monthEnd = date.slice(0, 8) + String(daysInMonth(date)).padStart(2, '0');
  const elapsed = Number(date.slice(8)) / daysInMonth(date);
  const goals = store.all('goals').filter((g) => g.horizon === 'month' && g.period === date.slice(0, 7) && g.status !== 'done');
  if (goals.length) lines.push(`🎯 ${goals.length} of this month’s goals still open`);
  for (const g of goals.filter((x) => goalProgress(x) < elapsed - 0.15).slice(0, 2)) {
    const due = monthEnd > date ? (nextWeekday(date, 3) < monthEnd ? nextWeekday(date, 3) : monthEnd) : null;
    suggestions.push({
      id: `${date}:wgoal:${g.id}`, title: `Add a task: move “${g.title}” forward`,
      why: `${Math.round(goalProgress(g) * 100)}% done with ${Math.round(elapsed * 100)}% of the month gone`,
      action: { type: 'addTask', title: `Move goal forward: ${g.title}`, due },
    });
  }
  const stale = M.openTasks().filter((t) => !t.due && !t.planned && ((t.priority || 0) >= 2 || Date.now() - (t.createdAt || Date.now()) > 14 * 86400000))
    .sort(M.taskSort);
  for (const t of stale.slice(0, 3 - suggestions.length)) {
    const age = Math.round((Date.now() - (t.createdAt || Date.now())) / 86400000);
    suggestions.push({
      id: `${date}:wplan:${t.id}`, title: `Plan “${t.title}” for Monday`,
      why: `${t.priority >= 2 ? 'High priority' : 'No date'}, open ${plural(age, 'day')}`,
      action: { type: 'planTask', taskId: t.id, date: monday },
    });
  }

  return {
    job: 'weekly-review', date, lines, counts, suggestions: suggestions.slice(0, 3), expires: D.addDays(date, 2),
    notification: { title: 'Your week in review', url: '#/agent', tag: 'daybook-week' },
  };
}

// ---- Record a job's result: suggestions (or actions, if allowed), a log entry, tidying --------
// `extra` can add AI output: { summary, suggestions, ai: { status } }.
// Returns counts and the notification to send (or null). Never puts titles in either.
export function record(result, { now = Date.now(), extra = {} } = {}) {
  const { job, date } = result;
  const raw = store.snapshot().agentInbox || {};

  for (const s of pending()) if ((s.expires || s.date) < date) store.put('agentInbox', { ...s, status: 'expired' });

  const did = [];
  let added = 0;
  for (const sug of [...result.suggestions, ...(extra.suggestions || [])]) {
    if (raw[sug.id]) continue; // already suggested (and maybe dismissed): don't ask twice
    const rec = { ...sug, date, job, expires: sug.expires || result.expires || date };
    if (autonomy(sug.action.type) === 'act') {
      const res = apply(sug.action);
      store.put('agentInbox', { ...rec, status: 'auto', decidedAt: now, result: res });
      if (res) did.push(res);
    } else {
      store.put('agentInbox', { ...rec, status: 'pending' });
      added++;
    }
  }

  const waiting = pending().length;
  const summary = [
    result.counts.join(' · ') || (job === 'evening-checkin' ? 'All logged' : 'Nothing urgent'),
    waiting ? `${plural(waiting, 'suggestion')} to approve` : null,
    did.length ? `${did.length} done for you` : null,
  ].filter(Boolean).join(' · ');

  store.put('agentLog', {
    id: `run:${job}:${now}`, at: now, date, job, brief: result.lines, summary, did,
    ai: extra.ai || null, aiSummary: extra.summary || null,
  });

  const cutoff = now - KEEP_DAYS * 86400000;
  for (const r of store.all('agentLog')) if (r.at < cutoff) store.remove('agentLog', r.id);
  for (const s of store.all('agentInbox')) if (s.status !== 'pending' && (s.decidedAt || s.createdAt) < cutoff) store.remove('agentInbox', s.id);

  const { quietIfEmpty, ...note } = result.notification;
  const quiet = quietIfEmpty && !result.counts.length;
  return {
    stats: { suggested: added, done: did.length, waiting },
    notification: quiet ? null : { ...note, body: summary },
  };
}

export function runMorningBrief(date = D.today(), now = Date.now()) {
  return record(morningBrief(date), { now });
}
