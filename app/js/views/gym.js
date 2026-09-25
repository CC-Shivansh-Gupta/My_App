// Gym: a Strong-style workout logger. Start from a routine or empty, log sets with
// the previous session alongside, auto rest timer, PRs, history and exercise stats.

import * as store from '../store.js';
import { shareButton } from '../share.js';
import * as D from '../dates.js';
import * as G from '../gym/model.js';
import * as X from '../gym/exercises.js';
import * as C from '../charts.js';
import { h, icon, section, sheet, closeSheet, empty, segmented, toast, field } from '../ui.js';

let tab = 'workout';
let rerender = () => {};

// ---- Rest timer + workout clock (updated in place, no re-render) -------------------------------
const rest = { endsAt: 0, total: 0, bar: null, audio: null };
let ticking = null;

export function startTicker() {
  ensureTicker();
}

function ensureTicker() {
  if (ticking) return;
  ticking = setInterval(tick, 250);
}

function tick() {
  const w = G.activeWorkout();
  for (const el of document.querySelectorAll('.w-clock')) {
    el.textContent = w ? G.fmtClock((Date.now() - w.startedAt) / 1000) : '';
  }
  if (!rest.endsAt) { rest.bar?.classList.remove('show'); return; }
  const left = (rest.endsAt - Date.now()) / 1000;
  if (left <= 0) { restDone(); return; }
  if (!rest.bar) buildRestBar();
  rest.bar.classList.add('show');
  rest.bar.querySelector('.rest-time').textContent = G.fmtClock(Math.ceil(left));
  rest.bar.querySelector('.rest-fill').style.width = `${(left / rest.total) * 100}%`;
}

function buildRestBar() {
  rest.bar = h('div', { class: 'rest-bar', role: 'timer', 'aria-live': 'off' },
    h('span', { class: 'rest-fill' }),
    h('span', { class: 'rest-label' }, icon('timer', 18), 'Rest'),
    h('span', { class: 'rest-time' }),
    h('button', { class: 'btn ghost sm', onclick: () => adjustRest(-15) }, '−15'),
    h('button', { class: 'btn ghost sm', onclick: () => adjustRest(15) }, '+15'),
    h('button', { class: 'btn primary sm', onclick: () => { rest.endsAt = 0; tick(); } }, 'Skip'));
  document.body.append(rest.bar);
}

export function startRest(seconds = Number(store.pref('restSeconds', 90))) {
  if (!seconds) return;
  rest.total = seconds;
  rest.endsAt = Date.now() + seconds * 1000;
  // Unlock audio on this user gesture so the end beep can play later (iOS).
  try { rest.audio = rest.audio || new (window.AudioContext || window.webkitAudioContext)(); rest.audio.resume?.(); } catch { /* ignore */ }
  ensureTicker();
  tick();
}

function adjustRest(delta) {
  rest.endsAt += delta * 1000;
  rest.total = Math.max(rest.total + delta, 1);
  tick();
}

function restDone() {
  rest.endsAt = 0;
  rest.bar?.classList.remove('show');
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ }
  try {
    const ctx = rest.audio;
    if (ctx) {
      [0, 0.25].forEach((t) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = 880; g.gain.setValueAtTime(0.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
        o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.22);
      });
    }
  } catch { /* ignore */ }
  toast('Rest over — next set 💪');
}

// ---- Render --------------------------------------------------------------------------------------
export function render(ctx) {
  rerender = ctx.rerender;
  ensureTicker();
  const w = G.activeWorkout();
  const tabs = segmented([['workout', w ? 'Workout ●' : 'Start'], ['history', 'History'], ['exercises', 'Exercises']], tab, (v) => { tab = v; ctx.rerender(); }, { small: true });
  const head = h('header', { class: 'page-head' }, h('h1', null, 'Gym'), tabs);
  let body;
  if (tab === 'history') body = historyTab();
  else if (tab === 'exercises') body = exercisesTab();
  else body = w ? activeTab(w) : startTab();
  return h('div', { class: 'page' }, head, body);
}

// ---- Start tab -------------------------------------------------------------------------------------
function startTab() {
  const tpls = G.templates();
  return h('div', { class: 'stack' },
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, 'Quick start')),
      h('button', { class: 'btn primary big', onclick: () => { G.startWorkout(); } }, icon('plus', 18), 'Start an empty workout')),
    section('My templates', h('button', { class: 'btn ghost sm', onclick: () => editTemplate() }, icon('plus', 16), 'Template'),
      tpls.length ? h('div', { class: 'tpl-grid' }, tpls.map((t) => templateCard(t)))
        : empty('Templates are your routines (e.g. Push / Pull / Legs). Create one, or save a finished workout as a template.')),
    section('Example templates', null,
      h('div', { class: 'tpl-grid' }, X.EXAMPLE_TEMPLATES.map((ex) => {
        const t = X.exampleToTemplate(ex);
        return h('div', { class: 'tpl-card' },
          h('b', null, t.name),
          h('p', { class: 'tpl-lines' }, t.exercises.map((e) => `${e.sets.length} × ${X.displayName(X.getExercise(e.exId))}`).join('\n')),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn primary sm', onclick: () => G.startWorkout(t) }, 'Start'),
            h('button', { class: 'btn ghost sm', onclick: () => { store.put('templates', t); toast(`Saved “${t.name}” to your templates`); } }, 'Save')));
      }))),
    h('div', { class: 'grid-2' }, bodyWeightCard(), toolsCard()));
}

