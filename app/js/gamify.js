// Life as an RPG. XP is *derived* from everything already in the app (nothing
// extra is stored), so history counts retroactively and it syncs for free.
//
// Every completed thing becomes an XP event { date, xp, attr, kind }.
// Attributes: str (body), int (mind), dis (discipline), wlt (wealth), wis (wisdom), spi (spirit/fun).

import * as store from './store.js';
import * as D from './dates.js';

export const ATTRS = {
  str: { name: 'Strength', emoji: '💪', hint: 'Workouts, PRs, exercise habits' },
  int: { name: 'Intellect', emoji: '🧠', hint: 'Books, papers, learnings, reviews' },
  dis: { name: 'Discipline', emoji: '🎯', hint: 'Habits, to-dos, tasks' },
  wlt: { name: 'Wealth', emoji: '💰', hint: 'Tracking spending, staying under budget' },
  wis: { name: 'Wisdom', emoji: '🦉', hint: 'Goals, notes, life lessons' },
  spi: { name: 'Spirit', emoji: '✨', hint: 'Movies, shows, fun & travel goals' },
};

const RANKS = [[1, 'Novice'], [5, 'Apprentice'], [10, 'Adept'], [15, 'Expert'], [20, 'Veteran'], [30, 'Master'], [40, 'Grandmaster'], [50, 'Legend'], [75, 'Mythic']];

// Level curve: level L needs 50·(L−1)² total XP (L2 = 50, L5 = 800, L10 = 4,050, L20 = 18,050).
export function levelFor(xp) {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
  const floor = 50 * (level - 1) ** 2;
  const next = 50 * level ** 2;
  return { level, xp, into: xp - floor, need: next - floor, frac: (xp - floor) / (next - floor), rank: rankFor(level) };
}

// Attribute levels climb faster (smaller pools of XP).
export function attrLevel(xp) {
  const level = Math.floor(Math.sqrt(Math.max(0, xp) / 20)) + 1;
  const floor = 20 * (level - 1) ** 2;
  const next = 20 * level ** 2;
  return { level, xp, frac: (xp - floor) / (next - floor), toNext: next - xp };
}

export function rankFor(level) {
  let r = RANKS[0][1];
  for (const [l, name] of RANKS) if (level >= l) r = name;
  return r;
}

const dayOf = (ms) => (ms ? D.toStr(new Date(ms)) : null);
const GOAL_ATTR = { Health: 'str', Career: 'wis', Money: 'wlt', Learning: 'int', Relationships: 'spi', Personal: 'wis', Fun: 'spi', Travel: 'spi', Other: 'wis' };
const EX_HABIT = /exercis|gym|workout|run|walk|yoga|lift|train|swim|cycl|steps|sport|stretch/i;
const MIND_HABIT = /read|stud|learn|meditat|journal|write|course|practice|language|code/i;

