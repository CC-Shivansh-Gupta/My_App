// Goals: monthly, yearly and life goals. Each goal is tracked as a simple
// done/not-done, a list of milestones, or a number towards a target, and can
// support a bigger goal (month → year → life).

import * as store from '../store.js';
import { shareButton } from '../share.js';
import * as D from '../dates.js';
import { h, icon, section, empty, segmented, toast, sheet, closeSheet, field, checkbox, quickInput, removeWithUndo } from '../ui.js';
import * as C from '../charts.js';

export const AREAS = [['Health', '💪'], ['Career', '💼'], ['Money', '💰'], ['Learning', '📚'], ['Relationships', '❤️'],
  ['Personal', '🌱'], ['Fun', '🎉'], ['Travel', '✈️'], ['Other', '⭐']];
const HORIZONS = [['month', 'Month'], ['year', 'Year'], ['life', 'Life']];

let horizon = 'month';
let monthCursor = null; // "YYYY-MM"
let yearCursor = null;  // "YYYY"
let rerender = () => {};

export function areaEmoji(a) {
  return AREAS.find(([n]) => n === a)?.[1] || '⭐';
}

// 0..1
export function progress(g) {
  if (g.status === 'done') return 1;
  if (g.mode === 'number') return g.target ? Math.min(1, Math.max(0, (Number(g.current) || 0) / g.target)) : 0;
  if (g.mode === 'milestones') {
    const ms = g.milestones || [];
    return ms.length ? ms.filter((m) => m.done).length / ms.length : 0;
  }
  return 0;
}

export function goalsFor(hz, period) {
  return store.all('goals').filter((g) => g.horizon === hz && (hz === 'life' || g.period === period))
    .sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
}

export function currentPeriod(hz) {
  const t = D.today();
  return hz === 'month' ? t.slice(0, 7) : hz === 'year' ? t.slice(0, 4) : null;
}