function templateCard(t) {
  const last = G.lastPerformed(t.id);
  return h('button', { class: 'tpl-card', onclick: () => templatePreview(t) },
    h('b', null, t.name),
    h('p', { class: 'tpl-lines' }, t.exercises.slice(0, 6).map((e) => `${e.sets.length} × ${X.displayName(X.getExercise(e.exId))}`).join('\n')
      + (t.exercises.length > 6 ? `\n+${t.exercises.length - 6} more` : '')),
    h('p', { class: 'muted small' }, last ? `Last: ${D.fmtDate(last.date)}` : 'Not performed yet'));
}

function templatePreview(t) {
  sheet(t.name, h('ul', { class: 'list compact' }, t.exercises.map((e) => {
    const ex = X.getExercise(e.exId);
    return h('li', { class: 'row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, `${e.sets.length} × ${X.displayName(ex)}`),
      h('span', { class: 'row-sub' }, ex?.bodyPart || '')));
  })), {
    actions: [
      h('button', { class: 'btn danger ghost', onclick: () => { closeSheet(); store.remove('templates', t.id); toast('Template deleted', { label: 'Undo', run: () => store.put('templates', t) }); } }, icon('trash', 18), 'Delete'),
      h('button', { class: 'btn ghost', onclick: () => editTemplate(t) }, 'Edit'),
      h('button', { class: 'btn primary', onclick: () => { closeSheet(); G.startWorkout(t); tab = 'workout'; } }, 'Start workout'),
    ],
  });
}

function bodyWeightCard() {
  const list = G.bodyWeights();
  const last = list[list.length - 1];
  const input = h('input', { class: 'quick', inputmode: 'decimal', placeholder: last ? `Last: ${last.value} ${G.unit()}` : `Today's weight (${G.unit()})`, 'data-key': 'bw-add', enterkeyhint: 'done' });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && Number(input.value)) { G.logBodyWeight(Number(input.value)); input.value = ''; toast('Body weight logged'); }
  });
  const pts = list.slice(-30).map((m) => ({ label: D.parse(m.date).getDate(), value: m.value, tip: `${D.fmtDate(m.date, { relative: false })}: ${m.value} ${G.unit()}` }));
  const min = pts.length ? Math.min(...pts.map((p) => p.value)) : 0;
  return section('Body weight', last ? h('span', { class: 'count' }, `${last.value} ${G.unit()}`) : null, input,
    pts.length > 1 ? C.line(pts.map((p) => ({ ...p, value: p.value - Math.floor(min * 0.98) })), { fmt: (v) => G.fmtNum(Math.round(v + Math.floor(min * 0.98))), labelEvery: 5, height: 100 }) : null);
}

function toolsCard() {
  const rs = Number(store.pref('restSeconds', 90));
  return section('Tools', null,
    field('Default rest timer', segmented([[0, 'Off'], [60, '1:00'], [90, '1:30'], [120, '2:00'], [180, '3:00']], rs, (v) => store.setPref('restSeconds', v), { small: true })),
    field('Units', segmented([['kg', 'kg / km'], ['lb', 'lb / mi']], G.unit(), (v) => store.setPref('weightUnit', v), { small: true })),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost', onclick: plateCalculator }, 'Plate calculator'),
      h('button', { class: 'btn ghost', onclick: () => startRest() }, icon('timer', 18), 'Start rest timer')));
}

function plateCalculator() {
  const kg = G.unit() === 'kg';
  const target = h('input', { inputmode: 'decimal', placeholder: kg ? '100' : '225', autofocus: true });
  const bar = h('input', { inputmode: 'decimal', value: kg ? 20 : 45 });
  const out = h('div', { class: 'plates' });
  const calc = () => {
    const r = G.plates(Number(target.value), Number(bar.value));
    if (!target.value) { out.replaceChildren(); return; }
    if (!r) { out.replaceChildren(h('p', { class: 'muted' }, 'Target is lighter than the bar.')); return; }
    out.replaceChildren(
      h('p', { class: 'small muted' }, 'Each side:'),
      h('div', { class: 'plate-row' }, r.plates.length ? r.plates.map((p) => h('span', { class: 'plate', style: { height: `${30 + p * (kg ? 2 : 0.9)}px` } }, G.fmtNum(p))) : h('span', { class: 'muted' }, 'Just the bar')),
      r.leftover ? h('p', { class: 'small muted' }, `${G.fmtNum(r.leftover)} ${G.unit()} can’t be made with standard plates.`) : null);
  };
  target.addEventListener('input', calc); bar.addEventListener('input', calc);
  sheet('Plate calculator', h('div', { class: 'form' }, h('div', { class: 'row2' }, field(`Target (${G.unit()})`, target), field(`Bar (${G.unit()})`, bar)), out));
}