export function events() {
  const ev = [];
  const push = (date, xp, attr, kind) => { if (date && xp) ev.push({ date, xp, attr, kind }); };

  for (const t of store.all('todos')) if (t.done) push(dayOf(t.doneAt) || t.date, 5, 'dis', 'todo');
  for (const t of store.all('tasks')) if (t.done) push(dayOf(t.doneAt) || dayOf(t.updatedAt), 10 + 5 * (t.priority || 0), 'dis', 'task');

  const habits = Object.fromEntries(store.all('habits').map((x) => [x.id, x]));
  for (const l of store.all('habitLogs')) {
    if (!l.done) continue;
    const hb = habits[l.habit];
    const attr = hb && EX_HABIT.test(hb.name) ? 'str' : hb && MIND_HABIT.test(hb.name) ? 'int' : 'dis';
    push(l.date, 10, attr, 'habit');
  }

  // Workouts + PRs (running records per exercise, chronological).
  const best = {};
  const workouts = store.all('workouts').filter((w) => w.endedAt).sort((a, b) => a.startedAt - b.startedAt);
  for (const w of workouts) {
    const sets = w.exercises.reduce((n, e) => n + e.sets.length, 0);
    push(w.date, 30 + Math.min(sets, 40), 'str', 'workout');
    for (const e of w.exercises) {
      let top = 0;
      for (const s of e.sets) if (s.type !== 'warmup') top = Math.max(top, (Number(s.weight) || 0) * (1 + Math.min(Number(s.reps) || 0, 15) / 30) || Number(s.reps) || Number(s.seconds) || Number(s.distance) || 0);
      if (best[e.exId] !== undefined && top > best[e.exId]) push(w.date, 15, 'str', 'pr');
      best[e.exId] = Math.max(best[e.exId] || 0, top);
    }
  }
  for (const m of store.all('measurements')) push(m.date, 2, 'str', 'measure');

  for (const r of store.all('reading')) {
    if (r.status === 'done') push(r.finishedAt || dayOf(r.updatedAt), r.type === 'book' ? 50 : 15, 'int', r.type === 'book' ? 'book' : 'article');
  }
  for (const w of store.all('watch')) {
    if (w.status === 'done') push(w.finishedAt || dayOf(w.updatedAt), w.type === 'show' ? 25 : w.type === 'video' ? 5 : 15, 'spi', 'watched');
    if (w.type === 'show' && w.episodesWatched) push(dayOf(w.updatedAt), Math.min(w.episodesWatched, 50), 'spi', 'episodes');
  }
  for (const l of store.all('learnings')) {
    push(dayOf(l.createdAt), 10, l.type === 'lesson' ? 'wis' : 'int', 'learning');
    for (const d of l.reviewDates || []) push(d, 2, 'int', 'review');
  }
  for (const n of store.all('notes')) push(dayOf(n.createdAt), 2, 'wis', 'note');
  for (const l of store.all('routineLogs')) if (l.done) push(l.date, 5, 'dis', 'routine');
  for (const e of store.all('timelog')) if (e.end) push(e.date, 3, 'dis', 'timelog');
  const screenLimit = Number(store.pref('screenLimit', 240));
  const screenByDay = {};
  for (const e of store.all('screentime')) { screenByDay[e.date] = (screenByDay[e.date] || 0) + e.minutes; push(e.date, 2, 'dis', 'screenLog'); }
  for (const [d, m] of Object.entries(screenByDay)) if (m <= screenLimit) push(d, 15, 'dis', 'screenUnder');
  for (const e of store.all('expenses')) push(dayOf(e.createdAt) || e.date, 2, 'wlt', 'expense');

  // A finished month under budget.
  const budget = Number(store.pref('budget', 0));
  if (budget) {
    const byMonth = {};
    for (const e of store.all('expenses')) byMonth[e.date.slice(0, 7)] = (byMonth[e.date.slice(0, 7)] || 0) + e.amount;
    const cur = D.today().slice(0, 7);
    for (const [m, total] of Object.entries(byMonth)) if (m < cur && total <= budget) push(D.addDays(D.addMonths(`${m}-01`, 1), -1), 100, 'wlt', 'budget');
  }

  for (const g of store.all('goals')) {
    const attr = GOAL_ATTR[g.area] || 'wis';
    push(dayOf(g.createdAt), 5, 'wis', 'goalSet');
    for (const m of g.milestones || []) if (m.done) push(dayOf(g.updatedAt), 10, attr, 'milestone');
    if (g.status === 'done') push(dayOf(g.doneAt) || dayOf(g.updatedAt), g.horizon === 'life' ? 500 : g.horizon === 'year' ? 150 : 50, attr, 'goal');
  }
  penalties(push);
  return ev;
}

// ---- Penalties: bad days cost XP (severity is a setting) ---------------------------------------------------
export const SEVERITY = { off: 0, gentle: 0.5, normal: 1, hardcore: 2 };
const LOOKBACK = 120; // days of history that can cost XP

