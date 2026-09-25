// Workouts, templates, previous sets, personal records and stats.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import { getExercise, fields } from './exercises.js';
import { bestMatch } from '../intents.js';

export const SET_TYPES = {
  normal: { label: 'Normal', short: null },
  warmup: { label: 'Warm-up', short: 'W' },
  drop: { label: 'Drop set', short: 'D' },
  failure: { label: 'Failure', short: 'F' },
};

export function unit() {
  return store.pref('weightUnit', 'kg');
}

export function distUnit() {
  return unit() === 'lb' ? 'mi' : 'km';
}

// ---- Workouts ----------------------------------------------------------------------------------
export function activeWorkout() {
  return store.all('workouts').filter((w) => !w.endedAt).sort((a, b) => b.startedAt - a.startedAt)[0] || null;
}

export function finishedWorkouts() {
  return store.all('workouts').filter((w) => w.endedAt).sort((a, b) => b.startedAt - a.startedAt);
}

const blankSet = (prev = {}) => ({ type: prev.type === 'warmup' ? 'warmup' : 'normal', weight: prev.weight ?? null, reps: prev.reps ?? null,
  seconds: prev.seconds ?? null, distance: prev.distance ?? null, done: false });

function defaultName() {
  const hr = new Date().getHours();
  return hr < 11 ? 'Morning Workout' : hr < 16 ? 'Afternoon Workout' : hr < 20 ? 'Evening Workout' : 'Night Workout';
}

export function startWorkout(template = null) {
  const cur = activeWorkout();
  if (cur) return cur;
  return store.put('workouts', {
    name: template?.name || defaultName(),
    templateId: template?.id || null,
    startedAt: Date.now(),
    endedAt: null,
    date: D.today(),
    notes: '',
    exercises: (template?.exercises || []).map((e) => ({ exId: e.exId, notes: '', sets: (e.sets.length ? e.sets : [{}]).map((st) => blankSet(st)) })),
  });
}

export function addExercises(w, exIds) {
  const exercises = [...w.exercises, ...exIds.map((exId) => {
    const prev = previousSets(exId, w.startedAt);
    const n = Math.max(1, Math.min(prev.length || 3, 6));
    return { exId, notes: '', sets: Array.from({ length: n }, () => blankSet()) };
  })];
  return store.put('workouts', { ...w, exercises });
}

export function saveSilently(w) {
  return store.put('workouts', w, { silent: true });
}

// Finish: drop unchecked sets and empty exercises, stamp the end time, tick the exercise habit.
export function finishWorkout(w) {
  const exercises = w.exercises.map((e) => ({ ...e, sets: e.sets.filter((st) => st.done) })).filter((e) => e.sets.length);
  const done = store.put('workouts', { ...w, exercises, endedAt: Date.now(), date: D.toStr(new Date(w.startedAt)) });
  const habit = bestMatch('exercise gym workout lift train', M.habits(), (x) => x.name, 0.3)
    || M.habits().find((x) => /gym|workout|exercis|lift|train/i.test(x.name));
  if (habit) M.setDone(habit.id, done.date, true);
  return done;
}

export function cancelWorkout(w) {
  store.remove('workouts', w.id);
}

// ---- Numbers ----------------------------------------------------------------------------------
export function est1RM(weight, reps) {
  if (!weight || !reps) return 0;
  if (reps === 1) return weight;
  return weight * (1 + Math.min(reps, 15) / 30); // Epley
}

export function setVolume(st, ex) {
  const f = fields(ex);
  if (!f.includes('weight') || ex.category === 'assisted') return 0;
  return (Number(st.weight) || 0) * (Number(st.reps) || 0);
}

export function workoutVolume(w) {
  return w.exercises.reduce((sum, e) => {
    const ex = getExercise(e.exId);
    return sum + e.sets.filter((st) => st.done !== false).reduce((s, st) => s + setVolume(st, ex), 0);
  }, 0);
}

export function fmtNum(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  const h = Math.floor(min / 60);
  return h ? `${h}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`;
}

export function fmtSet(st, ex) {
  const u = unit();
  switch (ex?.category) {
    case 'reps': return `${st.reps || 0} reps`;
    case 'duration': return fmtClock(st.seconds || 0);
    case 'cardio': return `${fmtNum(st.distance || 0)} ${distUnit()} · ${fmtClock(st.seconds || 0)}`;
    case 'assisted': return `−${fmtNum(st.weight || 0)} ${u} × ${st.reps || 0}`;
    default: return `${fmtNum(st.weight || 0)} ${u} × ${st.reps || 0}`;
  }
}

// Parse "1:30" / "90" into seconds.
export function parseClock(v) {
  if (v === '' || v === null || v === undefined) return null;
  const parts = String(v).split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((a, b) => a * 60 + b, 0);
}

// ---- History & records -----------------------------------------------------------------------
// Sets from the most recent finished workout that included this exercise.
export function previousSets(exId, before = Infinity) {
  for (const w of finishedWorkouts()) {
    if (w.startedAt >= before) continue;
    const e = w.exercises.find((x) => x.exId === exId);
    if (e) return e.sets;
  }
  return [];
}