// Pull "24 books" out of "Read 24 books" to make a number goal.
export function parseGoalText(text) {
  const m = text.match(/\b(\d{1,3}(?:,\d{3})+|\d+(?:[.,]\d+)?)\s*(k|km|kms|kg|kgs|books?|pages?|workouts?|runs?|times|days|hours?|lakhs?|%|[a-z]+)?\b/i);
  if (!m) return { title: text.trim(), mode: 'check' };
  let target = Number(m[1].replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  let unit = (m[2] || '').toLowerCase();
  if (unit === 'k') { target *= 1000; unit = ''; }
  return { title: text.trim(), mode: 'number', target, current: 0, unit };
}

export function addGoal({ title, horizon: hz = 'month', period, area = 'Personal', parent = null, mode, target, unit }) {
  const parsed = mode ? { mode, target, unit, current: 0 } : parseGoalText(title);
  return store.put('goals', {
    title: title.trim(), horizon: hz, period: hz === 'life' ? null : period || currentPeriod(hz), area, parent,
    status: 'active', notes: '', milestones: [], mode: parsed.mode, target: parsed.target ?? null, current: parsed.current ?? 0, unit: parsed.unit ?? '',
  });
}

function setStatus(g, status) {
  store.put('goals', { ...g, status, doneAt: status === 'done' ? Date.now() : null });
  if (status === 'done') toast(`Goal achieved: ${g.title} 🎉`, { label: 'Undo', run: () => store.put('goals', g) });
}

// ---- View ----------------------------------------------------------------------------------------------------
export function render(ctx) {
  rerender = ctx.rerender;
  const t = D.today();
  monthCursor = monthCursor || t.slice(0, 7);
  yearCursor = yearCursor || t.slice(0, 4);
  const period = horizon === 'month' ? monthCursor : horizon === 'year' ? yearCursor : null;
  const list = goalsFor(horizon, period);
  const done = list.filter((g) => g.status === 'done').length;
  const active = list.filter((g) => g.status !== 'dropped');

  const nav = horizon === 'life' ? null : h('div', { class: 'day-nav' },
    h('button', { class: 'icon-btn', 'aria-label': 'Previous', onclick: () => step(-1) }, icon('left')),
    period !== currentPeriod(horizon) ? h('button', { class: 'btn ghost sm', onclick: () => { monthCursor = null; yearCursor = null; ctx.rerender(); } }, horizon === 'month' ? 'This month' : 'This year') : null,
    h('button', { class: 'icon-btn', 'aria-label': 'Next', onclick: () => step(1) }, icon('right')));

  const label = horizon === 'month' ? `${D.MONTH_NAMES[Number(monthCursor.slice(5)) - 1]} ${monthCursor.slice(0, 4)}` : horizon === 'year' ? yearCursor : 'Life goals';
  const avg = active.length ? active.reduce((s, g) => s + progress(g), 0) / active.length : 0;

  // Unfinished goals from the previous month/year that could be carried over.
  const prevPeriod = horizon === 'month' ? D.addMonths(`${monthCursor}-01`, -1).slice(0, 7) : horizon === 'year' ? String(Number(yearCursor) - 1) : null;
  const leftovers = prevPeriod && period === currentPeriod(horizon) ? goalsFor(horizon, prevPeriod).filter((g) => g.status === 'active') : [];

  const byArea = horizon === 'life';
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', null, 'Goals'), segmented(HORIZONS, horizon, (v) => { horizon = v; ctx.rerender(); }, { small: true })),
    h('section', { class: 'card goal-hero' },
      h('div', { class: 'card-head' }, h('h3', null, label), nav),
      active.length ? h('div', { class: 'goal-summary' },
        h('span', { class: 'hero-value sm' }, `${Math.round(avg * 100)}%`),
        h('span', { class: 'muted small' }, `${done} of ${active.length} achieved`),
        C.meter(avg)) : null,
      quickInput(horizon === 'life' ? 'Add a life goal — e.g. “Run a marathon”' : horizon === 'year' ? 'Add a goal for the year — e.g. “Read 24 books”' : 'Add a goal for the month — e.g. “Save 20,000”', (v) => {
        addGoal({ title: v, horizon, period });
      }, { key: `goal-add-${horizon}` }),
      h('p', { class: 'muted small' }, 'Tip: include a number (“Run 50 km”) to track progress towards it. Tap a goal for milestones, area and more.')),
    leftovers.length ? h('div', { class: 'sub-block carry' },
      h('div', { class: 'sub-head-row' },
        h('p', { class: 'sub-head' }, `${leftovers.length} unfinished from ${horizon === 'month' ? 'last month' : 'last year'}`),
        h('button', { class: 'btn ghost sm', onclick: () => {
          leftovers.forEach((g) => store.put('goals', { ...g, period }));
          toast(`Carried ${leftovers.length} over`);
        } }, 'Carry over')),
      h('p', { class: 'small' }, leftovers.map((g) => g.title).join(' · '))) : null,
    list.length
      ? byArea
        ? AREAS.filter(([a]) => list.some((g) => g.area === a)).map(([a, e]) => h('div', { class: 'group' },
            h('p', { class: 'sub-head' }, `${e} ${a}`), h('div', { class: 'goal-grid' }, list.filter((g) => g.area === a).map(goalCard))))
        : h('div', { class: 'goal-grid' }, list.map(goalCard))
      : section('', null, empty(horizon === 'life' ? 'What do you want to do in your life? Big dreams go here.' : 'No goals yet for this period.')));
}

function step(n) {
  if (horizon === 'month') monthCursor = D.addMonths(`${monthCursor}-01`, n).slice(0, 7);
  else yearCursor = String(Number(yearCursor) + n);
  rerender();
}