function penalties(push) {
  const mult = SEVERITY[store.pref('penaltyLevel', 'normal')] ?? 1;
  const t = D.today();
  const earliest = D.addDays(t, -LOOKBACK);
  const neg = (date, xp, attr, kind) => { if (mult && date && date >= earliest && date < t) push(date, -Math.max(1, Math.round(xp * mult)), attr, kind); };

  // Missed habits (scheduled days you didn't tick, from the day the habit started).
  const done = new Set(store.all('habitLogs').filter((l) => l.done).map((l) => `${l.habit}|${l.date}`));
  for (const hb of store.all('habits')) {
    if (hb.archived) continue;
    let start = D.toStr(new Date(hb.createdAt || Date.now()));
    for (const l of store.all('habitLogs')) if (l.habit === hb.id && l.done && l.date < start) start = l.date;
    const days = hb.days && hb.days.length ? hb.days : [0, 1, 2, 3, 4, 5, 6];
    for (let d = start < earliest ? earliest : start; d < t; d = D.addDays(d, 1)) {
      if (days.includes(D.weekday(d)) && !done.has(`${hb.id}|${d}`)) neg(d, 3, 'dis', 'habitMiss');
    }
  }
  // Tasks that went past their due date (once each, the day after it was due).
  for (const x of store.all('tasks')) {
    if (!x.due) continue;
    const finished = x.done ? dayOf(x.doneAt) || dayOf(x.updatedAt) : null;
    if (!finished || finished > x.due) neg(D.addDays(x.due, 1), 5, 'dis', 'lateTask');
  }
  // To-dos left undone on their day.
  for (const x of store.all('todos')) if (!x.done) neg(x.date, 2, 'dis', 'todoMiss');
  // Screen time over the limit: −1 per 15 minutes over, up to −20 a day.
  const screenLimit = Number(store.pref('screenLimit', 240));
  const byDay = {};
  for (const e of store.all('screentime')) byDay[e.date] = (byDay[e.date] || 0) + e.minutes;
  for (const [d, m] of Object.entries(byDay)) if (m > screenLimit) neg(d, Math.min(20, Math.ceil((m - screenLimit) / 15)), 'dis', 'screenOver');
  // Months over budget.
  const budget = Number(store.pref('budget', 0));
  if (budget) {
    const byMonth = {};
    for (const e of store.all('expenses')) byMonth[e.date.slice(0, 7)] = (byMonth[e.date.slice(0, 7)] || 0) + e.amount;
    for (const [m, total] of Object.entries(byMonth)) {
      const last = D.addDays(D.addMonths(`${m}-01`, 1), -1);
      if (total > budget) neg(last < t ? last : D.addDays(t, -1), 100, 'wlt', 'overBudget');
    }
  }
  // Habits to break: slips cost their penalty; clean days earn +2.
  const vices = store.all('vices');
  const slipDays = {};
  for (const sl of store.all('slips')) {
    const v = vices.find((x) => x.id === sl.vice);
    if (!v) continue;
    (slipDays[v.id] ||= new Set()).add(sl.date);
    if (mult) push(sl.date, -Math.round((v.penalty || 10) * mult), v.attr || 'dis', 'slip');
  }
  for (const v of vices) {
    if (v.archived) continue;
    const from = D.toStr(new Date(v.createdAt || Date.now()));
    for (let d = from < earliest ? earliest : from; d < t; d = D.addDays(d, 1)) {
      if (!slipDays[v.id]?.has(d)) push(d, 2, v.attr || 'dis', 'clean');
    }
  }
}

export function summary() {
  const ev = events();
  const total = Math.max(0, ev.reduce((s, e) => s + e.xp, 0));
  const attrs = Object.fromEntries(Object.keys(ATTRS).map((k) => [k, 0]));
  const byDay = {};   // net XP per day
  const gains = {};   // positive XP per day (drives streaks)
  const losses = {};  // penalties per day (negative numbers)
  const kinds = {};
  for (const e of ev) {
    attrs[e.attr] += e.xp;
    byDay[e.date] = (byDay[e.date] || 0) + e.xp;
    if (e.xp > 0 && e.kind !== 'clean') gains[e.date] = (gains[e.date] || 0) + e.xp;
    if (e.xp < 0) losses[e.date] = (losses[e.date] || 0) + e.xp;
    kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  }
  for (const k of Object.keys(attrs)) attrs[k] = Math.max(0, attrs[k]);
  const t = D.today();
  const weekAgo = D.addDays(t, -6);
  let weekGain = 0; let weekLoss = 0;
  for (const e of ev) if (e.date >= weekAgo && e.date <= t) { if (e.xp > 0) weekGain += e.xp; else weekLoss += e.xp; }
  // Active-day streak (today may still be empty).
  let streak = 0;
  let d = gains[t] ? t : D.addDays(t, -1);
  while (gains[d]) { streak++; d = D.addDays(d, -1); }
  let bestStreak = 0; let run = 0; let prev = null;
  for (const day of Object.keys(gains).sort()) {
    run = prev && D.addDays(prev, 1) === day ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    prev = day;
  }
  return { total, level: levelFor(total), attrs, byDay, gains, losses, kinds, streak, bestStreak, today: byDay[t] || 0, weekGain, weekLoss };
}

// ---- Daily quests: three per day, picked deterministically from ones that fit your data ------------------
function seeded(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}

