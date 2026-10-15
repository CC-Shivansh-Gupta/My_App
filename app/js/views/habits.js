// Habits: one tap to tick today, a little celebration when it counts, and for every habit a page of its
// own (#/habits/<id>) with strength, history, a calendar you can fill in, streaks and patterns —
// in the spirit of Loop Habit Tracker.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import { h, s, icon, section, sheet, closeSheet, field, segmented, toast, haptic, reducedMotion } from '../ui.js';
import * as V from '../vices.js';
import { ATTRS, SEVERITY } from '../gamify.js';
import * as C from '../charts.js';
import { editHabit, colorOf, describe, fmtNum, IDEAS, WHEN } from './habit-form.js';

const go = (hb) => { location.hash = `#/habits/${hb.id}`; };
let shownId = null;
let redraw = () => {};

export function render(ctx = {}) {
  if (ctx.rerender) redraw = ctx.rerender;
  const id = decodeURIComponent(location.hash.split(/[/?]/)[2] || '');
  const hb = id ? store.get('habits', id) : null;
  if ((hb?.id || null) !== shownId) {
    shownId = hb?.id || null;
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }
  return hb ? detail(hb) : overview();
}

// ---- Ticking, with a little ceremony ------------------------------------------------------------------
const MILESTONES = { 3: 'A start!', 7: 'A full week.', 14: 'Two weeks strong.', 21: 'Three weeks — it’s becoming you.', 30: 'A whole month!',
  50: 'Fifty. Unreal.', 66: '66 days: science says it’s a habit now.', 100: 'Triple digits! 💯', 200: '200!', 365: 'A full year. Legend.' };
let pop = { key: null, at: 0 };

// Tiny habits on a count goal (8 glasses) go up one per tap; bigger ones (20 pages, 8,000 steps) fill in one tap.
const stepsByOne = (hb) => M.isCount(hb) && Number(hb.target) <= 12;

function dueAllDone(date) {
  const due = M.habits().filter((x) => M.scheduledOn(x, date));
  return due.length > 0 && due.every((x) => M.isDone(x.id, date));
}

// Run a change to one day of a habit; celebrate if it completed something.
function change(hb, date, fn) {
  const was = M.isDone(hb.id, date);
  const before = M.streak(hb, date);
  const allBefore = dueAllDone(date);
  fn();
  if (was || !M.isDone(hb.id, date)) return;
  haptic(12);
  pop = { key: `${hb.id}|${date}`, at: Date.now() };
  if (date !== D.today()) return;
  const due = M.habits().filter((x) => M.scheduledOn(x, date));
  const n = M.streak(hb, date);
  const unit = M.streakUnit(hb);
  if (!allBefore && due.length > 1 && dueAllDone(date)) {
    confetti(90);
    toast(`Perfect day — all ${due.length} habits done 🎉`);
  } else if (n > before && MILESTONES[n]) {
    confetti(50);
    toast(`${hb.emoji || '🔥'} ${n}-${unit} streak! ${MILESTONES[n]}`);
  }
}

// The main check button: tick, add one, or undo.
export function tick(hb, date = D.today()) {
  const prev = M.habitLog(hb.id, date);
  if (M.isDone(hb.id, date)) {
    M.setDone(hb.id, date, false);
    if (M.isCount(hb) && prev) toast(`${hb.name}: back to 0`, { label: 'Undo', run: () => store.restore('habitLogs', prev) });
    return;
  }
  change(hb, date, () => {
    if (stepsByOne(hb)) M.setValue(hb, date, M.valueOn(hb, date) + 1);
    else M.setDone(hb.id, date, true);
  });
}

// Press and hold (or right-click) anything that ticks to get the full day sheet: amount, skip, note.
export function holdable(el, onHold) {
  let timer = null; let held = false;
  el.classList.add('holdable');
  el.addEventListener('pointerdown', (e) => {
    held = false;
    if (e.button > 0) return;
    timer = setTimeout(() => {
      held = true; haptic(6); onHold();
      document.dispatchEvent(new Event('scroll')); // cancels the touch-and-hold tooltip that would land on the sheet
    }, 420);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  // Right-click on a laptop; on Android a long press fires this too, after our timer already opened the sheet.
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); if (!held) { held = true; onHold(); } });
  // A hold ends in a click; swallow it so the hold doesn't also tick.
  el.addEventListener('click', (e) => { if (held) { e.stopImmediatePropagation(); e.preventDefault(); held = false; } }, true);
  return el;
}

export function checkButton(hb, date = D.today(), { size = 'md' } = {}) {
  const done = M.isDone(hb.id, date);
  const skipped = M.isSkipped(hb.id, date);
  const v = M.valueOn(hb, date);
  const frac = M.isCount(hb) ? Math.min(1, v / Number(hb.target)) : done ? 1 : 0;
  const popped = pop.key === `${hb.id}|${date}` && Date.now() - pop.at < 700;
  const label = done ? `${hb.name}: done. Tap to undo` : stepsByOne(hb) ? `${hb.name}: add one (${fmtNum(v)} of ${fmtNum(hb.target)})` : `Mark ${hb.name} done`;
  const btn = h('button', {
    type: 'button', class: ['hcheck', size, done && 'on', skipped && 'skip', popped && 'pop'], style: `--hc:${colorOf(hb)};--p:${Math.round(frac * 100)}`,
    'aria-pressed': String(done), 'aria-label': label,
    onclick: (e) => { e.stopPropagation(); tick(hb, date); },
  }, done ? icon('check', size === 'lg' ? 30 : 20) : skipped ? h('span', { class: 'hcheck-txt' }, '–')
    : stepsByOne(hb) && v > 0 ? h('span', { class: 'hcheck-txt' }, fmtNum(v)) : M.isCount(hb) || stepsByOne(hb) ? icon('plus', size === 'lg' ? 26 : 18) : null);
  return holdable(btn, () => daySheet(hb, date));
}