// ---- Active workout ------------------------------------------------------------------------------
function activeTab(w) {
  const name = h('input', { class: 'w-name', value: w.name, 'data-key': 'w-name', 'aria-label': 'Workout name' });
  name.addEventListener('input', () => G.saveSilently({ ...G.activeWorkout(), name: name.value }));
  name.addEventListener('change', () => rerender());
  return h('div', { class: 'stack workout' },
    h('section', { class: 'card w-head' },
      h('div', { class: 'w-head-row' },
        h('div', { class: 'w-title' }, name,
          h('p', { class: 'muted small' }, icon('timer', 14), h('span', { class: 'w-clock' }, G.fmtClock((Date.now() - w.startedAt) / 1000)),
            ` · ${w.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0)} sets done`)),
        h('button', { class: 'btn finish', onclick: () => finishFlow(w) }, 'Finish'))),
    w.exercises.map((e, i) => exerciseBlock(w, e, i)),
    h('button', { class: 'btn ghost big add-ex', onclick: () => pickExercises((ids) => G.addExercises(G.activeWorkout(), ids)) }, icon('plus', 18), 'Add exercises'),
    h('button', { class: 'btn danger ghost', onclick: () => {
      sheet('Cancel workout?', h('p', null, 'This workout will be discarded.'), { actions: [
        h('button', { class: 'btn ghost', onclick: closeSheet }, 'Keep going'),
        h('button', { class: 'btn danger', onclick: () => { closeSheet(); rest.endsAt = 0; G.cancelWorkout(w); toast('Workout discarded'); } }, 'Discard workout')] });
    } }, 'Cancel workout'));
}

const COLS = {
  weight: () => G.unit().toUpperCase(),
  reps: () => 'REPS',
  seconds: () => 'TIME',
  distance: () => G.distUnit().toUpperCase(),
};

function exerciseBlock(w, e, i) {
  const ex = X.getExercise(e.exId);
  const fs = X.fields(ex);
  const prev = G.previousSets(e.exId, w.startedAt);
  let normalNo = 0;
  return h('section', { class: 'card ex-block' },
    h('div', { class: 'ex-head' },
      h('button', { class: 'ex-name', onclick: () => exerciseDetail(e.exId) }, X.displayName(ex)),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Exercise options', onclick: () => exerciseMenu(i) }, icon('dots', 18))),
    e.notes !== '' && e.notes !== undefined && e.notes !== null && e.showNote !== false
      ? noteInput(i, e.notes) : null,
    h('div', { class: ['set-table', `cols-${fs.length}`] },
      h('div', { class: 'set-row set-head' }, h('span', null, 'SET'), h('span', null, 'PREVIOUS'),
        fs.map((f) => h('span', null, ex.category === 'assisted' && f === 'weight' ? `−${COLS[f]()}` : COLS[f]())), h('span', null, '✓')),
      e.sets.map((st, j) => {
        if (st.type !== 'warmup') normalNo++;
        const p = prev[j];
        const badge = G.SET_TYPES[st.type]?.short || String(normalNo);
        return h('div', { class: ['set-row', st.done && 'done', `t-${st.type}`] },
          h('button', { class: 'set-no', 'aria-label': 'Set type', onclick: () => setMenu(i, j) }, badge),
          h('button', { class: 'prev', disabled: !p, onclick: () => p && updateSet(i, j, pick(p, fs), true) }, p ? G.fmtSet(p, ex) : '—'),
          fs.map((f) => setInput(i, j, f, st, p)),
          h('button', { class: ['set-check', st.done && 'on'], 'aria-label': st.done ? 'Mark set not done' : 'Complete set', onclick: () => completeSet(i, j, fs, p) }, icon('check', 18)));
      })),
    h('button', { class: 'btn ghost sm add-set', onclick: () => addSet(i) }, icon('plus', 16), 'Add set'));
}

function noteInput(i, value) {
  const inp = h('input', { class: 'ex-note', value, placeholder: 'Note', 'data-key': `note-${i}` });
  inp.addEventListener('input', () => { const w = structuredClone(G.activeWorkout()); w.exercises[i].notes = inp.value; G.saveSilently(w); });
  return inp;
}

function pick(st, fs) {
  return Object.fromEntries(fs.map((f) => [f, st[f]]));
}

function setInput(i, j, f, st, p) {
  const isTime = f === 'seconds';
  const val = st[f] === null || st[f] === undefined ? '' : isTime ? G.fmtClock(st[f]) : String(st[f]);
  const ph = p && p[f] !== null && p[f] !== undefined ? (isTime ? G.fmtClock(p[f]) : String(p[f])) : isTime ? '0:00' : '';
  const inp = h('input', { class: 'set-in', value: val, placeholder: ph, inputmode: f === 'reps' ? 'numeric' : isTime ? 'text' : 'decimal', 'data-key': `s-${i}-${j}-${f}`, 'aria-label': f, enterkeyhint: 'next', autocomplete: 'off' });
  inp.addEventListener('focus', () => inp.select());
  inp.addEventListener('input', () => {
    const raw = inp.value.trim();
    const v = raw === '' ? null : isTime ? G.parseClock(raw) : Number(raw.replace(',', '.'));
    if (raw !== '' && (v === null || Number.isNaN(v))) return;
    updateSet(i, j, { [f]: v }, false);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const all = [...document.querySelectorAll('.set-in')];
      const next = all[all.indexOf(inp) + 1];
      if (next) next.focus(); else inp.blur();
    }
  });
  return inp;
}

