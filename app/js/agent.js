// The Daybook agent. A scheduled job (agent/run.mjs, run by GitHub Actions in
// the private second-brain repo) reads your synced data every morning, writes a
// brief, and suggests changes. Suggestions wait in the inbox until you approve
// them, unless you've told it to just do that kind of thing (see `autonomy`).
// No DOM code here: the app and the Node job share this file.

import * as store from './store.js';
import * as D from './dates.js';
import * as M from './models.js';
import { progress as goalProgress } from './views/goals.js';

// The only things the agent can ever change. Anything else in a suggestion is ignored.
export const ACTIONS = {
  planTask: { label: 'Plan overdue tasks for today', emoji: '📋' },
  moveTodos: { label: 'Move unfinished to-dos to today', emoji: '☑️' },
  addTodo: { label: 'Add a to-do for a goal running out of time', emoji: '🎯' },
};

const KEEP_DAYS = 30;

// ---- Autonomy: "ask" (default) waits for you, "act" lets the agent do it and log it --------------
export function autonomy(type) {
  return store.pref('agentAutonomy', {})[type] === 'act' ? 'act' : 'ask';
}

export function setAutonomy(type, level) {
  store.setPref('agentAutonomy', { ...store.pref('agentAutonomy', {}), [type]: level });
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

export function latestBrief(date = D.today()) {
  return runs(50).find((r) => r.date === date && r.brief) || null;
}

// Carry out one action. Returns what was done, or null if there was nothing to do.
export function apply(action) {
  if (!action || !ACTIONS[action.type]) return null;
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
    const title = String(action.title || '').trim().slice(0, 200);
    if (!title || M.todosOn(action.date).some((t) => t.title === title)) return null;
    M.addTodo(title, action.date);
    return `Added to-do “${title}”`;
  }
  return null;
}

export function approve(s) {
  const did = apply(s.action);
  store.put('agentInbox', { ...s, status: 'approved', decidedAt: Date.now(), result: did });
  return did;
}

export function dismiss(s) {
  store.put('agentInbox', { ...s, status: 'dismissed', decidedAt: Date.now() });
}

// ---- The morning brief: plain rules over your data, no AI ------------------------------------------
function daysInMonth(date) {
  const d = D.parse(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

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
  return { date, lines, counts, suggestions };
}

// Run the morning brief against the loaded store: expire yesterday's suggestions,
// add new ones (or carry them out, if allowed), log the run, tidy old entries.
// Returns counts and the notification to send. Never includes titles in `stats`.
export function runMorningBrief(date = D.today(), now = Date.now()) {
  const brief = morningBrief(date);
  const raw = store.snapshot().agentInbox || {};

  for (const s of pending()) if (s.date < date) store.put('agentInbox', { ...s, status: 'expired' });

  const did = [];
  let added = 0;
  for (const sug of brief.suggestions) {
    if (raw[sug.id]) continue; // already suggested (and maybe dismissed): don't ask twice
    if (autonomy(sug.action.type) === 'act') {
      const res = apply(sug.action);
      store.put('agentInbox', { ...sug, date, status: 'auto', decidedAt: now, result: res });
      if (res) did.push(res);
    } else {
      store.put('agentInbox', { ...sug, date, status: 'pending' });
      added++;
    }
  }

  const waiting = pending().length;
  const summary = [
    brief.counts.join(' · ') || 'Nothing urgent',
    waiting ? `${plural(waiting, 'suggestion')} to approve` : null,
    did.length ? `${did.length} done for you` : null,
  ].filter(Boolean).join(' · ');

  store.put('agentLog', { id: `run:${now}`, at: now, date, job: 'morning-brief', brief: brief.lines, summary, did });

  const cutoff = now - KEEP_DAYS * 86400000;
  for (const r of store.all('agentLog')) if (r.at < cutoff) store.remove('agentLog', r.id);
  for (const s of store.all('agentInbox')) if (s.status !== 'pending' && (s.decidedAt || s.createdAt) < cutoff) store.remove('agentInbox', s.id);

  return {
    stats: { suggested: added, done: did.length, waiting },
    notification: { title: 'Your morning brief', body: summary, url: '#/agent', tag: 'daybook-brief' },
  };
}