// Emoji in a ring that fills with the habit's strength.
export function bubble(hb, { size = '' } = {}) {
  const p = Math.round(M.strength(hb) * 100);
  return h('span', { class: ['hb-bubble', size], style: `--hc:${colorOf(hb)};--p:${p}`, 'data-tip': `Strength ${p}%` }, h('span', null, hb.emoji || '✅'));
}

// The full day: amount, done, skip and a note — for today or any day in the calendar.
export function daySheet(hb, date) {
  const log = M.habitLog(hb.id, date) || {};
  let value = M.valueOn(hb, date);
  let done = Boolean(log.done);
  let skip = Boolean(log.skip && !log.done);
  const body = h('div', { class: 'form' });
  const note = h('textarea', { rows: 2, placeholder: 'How did it go? (optional)', value: log.note || '' });
  const target = Number(hb.target) || 1;
  const bumps = target <= 20 ? [1, 5] : target <= 200 ? [5, 10, 25] : target <= 2000 ? [50, 100, 250] : [500, 1000, 2000];
  const draw = () => {
    const parts = [];
    if (M.isCount(hb)) {
      const input = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', value, class: 'amount-input', 'aria-label': `Amount in ${hb.unit || 'times'}` });
      input.addEventListener('input', () => { value = Math.max(0, Number(input.value) || 0); skip = false; });
      input.addEventListener('change', draw);
      const set = (x) => { value = Math.max(0, Math.round(x * 100) / 100); skip = false; draw(); };
      parts.push(h('div', { class: 'amount' },
        h('button', { type: 'button', class: 'icon-btn amount-step', 'aria-label': 'Less', onclick: () => set(value - bumps[0]) }, '−'),
        h('div', { class: 'amount-mid' }, input, h('span', { class: 'muted small' }, `of ${fmtNum(target)} ${hb.unit || 'times'}`)),
        h('button', { type: 'button', class: 'icon-btn amount-step', 'aria-label': 'More', onclick: () => set(value + bumps[0]) }, '+')),
      C.meter(value / target),
      h('div', { class: 'chips' }, bumps.map((b) => h('button', { type: 'button', class: 'chip', onclick: () => set(value + b) }, `+${fmtNum(b)}`)),
        h('button', { type: 'button', class: 'chip', onclick: () => set(target) }, `All ${fmtNum(target)}`)));
    } else {
      parts.push(segmented([['done', '✓ Done'], ['no', 'Not done']], done ? 'done' : 'no', (k) => { done = k === 'done'; if (done) skip = false; draw(); }));
    }
    parts.push(h('label', { class: 'toggle-row' },
      h('input', { type: 'checkbox', checked: skip, onchange: (e) => { skip = e.target.checked; if (skip) { done = false; value = 0; } draw(); } }),
      h('span', null, h('b', null, 'Skip this day'), h('span', { class: 'row-sub' }, 'Sick, travelling or resting — it won’t break your streak.'))),
    field('Note', note));
    body.replaceChildren(...parts);
  };
  draw();
  const save = () => {
    change(hb, date, () => {
      if (skip) M.setSkip(hb.id, date, true);
      else if (M.isCount(hb)) M.setValue(hb, date, value);
      else M.setDone(hb.id, date, done);
      if ((note.value || '') !== (log.note || '')) M.setNote(hb.id, date, note.value.trim());
    });
    closeSheet();
  };
  sheet(`${hb.emoji || '✅'} ${hb.name} · ${D.fmtDate(date)}`, body, { actions: [h('button', { class: 'btn primary', onclick: save }, 'Save')] });
}

// A burst of confetti in the habits' colours.
function confetti(n = 60) {
  if (reducedMotion()) return;
  const colors = ['#2a78d6', '#1f9d55', '#e8710a', '#d6409f', '#7c5cd6', '#c99000', '#0e9aa7'];
  const box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  for (let i = 0; i < n; i++) {
    box.append(h('i', { style: `--x:${(Math.random() * 2 - 1) * 46}vw;--y:${-(30 + Math.random() * 50)}vh;--r:${Math.round(Math.random() * 720 - 360)}deg;--d:${(0.9 + Math.random() * 0.8).toFixed(2)}s;--c:${colors[i % colors.length]};left:${45 + Math.random() * 10}%` }));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 2000);
}