function updateSet(i, j, patch, loud) {
  const w = structuredClone(G.activeWorkout());
  Object.assign(w.exercises[i].sets[j], patch);
  if (loud) store.put('workouts', w); else G.saveSilently(w);
}

function completeSet(i, j, fs, p) {
  const w = structuredClone(G.activeWorkout());
  const st = w.exercises[i].sets[j];
  if (!st.done) {
    // Blank fields take the previous session's values (shown as placeholders).
    for (const f of fs) if ((st[f] === null || st[f] === undefined) && p && p[f] != null) st[f] = p[f];
    if (fs.includes('reps') && !st.reps) { toast('Enter the reps first'); return; }
    if (fs.includes('seconds') && !fs.includes('reps') && !st.seconds) { toast('Enter the time first'); return; }
    st.done = true;
    store.put('workouts', w);
    startRest(Number(store.pref(`rest-${w.exercises[i].exId}`, store.pref('restSeconds', 90))));
  } else {
    st.done = false;
    store.put('workouts', w);
  }
}

function addSet(i) {
  const w = structuredClone(G.activeWorkout());
  const sets = w.exercises[i].sets;
  const last = sets[sets.length - 1] || {};
  sets.push({ type: 'normal', weight: last.weight ?? null, reps: last.reps ?? null, seconds: last.seconds ?? null, distance: last.distance ?? null, done: false });
  store.put('workouts', w);
}

function setMenu(i, j) {
  const choose = (fn) => () => { const w = structuredClone(G.activeWorkout()); fn(w); store.put('workouts', w); closeSheet(); };
  sheet('Set type', h('div', { class: 'menu-list' },
    Object.entries(G.SET_TYPES).map(([k, v]) => h('button', { class: 'menu-item', onclick: choose((w) => { w.exercises[i].sets[j].type = k; }) },
      h('span', { class: `set-no t-${k}` }, v.short || '1'), v.label)),
    h('button', { class: 'menu-item danger', onclick: choose((w) => { w.exercises[i].sets.splice(j, 1); }) }, icon('trash', 18), 'Delete set')));
}

function exerciseMenu(i) {
  const w0 = G.activeWorkout();
  const e = w0.exercises[i];
  const edit = (fn) => () => { const w = structuredClone(G.activeWorkout()); fn(w); store.put('workouts', w); closeSheet(); };
  const restKey = `rest-${e.exId}`;
  const cur = Number(store.pref(restKey, store.pref('restSeconds', 90)));
  sheet(X.displayName(X.getExercise(e.exId)), h('div', { class: 'menu-list' },
    h('button', { class: 'menu-item', onclick: edit((w) => { w.exercises[i].notes = w.exercises[i].notes || ' '; }) }, 'Add a note'),
    field('Rest timer for this exercise', segmented([[0, 'Off'], [60, '1:00'], [90, '1:30'], [120, '2:00'], [180, '3:00'], [240, '4:00']], cur, (v) => { store.setPref(restKey, v); closeSheet(); }, { small: true })),
    i > 0 ? h('button', { class: 'menu-item', onclick: edit((w) => { const [x] = w.exercises.splice(i, 1); w.exercises.splice(i - 1, 0, x); }) }, 'Move up') : null,
    i < w0.exercises.length - 1 ? h('button', { class: 'menu-item', onclick: edit((w) => { const [x] = w.exercises.splice(i, 1); w.exercises.splice(i + 1, 0, x); }) }, 'Move down') : null,
    h('button', { class: 'menu-item', onclick: () => { closeSheet(); pickExercises((ids) => { const w = structuredClone(G.activeWorkout()); w.exercises[i].exId = ids[0]; store.put('workouts', w); }, { single: true }); } }, 'Replace exercise'),
    h('button', { class: 'menu-item danger', onclick: edit((w) => { w.exercises.splice(i, 1); }) }, icon('trash', 18), 'Remove exercise')));
}