function goalCard(g) {
  const p = progress(g);
  const parent = g.parent ? store.get('goals', g.parent) : null;
  const children = store.all('goals').filter((c) => c.parent === g.id);
  const ms = g.milestones || [];
  return h('article', { class: ['card', 'goal-card', g.status === 'done' && 'done', g.status === 'dropped' && 'dropped'] },
    h('div', { class: 'goal-top' },
      g.mode !== 'number' || g.status === 'done' ? checkbox(g.status === 'done', (v) => setStatus(g, v ? 'done' : 'active'), 'Achieved') : null,
      h('button', { class: 'goal-title', onclick: () => editGoal(g) },
        h('span', null, g.title),
        h('span', { class: 'row-sub' }, [`${areaEmoji(g.area)} ${g.area}`, parent ? `↑ ${parent.title}` : '', children.length ? `${children.length} supporting` : ''].filter(Boolean).join(' · ')))),
    g.mode === 'number' ? h('div', { class: 'goal-num' },
      h('span', { class: 'goal-count' }, `${fmt(g.current)} / ${fmt(g.target)} ${g.unit || ''}`),
      g.status !== 'done' ? h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost xs', onclick: () => bump(g, -1) }, '−1'),
        h('button', { class: 'btn ghost xs', onclick: () => bump(g, 1) }, '+1'),
        h('button', { class: 'btn ghost xs', onclick: () => setValue(g) }, 'Set')) : null) : null,
    g.mode !== 'check' ? C.meter(p, { state: g.status === 'done' ? 'ok' : 'ok' }) : null,
    ms.length ? h('ul', { class: 'milestones' }, ms.map((m, i) => h('li', { class: m.done ? 'done' : '' },
      checkbox(m.done, (v) => toggleMilestone(g, i, v), 'Milestone done'), h('span', null, m.text)))) : null);
}

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function bump(g, d) {
  const current = Math.max(0, (Number(g.current) || 0) + d);
  const next = { ...g, current };
  store.put('goals', next);
  if (g.target && current >= g.target && g.status !== 'done') setStatus(next, 'done');
}