// ---- Overview -------------------------------------------------------------------------------------------
function overview() {
  const t = D.today();
  const list = M.habits();
  const head = h('header', { class: 'page-head' }, h('h1', null, 'Habits'),
    h('button', { class: 'btn primary sm', onclick: () => editHabit() }, icon('plus', 16), 'New habit'));

  if (!list.length) return h('div', { class: 'page' }, head, starter(), vicesSection());

  const due = list.filter((hb) => M.scheduledOn(hb, t) || M.isDone(hb.id, t));
  const later = list.filter((hb) => !due.includes(hb));
  return h('div', { class: 'page' }, head,
    todayHero(due, t),
    todayList(due, later, t),
    weekGrid(list, t),
    strengthCard(list, t),
    vicesSection(),
    completionCard(list, t));
}

// First visit: ideas you can add with one tap, a category at a time, plus your own.
let starterCat = 0;
function starter() {
  const [, ideas] = IDEAS[starterCat];
  return h('section', { class: 'card habit-starter' },
    h('div', { class: 'starter-hero' },
      h('span', { class: 'big-emoji' }, '🌱'),
      h('div', null, h('h2', null, 'Build habits that stick'),
        h('p', { class: 'muted' }, 'Start with one or two small ones. Tap an idea to add it — you can change anything later.'))),
    h('div', { class: 'tabs-scroll' }, segmented(IDEAS.map(([n], i) => [i, n]), starterCat, (i) => { starterCat = i; rerenderSoon(); }, { small: true })),
    h('div', { class: 'idea-grid' }, ideas.map((x) => h('button', {
      class: 'idea-card', style: `--hc:${colorOf(x)}`,
      onclick: () => {
        const r = M.addHabit({ ...x });
        haptic();
        toast(`${r.emoji} ${r.name} added`, { label: 'Edit', run: () => editHabit(store.get('habits', r.id)) });
      },
    }, h('span', { class: 'idea-emoji' }, x.emoji), h('span', { class: 'idea-text' }, h('b', null, x.name), h('span', { class: 'row-sub' }, describe(x)))))),
    h('button', { class: 'btn ghost', onclick: () => editHabit() }, icon('plus', 16), 'Create your own'));
}

// Today's progress ring and one line that nudges.
function todayHero(due, t) {
  const done = due.filter((hb) => M.isDone(hb.id, t)).length;
  const total = due.length;
  const left = total - done;
  const perfect = perfectRun(t);
  const atRisk = due.filter((hb) => !M.isDone(hb.id, t) && M.streak(hb, t) >= 3).sort((a, b) => M.streak(b, t) - M.streak(a, t));
  const hour = new Date().getHours();
  const line = !total ? 'Nothing due today. Enjoy the rest.'
    : !left ? `All done for today${perfect > 1 ? ` — ${perfect} perfect days in a row` : ''}. 🎉`
      : !done ? (hour < 12 ? 'Fresh start. Begin with the easiest one.' : hour < 18 ? 'Still time. One tick gets the ball rolling.' : 'The evening counts too — pick one and do it now.')
        : left === 1 ? 'One to go. Finish strong!' : `${left} to go — keep the momentum.`;
  return h('section', { class: 'card habit-hero' },
    ring(total ? done / total : 0, total ? `${done}/${total}` : '–', 'today'),
    h('div', { class: 'habit-hero-text' },
      h('h2', null, !total ? 'Rest day' : !left ? 'Perfect day' : `${done} of ${total} done`),
      h('p', { class: 'muted' }, line),
      atRisk.slice(0, 2).map((hb) => h('button', { class: 'risk', onclick: () => go(hb) },
        `🔥 Keep your ${M.streak(hb, t)}-${M.streakUnit(hb)} ${hb.name} streak alive`, hb.why ? h('span', { class: 'row-sub' }, `“${hb.why}”`) : null))));
}

function ring(frac, label, sub) {
  const r = 42; const c = 2 * Math.PI * r;
  return h('div', { class: 'hring' },
    s('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' },
      s('circle', { cx: 50, cy: 50, r, class: 'hring-track' }),
      s('circle', { cx: 50, cy: 50, r, class: 'hring-fill', 'stroke-dasharray': `${(c * Math.min(1, frac)).toFixed(1)} ${c.toFixed(1)}`, transform: 'rotate(-90 50 50)' })),
    h('span', { class: 'hring-label' }, h('b', null, label), sub ? h('small', null, sub) : null));
}

// Days in a row (ending today, or yesterday if today isn't finished) where every due habit got done.
function perfectRun(t) {
  const list = M.habits().map((hb) => [hb, M.habitStart(hb)]);
  let n = 0;
  for (let i = 0, d = t; i < 366; i++, d = D.addDays(d, -1)) {
    const due = list.filter(([hb, start]) => start <= d && M.scheduledOn(hb, d)).map(([hb]) => hb);
    const ok = due.length > 0 && due.every((hb) => M.isDone(hb.id, d));
    if (ok) n++;
    else if (d !== t) break;
  }
  return n;
}

