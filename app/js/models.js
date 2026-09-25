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
    tag: parsed.tag || null, done: false, notes: '',
  });
}

export function toggleTask(t, done) {
  store.put('tasks', { ...t, done, doneAt: done ? Date.now() : null });
}

// ---- Habits -------------------------------------------------------------------------------
export function habits() {
  return store.all('habits').filter((x) => !x.archived).sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
}

const logId = (habitId, date) => `${habitId}|${date}`;

export function isDone(habitId, date) {
  return Boolean(store.get('habitLogs', logId(habitId, date))?.done);
}

export function setDone(habitId, date, done) {
  store.put('habitLogs', { id: logId(habitId, date), habit: habitId, date, done });
}

export function scheduledOn(habit, date) {
  const days = habit.days && habit.days.length ? habit.days : [0, 1, 2, 3, 4, 5, 6];
  return days.includes(D.weekday(date));
}

// First day the habit counts from: its creation, or an earlier back-filled tick.
export function habitStart(habit) {
  let start = D.toStr(new Date(habit.createdAt || Date.now()));
  for (const l of store.all('habitLogs')) if (l.habit === habit.id && l.done && l.date < start) start = l.date;
  return start;
}

export function streak(habit, date = D.today()) {
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

export function completionRate(habit, days = 30, end = D.today()) {
  const start = habitStart(habit);
  let sched = 0; let done = 0;
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