export function exerciseHistory(exId) {
  const out = [];
  for (const w of finishedWorkouts()) {
    const sets = w.exercises.filter((x) => x.exId === exId).flatMap((x) => x.sets);
    if (sets.length) out.push({ workout: w, sets });
  }
  return out;
}

export function records(exId, before = Infinity) {
  const ex = getExercise(exId);
  const r = { est1RM: 0, weight: 0, volume: 0, reps: 0, seconds: 0, distance: 0, count: 0 };
  for (const w of finishedWorkouts()) {
    if (w.startedAt >= before) continue;
    for (const e of w.exercises) {
      if (e.exId !== exId) continue;
      r.count++;
      for (const st of e.sets) {
        if (st.type === 'warmup') continue;
        mergeRecord(r, st, ex);
      }
    }
  }
  return r;
}

function mergeRecord(r, st, ex) {
  const w = Number(st.weight) || 0; const reps = Number(st.reps) || 0;
  r.est1RM = Math.max(r.est1RM, ex?.category === 'assisted' ? 0 : est1RM(w, reps));
  r.weight = Math.max(r.weight, ex?.category === 'assisted' ? 0 : w);
  r.volume = Math.max(r.volume, setVolume(st, ex));
  r.reps = Math.max(r.reps, reps);
  r.seconds = Math.max(r.seconds, Number(st.seconds) || 0);
  r.distance = Math.max(r.distance, Number(st.distance) || 0);
}

// Personal records set in this workout, compared with everything before it.
export function workoutPRs(w) {
  const prs = [];
  for (const e of w.exercises) {
    const ex = getExercise(e.exId);
    const before = records(e.exId, w.startedAt);
    if (!before.count) continue; // first time isn't a "record"
    const now = { est1RM: 0, weight: 0, volume: 0, reps: 0, seconds: 0, distance: 0 };
    for (const st of e.sets) if (st.done !== false && st.type !== 'warmup') mergeRecord(now, st, ex);
    const f = fields(ex);
    const u = unit();
    if (f.includes('weight') && ex.category !== 'assisted') {
      if (now.weight > before.weight) prs.push({ exId: e.exId, label: 'Heaviest weight', value: `${fmtNum(now.weight)} ${u}` });
      if (now.est1RM > before.est1RM + 0.01) prs.push({ exId: e.exId, label: 'Est. 1RM', value: `${fmtNum(Math.round(now.est1RM * 10) / 10)} ${u}` });
      if (now.volume > before.volume) prs.push({ exId: e.exId, label: 'Best set volume', value: `${fmtNum(now.volume)} ${u}` });
    } else if (f.includes('reps') && now.reps > before.reps) prs.push({ exId: e.exId, label: 'Most reps', value: `${now.reps}` });
    if (f.includes('seconds') && !f.includes('distance') && now.seconds > before.seconds) prs.push({ exId: e.exId, label: 'Longest', value: fmtClock(now.seconds) });
    if (f.includes('distance') && now.distance > before.distance) prs.push({ exId: e.exId, label: 'Longest distance', value: `${fmtNum(now.distance)} ${distUnit()}` });
  }
  return prs;
}

export function workoutsPerWeek(weeks = 8) {
  const t = D.today();
  const weekStart = store.pref('weekStart', 1);
  const start = D.addDays(t, -((D.weekday(t) - weekStart + 7) % 7));
  const list = finishedWorkouts();
  return Array.from({ length: weeks }, (_, i) => {
    const from = D.addDays(start, -7 * (weeks - 1 - i));
    const to = D.addDays(from, 6);
    const n = list.filter((w) => w.date >= from && w.date <= to).length;
    return { from, n };
  });
}

// ---- Templates -----------------------------------------------------------------------------------
export function templates() {
  return store.all('templates').sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
}

export function templateExercises(w) {
  return w.exercises.map((e) => ({ exId: e.exId, sets: e.sets.map((st) => ({ type: st.type, weight: st.weight, reps: st.reps, seconds: st.seconds, distance: st.distance })) }));
}

export function templateFromWorkout(w, name = w.name) {
  return store.put('templates', { name, exercises: templateExercises(w) });
}

export function lastPerformed(templateId) {
  return finishedWorkouts().find((w) => w.templateId === templateId) || null;
}

// ---- Body weight ---------------------------------------------------------------------------------
export function bodyWeights() {
  return store.all('measurements').filter((m) => m.kind === 'bodyweight').sort((a, b) => a.date.localeCompare(b.date));
}

export function logBodyWeight(value, date = D.today()) {
  return store.put('measurements', { id: `bw-${date}`, kind: 'bodyweight', date, value: Number(value) });
}

// Plates per side for a target weight.
export function plates(target, bar) {
  const kg = unit() === 'kg';
  const sizes = kg ? [25, 20, 15, 10, 5, 2.5, 1.25] : [45, 35, 25, 10, 5, 2.5];
  let side = (target - bar) / 2;
  if (side < 0) return null;
  const out = [];
  for (const p of sizes) {
    while (side >= p - 1e-9) { out.push(p); side -= p; }
  }
  return { plates: out, leftover: Math.round(side * 2 * 100) / 100 };
}