// Today's habits as big rows, grouped by time of day; ones not due today tuck away underneath.
function todayList(due, later, t) {
  const groups = WHEN.map(([k, label, emoji]) => [k, `${emoji} ${label}`, due.filter((hb) => (hb.when || 'any') === k)]).filter(([, , l]) => l.length);
  const hour = new Date().getHours();
  const now = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const grouped = groups.length > 1 || (groups[0] && groups[0][0] !== 'any');
  return section('Today', h('span', { class: 'muted small' }, 'Tap ✓ · hold for more'),
    due.length ? groups.map(([k, label, l]) => h('div', { class: 'hgroup' },
      grouped ? h('h4', { class: 'sub-head' }, label, k === now ? h('span', { class: 'now-pill' }, 'now') : null) : null,
      l.map((hb) => habitRow(hb, t)))) : h('p', { class: 'empty' }, 'Nothing due today.'),
    later.length ? h('details', { class: 'ideas later' }, h('summary', null, `Not due today (${later.length})`),
      later.map((hb) => habitRow(hb, t))) : null);
}

function habitRow(hb, t) {
  const done = M.isDone(hb.id, t);
  const skipped = M.isSkipped(hb.id, t);
  const st = M.streak(hb, t);
  const unit = M.streakUnit(hb);
  const bits = [];
  if (M.isCount(hb)) bits.push(`${fmtNum(M.valueOn(hb, t))} / ${fmtNum(hb.target)} ${hb.unit || 'times'}`);
  if (M.isWeekly(hb)) bits.push(`${M.weekCount(hb, t)} of ${hb.perWeek} this week`);
  if (skipped) bits.push('Skipped today');
  else if (st) bits.push(`🔥 ${st} ${unit}${st === 1 ? '' : 's'}`);
  else if (!done) {
    const best = M.bestStreak(hb, t);
    bits.push(best > 1 ? `Best: ${best} ${unit}s — start a new run` : 'Start your streak today');
  }
  return h('div', { class: ['hrow', done && 'done', skipped && 'skipped'], style: `--hc:${colorOf(hb)}` },
    h('button', { class: 'hrow-main', onclick: () => go(hb), 'aria-label': `${hb.name}: open trends and history` },
      bubble(hb),
      h('span', { class: 'hrow-text' }, h('b', null, hb.name), h('span', { class: 'row-sub' }, bits.join(' · ')))),
    checkButton(hb, t));
}

function weekGrid(list, t) {
  const week = [...Array(7)].map((_, i) => D.addDays(t, i - 6));
  const grid = h('div', { class: 'habit-grid' },
    h('div', { class: 'hg-row hg-head' }, h('span'),
      week.map((d) => h('span', { class: ['hg-day', d === t && 'is-today'] },
        h('small', null, D.DAY_NAMES[D.weekday(d)].slice(0, 1)), D.parse(d).getDate())),
      h('span', { class: 'hg-stat' }, 'Streak')),
    list.map((hb) => h('div', { class: 'hg-row', style: `--hc:${colorOf(hb)}` },
      h('button', { class: 'hg-name', onclick: () => go(hb) }, h('span', null, hb.emoji || '✅'), h('span', null, hb.name)),
      week.map((d) => {
        const on = M.isDone(hb.id, d);
        const skip = M.isSkipped(hb.id, d);
        const part = !on && M.isCount(hb) && M.valueOn(hb, d) > 0;
        const sched = M.scheduledOn(hb, d);
        const cell = h('button', {
          class: ['hg-cell', on && 'on', part && 'part', skip && 'skip', !sched && !on && !skip && 'rest'], 'aria-pressed': String(on),
          'aria-label': `${hb.name} on ${D.fmtDate(d)}`, style: part ? `--p:${Math.round((M.valueOn(hb, d) / hb.target) * 100)}` : null,
          onclick: () => change(hb, d, () => M.setDone(hb.id, d, !on)),
        }, on ? icon('check', 16) : skip ? '–' : null);
        return holdable(cell, () => daySheet(hb, d));
      }),
      h('span', { class: 'hg-stat' }, `🔥 ${M.streak(hb, t)}${M.isWeekly(hb) ? 'w' : ''}`))));
  return section('This week', h('span', { class: 'muted small' }, 'Tap to tick · hold to skip or add a note'), grid);
}

function strengthCard(list, t) {
  const rows = list.map((hb) => ({ key: hb.id, label: `${hb.emoji || '✅'} ${hb.name}`, value: Math.round(M.strength(hb, t) * 100), hb }))
    .sort((a, b) => b.value - a.value);
  return section('Habit strength', h('span', { class: 'muted small', 'data-tip': 'Like Loop Habit Tracker’s score: it rises with every tick and dips gently when you miss, so one bad day never wipes out your progress.' }, 'What’s this?'),
    C.hbars(rows.map((r) => ({ ...r, sub: strengthWord(r.value / 100), tip: `${r.label}: ${r.value}% strength` })), { fmt: (v) => `${v}%`, onPick: (r) => go(r.hb) }));
}

export function strengthWord(x) {
  return x >= 0.8 ? 'rock solid' : x >= 0.5 ? 'growing' : x >= 0.2 ? 'building' : 'just started';
}

function completionCard(list, t) {
  const days30 = [...Array(30)].map((_, i) => D.addDays(t, i - 29));
  const starts = new Map(list.map((hb) => [hb.id, M.habitStart(hb)]));
  const pts = days30.map((d) => {
    const sched = list.filter((hb) => starts.get(hb.id) <= d && M.scheduledOn(hb, d));
    const done = sched.filter((hb) => M.isDone(hb.id, d)).length;
    const v = sched.length ? Math.round((done / sched.length) * 100) : 0;
    return { label: D.parse(d).getDate(), value: v, tip: `${D.fmtDate(d, { relative: false })}: ${done}/${sched.length} habits (${v}%)` };
  });
  return section('Daily completion · last 30 days', null, C.line(pts, { max: 100, fmt: (v) => `${v}%` }));
}