function finishFlow(w) {
  const pending = w.exercises.flatMap((e) => e.sets).filter((s) => !s.done);
  const doneCount = w.exercises.flatMap((e) => e.sets).filter((s) => s.done).length;
  const go = () => {
    closeSheet();
    rest.endsAt = 0;
    const done = G.finishWorkout(G.activeWorkout());
    summary(done);
  };
  if (!doneCount) {
    sheet('No sets completed', h('p', null, 'Tick at least one set before finishing, or cancel the workout.'), { actions: [h('button', { class: 'btn primary', onclick: closeSheet }, 'OK')] });
    return;
  }
  if (pending.length) {
    sheet('Finish workout?', h('p', null, `${pending.length} unticked ${pending.length === 1 ? 'set' : 'sets'} will be discarded.`), {
      actions: [h('button', { class: 'btn ghost', onclick: closeSheet }, 'Keep going'), h('button', { class: 'btn finish', onclick: go }, 'Finish')],
    });
  } else go();
}

function summary(w) {
  const prs = G.workoutPRs(w);
  const sets = w.exercises.reduce((n, e) => n + e.sets.length, 0);
  const vol = G.workoutVolume(w);
  const n = G.finishedWorkouts().length;
  const tpl = w.templateId ? store.get('templates', w.templateId) : null;
  const actions = [];
  if (!tpl) actions.push(h('button', { class: 'btn ghost', onclick: () => { G.templateFromWorkout(w); closeSheet(); toast('Saved as a template'); } }, 'Save as template'));
  else actions.push(h('button', { class: 'btn ghost', onclick: () => { store.put('templates', { ...tpl, exercises: G.templateExercises(w) }); closeSheet(); toast(`Updated “${tpl.name}” with today’s sets`); } }, 'Update template'));
  actions.push(shareButton(() => workoutShare(w, prs)));
  actions.push(h('button', { class: 'btn primary', onclick: closeSheet }, 'Done'));
  sheet('Workout complete 🎉', h('div', { class: 'summary' },
    h('p', { class: 'muted' }, `Workout #${n} · ${D.fmtDate(w.date)}`),
    h('h3', null, w.name),
    h('div', { class: 'stat-row' },
      stat(G.fmtDuration(w.endedAt - w.startedAt), 'Duration'),
      stat(vol ? `${G.fmtNum(Math.round(vol))} ${G.unit()}` : '—', 'Volume'),
      stat(String(sets), 'Sets'),
      stat(String(prs.length), 'PRs')),
    prs.length ? prList(prs) : null,
    h('ul', { class: 'list compact' }, w.exercises.map((e) => {
      const ex = X.getExercise(e.exId);
      return h('li', { class: 'row' }, h('span', { class: 'row-main' }, `${e.sets.length} × ${X.displayName(ex)}`), h('span', { class: 'row-sub' }, bestSetLabel(e, ex)));
    }))), { actions });
}

// PRs grouped per exercise: "🏆 Bench Press — Heaviest 47.5 kg · Est. 1RM 55.4 kg".
function prList(prs) {
  const by = new Map();
  for (const p of prs) by.set(p.exId, [...(by.get(p.exId) || []), `${p.label} ${p.value}`]);
  return h('ul', { class: 'pr-list' }, [...by].map(([exId, items]) => h('li', null, icon('trophy', 16),
    h('b', null, X.displayName(X.getExercise(exId))), h('span', null, items.join(' · ')))));
}