export function quests(date = D.today()) {
  const habitsToday = store.all('habits').filter((hb) => !hb.archived && (!hb.days?.length || hb.days.includes(D.weekday(date))));
  const logsToday = new Set(store.all('habitLogs').filter((l) => l.date === date && l.done).map((l) => l.habit));
  const todos = store.all('todos').filter((x) => x.date === date);
  const doneTodos = store.all('todos').filter((x) => x.done && (dayOf(x.doneAt) || x.date) === date).length;
  const doneTasks = store.all('tasks').filter((x) => x.done && dayOf(x.doneAt) === date).length;
  const pool = [];
  if (habitsToday.length) pool.push({ id: 'habits', title: 'Tick every habit today', emoji: '✅', xp: 30, progress: [habitsToday.filter((hb) => logsToday.has(hb.id)).length, habitsToday.length] });
  pool.push({ id: 'todos3', title: 'Finish 3 to-dos', emoji: '☑️', xp: 20, progress: [Math.min(doneTodos, 3), 3] });
  if (store.all('tasks').some((x) => !x.done)) pool.push({ id: 'task', title: 'Complete a task from your backlog', emoji: '📋', xp: 20, progress: [Math.min(doneTasks, 1), 1] });
  pool.push({ id: 'learn', title: 'Log something you learned', emoji: '💡', xp: 20, progress: [Math.min(store.all('learnings').filter((l) => dayOf(l.createdAt) === date).length, 1), 1] });
  const dueCards = store.all('learnings').filter((l) => !l.noReview && (l.due || '') <= date).length;
  const reviewed = store.all('learnings').filter((l) => (l.reviewDates || []).includes(date)).length;
  if (dueCards + reviewed >= 3) pool.push({ id: 'review', title: 'Review 3 learnings', emoji: '🔁', xp: 15, progress: [Math.min(reviewed, 3), 3] });
  if (store.all('workouts').length) pool.push({ id: 'workout', title: 'Get a workout in', emoji: '🏋️', xp: 30, progress: [store.all('workouts').some((w) => w.endedAt && w.date === date) ? 1 : 0, 1] });
  if (store.all('reading').some((r) => r.status === 'reading')) pool.push({ id: 'read', title: 'Move a book forward', emoji: '📖', xp: 15, progress: [store.all('reading').some((r) => r.status !== 'toread' && dayOf(r.updatedAt) === date) ? 1 : 0, 1] });
  if (store.all('expenses').length) pool.push({ id: 'money', title: 'Log today’s spending', emoji: '🧾', xp: 10, progress: [store.all('expenses').some((e) => e.date === date) ? 1 : 0, 1] });
  pool.push({ id: 'note', title: 'Capture a thought in Notes', emoji: '📝', xp: 10, progress: [store.all('notes').some((n) => dayOf(n.createdAt) === date) ? 1 : 0, 1] });
  if (store.all('routine').length) pool.push({ id: 'routine', title: 'Follow 3 blocks of your routine', emoji: '⏰', xp: 20, progress: [Math.min(store.all('routineLogs').filter((l) => l.done && l.date === date).length, 3), 3] });
  pool.push({ id: 'track', title: 'Log 3 things you did in the day tracker', emoji: '⏱️', xp: 15, progress: [Math.min(store.all('timelog').filter((e) => e.date === date).length, 3), 3] });
  if (store.all('screentime').length) pool.push({ id: 'screen', title: 'Log your screen time', emoji: '📱', xp: 10, progress: [store.all('screentime').some((e) => e.date === date) ? 1 : 0, 1] });
  if (store.all('watch').length) pool.push({ id: 'watch', title: 'Watch something from your list', emoji: '🍿', xp: 10, progress: [store.all('watch').some((w) => w.status !== 'towatch' && dayOf(w.updatedAt) === date) ? 1 : 0, 1] });
  if (todos.length === 0) pool.push({ id: 'plan', title: 'Plan your day: add 3 to-dos', emoji: '🗓', xp: 10, progress: [Math.min(todos.length, 3), 3] });

  const rnd = seeded(date);
  const picked = [];
  const bag = [...pool];
  while (picked.length < 3 && bag.length) picked.push(bag.splice(Math.floor(rnd() * bag.length), 1)[0]);
  return picked.map((q) => ({ ...q, done: q.progress[0] >= q.progress[1] }));
}

// Quest bonus XP for past days is not stored; it's shown for today only (keeps XP purely derived).