// ---- One habit ------------------------------------------------------------------------------------------
const ui = { range: '3m', hist: 'week', month: null, habit: null };

function detail(hb) {
  if (ui.habit !== hb.id) Object.assign(ui, { habit: hb.id, month: D.today().slice(0, 7) + '-01' });
  const t = D.today();
  return h('div', { class: 'page habit-detail', style: `--hc:${colorOf(hb)}` },
    h('div', { class: 'detail-nav' },
      h('a', { class: 'btn ghost sm back', href: '#/habits' }, icon('left', 16), 'Habits'),
      h('button', { class: 'btn ghost sm', onclick: () => editHabit(hb) }, 'Edit')),
    h('header', { class: 'habit-title' },
      bubble(hb, { size: 'xl' }),
      h('div', null, h('h1', null, hb.name), h('p', { class: 'muted' }, describe(hb)),
        hb.why ? h('p', { class: 'why' }, `“${hb.why}”`) : null)),
    checkInCard(hb, t),
    overviewCard(hb, t),
    insightCard(hb, t),
    strengthChart(hb, t),
    historyCard(hb, t),
    calendarCard(hb, t),
    h('div', { class: 'grid-2' }, streaksCard(hb, t), weekdayCard(hb, t)),
    yearCard(hb, t),
    notesCard(hb));
}

function checkInCard(hb, t) {
  const done = M.isDone(hb.id, t);
  const skipped = M.isSkipped(hb.id, t);
  const planned = M.scheduledOn(hb, t);
  const v = M.valueOn(hb, t);
  const title = done ? 'Done today ✓' : skipped ? 'Skipped today' : !planned ? 'Not due today' : 'Today';
  const sub = M.isCount(hb) ? `${fmtNum(v)} of ${fmtNum(hb.target)} ${hb.unit || 'times'}`
    : M.isWeekly(hb) ? `${M.weekCount(hb, t)} of ${hb.perWeek} this week`
      : done ? 'Nice work. Tap to undo.' : !planned ? 'You can still tick it — extra days count.' : 'Tap the circle when it’s done.';
  return h('section', { class: ['card', 'checkin', done && 'done'] },
    checkButton(hb, t, { size: 'lg' }),
    h('div', { class: 'checkin-text' }, h('b', null, title), h('span', { class: 'muted' }, sub),
      M.isCount(hb) ? C.meter(v / hb.target) : null),
    h('div', { class: 'checkin-actions' },
      h('button', { class: 'btn ghost sm', onclick: () => daySheet(hb, t) }, M.isCount(hb) ? 'Amount & note' : 'Add note'),
      h('button', { class: 'btn ghost sm', onclick: () => M.setSkip(hb.id, t, !skipped) }, skipped ? 'Unskip' : 'Skip today')));
}

function overviewCard(hb, t) {
  const series = M.strengthSeries(hb, t);
  const now = series.at(-1)?.score || 0;
  const ago = series.length > 30 ? series[series.length - 31].score : 0;
  const diff = Math.round((now - ago) * 100);
  const unit = M.streakUnit(hb);
  const tot = M.habitTotals(hb);
  const rate = M.completionRate(hb, 30, t);
  return h('section', { class: 'card' }, h('div', { class: 'stat-grid' },
    stat('Strength', `${Math.round(now * 100)}%`, h('span', { class: diff > 0 ? 'delta-good' : diff < 0 ? 'delta-bad' : 'muted' }, `${diff > 0 ? '+' : ''}${diff} vs last month`)),
    stat('Current streak', `${M.streak(hb, t)} ${unit}${M.streak(hb, t) === 1 ? '' : 's'}`),
    stat('Best streak', `${M.bestStreak(hb, t)} ${unit}${M.bestStreak(hb, t) === 1 ? '' : 's'}`),
    stat('Last 30 days', rate === null ? '—' : `${Math.round(rate * 100)}%`),
    stat('Times done', fmtNum(tot.days)),
    M.isCount(hb) ? stat(`Total ${hb.unit || ''}`.trim(), fmtNum(tot.amount)) : stat('Since', D.fmtDate(M.habitStart(hb), { relative: false, weekday: false }))));
}

function stat(label, value, extra) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label), extra || null);
}