function setValue(g) {
  const inp = h('input', { inputmode: 'decimal', value: g.current || '', autofocus: true });
  const save = () => {
    const current = Number(inp.value) || 0;
    store.put('goals', { ...g, current });
    closeSheet();
    if (g.target && current >= g.target && g.status !== 'done') setStatus({ ...g, current }, 'done');
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  sheet(g.title, field(`Progress${g.unit ? ` (${g.unit})` : ''} — target ${fmt(g.target)}`, inp), { actions: [h('button', { class: 'btn primary', onclick: save }, 'Save')] });
}

function toggleMilestone(g, i, v) {
  const milestones = (g.milestones || []).map((m, j) => (j === i ? { ...m, done: v } : m));
  const next = { ...g, milestones };
  store.put('goals', next);
  if (v && milestones.every((m) => m.done) && g.status !== 'done') setStatus(next, 'done');
}

// ---- Editor --------------------------------------------------------------------------------------------------------
export function editGoal(g) {
  const draft = structuredClone(g);
  draft.milestones = draft.milestones || [];
  const title = h('input', { value: draft.title });
  const area = h('select', null, AREAS.map(([a, e]) => h('option', { value: a, selected: a === draft.area }, `${e} ${a}`)));
  const hz = h('select', null, HORIZONS.map(([k, l]) => h('option', { value: k, selected: k === draft.horizon }, l)));
  const periodIn = h('input', { value: draft.period || '', type: draft.horizon === 'month' ? 'month' : 'number', placeholder: draft.horizon === 'year' ? 'YYYY' : '' });
  const parentOptions = () => {
    const up = draft.horizon === 'month' ? 'year' : draft.horizon === 'year' ? 'life' : null;
    return up ? store.all('goals').filter((x) => x.horizon === up && x.status !== 'dropped' && x.id !== draft.id) : [];
  };
  const parent = h('select');
  const fillParents = () => parent.replaceChildren(h('option', { value: '' }, '— none —'), ...parentOptions().map((x) => h('option', { value: x.id, selected: x.id === draft.parent }, `${areaEmoji(x.area)} ${x.title}${x.period ? ` (${x.period})` : ''}`)));
  fillParents();
  const mode = h('select', null, [['check', 'Done / not done'], ['milestones', 'Milestones'], ['number', 'Number towards a target']].map(([k, l]) => h('option', { value: k, selected: k === draft.mode }, l)));
  const target = h('input', { inputmode: 'decimal', value: draft.target ?? '', placeholder: 'e.g. 24' });
  const current = h('input', { inputmode: 'decimal', value: draft.current ?? 0 });
  const unit = h('input', { value: draft.unit || '', placeholder: 'e.g. books, km' });
  const numberRow = h('div', { class: 'row3' }, field('Current', current), field('Target', target), field('Unit', unit));
  const msList = h('ul', { class: 'milestones edit' });
  const msInput = h('input', { placeholder: 'Add a milestone and press Enter' });
  const drawMs = () => msList.replaceChildren(...draft.milestones.map((m, i) => h('li', null,
    checkbox(m.done, (v) => { m.done = v; drawMs(); }), h('span', null, m.text),
    h('button', { class: 'icon-btn sm', 'aria-label': 'Remove milestone', onclick: () => { draft.milestones.splice(i, 1); drawMs(); } }, icon('close', 14)))));
  msInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && msInput.value.trim()) { e.preventDefault(); draft.milestones.push({ text: msInput.value.trim(), done: false }); msInput.value = ''; drawMs(); }
  });
  drawMs();
  const msBlock = h('div', { class: 'form' }, msList, msInput);
  const notes = h('textarea', { rows: 3, placeholder: 'Why does this matter? How will you get there?' }, draft.notes || '');
  const sync = () => {
    numberRow.style.display = mode.value === 'number' ? '' : 'none';
    msBlock.style.display = mode.value === 'milestones' ? '' : 'none';
    periodField.style.display = hz.value === 'life' ? 'none' : '';
    periodIn.type = hz.value === 'month' ? 'month' : 'number';
  };
  const periodField = field(hz.value === 'year' ? 'Year' : 'Month', periodIn);
  hz.addEventListener('change', () => {
    draft.horizon = hz.value;
    periodIn.value = currentPeriod(hz.value) || '';
    draft.parent = null; fillParents(); sync();
  });
  mode.addEventListener('change', sync);

  const save = () => {
    if (!title.value.trim()) { title.focus(); return; }
    const m = mode.value;
    store.put('goals', {
      ...draft, title: title.value.trim(), area: area.value, horizon: hz.value,
      period: hz.value === 'life' ? null : (periodIn.value || currentPeriod(hz.value)).slice(0, hz.value === 'month' ? 7 : 4),
      parent: parent.value || null, mode: m, notes: notes.value,
      target: m === 'number' ? Number(target.value) || null : draft.target, current: m === 'number' ? Number(current.value) || 0 : draft.current,
      unit: unit.value.trim(), milestones: draft.milestones,
    });
    closeSheet();
  };
  sheet('Goal', h('div', { class: 'form' },
    title,
    h('div', { class: 'row2' }, field('Area', area), field('Timeframe', hz)),
    periodField,
    field('Supports a bigger goal', parent),
    field('Track progress as', mode), numberRow, msBlock, notes), {
    actions: [
      h('button', { class: 'btn danger ghost', onclick: () => { closeSheet(); removeWithUndo('goals', g.id, 'Goal deleted'); } }, icon('trash', 18), 'Delete'),
      h('button', { class: 'btn ghost', onclick: () => { store.put('goals', { ...g, status: g.status === 'dropped' ? 'active' : 'dropped' }); closeSheet(); } }, g.status === 'dropped' ? 'Restore' : 'Drop'),
      shareButton(() => ({ type: g.status === 'done' ? 'goalDone' : 'goal', title: title.value.trim(), body: `${areaEmoji(area.value)} ${area.value} · ${hz.value === 'life' ? 'Life goal' : hz.value === 'year' ? `Goal for ${periodIn.value || currentPeriod('year')}` : 'Goal for this month'}` })),
      h('button', { class: 'btn primary', onclick: save }, 'Save'),
    ],
  });
  sync();
}

// Compact card for the Today screen: this month's goals.
export function todayCard() {
  const list = goalsFor('month', currentPeriod('month')).filter((g) => g.status === 'active');
  if (!list.length) return null;
  return section('Goals this month', h('a', { class: 'btn ghost sm', href: '#/goals' }, 'All'),
    h('ul', { class: 'list compact' }, list.slice(0, 4).map((g) => h('li', { class: 'row', onclick: () => { location.hash = '#/goals'; } },
      h('span', { class: 'row-emoji' }, areaEmoji(g.area)),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, g.title), h('span', { class: 'progress' }, h('span', { style: { width: `${progress(g) * 100}%` } }))),
      h('span', { class: 'row-sub' }, `${Math.round(progress(g) * 100)}%`)))));
}
