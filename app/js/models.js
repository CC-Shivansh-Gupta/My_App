// Domain logic shared by the views: events, to-dos, tasks, habits, expenses, reading.

import * as store from './store.js';
import * as D from './dates.js';

// ---- Events ---------------------------------------------------------------------
export function eventsOn(date) {
  return store.all('events')
    .filter((e) => D.occursOn(e, date))
    .sort((a, b) => (a.allDay === b.allDay ? (a.time || '').localeCompare(b.time || '') : a.allDay ? -1 : 1));
}

export function eventTimeLabel(e) {
  if (e.allDay || !e.time) return 'All day';
  return e.endTime ? `${D.fmtTime(e.time)} – ${D.fmtTime(e.endTime)}` : D.fmtTime(e.time);
}

// ---- Daily to-dos ------------------------------------------------------------------
export function todosOn(date) {
  return store.all('todos').filter((t) => t.date === date)
    .sort((a, b) => (a.done - b.done) || (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
}

export function unfinishedBefore(date) {
  return store.all('todos').filter((t) => !t.done && t.date < date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function addTodo(title, date = D.today()) {
  return store.put('todos', { title, date, done: false });
}

export function toggleTodo(t, done) {
  store.put('todos', { ...t, done, doneAt: done ? Date.now() : null });
}

// ---- Tasks (backlog) -------------------------------------------------------------------
export function openTasks() {
  return store.all('tasks').filter((t) => !t.done);
}

export function tasksForDay(date) {
  // Tasks due on/before the day, or explicitly planned for it.
  return openTasks().filter((t) => (t.due && t.due <= date) || t.planned === date)
    .sort(taskSort);
}

export function taskSort(a, b) {
  const ad = a.due || '9999'; const bd = b.due || '9999';
  return (b.priority || 0) - (a.priority || 0) || ad.localeCompare(bd) || a.createdAt - b.createdAt;
}

export function addTask(parsed) {
  return store.put('tasks', {
    title: parsed.title, due: parsed.date || null, priority: parsed.priority || 0,
    tag: parsed.tag || null, done: false, notes: '', heading: parsed.heading || null,
  });
}

// Headings group tasks into named sections ("Work", "Home", "Trip to Goa"…).
export function taskHeadings() {
  return store.all('taskGroups').sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
}

export function addHeading(name) {
  const last = taskHeadings().pop();
  return store.put('taskGroups', { name: name.trim(), order: (last?.order ?? last?.createdAt ?? 0) + 1, collapsed: false });
}

export function toggleTask(t, done) {
  store.put('tasks', { ...t, done, doneAt: done ? Date.now() : null });
}

// ---- Habits -------------------------------------------------------------------------------
// A habit: { name, emoji, color, why, when: 'morning'|'afternoon'|'evening'|'any',
//   kind: 'check' (just do it) or 'count' (hit `target` `unit`s, e.g. 8 glasses),
//   freq: 'days' (on the weekdays in `days`) or 'week' (any `perWeek` days a week) }.
// A day's log: { id: 'habit|date', habit, date, done, value, skip, note }.
// Older habits (name, emoji, days) read as yes/no habits on set days, so nothing needs migrating.
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function habits() {
  return store.all('habits').filter((x) => !x.archived).sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
}

export const isCount = (hb) => hb?.kind === 'count' && Number(hb.target) > 0;
export const isWeekly = (hb) => hb?.freq === 'week' && Number(hb.perWeek) > 0;
export const planDays = (hb) => (hb.days && hb.days.length ? hb.days : ALL_DAYS);

// A fitting emoji for a new habit's name.
const HABIT_EMOJI = [[/read|book|pages/i, '📖'], [/run|jog|walk|steps/i, '🏃'], [/gym|workout|exercis|lift|push-?ups?|train/i, '💪'],
  [/water|hydrat/i, '💧'], [/meditat|breath|mindful/i, '🧘'], [/yoga|stretch/i, '🤸'], [/sleep|bed|wake|early/i, '😴'],
  [/journal|write|diary/i, '✍️'], [/study|learn|course|code|coding|practice/i, '📚'], [/veg|fruit|salad|eat|diet|cook/i, '🥗'],
  [/pray|gratitude|grateful/i, '🙏'], [/clean|tidy|chores/i, '🧹'], [/floss|teeth|skin/i, '🪥'], [/call|family|friends/i, '📞'],
  [/phone|screen|social/i, '📵'], [/save|money|budget/i, '💰'], [/music|guitar|piano|sing/i, '🎸'], [/cycle|bike|swim/i, '🚴']];
export function habitEmoji(name) {
  return HABIT_EMOJI.find(([re]) => re.test(name || ''))?.[1] || '✅';
}

export function addHabit({ name, emoji, days, ...rest }) {
  const last = habits().pop();
  return store.put('habits', { ...rest, name, emoji: emoji || habitEmoji(name), days: days && days.length ? days : ALL_DAYS, order: (last?.order ?? last?.createdAt ?? 0) + 1 });
}

const logId = (habitId, date) => `${habitId}|${date}`;

export function habitLog(habitId, date) {
  return store.get('habitLogs', logId(habitId, date));
}

export function isDone(habitId, date) {
  return Boolean(habitLog(habitId, date)?.done);
}

export function isSkipped(habitId, date) {
  const l = habitLog(habitId, date);
  return Boolean(l?.skip && !l.done);
}

// How much was done that day: the count for a count habit, otherwise 1 or 0.
export function valueOn(hb, date) {
  const l = habitLog(hb.id, date);
  if (!l) return 0;
  if (isCount(hb)) return Number(l.value) || (l.done ? Number(hb.target) : 0);
  return l.done ? 1 : 0;
}

function writeLog(habitId, date, fields) {
  return store.put('habitLogs', { id: logId(habitId, date), habit: habitId, date, done: false, value: 0, skip: false, ...fields });
}

export function setDone(habitId, date, done) {
  const hb = store.get('habits', habitId);
  return writeLog(habitId, date, { done, value: done && isCount(hb) ? Number(hb.target) : 0 });
}

export function setValue(hb, date, value) {
  const v = Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
  return writeLog(hb.id, date, { value: v, done: v >= Number(hb.target) });
}

// A skipped day (sick, travelling…) is excused: it neither counts nor breaks a streak.
export function setSkip(habitId, date, skip) {
  return writeLog(habitId, date, { skip });
}

export function setNote(habitId, date, note) {
  const prev = habitLog(habitId, date);
  return store.put('habitLogs', { done: false, ...prev, id: logId(habitId, date), habit: habitId, date, note });
}

// First day of the week holding `date` (Settings → week starts on).
export function weekOf(date) {
  return D.addDays(date, -((D.weekday(date) - store.pref('weekStart', 1) + 7) % 7));
}

// Days done in the week holding `date`; with `before`, only the days before it.
export function weekCount(hb, date, { before = null } = {}) {
  const ws = weekOf(date);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = D.addDays(ws, i);
    if (before && d >= before) break;
    if (isDone(hb.id, d)) n++;
  }
  return n;
}

// How many days a weekly habit asks for in a given week: fewer in the week it started or for skipped days.
export function weekQuota(hb, date) {
  const ws = weekOf(date);
  const start = habitStart(hb);
  let open = 0;
  for (let i = 0; i < 7; i++) {
    const d = D.addDays(ws, i);
    if (d >= start && !isSkipped(hb.id, d)) open++;
  }
  return Math.min(Number(hb.perWeek), open);
}

// Is it due that day? A weekly habit is due every day until the week's quota is met; a skipped day never is.
export function scheduledOn(habit, date) {
  if (isSkipped(habit.id, date)) return false;
  if (isWeekly(habit)) return isDone(habit.id, date) || weekCount(habit, date, { before: date }) < Number(habit.perWeek);
  return planDays(habit).includes(D.weekday(date));
}

// First day the habit counts from: its creation, or an earlier back-filled tick.
export function habitStart(habit) {
  let start = D.toStr(new Date(habit.createdAt || Date.now()));
  for (const l of store.all('habitLogs')) if (l.habit === habit.id && l.done && l.date < start) start = l.date;
  return start;
}

// Weeks in a row that met their quota; this week joins once it's met, and doesn't break it before then.
function weekStreak(hb, date) {
  const start = habitStart(hb);
  let w = weekOf(date);
  let n = 0;
  if (weekCount(hb, w) < weekQuota(hb, w)) w = D.addDays(w, -7);
  for (; D.addDays(w, 6) >= start; w = D.addDays(w, -7)) {
    const q = weekQuota(hb, w);
    if (q <= 0) continue;
    if (weekCount(hb, w) >= q) n++;
    else break;
  }
  return n;
}

export function streak(habit, date = D.today()) {
  if (isWeekly(habit)) return weekStreak(habit, date);
  // Consecutive scheduled days done, ending today (today may still be pending).
  const start = habitStart(habit);
  let n = 0;
  let d = date;
  if (!isDone(habit.id, d)) d = D.addDays(d, -1);
  while (d >= start) {
    if (isDone(habit.id, d)) n++;
    else if (scheduledOn(habit, d)) break;
    d = D.addDays(d, -1);
  }
  return n;
}

export const streakUnit = (hb) => (isWeekly(hb) ? 'week' : 'day');

// Every streak the habit has had: [{ from, to, n }], oldest first (n in days, or weeks for weekly habits).
export function streakRuns(hb, end = D.today()) {
  const runs = [];
  let cur = null;
  const start = habitStart(hb);
  const close = () => { if (cur) runs.push(cur); cur = null; };
  if (isWeekly(hb)) {
    for (let w = weekOf(start); w <= end; w = D.addDays(w, 7)) {
      const q = weekQuota(hb, w);
      if (q <= 0) continue;
      const last = D.addDays(w, 6) < end ? D.addDays(w, 6) : end;
      if (weekCount(hb, w) >= q) { if (cur) { cur.to = last; cur.n++; } else cur = { from: w < start ? start : w, to: last, n: 1 }; } else if (weekOf(end) !== w) close();
    }
  } else {
    for (let d = start; d <= end; d = D.addDays(d, 1)) {
      if (isDone(hb.id, d)) { if (cur) { cur.to = d; cur.n++; } else cur = { from: d, to: d, n: 1 }; } else if (d !== end && scheduledOn(hb, d)) close();
    }
  }
  close();
  return runs;
}

export function bestStreak(hb, end = D.today()) {
  return streakRuns(hb, end).reduce((m, r) => Math.max(m, r.n), 0);
}

export function completionRate(habit, days = 30, end = D.today()) {
  const start = habitStart(habit);
  let sched = 0; let done = 0;
  if (isWeekly(habit)) {
    const from = D.addDays(end, -(days - 1));
    for (let w = weekOf(end); D.addDays(w, 6) >= from && D.addDays(w, 6) >= start; w = D.addDays(w, -7)) {
      const q = weekQuota(habit, w);
      const c = Math.min(weekCount(habit, w), q);
      if (w === weekOf(end) && c < q) { sched += c; done += c; continue; } // this week is still open
      sched += q; done += c;
    }
    return sched ? done / sched : null;
  }
  for (let i = 0; i < days; i++) {
    const d = D.addDays(end, -i);
    if (d < start) break;
    if (!scheduledOn(habit, d)) continue;
    if (d === end && !isDone(habit.id, d)) continue; // don't penalise today before it's over
    sched++;
    if (isDone(habit.id, d)) done++;
  }
  return sched ? done / sched : null;
}

// Habit strength, 0–1, like Loop Habit Tracker's score: each planned day nudges it toward 1 (done)
// or 0 (missed), so one missed day dents it instead of wiping out weeks of work. Half-life: 13 planned
// days, or 3 weeks for weekly habits. Count habits get partial credit. Returns [{ date, score }] per day.
const DAY_KEEP = 0.5 ** (1 / 13);
const WEEK_KEEP = 0.5 ** (1 / 3);
export function strengthSeries(hb, end = D.today()) {
  const out = [];
  const start = habitStart(hb);
  let score = 0;
  for (let d = start; d <= end; d = D.addDays(d, 1)) {
    if (isWeekly(hb)) {
      const lastOfWeek = D.addDays(weekOf(d), 6) === d;
      if (lastOfWeek || d === end) {
        const q = weekQuota(hb, d);
        const c = Math.min(weekCount(hb, d), q);
        if (q > 0 && (lastOfWeek || c >= q)) score = score * WEEK_KEEP + (c / q) * (1 - WEEK_KEEP);
      }
    } else {
      const done = isDone(hb.id, d);
      const credit = isCount(hb) ? Math.min(1, valueOn(hb, d) / Number(hb.target)) : done ? 1 : 0;
      const planned = planDays(hb).includes(D.weekday(d)) && !isSkipped(hb.id, d);
      if ((planned || done) && (d !== end || done)) score = score * DAY_KEEP + credit * (1 - DAY_KEEP);
    }
    out.push({ date: d, score });
  }
  return out;
}

export function strength(hb, end = D.today()) {
  const s = strengthSeries(hb, end);
  return s.length ? s[s.length - 1].score : 0;
}

// Totals per week or month, newest last: days done, or the amount for count habits.
export function habitHistory(hb, unit = 'week', n = 12, end = D.today()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const from = unit === 'month' ? D.addMonths(`${end.slice(0, 7)}-01`, -i) : D.addDays(weekOf(end), -7 * i);
    const next = unit === 'month' ? D.addMonths(from, 1) : D.addDays(from, 7);
    let value = 0;
    for (let d = from; d < next && d <= end; d = D.addDays(d, 1)) value += isCount(hb) ? valueOn(hb, d) : isDone(hb.id, d) ? 1 : 0;
    out.push({ from, to: D.addDays(next, -1), value });
  }
  return out;
}

// For each weekday (0 = Sunday): how often it was planned and how often it got done.
export function weekdayStats(hb, end = D.today()) {
  const out = ALL_DAYS.map((day) => ({ day, planned: 0, done: 0 }));
  for (let d = habitStart(hb); d <= end; d = D.addDays(d, 1)) {
    const done = isDone(hb.id, d);
    const planned = !isSkipped(hb.id, d) && (isWeekly(hb) || planDays(hb).includes(D.weekday(d)));
    if (d === end && !done) continue;
    if (planned) out[D.weekday(d)].planned++;
    if (done) out[D.weekday(d)].done++;
  }
  return out;
}

export function habitTotals(hb) {
  let days = 0; let amount = 0;
  for (const l of store.all('habitLogs')) {
    if (l.habit !== hb.id) continue;
    if (l.done) days++;
    if (isCount(hb)) amount += Number(l.value) || (l.done ? Number(hb.target) : 0);
  }
  return { days, amount };
}

export function habitNotes(hb) {
  return store.all('habitLogs').filter((l) => l.habit === hb.id && l.note && l.note.trim()).sort((a, b) => b.date.localeCompare(a.date));
}

// ---- Expenses -------------------------------------------------------------------------------
export const DEFAULT_CATEGORIES = [
  ['Food', '🍽️'], ['Groceries', '🛒'], ['Transport', '🚕'], ['Shopping', '🛍️'], ['Bills', '🧾'],
  ['Rent', '🏠'], ['Health', '💊'], ['Fun', '🎬'], ['Travel', '✈️'], ['Education', '📚'],
  ['Gifts', '🎁'], ['Other', '📦'],
];

const CATEGORY_HINTS = {
  Food: /\b(lunch|dinner|breakfast|coffee|cafe|tea|snack|restaurant|pizza|burger|swiggy|zomato|food|meal|brunch|chai|doordash|ubereats)\b/i,
  Groceries: /\b(grocer(y|ies)|vegetables?|fruits?|milk|bread|eggs|supermarket|blinkit|zepto|instamart|bigbasket|dmart)\b/i,
  Transport: /\b(uber|ola|taxi|cab|auto|metro|bus|train|fuel|petrol|diesel|gas|parking|toll|rapido|lyft)\b/i,
  Shopping: /\b(amazon|flipkart|myntra|clothes|shoes|shirt|jeans|shopping|gadget)\b/i,
  Bills: /\b(bill|electricity|internet|wifi|phone|mobile|recharge|subscription|netflix|spotify|prime|insurance)\b/i,
  Rent: /\b(rent|maintenance|landlord)\b/i,
  Health: /\b(doctor|medicine|pharmacy|gym|hospital|dentist|health|clinic|meds)\b/i,
  Fun: /\b(movie|cinema|concert|game|party|drinks|beer|bar|pub|outing)\b/i,
  Travel: /\b(flight|hotel|airbnb|trip|travel|visa|holiday)\b/i,
  Education: /\b(course|book|books|udemy|coursera|tuition|exam|fees)\b/i,
  Gifts: /\b(gift|present|donation|charity)\b/i,
};

export function categories() {
  const custom = store.pref('categories', null);
  return custom || DEFAULT_CATEGORIES;
}

export function categoryEmoji(name) {
  return categories().find(([n]) => n.toLowerCase() === (name || '').toLowerCase())?.[1] || '📦';
}

export function normalizeCategory(name) {
  if (!name) return null;
  const hit = categories().find(([n]) => n.toLowerCase() === name.toLowerCase());
  return hit ? hit[0] : name.charAt(0).toUpperCase() + name.slice(1);
}

// Guess a category from the note: same note used before wins, then keywords.
export function guessCategory(note) {
  if (!note) return 'Other';
  const key = note.toLowerCase().trim();
  const past = store.all('expenses').filter((e) => (e.note || '').toLowerCase().trim() === key)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (past) return past.category;
  for (const [cat, re] of Object.entries(CATEGORY_HINTS)) if (re.test(note)) return cat;
  return 'Other';
}

export function addExpense({ amount, note, category, date }) {
  return store.put('expenses', {
    amount: Math.round(amount * 100) / 100, note: note || '',
    category: normalizeCategory(category) || guessCategory(note), date: date || D.today(),
  });
}

export function expensesBetween(from, to) {
  return store.all('expenses').filter((e) => e.date >= from && e.date <= to);
}

export function sum(list) {
  return list.reduce((a, e) => a + (Number(e.amount) || 0), 0);
}

// ---- Reading ------------------------------------------------------------------------------------
export const READING_TYPES = [['book', 'Book'], ['paper', 'Paper'], ['article', 'Article'], ['other', 'Other']];
export const READING_STATUS = [['reading', 'Reading'], ['toread', 'Up next'], ['done', 'Finished']];

export function addReading({ title, author = '', url = '', type = 'book', status = 'toread' }) {
  return store.put('reading', {
    title, author, url, type, status, progress: 0, rating: 0, notes: '',
    startedAt: status === 'reading' ? D.today() : null, finishedAt: status === 'done' ? D.today() : null,
  });
}

export function readingIcon(type) {
  return { book: '📘', paper: '📄', article: '📰' }[type] || '🔖';
}