// A few plain sentences about how it's going.
export function insights(hb, t = D.today()) {
  const out = [];
  const series = M.strengthSeries(hb, t);
  const unit = M.streakUnit(hb);
  const tot = M.habitTotals(hb);
  if (!tot.days) return ['Your first tick starts the story. Small and every day beats big and rarely.'];
  const now = series.at(-1)?.score || 0;
  if (series.length > 14) {
    const ago = series.length > 30 ? series[series.length - 31].score : 0;
    const diff = Math.round((now - ago) * 100);
    out.push(diff >= 5 ? `Strength is up ${diff} points on a month ago — it’s sticking.`
      : diff <= -5 ? `Strength is down ${-diff} points on a month ago. One tick today starts turning it around.`
        : 'Strength is holding steady compared with a month ago.');
  }
  const wd = M.weekdayStats(hb, t).filter((x) => x.planned >= 3);
  if (!M.isWeekly(hb) && wd.length >= 3) {
    const rated = wd.map((x) => ({ ...x, rate: x.done / x.planned })).sort((a, b) => b.rate - a.rate);
    const best = rated[0]; const worst = rated[rated.length - 1];
    if (best.rate - worst.rate >= 0.2) out.push(`You’re most reliable on ${D.DAY_NAMES[best.day]}s (${Math.round(best.rate * 100)}%) and least on ${D.DAY_NAMES[worst.day]}s (${Math.round(worst.rate * 100)}%).`);
  } else if (M.isWeekly(hb)) {
    const all = M.weekdayStats(hb, t).sort((a, b) => b.done - a.done);
    if (all[0].done >= 3) out.push(`${D.DAY_NAMES[all[0].day]} is your go-to day for this.`);
  }
  out.push(`Done ${tot.days} time${tot.days === 1 ? '' : 's'} since ${D.fmtDate(M.habitStart(hb), { relative: false, weekday: false })}${M.isCount(hb) ? ` — ${fmtNum(tot.amount)} ${hb.unit || 'times'} in all` : ''}.`);
  const st = M.streak(hb, t);
  const next = Object.keys(MILESTONES).map(Number).find((n) => n > st);
  if (st && next) out.push(`${next - st} more ${unit}${next - st === 1 ? '' : 's'} to a ${next}-${unit} streak.`);
  return out;
}

function insightCard(hb, t) {
  return section('How it’s going', null, h('ul', { class: 'insights' }, insights(hb, t).map((x) => h('li', null, x))));
}

function strengthChart(hb, t) {
  const map = new Map(M.strengthSeries(hb, t).map((p) => [p.date, p.score]));
  const [days, step] = { '1m': [30, 1], '3m': [90, 1], '1y': [364, 7] }[ui.range];
  const pts = [];
  for (let i = 0; i <= days; i += step) {
    const d = D.addDays(t, -i);
    const v = Math.round((map.get(d) ?? 0) * 100);
    pts.unshift({ label: step === 7 ? D.MONTH_NAMES[D.parse(d).getMonth()].slice(0, 3) : D.parse(d).getDate(), value: v, tip: `${D.fmtDate(d, { relative: false })}: ${v}%` });
  }
  return section('Strength', segmented([['1m', '1M'], ['3m', '3M'], ['1y', '1Y']], ui.range, (r) => { ui.range = r; rerenderSoon(); }, { small: true }),
    C.line(pts, { max: 100, fmt: (v) => `${v}%`, labelEvery: step === 7 ? 9 : 7 }));
}

function historyCard(hb, t) {
  const unit = ui.hist;
  const rows = M.habitHistory(hb, unit, 12, t);
  const target = M.isCount(hb) ? Number(hb.target) : 1;
  const perPeriod = M.isWeekly(hb) ? Number(hb.perWeek) * (unit === 'month' ? 4.35 : 1) : M.planDays(hb).length * (unit === 'month' ? 4.35 : 1);
  const goal = Math.round(perPeriod * target);
  const fmtV = (v) => fmtNum(Math.round(v));
  const data = rows.map((r) => ({
    label: unit === 'month' ? D.MONTH_NAMES[D.parse(r.from).getMonth()].slice(0, 3) : D.parse(r.from).getDate(),
    value: r.value, highlight: r.to >= t,
    tip: `${unit === 'month' ? D.MONTH_NAMES[D.parse(r.from).getMonth()] : `Week of ${D.fmtDate(r.from, { relative: false })}`}: ${fmtV(r.value)} ${M.isCount(hb) ? hb.unit || 'times' : `day${r.value === 1 ? '' : 's'}`}`,
  }));
  return section('History', segmented([['week', 'Weeks'], ['month', 'Months']], unit, (u) => { ui.hist = u; rerenderSoon(); }, { small: true }),
    C.columns(data, { fmt: fmtV, avg: goal, avgLabel: `Goal: about ${fmtV(goal)} ${M.isCount(hb) ? hb.unit || 'times' : 'days'} a ${unit}` }));
}