// ---- Achievements --------------------------------------------------------------------------------------
export function achievements(s = summary()) {
  const k = s.kinds;
  const habitStreak = bestHabitStreak();
  const perfect = perfectDays();
  const defs = [
    ['first', '🌱', 'First steps', 'Earn your first XP', s.total, 1],
    ['todo50', '☑️', 'Getting things done', 'Finish 50 to-dos', k.todo || 0, 50],
    ['task25', '📋', 'Backlog slayer', 'Complete 25 tasks', k.task || 0, 25],
    ['streak7', '🔥', 'On fire', 'Keep any habit for 7 days in a row', habitStreak, 7],
    ['streak30', '🌋', 'Unstoppable', '30-day habit streak', habitStreak, 30],
    ['perfect', '💎', 'Perfect day', 'All habits and all to-dos done in one day', perfect, 1],
    ['active30', '📅', 'Consistency', 'Be active 30 days in a row', s.bestStreak, 30],
    ['gym1', '🏋️', 'Iron initiate', 'Finish your first workout', k.workout || 0, 1],
    ['gym25', '🦾', 'Gym regular', '25 workouts', k.workout || 0, 25],
    ['gym100', '🏆', 'Centurion', '100 workouts', k.workout || 0, 100],
    ['pr10', '📈', 'PR hunter', 'Set 10 personal records', k.pr || 0, 10],
    ['book1', '📘', 'Bookworm', 'Finish a book', k.book || 0, 1],
    ['book12', '📚', 'Book a month', 'Finish 12 books', k.book || 0, 12],
    ['learn10', '💡', 'Curious mind', 'Log 10 learnings', k.learning || 0, 10],
    ['learn100', '🧠', 'Sage', 'Log 100 learnings', k.learning || 0, 100],
    ['review100', '🔁', 'Memory palace', 'Do 100 reviews', k.review || 0, 100],
    ['watch10', '🍿', 'Couch critic', 'Watch 10 movies or shows', k.watched || 0, 10],
    ['watch50', '🎬', 'Cinephile', 'Watch 50 movies or shows', k.watched || 0, 50],
    ['money100', '🧾', 'Money mindful', 'Log 100 expenses', k.expense || 0, 100],
    ['budget', '🏦', 'Budget boss', 'Finish a month under budget', k.budget || 0, 1],
    ['goal1', '🎯', 'Goal getter', 'Achieve a goal', k.goal || 0, 1],
    ['goal10', '🚀', 'High achiever', 'Achieve 10 goals', k.goal || 0, 10],
    ['dream', '🌟', 'Dreamer', 'Set 5 goals', k.goalSet || 0, 5],
    ['notes25', '📝', 'Scribe', 'Write 25 notes', k.note || 0, 25],
    ['routine50', '⏰', 'Clockwork', 'Follow 50 routine blocks', k.routine || 0, 50],
    ['track50', '⏱️', 'Time keeper', 'Log 50 time entries', k.timelog || 0, 50],
    ['screen7', '📵', 'Digital minimalist', 'Stay under your screen limit on 7 days', k.screenUnder || 0, 7],
    ['clean30', '🕊️', 'Breaking free', 'Stay clean from a bad habit for 30 days', bestCleanAll(), 30],
    ['lvl10', '⭐', 'Double digits', 'Reach level 10', s.level.level, 10],
    ['lvl25', '👑', 'Royalty', 'Reach level 25', s.level.level, 25],
  ];
  return defs.map(([id, emoji, name, desc, have, need]) => ({ id, emoji, name, desc, have: Math.min(have, need), need, done: have >= need }));
}

function bestCleanAll() {
  let best = 0;
  const t = D.today();
  for (const v of store.all('vices')) {
    const dates = [D.toStr(new Date(v.createdAt || Date.now())), ...store.all('slips').filter((x) => x.vice === v.id).map((x) => x.date).sort(), t];
    for (let i = 1; i < dates.length; i++) best = Math.max(best, D.diffDays(dates[i - 1], dates[i]));
  }
  return best;
}

function bestHabitStreak() {
  const byHabit = {};
  for (const l of store.all('habitLogs')) if (l.done) (byHabit[l.habit] ||= []).push(l.date);
  let best = 0;
  for (const dates of Object.values(byHabit)) {
    dates.sort();
    let run = 0; let prev = null;
    for (const d of dates) { run = prev && D.addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  }
  return best;
}

function perfectDays() {
  const habits = store.all('habits').filter((x) => !x.archived);
  if (!habits.length) return 0;
  const logs = {};
  for (const l of store.all('habitLogs')) if (l.done) (logs[l.date] ||= new Set()).add(l.habit);
  const todosByDay = {};
  for (const t of store.all('todos')) (todosByDay[t.date] ||= []).push(t);
  let n = 0;
  for (const [date, set] of Object.entries(logs)) {
    const sched = habits.filter((hb) => (!hb.days?.length || hb.days.includes(D.weekday(date))) && D.toStr(new Date(hb.createdAt || 0)) <= date);
    const todos = todosByDay[date] || [];
    if (sched.length && sched.every((hb) => set.has(hb.id)) && todos.length && todos.every((t) => t.done)) n++;
  }
  return n;
}