function workoutShare(w, prs) {
  const vol = G.workoutVolume(w);
  return { type: 'workout', title: w.name, body: [G.fmtDuration(w.endedAt - w.startedAt), vol ? `${G.fmtNum(Math.round(vol))} ${G.unit()} volume` : '',
    `${w.exercises.length} exercises`, prs.length ? `🏆 ${prs.length} PR${prs.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')
    + '\n' + w.exercises.map((e) => `${e.sets.length} × ${X.displayName(X.getExercise(e.exId))}`).join('\n') };
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
}

function bestSetLabel(e, ex) {
  const sets = e.sets.filter((s) => s.type !== 'warmup');
  if (!sets.length) return '';
  const f = X.fields(ex);
  let best = sets[0];
  for (const s of sets) {
    if (f.includes('weight') ? G.est1RM(s.weight, s.reps) > G.est1RM(best.weight, best.reps) : f.includes('reps') ? (s.reps || 0) > (best.reps || 0) : (s.distance || s.seconds || 0) > (best.distance || best.seconds || 0)) best = s;
  }
  return G.fmtSet(best, ex);
}

// ---- Exercise picker ---------------------------------------------------------------------------------
function pickExercises(onPick, { single = false } = {}) {
  let q = ''; let part = null;
  const chosen = new Set();
  const list = h('ul', { class: 'list compact picker-list' });
  const addBtn = h('button', { class: 'btn primary' }, single ? 'Choose' : 'Add');
  const search = h('input', { type: 'search', placeholder: 'Search exercises', autocomplete: 'off' });
  const chips = h('div', { class: 'chips' });
  const counts = {};
  for (const w of G.finishedWorkouts()) for (const e of w.exercises) counts[e.exId] = (counts[e.exId] || 0) + 1;

  const draw = () => {
    chips.replaceChildren(...[null, ...X.BODY_PARTS].map((p) => h('button', { class: ['chip', part === p && 'on'], onclick: () => { part = p; draw(); } }, p || 'All')));
    const ql = q.toLowerCase();
    let items = X.allExercises().filter((x) => (!part || x.bodyPart === part) && (!ql || X.displayName(x).toLowerCase().includes(ql)));
    items = items.sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || X.displayName(a).localeCompare(X.displayName(b)));
    list.replaceChildren(...items.map((x) => h('li', {
      class: ['row', chosen.has(x.id) && 'picked'],
      onclick: () => {
        if (single) { chosen.clear(); chosen.add(x.id); } else if (chosen.has(x.id)) chosen.delete(x.id); else chosen.add(x.id);
        draw();
      },
    }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, X.displayName(x)), h('span', { class: 'row-sub' }, `${x.bodyPart}${counts[x.id] ? ` · done ${counts[x.id]}×` : ''}`)),
    chosen.has(x.id) ? icon('check', 18) : null)));
    if (!items.length) list.replaceChildren(h('li', { class: 'empty' }, 'No match. Create it below.'));
    addBtn.textContent = single ? 'Choose' : chosen.size ? `Add ${chosen.size}` : 'Add';
    addBtn.disabled = !chosen.size;
  };
  search.addEventListener('input', () => { q = search.value; draw(); });
  addBtn.addEventListener('click', () => { const ids = [...chosen]; closeSheet(); onPick(ids); });
  const panel = sheet(single ? 'Replace exercise' : 'Add exercises', h('div', { class: 'picker' }, search, chips, list), {
    actions: [h('button', { class: 'btn ghost', onclick: () => newExercise(q, (ex) => { closeSheet(); onPick([ex.id]); }) }, icon('plus', 16), 'New exercise'), addBtn],
  });
  panel.classList.add('tall');
  draw();
}

function newExercise(prefill = '', onCreate) {
  const name = h('input', { value: prefill, placeholder: 'e.g. Cable Woodchopper', autofocus: true });
  const cat = h('select', null, Object.entries(X.CATEGORIES).map(([k, v]) => h('option', { value: k }, v.label)));
  const part = h('select', null, X.BODY_PARTS.map((p) => h('option', { value: p }, p)));
  sheet('New exercise', h('div', { class: 'form' }, field('Name', name), h('div', { class: 'row2' }, field('Type', cat), field('Body part', part))), {
    actions: [h('button', { class: 'btn primary', onclick: () => {
      if (!name.value.trim()) { name.focus(); return; }
      const ex = store.put('exercises', { name: name.value.trim(), category: cat.value, bodyPart: part.value, custom: true });
      closeSheet();
      if (onCreate) onCreate(ex); else toast('Exercise created');
    } }, 'Create')],
  });
}

// ---- Templates editor --------------------------------------------------------------------------------
function editTemplate(t = null) {
  const draft = t ? structuredClone(t) : { name: 'New Template', exercises: [] };
  const name = h('input', { value: draft.name, placeholder: 'Template name' });
  name.addEventListener('input', () => { draft.name = name.value; });
  const list = h('ul', { class: 'list compact' });
  const draw = () => list.replaceChildren(...draft.exercises.map((e, i) => h('li', { class: 'row' },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, X.displayName(X.getExercise(e.exId)))),
    h('button', { class: 'icon-btn sm', 'aria-label': 'Fewer sets', onclick: () => { if (e.sets.length > 1) e.sets.pop(); draw(); } }, '−'),
    h('span', { class: 'sets-count' }, `${e.sets.length} sets`),
    h('button', { class: 'icon-btn sm', 'aria-label': 'More sets', onclick: () => { e.sets.push({ ...(e.sets[e.sets.length - 1] || { type: 'normal' }) }); draw(); } }, '+'),
    h('button', { class: 'icon-btn sm', 'aria-label': 'Remove', onclick: () => { draft.exercises.splice(i, 1); draw(); } }, icon('close', 16)))));
  draw();
  const open = () => sheet(t ? 'Edit template' : 'New template', h('div', { class: 'form' }, field('Name', name), list,
    h('button', { class: 'btn ghost', onclick: () => pickExercises((ids) => {
      for (const id of ids) draft.exercises.push({ exId: id, sets: [{ type: 'normal' }, { type: 'normal' }, { type: 'normal' }] });
      draw(); open();
    }) }, icon('plus', 16), 'Add exercises')), {
    actions: [h('button', { class: 'btn primary', onclick: () => {
      if (!draft.exercises.length) { toast('Add at least one exercise'); return; }
      store.put('templates', { ...draft, name: draft.name.trim() || 'Template' });
      closeSheet(); toast('Template saved');
    } }, 'Save template')],
  });
  open();
}

// ---- History ---------------------------------------------------------------------------------------------
function historyTab() {
  const list = G.finishedWorkouts();
  if (!list.length) return section('', null, empty('Finished workouts show up here.'));
  const weeks = G.workoutsPerWeek(10);
  const groups = [];
  for (const w of list) {
    const k = w.date.slice(0, 7);
    if (!groups.length || groups[groups.length - 1][0] !== k) groups.push([k, []]);
    groups[groups.length - 1][1].push(w);
  }
  return h('div', { class: 'stack' },
    section('Workouts per week', h('span', { class: 'count' }, `${list.length} total`),
      C.columns(weeks.map((x, i) => ({ label: D.parse(x.from).getDate(), value: x.n, highlight: i === weeks.length - 1, tip: `Week of ${D.fmtDate(x.from, { relative: false })}: ${x.n} workouts` })), { height: 90, labelEvery: 2 })),
    groups.map(([k, ws]) => h('div', { class: 'group' },
      h('p', { class: 'sub-head' }, `${D.MONTH_NAMES[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`),
      h('div', { class: 'tpl-grid' }, ws.map((w) => historyCard(w))))));
}

function historyCard(w) {
  const prs = G.workoutPRs(w);
  const vol = G.workoutVolume(w);
  return h('button', { class: 'tpl-card hist-card', onclick: () => workoutDetail(w) },
    h('b', null, w.name),
    h('p', { class: 'muted small' }, [D.fmtDate(w.date), G.fmtDuration(w.endedAt - w.startedAt), vol ? `${G.fmtNum(Math.round(vol))} ${G.unit()}` : '', prs.length ? `🏆 ${prs.length} PR${prs.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')),
    h('div', { class: 'hist-lines' }, w.exercises.map((e) => {
      const ex = X.getExercise(e.exId);
      return h('p', null, h('span', null, `${e.sets.length} × ${X.displayName(ex)}`), h('span', { class: 'muted' }, bestSetLabel(e, ex)));
    })));
}

function workoutDetail(w) {
  const prs = G.workoutPRs(w);
  sheet(w.name, h('div', { class: 'summary' },
    h('p', { class: 'muted' }, `${D.fmtDate(w.date, { relative: false })} · ${new Date(w.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${G.fmtDuration(w.endedAt - w.startedAt)}`),
    prs.length ? prList(prs) : null,
    w.exercises.map((e) => {
      const ex = X.getExercise(e.exId);
      let n = 0;
      return h('div', { class: 'detail-ex' }, h('b', null, X.displayName(ex)),
        e.notes && e.notes.trim() ? h('p', { class: 'muted small' }, e.notes) : null,
        e.sets.map((s) => h('p', { class: 'detail-set' }, h('span', { class: `set-no t-${s.type}` }, G.SET_TYPES[s.type]?.short || String(++n)), G.fmtSet(s, ex),
          X.fields(ex).includes('weight') && s.reps && ex.category !== 'assisted' ? h('span', { class: 'muted small' }, ` · 1RM ≈ ${G.fmtNum(Math.round(G.est1RM(s.weight, s.reps)))}`) : null)));
    })), {
    actions: [
      h('button', { class: 'btn danger ghost', onclick: () => { closeSheet(); store.remove('workouts', w.id); toast('Workout deleted', { label: 'Undo', run: () => store.put('workouts', w) }); } }, icon('trash', 18), 'Delete'),
      h('button', { class: 'btn ghost', onclick: () => { G.templateFromWorkout(w); closeSheet(); toast('Saved as a template'); } }, 'Save as template'),
      shareButton(() => workoutShare(w, prs)),
      h('button', { class: 'btn primary', onclick: () => {
        closeSheet();
        if (G.activeWorkout()) { toast('Finish your current workout first'); return; }
        G.startWorkout({ name: w.name, id: w.templateId, exercises: w.exercises.map((e) => ({ exId: e.exId, sets: e.sets.map((s) => ({ ...s, done: false })) })) });
        tab = 'workout';
      } }, 'Repeat'),
    ],
  });
}

// ---- Exercises tab ---------------------------------------------------------------------------------------
let exQuery = ''; let exPart = null;

function exercisesTab() {
  const counts = {};
  for (const w of G.finishedWorkouts()) for (const e of w.exercises) counts[e.exId] = (counts[e.exId] || 0) + 1;
  const search = h('input', { type: 'search', class: 'quick', placeholder: 'Search exercises', value: exQuery, 'data-key': 'ex-search', autocomplete: 'off' });
  search.addEventListener('input', () => { exQuery = search.value; rerender(); });
  const ql = exQuery.toLowerCase();
  const items = X.allExercises().filter((x) => (!exPart || x.bodyPart === exPart) && (!ql || X.displayName(x).toLowerCase().includes(ql)))
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || X.displayName(a).localeCompare(X.displayName(b)));
  return section(`${items.length} exercises`, h('button', { class: 'btn ghost sm', onclick: () => newExercise() }, icon('plus', 16), 'New exercise'),
    search,
    h('div', { class: 'chips' }, [null, ...X.BODY_PARTS].map((p) => h('button', { class: ['chip', exPart === p && 'on'], onclick: () => { exPart = p; rerender(); } }, p || 'All'))),
    h('ul', { class: 'list compact' }, items.map((x) => h('li', { class: 'row', onclick: () => exerciseDetail(x.id) },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, X.displayName(x)), h('span', { class: 'row-sub' }, `${x.bodyPart} · ${X.CATEGORIES[x.category].label}`)),
      counts[x.id] ? h('span', { class: 'row-sub' }, `${counts[x.id]}×`) : null))));
}

function exerciseDetail(exId) {
  const ex = X.getExercise(exId);
  const hist = G.exerciseHistory(exId);
  const rec = G.records(exId);
  const f = X.fields(ex);
  const u = G.unit();
  const stats = [];
  if (f.includes('weight') && ex.category !== 'assisted') {
    stats.push([rec.est1RM ? `${G.fmtNum(Math.round(rec.est1RM))} ${u}` : '—', 'Est. 1RM'], [rec.weight ? `${G.fmtNum(rec.weight)} ${u}` : '—', 'Heaviest'], [rec.volume ? `${G.fmtNum(rec.volume)} ${u}` : '—', 'Best set volume']);
  }
  if (f.includes('reps')) stats.push([rec.reps || '—', 'Most reps']);
  if (f.includes('distance')) stats.push([rec.distance ? `${G.fmtNum(rec.distance)} ${G.distUnit()}` : '—', 'Longest']);
  if (f.includes('seconds') && !f.includes('distance')) stats.push([rec.seconds ? G.fmtClock(rec.seconds) : '—', 'Longest']);
  const metric = (sets) => {
    const s = sets.filter((x) => x.type !== 'warmup');
    if (f.includes('weight') && ex.category !== 'assisted') return Math.max(0, ...s.map((x) => G.est1RM(x.weight, x.reps)));
    if (f.includes('distance')) return Math.max(0, ...s.map((x) => x.distance || 0));
    if (f.includes('reps')) return Math.max(0, ...s.map((x) => x.reps || 0));
    return Math.max(0, ...s.map((x) => x.seconds || 0));
  };
  const metricName = f.includes('weight') && ex.category !== 'assisted' ? 'Est. 1RM' : f.includes('distance') ? 'Distance' : f.includes('reps') ? 'Most reps' : 'Time';
  const pts = hist.slice(0, 20).reverse().map(({ workout, sets }) => ({ label: `${D.parse(workout.date).getDate()}/${D.parse(workout.date).getMonth() + 1}`, value: Math.round(metric(sets) * 10) / 10, tip: `${D.fmtDate(workout.date, { relative: false })}: ${G.fmtNum(Math.round(metric(sets) * 10) / 10)}` }));
  const actions = [];
  if (ex.custom) actions.push(h('button', { class: 'btn danger ghost', onclick: () => { closeSheet(); store.remove('exercises', ex.id); toast('Exercise deleted'); } }, icon('trash', 18), 'Delete'));
  actions.push(h('button', { class: 'btn primary', onclick: closeSheet }, 'Close'));
  sheet(X.displayName(ex), h('div', { class: 'summary' },
    h('p', { class: 'muted small' }, `${ex.bodyPart} · ${X.CATEGORIES[ex.category].label} · done ${hist.length}×`),
    hist.length ? h('div', { class: 'stat-row' }, stats.map(([v, l]) => stat(String(v), l))) : empty('No history yet. Do it in a workout and your records show up here.'),
    pts.length > 1 ? h('div', null, h('p', { class: 'sub-head' }, `${metricName} over time`), C.line(pts, { height: 110, labelEvery: Math.ceil(pts.length / 5), fmt: (v) => G.fmtNum(Math.round(v)) })) : null,
    hist.length ? h('div', null, h('p', { class: 'sub-head' }, 'History'), hist.slice(0, 15).map(({ workout, sets }) => h('div', { class: 'detail-ex' },
      h('b', null, `${D.fmtDate(workout.date)} · ${workout.name}`),
      h('p', { class: 'muted small' }, sets.map((s) => G.fmtSet(s, ex)).join(' · '))))) : null), { actions });
}

// Small card for the Today screen.
export function todayCard() {
  const w = G.activeWorkout();
  if (w) {
    return section('Workout in progress', null,
      h('a', { class: 'btn finish', href: '#/gym' }, icon('gym', 18), 'Resume ', h('span', { class: 'w-clock' }, G.fmtClock((Date.now() - w.startedAt) / 1000))));
  }
  const last = G.finishedWorkouts()[0];
  const tpls = G.templates();
  if (!last && !tpls.length) return null;
  return section('Gym', h('a', { class: 'btn ghost sm', href: '#/gym' }, 'Open'),
    last ? h('p', { class: 'small muted' }, `Last: ${last.name} · ${D.fmtDate(last.date)}`) : null,
    h('div', { class: 'chips' }, tpls.slice(0, 4).map((t) => h('button', { class: 'chip', onclick: () => { G.startWorkout(t); location.hash = '#/gym'; } }, `▶ ${t.name}`))));
}

export function resumeWorkout() {
  tab = 'workout';
}