// The month, filled in. Tap a day to tick it (then skip, then clear); hold for amount and notes.
function calendarCard(hb, t) {
  const month = ui.month;
  const start = M.habitStart(hb);
  const m = D.parse(month).getMonth();
  const weeks = D.monthMatrix(month, store.pref('weekStart', 1));
  const order = store.pref('weekStart', 1) === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const nav = h('div', { class: 'cal-nav-sm' },
    h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => { ui.month = D.addMonths(month, -1); rerenderSoon(); } }, icon('left', 18)),
    h('b', null, `${D.MONTH_NAMES[m]} ${D.parse(month).getFullYear()}`),
    h('button', { class: 'icon-btn', 'aria-label': 'Next month', disabled: D.addMonths(month, 1) > t, onclick: () => { ui.month = D.addMonths(month, 1); rerenderSoon(); } }, icon('right', 18)));
  const cells = weeks.flat().map((d) => {
    const inMonth = D.parse(d).getMonth() === m;
    const on = M.isDone(hb.id, d);
    const skip = M.isSkipped(hb.id, d);
    const v = M.valueOn(hb, d);
    const part = !on && M.isCount(hb) && v > 0;
    const planned = M.isWeekly(hb) || M.planDays(hb).includes(D.weekday(d));
    const future = d > t;
    const state = on ? 'done' : skip ? 'skipped' : part ? `${fmtNum(v)} ${hb.unit || ''}` : future ? '' : d < start ? 'before you started' : planned && d < t ? 'missed' : planned ? 'to do' : 'rest day';
    const cell = h('button', {
      class: ['hc-day', !inMonth && 'out', on && 'on', part && 'part', skip && 'skip', !on && !skip && !part && d < t && d >= start && planned && !M.isWeekly(hb) && 'miss', !planned && 'rest', d === t && 'today'],
      style: part ? `--p:${Math.round((v / hb.target) * 100)}` : null,
      disabled: future, 'data-tip': `${D.fmtDate(d, { relative: false })}${state ? `: ${state}` : ''}`, 'aria-label': `${D.fmtDate(d, { relative: false })}${state ? `, ${state}` : ''}`,
      onclick: () => {
        if (M.isCount(hb)) { daySheet(hb, d); return; }
        if (on) M.setSkip(hb.id, d, true);
        else if (skip) M.setSkip(hb.id, d, false);
        else change(hb, d, () => M.setDone(hb.id, d, true));
      },
    }, D.parse(d).getDate());
    return holdable(cell, () => daySheet(hb, d));
  });
  return section('Calendar', nav,
    h('div', { class: 'hc-grid' }, order.map((d) => h('span', { class: 'hc-dow' }, D.DAY_NAMES[d].slice(0, 1))), cells),
    h('div', { class: 'legend small muted' },
      h('span', null, h('i', { class: 'lg on' }), 'Done'), M.isCount(hb) ? h('span', null, h('i', { class: 'lg part' }), 'Partly') : null,
      h('span', null, h('i', { class: 'lg skip' }), 'Skipped'), h('span', null, h('i', { class: 'lg miss' }), 'Missed')),
    h('p', { class: 'small muted' }, M.isCount(hb) ? 'Tap a day to fill in the amount.' : 'Tap a day: done → skipped → clear. Hold for a note.'));
}

function yearCard(hb, t) {
  const weeks = 53;
  const start = D.addDays(t, -(weeks * 7 - 1));
  const first = D.addDays(start, -((D.weekday(start) - store.pref('weekStart', 1) + 7) % 7));
  const hs = M.habitStart(hb);
  const cells = [];
  for (let d = first; d <= t; d = D.addDays(d, 1)) {
    const on = M.isDone(hb.id, d);
    const frac = M.isCount(hb) ? Math.min(1, M.valueOn(hb, d) / hb.target) : on ? 1 : 0;
    const planned = d >= hs && (M.isWeekly(hb) || M.planDays(hb).includes(D.weekday(d))) && !M.isSkipped(hb.id, d);
    const level = on ? 4 : frac > 0 ? Math.max(1, Math.ceil(frac * 3)) : planned ? 0 : null;
    cells.push({ date: d, today: d === t, level, tip: `${D.fmtDate(d, { relative: false })}: ${on ? 'done' : frac ? `${Math.round(frac * 100)}%` : M.isSkipped(hb.id, d) ? 'skipped' : planned ? 'not done' : 'rest day'}` });
  }
  return section('Past year', null, h('div', { class: 'year-scroll' }, C.heatmap(cells)));
}

function streaksCard(hb, t) {
  const unit = M.streakUnit(hb);
  const runs = M.streakRuns(hb, t).sort((a, b) => b.n - a.n || b.to.localeCompare(a.to)).slice(0, 5);
  const span = (r) => `${D.fmtDate(r.from, { relative: false, weekday: false })} – ${r.to === t ? 'now' : D.fmtDate(r.to, { relative: false, weekday: false })}`;
  return section('Best streaks', null, runs.length
    ? C.hbars(runs.map((r, i) => ({ key: i, label: span(r), value: r.n, tip: `${r.n} ${unit}${r.n === 1 ? '' : 's'} · ${span(r)}` })), { fmt: (v) => `${v}${unit === 'week' ? 'w' : 'd'}` })
    : h('p', { class: 'empty' }, 'Your streaks will show up here.'));
}

function weekdayCard(hb, t) {
  const order = store.pref('weekStart', 1) === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const stats = M.weekdayStats(hb, t);
  const weekly = M.isWeekly(hb);
  const data = order.map((d) => {
    const x = stats[d];
    const value = weekly ? x.done : x.planned ? Math.round((x.done / x.planned) * 100) : 0;
    return { label: D.DAY_NAMES[d].slice(0, 2), value, tip: weekly ? `${D.DAY_NAMES[d]}: done ${x.done}×` : `${D.DAY_NAMES[d]}: ${x.done}/${x.planned} (${value}%)` };
  });
  const top = Math.max(...data.map((x) => x.value));
  data.forEach((x) => { x.highlight = top > 0 && x.value === top; });
  return section(weekly ? 'Which days you do it' : 'By day of the week', null, C.columns(data, { fmt: weekly ? String : (v) => `${v}%`, height: 110 }));
}

function notesCard(hb) {
  const notes = M.habitNotes(hb);
  if (!notes.length) return null;
  return section('Notes', h('span', { class: 'count' }, notes.length),
    h('ul', { class: 'list compact' }, notes.slice(0, 30).map((l) => h('li', { class: 'row', onclick: () => daySheet(hb, l.date) },
      h('div', { class: 'row-main' }, h('span', null, l.note), h('span', { class: 'row-sub' }, `${D.fmtDate(l.date)}${l.done ? ' · ✓' : l.skip ? ' · skipped' : ''}`))))));
}

// Local view state (chart range, month) changed: redraw without touching data.
const rerenderSoon = () => redraw();

// ---- Habits to break --------------------------------------------------------------------------------------
function vicesSection() {
  const list = V.vices();
  const t = D.today();
  const mult = SEVERITY[store.pref('penaltyLevel', 'normal')] ?? 1;
  const days = [...Array(14)].map((_, i) => D.addDays(t, i - 13));
  return section('Habits to break', h('button', { class: 'btn ghost sm', onclick: () => editVice() }, icon('plus', 16), 'Add'),
    list.length ? h('div', { class: 'vice-list' }, list.map((v) => {
      const clean = V.cleanStreak(v, t);
      const slips = V.slipsFor(v.id);
      const slipDays = new Set(slips.map((x) => x.date));
      const todaySlips = slips.filter((x) => x.date === t).length;
      return h('div', { class: 'vice' },
        h('button', { class: 'vice-name', onclick: () => editVice(v) }, h('span', { class: 'habit-emoji' }, v.emoji || '🚫'),
          h('span', null, h('b', null, v.name), h('span', { class: 'row-sub' }, clean ? `Clean for ${clean} day${clean === 1 ? '' : 's'} · best ${V.bestClean(v, t)}` : `Slipped today${todaySlips > 1 ? ` (${todaySlips}×)` : ''}`))),
        h('div', { class: 'vice-dots', 'aria-label': 'Last 14 days' }, days.map((d) => h('i', { class: slipDays.has(d) ? 'slip' : d < V.startDate(v) ? 'na' : 'ok', 'data-tip': `${D.fmtDate(d, { relative: false })}: ${slipDays.has(d) ? 'slipped' : d < V.startDate(v) ? 'not tracked' : 'clean'}` }))),
        h('button', { class: 'btn slip-btn sm', onclick: () => {
          const r = V.logSlip(v);
          toast(`Logged a slip · −${Math.round((v.penalty || 10) * mult)} XP`, { label: 'Undo', run: () => store.remove('slips', r.id) });
        } }, 'I slipped'));
    })) : h('div', null,
      h('p', { class: 'small muted' }, 'Things you want to do less. Each slip costs XP; every clean day earns +2.'),
      h('details', { class: 'ideas' }, h('summary', null, 'Show ideas'),
        h('div', { class: 'chips' }, V.SUGGESTIONS.map(([emoji, name, penalty, attr]) => h('button', { class: 'chip', onclick: () => store.put('vices', { name, emoji, penalty, attr }) }, `${emoji} ${name}`))))));
}

function editVice(v = null) {
  const draft = v ? { ...v } : { name: '', emoji: '🚫', penalty: 10, attr: 'dis' };
  const name = h('input', { value: draft.name, placeholder: 'e.g. Doomscrolling after midnight' });
  const emoji = h('input', { value: draft.emoji, class: 'short', maxlength: 4 });
  const attr = h('select', null, Object.entries(ATTRS).map(([k, a]) => h('option', { value: k, selected: k === draft.attr }, `${a.emoji} ${a.name}`)));
  let penalty = draft.penalty;
  const pen = h('div');
  const drawPen = () => pen.replaceChildren(segmented(V.PENALTIES.map(([n, l]) => [n, `${l} −${n}`]), penalty, (x) => { penalty = x; drawPen(); }, { small: true }));
  drawPen();
  const save = () => {
    if (!name.value.trim()) { name.focus(); return; }
    store.put('vices', { ...draft, name: name.value.trim(), emoji: emoji.value.trim() || '🚫', penalty, attr: attr.value });
    closeSheet();
  };
  const actions = [h('button', { class: 'btn primary', onclick: save }, 'Save')];
  if (v) {
    actions.unshift(h('button', { class: 'btn ghost', onclick: () => {
      const r = store.put('slips', { vice: v.id, date: D.addDays(D.today(), -1), note: '', ts: Date.now() });
      closeSheet(); toast('Logged a slip for yesterday', { label: 'Undo', run: () => store.remove('slips', r.id) });
    } }, 'Slipped yesterday'));
    actions.unshift(h('button', { class: 'btn danger ghost', onclick: () => { store.put('vices', { ...v, archived: true }); closeSheet(); toast('Stopped tracking', { label: 'Undo', run: () => store.put('vices', { ...v, archived: false }) }); } }, 'Stop tracking'));
  }
  sheet(v ? 'Habit to break' : 'New habit to break', h('div', { class: 'form' },
    h('div', { class: 'row2 name-emoji' }, field('Name', name), field('Emoji', emoji)),
    field('XP lost per slip', pen), field('Which attribute it hurts', attr),
    h('p', { class: 'muted small' }, 'Every day without a slip earns +2 XP, so clean streaks pay off.')), { actions });
}
