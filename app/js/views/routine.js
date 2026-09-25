// Routine: your ideal day as time blocks per weekday. See what you should be
// doing now, a weekly time table, how your week's hours add up, and tick off
// the blocks you actually followed.

import * as store from '../store.js';
import * as D from '../dates.js';
import { h, icon, section, empty, segmented, toast, sheet, closeSheet, field, checkbox } from '../ui.js';
import * as C from '../charts.js';

export const CATS = [
  ['sleep', 'Sleep', '😴'], ['work', 'Work', '💼'], ['exercise', 'Exercise', '🏃'], ['learning', 'Learning', '📚'],
  ['meals', 'Meals', '🍽️'], ['mind', 'Mindfulness', '🧘'], ['personal', 'Personal', '🌱'], ['family', 'Family & friends', '❤️'],
  ['commute', 'Commute', '🚌'], ['fun', 'Fun', '🎮'], ['chores', 'Chores', '🧺'], ['other', 'Other', '⭐'],
];
const catOf = (k) => CATS.find(([id]) => id === k) || CATS[CATS.length - 1];

let tab = 'today';
let viewDay = null;
let rerender = () => {};

// ---- Model -------------------------------------------------------------------------------------------------
const mins = (hhmm) => { const [hh, mm] = (hhmm || '0:0').split(':').map(Number); return hh * 60 + mm; };
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function blocks() {
  return store.all('routine').sort((a, b) => mins(a.start) - mins(b.start));
}

// Segments of the day `date`: [{block, from, to}] in minutes 0..1440 (splits blocks that cross midnight).
export function segmentsOn(date) {
  const wd = D.weekday(date);
  const prevWd = (wd + 6) % 7;
  const out = [];
  for (const b of blocks()) {
    const s = mins(b.start); let e = mins(b.end);
    const wraps = e <= s;
    if (b.days.includes(wd)) out.push({ block: b, from: s, to: wraps ? 1440 : e });
    if (wraps && b.days.includes(prevWd) && e > 0) out.push({ block: b, from: 0, to: e, carry: true });
  }
  return out.sort((a, b) => a.from - b.from);
}

export function nowAndNext(date = D.today(), minute = new Date().getHours() * 60 + new Date().getMinutes()) {
  const segs = segmentsOn(date);
  const now = segs.find((s) => s.from <= minute && minute < s.to) || null;
  const next = segs.find((s) => s.from > minute) || null;
  return { now, next, minute };
}

const logId = (b, date) => `${b.id}|${date}`;
export function followed(b, date) { return Boolean(store.get('routineLogs', logId(b, date))?.done); }
function setFollowed(b, date, done) { store.put('routineLogs', { id: logId(b, date), block: b.id, date, done }); }

function durationMin(b) {
  const s = mins(b.start); const e = mins(b.end);
  return e > s ? e - s : 1440 - s + e;
}

export function weeklyHours() {
  const byCat = {};
  for (const b of blocks()) byCat[b.category] = (byCat[b.category] || 0) + (durationMin(b) * b.days.length) / 60;
  return Object.entries(byCat).sort((a, b) => b[1] - a[1]);
}

function overlaps() {
  const out = [];
  for (let wd = 0; wd < 7; wd++) {
    const date = D.addDays('2026-01-04', wd); // a Sunday + wd
    const segs = segmentsOn(date);
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      if (segs[j].from < segs[i].to && segs[i].block.id !== segs[j].block.id) out.push([wd, segs[i].block, segs[j].block]);
    }
  }
  return out;
}

// ---- Day tracker (what you actually did) -------------------------------------------------------------------
const CAT_WORDS = {
  sleep: /\b(sleep|slept|nap|bed)\b/i, work: /\b(work|worked|working|meetings?|office|emails?|calls?|deep work|coding|code|slides|report|standup)\b/i,
  exercise: /\b(gym|workout|run|ran|running|walk|yoga|exercise|sport|swim|cycle|cycling|cricket|football)\b/i,
  learning: /\b(study|studied|learn|learning|course|class|lecture|read|reading|revision)\b/i,
  meals: /\b(breakfast|lunch|dinner|eat|ate|meal|snack|cook|cooking)\b/i, mind: /\b(meditat\w*|journal\w*|pray\w*)\b/i,
  family: /\b(family|friends?|mom|dad|date|kids?|partner|call home)\b/i, commute: /\b(commute|drive|drove|travel|bus|metro|train|uber|cab)\b/i,
  fun: /\b(tv|netflix|movie|game|gaming|youtube|social media|instagram|scroll\w*|party|chill\w*)\b/i,
  chores: /\b(chores?|clean\w*|laundry|groceries|shopping|errands?|dishes)\b/i, personal: /\b(shower|get ready|getting ready|personal|self care)\b/i,
};

export function guessCategory(text) {
  for (const [k, re] of Object.entries(CAT_WORDS)) if (re.test(text)) return k;
  // Fall back to a routine block with a similar title.
  const b = blocks().find((x) => text.toLowerCase().includes(x.title.toLowerCase()) || x.title.toLowerCase().includes(text.toLowerCase()));
  return b ? b.category : 'other';
}

const nowHM = () => { const d = new Date(); return hhmm(d.getHours() * 60 + d.getMinutes()); };

export function logsOn(date) {
  return store.all('timelog').filter((e) => e.date === date).sort((a, b) => mins(a.start) - mins(b.start));
}

export function running() {
  return store.all('timelog').find((e) => !e.end) || null;
}

// Stop whatever is running (at `at`, today) and optionally start something new.
export function track(title, category = guessCategory(title)) {
  const t = D.today();
  const at = nowHM();
  const cur = running();
  if (cur) store.put('timelog', { ...cur, end: cur.date === t ? at : '23:59' });
  if (!title) return null;
  return store.put('timelog', { date: t, start: at, end: null, title: title.charAt(0).toUpperCase() + title.slice(1), category });
}

export function logEntry({ date = D.today(), start, end, title, category }) {
  return store.put('timelog', { date, start, end, title: title.charAt(0).toUpperCase() + title.slice(1), category: category || guessCategory(title) });
}

// "9-11 deep work", "2pm-3:30pm gym #exercise", "lunch 13:00-13:45", "reading" (starts now)
export function parseLog(text, date = D.today()) {
  const p = D.parseSmart(text, date);
  const title = p.title || 'Activity';
  let cat = null;
  if (p.tag) cat = CATS.find(([k, l]) => k === p.tag.toLowerCase() || l.toLowerCase() === p.tag.toLowerCase())?.[0] || null;
  if (!p.time) return { running: true, title, category: cat || guessCategory(title) };
  const end = p.endTime || hhmm(Math.min(mins(p.time) + 60, 1439));
  return { running: false, date: p.date || date, start: p.time, end, title, category: cat || guessCategory(title) };
}

function entryMinutes(e, date) {
  const s = mins(e.start);
  let en = e.end ? mins(e.end) : (e.date === D.today() ? new Date().getHours() * 60 + new Date().getMinutes() : 1439);
  if (en <= s) en = e.end ? 1440 : s + 1;
  return [s, en];
}

export function actualHours(from, to) {
  const byCat = {};
  for (const e of store.all('timelog')) {
    if (e.date < from || e.date > to) continue;
    const [s, en] = entryMinutes(e, e.date);
    byCat[e.category] = (byCat[e.category] || 0) + (en - s) / 60;
  }
  return byCat;
}

const fmtT = (hm) => D.fmtTime(hm);
const fmtDur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

// ---- Starter routines ---------------------------------------------------------------------------------------
const WEEKDAYS = [1, 2, 3, 4, 5]; const WEEKEND = [0, 6]; const ALL = [0, 1, 2, 3, 4, 5, 6];
const STARTERS = {
  'Balanced workday': [
    ['Wake up, water, no phone', '06:30', '07:00', 'personal', WEEKDAYS], ['Workout', '07:00', '08:00', 'exercise', WEEKDAYS],
    ['Breakfast', '08:00', '08:30', 'meals', WEEKDAYS], ['Deep work', '09:00', '12:30', 'work', WEEKDAYS], ['Lunch & walk', '12:30', '13:30', 'meals', WEEKDAYS],
    ['Meetings & shallow work', '13:30', '17:30', 'work', WEEKDAYS], ['Learning / side project', '18:00', '19:00', 'learning', WEEKDAYS],
    ['Dinner & family', '19:30', '20:30', 'family', WEEKDAYS], ['Read & wind down', '21:30', '22:30', 'mind', WEEKDAYS], ['Sleep', '22:30', '06:30', 'sleep', [0, 1, 2, 3, 4]],
  ],
  'Relaxed weekend': [
    ['Slow morning', '08:00', '09:00', 'personal', WEEKEND], ['Long run / sport', '09:00', '10:30', 'exercise', WEEKEND],
    ['Brunch', '10:30', '11:30', 'meals', WEEKEND], ['Chores & errands', '11:30', '13:00', 'chores', WEEKEND], ['Friends / outing', '16:00', '20:00', 'fun', WEEKEND],
    ['Plan the week', '20:30', '21:00', 'personal', [0]], ['Sleep', '23:30', '08:00', 'sleep', [5, 6]],
  ],
  'Student': [
    ['Wake up', '07:00', '07:30', 'personal', WEEKDAYS], ['Classes', '08:30', '13:00', 'learning', WEEKDAYS], ['Lunch', '13:00', '14:00', 'meals', WEEKDAYS],
    ['Self study', '14:00', '17:00', 'learning', WEEKDAYS], ['Sports', '17:00', '18:30', 'exercise', WEEKDAYS], ['Dinner', '19:30', '20:30', 'meals', ALL],
    ['Revision', '20:30', '22:00', 'learning', [0, 1, 2, 3, 4]], ['Sleep', '23:00', '07:00', 'sleep', ALL],
  ],
};

function applyStarter(name) {
  for (const [title, start, end, category, days] of STARTERS[name]) store.put('routine', { title, start, end, category, days, notes: '' });
  toast(`Added “${name}” — tweak any block to make it yours`);
}

// ---- View --------------------------------------------------------------------------------------------------
export function render(ctx) {
  rerender = ctx.rerender;
  const has = blocks().length;
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', null, 'Routine'),
      segmented([['today', 'Day'], ['week', 'Week'], ['plan', 'Plan'], ['insights', 'Insights']], tab, (v) => { tab = v; ctx.rerender(); }, { small: true })),
    tab === 'week' ? (has ? weekTab() : starterCard()) : tab === 'plan' ? planTab() : tab === 'insights' ? insightsTab() : dayTab(has));
}

function starterCard() {
  return section('Design your ideal day', null,
    h('p', { class: 'small muted' }, 'Block out your time: sleep, deep work, workouts, learning, family. Start from a template or build your own in Plan.'),
    h('div', { class: 'tpl-grid' }, Object.entries(STARTERS).map(([name, items]) => h('div', { class: 'tpl-card' },
      h('b', null, name),
      h('p', { class: 'tpl-lines' }, items.slice(0, 6).map(([t, s]) => `${fmtT(s)} · ${t}`).join('\n') + (items.length > 6 ? '\n…' : '')),
      h('button', { class: 'btn primary sm', onclick: () => applyStarter(name) }, 'Use this')))),
    h('button', { class: 'btn ghost', onclick: () => editBlock() }, icon('plus', 16), 'Start from scratch'));
}

function trackerCard(date) {
  const cur = running();
  const t = D.today();
  const input = h('input', { class: 'quick', placeholder: 'What did you do? e.g. “9-11 deep work”, “2pm-3pm gym”, or “reading” to start now', 'data-key': 'log-add', enterkeyhint: 'done', autocomplete: 'off' });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const p = parseLog(input.value.trim(), date);
    input.value = '';
    if (p.running) { if (date !== t) { toast('Add a time range for past days, e.g. “9-11 work”'); return; } track(p.title, p.category); toast(`Tracking: ${p.title}`); }
    else { logEntry(p); toast(`Logged ${fmtT(p.start)}–${fmtT(p.end)} · ${p.title}`); }
  });
  // Quick-switch chips: your routine's activities plus common categories.
  const suggestions = [...new Map([...blocks().map((b) => [b.title, b.category]), ['Deep work', 'work'], ['Break', 'fun'], ['Commute', 'commute'], ['Exercise', 'exercise'], ['Meal', 'meals']]).entries()].slice(0, 10);
  return h('section', { class: 'card tracker' },
    cur ? h('div', { class: 'tracking' },
      h('span', { class: `swatch cat-${cur.category}` }),
      h('span', { class: 'row-main' }, h('b', null, cur.title), h('span', { class: 'muted small' }, `since ${fmtT(cur.start)} · `, h('span', { class: 'live-dur', 'data-start': cur.start }, fmtDur(Math.max(0, mins(nowHM()) - mins(cur.start)))))),
      h('button', { class: 'btn ghost sm', onclick: () => { track(null); toast('Stopped'); } }, 'Stop'))
      : h('p', { class: 'eyebrow' }, 'Now doing'),
    date === t ? h('div', { class: 'chips' }, suggestions.map(([title, cat]) => h('button', {
      class: ['chip', cur && cur.title === title && 'on'], onclick: () => { if (cur && cur.title === title) return; track(title, cat); },
    }, `${catOf(cat)[2]} ${title}`))) : null,
    input);
}

function dayTab(hasRoutine) {
  const t = D.today();
  const date = viewDay || t;
  const isToday = date === t;
  const segs = segmentsOn(date);
  const logs = logsOn(date);
  const { now, next, minute } = nowAndNext(date);
  const starts = [...segs.filter((s) => !s.carry).map((s) => s.from), ...logs.map((e) => mins(e.start))];
  const firstHour = Math.max(0, Math.min(6, ...starts.map((m) => Math.floor(m / 60))));
  const startMin = firstHour * 60;
  const PX = 1; // px per minute (60px per hour)
  const doneCount = segs.filter((s) => !s.carry && followed(s.block, date)).length;
  const total = segs.filter((s) => !s.carry).length;
  const logged = logs.reduce((sum, e) => { const [s, en] = entryMinutes(e, date); return sum + (en - s); }, 0);

  const hours = [];
  for (let hr = firstHour; hr <= 24; hr++) hours.push(h('div', { class: 'tl-hour', style: { top: `${(hr * 60 - startMin) * PX}px` } }, h('span', null, hr === 24 ? '' : fmtT(hhmm(hr * 60)))));

  const nowCard = isToday && hasRoutine ? h('section', { class: 'card now-card' },
    now ? [h('p', { class: 'eyebrow' }, 'Your routine says'),
      h('h3', null, `${catOf(now.block.category)[2]} ${now.block.title}`),
      h('p', { class: 'muted small' }, `until ${fmtT(hhmm(now.to % 1440))} · ${fmtDur(now.to - minute)} left`),
      C.meter((minute - now.from) / (now.to - now.from))]
      : [h('p', { class: 'eyebrow' }, 'Your routine says'), h('h3', null, 'Free time'), next ? h('p', { class: 'muted small' }, `${fmtDur(next.from - minute)} until ${next.block.title}`) : null],
    next ? h('p', { class: 'small' }, h('b', null, 'Next: '), `${fmtT(next.block.start)} · ${next.block.title}`) : null) : null;

  const height = (1440 - startMin) * PX;
  const plan = h('div', { class: 'tl-col' },
    segs.filter((s) => s.to > startMin).map((s) => {
      const b = s.block;
      const top = (Math.max(s.from, startMin) - startMin) * PX;
      const hgt = Math.max(22, (s.to - Math.max(s.from, startMin)) * PX - 2);
      const cur = isToday && now && now.block.id === b.id && now.from === s.from;
      return h('div', {
        class: ['tl-block', `cat-${b.category}`, cur && 'current', !s.carry && followed(b, date) && 'followed', hgt < 40 && 'short'],
        style: { top: `${top}px`, height: `${hgt}px` }, onclick: () => editBlock(b),
      },
      h('div', { class: 'tl-text' }, h('b', null, `${catOf(b.category)[2]} ${b.title}`), h('span', null, `${fmtT(b.start)} – ${fmtT(b.end)}`)),
      s.carry ? null : checkbox(followed(b, date), (v) => setFollowed(b, date, v), 'Followed this block'));
    }));
  const actual = h('div', { class: 'tl-col actual' },
    logs.map((e) => {
      const [s, en] = entryMinutes(e, date);
      const top = (Math.max(s, startMin) - startMin) * PX;
      const hgt = Math.max(22, (en - Math.max(s, startMin)) * PX - 2);
      return h('div', { class: ['tl-block', `cat-${e.category}`, !e.end && 'running', hgt < 40 && 'short'], style: { top: `${top}px`, height: `${hgt}px` }, onclick: (ev) => { ev.stopPropagation(); editLog(e); } },
        h('div', { class: 'tl-text' }, h('b', null, `${catOf(e.category)[2]} ${e.title}`), h('span', null, `${fmtT(e.start)} – ${e.end ? fmtT(e.end) : 'now'} · ${fmtDur(en - s)}`)));
    }));
  // Tap an empty spot on the Actual column to log what you did then.
  actual.addEventListener('click', (ev) => {
    if (ev.target !== actual) return;
    const y = ev.offsetY;
    const m = Math.min(1425, Math.round((startMin + y / PX) / 15) * 15);
    editLog({ date, start: hhmm(m), end: hhmm(Math.min(m + 60, 1439)), title: '', category: 'other' });
  });

  return h('div', { class: 'stack' },
    h('div', { class: 'day-nav spread' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => { viewDay = D.addDays(date, -1); rerender(); } }, icon('left')),
      h('b', null, D.fmtDate(date)),
      !isToday ? h('button', { class: 'btn ghost sm', onclick: () => { viewDay = null; rerender(); } }, 'Today') : null,
      h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => { viewDay = D.addDays(date, 1); rerender(); } }, icon('right'))),
    h('div', { class: 'grid-2' }, trackerCard(date), nowCard || (hasRoutine ? null : section('No ideal routine yet', h('button', { class: 'btn ghost sm', onclick: () => { tab = 'plan'; rerender(); } }, 'Plan it'), h('p', { class: 'small muted' }, 'Design your ideal day to compare it with what you actually do. Start from a template:'),
      h('div', { class: 'btn-row' }, Object.keys(STARTERS).map((n) => h('button', { class: 'btn ghost sm', onclick: () => applyStarter(n) }, `+ ${n}`)))))),
    h('section', { class: 'card timeline-card' },
      h('div', { class: 'tl-heads' }, h('span'), h('span', null, `Ideal${total ? ` · ${doneCount}/${total} followed` : ''}`), h('span', null, `Actual · ${fmtDur(logged)} logged`)),
      h('div', { class: 'timeline two', style: { height: `${height}px` } },
        hours, plan, actual,
        isToday ? h('div', { class: 'now-line', style: { top: `${(minute - startMin) * PX}px` } }) : null)));
}

export function editLog(e) {
  const isNew = !e.id;
  const title = h('input', { value: e.title || '', placeholder: 'What were you doing?', autofocus: true });
  const start = h('input', { type: 'time', value: e.start });
  const end = h('input', { type: 'time', value: e.end || nowHM() });
  const dateIn = h('input', { type: 'date', value: e.date });
  const cat = h('select', null, CATS.map(([k, l, em]) => h('option', { value: k, selected: k === e.category }, `${em} ${l}`)));
  let touched = !isNew;
  cat.addEventListener('change', () => { touched = true; });
  title.addEventListener('input', () => { if (!touched) cat.value = guessCategory(title.value); });
  const running = !e.end && !isNew;
  const save = () => {
    if (!title.value.trim()) { title.focus(); return; }
    store.put('timelog', { ...e, title: title.value.trim(), date: dateIn.value, start: start.value, end: running && end.value === '' ? null : end.value, category: cat.value });
    closeSheet();
  };
  const actions = [h('button', { class: 'btn primary', onclick: save }, 'Save')];
  if (!isNew) actions.unshift(h('button', { class: 'btn danger ghost', onclick: () => { closeSheet(); store.remove('timelog', e.id); toast('Entry deleted', { label: 'Undo', run: () => store.put('timelog', e) }); } }, icon('trash', 18), 'Delete'));
  sheet(isNew ? 'Log time' : 'Time entry', h('div', { class: 'form' }, title,
    h('div', { class: 'row3' }, field('From', start), field('To', end), field('Day', dateIn)), field('Category', cat)), { actions });
}

function insightsTab() {
  const t = D.today();
  const from = D.addDays(t, -6);
  const actual = actualHours(from, t);
  const ideal = Object.fromEntries(weeklyHours());
  const keys = [...new Set([...Object.keys(ideal), ...Object.keys(actual)])].sort((a, b) => (ideal[b] || actual[b] || 0) - (ideal[a] || actual[a] || 0));
  const days = Array.from({ length: 14 }, (_, i) => D.addDays(t, i - 13));
  const loggedPts = days.map((d) => {
    const m = logsOn(d).reduce((sum, e) => { const [s, en] = entryMinutes(e, d); return sum + (en - s); }, 0);
    return { label: D.parse(d).getDate(), value: Math.round((m / 60) * 10) / 10, highlight: d === t, tip: `${D.fmtDate(d, { relative: false })}: ${fmtDur(m)} logged` };
  });
  const r1 = (v) => Math.round(v * 10) / 10;
  return h('div', { class: 'stack' },
    section('Ideal vs actual · last 7 days', null,
      keys.length ? h('div', { class: 'compare' },
        h('div', { class: 'compare-row compare-head' }, h('span', null, 'Category'), h('span', null, 'Ideal'), h('span', null, 'Actual'), h('span', null, 'Diff')),
        keys.map((k) => {
          const i = r1(ideal[k] || 0); const a = r1(actual[k] || 0); const diff = r1(a - i);
          const max = Math.max(i, a, 1);
          return h('div', { class: 'compare-row', 'data-tip': `${catOf(k)[1]}: ideal ${i}h, actual ${a}h` },
            h('span', null, `${catOf(k)[2]} ${catOf(k)[1]}`),
            h('span', { class: 'cmp-val' }, `${i}h`),
            h('span', { class: 'cmp-val' }, `${a}h`),
            h('span', { class: ['cmp-diff', Math.abs(diff) < 0.5 ? '' : diff > 0 ? 'up' : 'down'] }, `${diff > 0 ? '+' : ''}${diff}h`),
            h('span', { class: 'cmp-bars' }, h('i', { class: 'ideal', style: { width: `${(i / max) * 100}%` } }), h('i', { class: 'act', style: { width: `${(a / max) * 100}%` } })));
        }),
        h('p', { class: 'legend' }, h('span', null, h('i', { class: 'swatch ideal-sw' }), 'Ideal (from your routine)'), h('span', null, h('i', { class: 'swatch act-sw' }), 'Actual (from the tracker)')))
        : empty('Plan your ideal routine and log a few days to compare.')),
    section('Hours logged per day', null, C.columns(loggedPts, { fmt: (v) => `${v}h`, height: 100, labelEvery: 2 })));
}

function weekTab() {
  const order = store.pref('weekStart', 1) === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const base = '2026-01-04'; // Sunday
  const startMin = 5 * 60;
  const PX = 0.6;
  return h('div', { class: 'stack' },
    h('section', { class: 'card week-card' },
      h('div', { class: 'week-grid' },
        h('div', { class: 'wk-col wk-times' }, h('div', { class: 'wk-head' }),
          h('div', { class: 'wk-body', style: { height: `${(1440 - startMin) * PX}px` } },
            Array.from({ length: 20 }, (_, i) => h('span', { class: 'wk-hour', style: { top: `${i * 60 * PX}px` } }, `${(5 + i) % 24}`)))),
        order.map((wd) => {
          const segs = segmentsOn(D.addDays(base, wd));
          const isToday = D.weekday(D.today()) === wd;
          return h('div', { class: ['wk-col', isToday && 'is-today'] },
            h('div', { class: 'wk-head' }, D.DAY_NAMES[wd].slice(0, 3)),
            h('div', { class: 'wk-body', style: { height: `${(1440 - startMin) * PX}px` } },
              segs.filter((s) => s.to > startMin).map((s) => h('button', {
                class: ['wk-block', `cat-${s.block.category}`],
                style: { top: `${(Math.max(s.from, startMin) - startMin) * PX}px`, height: `${Math.max(10, (s.to - Math.max(s.from, startMin)) * PX - 1)}px` },
                'data-tip': `${s.block.title} · ${fmtT(s.block.start)}–${fmtT(s.block.end)}`, onclick: () => editBlock(s.block),
              }, s.to - s.from >= 45 ? s.block.title : ''))));
        }))),
    legend());
}

function legend() {
  const used = new Set(blocks().map((b) => b.category));
  return h('div', { class: 'legend wrap' }, CATS.filter(([k]) => used.has(k)).map(([k, l, e]) => h('span', null, h('i', { class: `swatch cat-${k}` }), `${e} ${l}`)));
}

function planTab() {
  const list = blocks();
  const hrs = weeklyHours();
  const clash = overlaps();
  const byDays = {};
  for (const b of list) { const key = daysLabel(b.days); (byDays[key] ||= []).push(b); }
  // Adherence over the last 14 days.
  const t = D.today();
  const pts = Array.from({ length: 14 }, (_, i) => {
    const d = D.addDays(t, i - 13);
    const segs = segmentsOn(d).filter((s) => !s.carry);
    const done = segs.filter((s) => followed(s.block, d)).length;
    const v = segs.length ? Math.round((done / segs.length) * 100) : 0;
    return { label: D.parse(d).getDate(), value: v, highlight: d === t, tip: `${D.fmtDate(d, { relative: false })}: ${done}/${segs.length} blocks (${v}%)` };
  });
  return h('div', { class: 'stack' },
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary', onclick: () => editBlock() }, icon('plus', 16), 'Add block'),
      Object.keys(STARTERS).map((n) => h('button', { class: 'btn ghost sm', onclick: () => applyStarter(n) }, `+ ${n}`))),
    clash.length ? h('div', { class: 'sub-block carry' }, h('p', { class: 'small' }, `⚠️ Overlaps: ${[...new Set(clash.map(([wd, a, b]) => `${a.title} / ${b.title} (${D.DAY_NAMES[wd].slice(0, 3)})`))].slice(0, 4).join(' · ')}`)) : null,
    list.length ? h('div', { class: 'grid-2' },
      h('div', { class: 'stack' }, Object.entries(byDays).map(([label, bs]) => section(label, null,
        h('ul', { class: 'list compact' }, bs.map((b) => h('li', { class: 'row', onclick: () => editBlock(b) },
          h('i', { class: `swatch cat-${b.category}` }),
          h('span', { class: 'ev-time' }, `${fmtT(b.start)} – ${fmtT(b.end)}`),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, b.title), h('span', { class: 'row-sub' }, `${catOf(b.category)[1]} · ${fmtDur(durationMin(b))}`)))))))),
      h('div', { class: 'stack' },
        section('Ideal week in hours', null, C.hbars(hrs.map(([k, v]) => ({ label: `${catOf(k)[2]} ${catOf(k)[1]}`, value: Math.round(v * 10) / 10, tip: `${catOf(k)[1]}: ${Math.round(v * 10) / 10} h/week (${Math.round((v / 168) * 100)}% of the week)` })), { fmt: (v) => `${v}h` })),
        section('Followed · last 14 days', null, C.columns(pts, { fmt: (v) => `${v}%`, height: 90, labelEvery: 2 }))))
      : section('', null, empty('No blocks yet. Add one, or start from a template above.')));
}

function daysLabel(days) {
  const s = [...days].sort().join(',');
  if (s === '0,1,2,3,4,5,6') return 'Every day';
  if (s === '1,2,3,4,5') return 'Weekdays';
  if (s === '0,6') return 'Weekends';
  const order = store.pref('weekStart', 1) === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  return order.filter((d) => days.includes(d)).map((d) => D.DAY_NAMES[d].slice(0, 3)).join(', ');
}

export function editBlock(b = null) {
  const draft = b ? { ...b, days: [...b.days] } : { title: '', start: '09:00', end: '10:00', category: 'work', days: [1, 2, 3, 4, 5], notes: '' };
  const title = h('input', { value: draft.title, placeholder: 'e.g. Deep work, Gym, Read' });
  const start = h('input', { type: 'time', value: draft.start });
  const end = h('input', { type: 'time', value: draft.end });
  const cat = h('select', null, CATS.map(([k, l, e]) => h('option', { value: k, selected: k === draft.category }, `${e} ${l}`)));
  const dayRow = h('div', { class: 'chips' });
  const order = store.pref('weekStart', 1) === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const drawDays = () => dayRow.replaceChildren(
    ...order.map((d) => h('button', { type: 'button', class: ['chip', draft.days.includes(d) && 'on'], onclick: () => { draft.days = draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d]; drawDays(); } }, D.DAY_NAMES[d].slice(0, 3))),
    h('button', { type: 'button', class: 'chip', onclick: () => { draft.days = [1, 2, 3, 4, 5]; drawDays(); } }, 'Weekdays'),
    h('button', { type: 'button', class: 'chip', onclick: () => { draft.days = [0, 1, 2, 3, 4, 5, 6]; drawDays(); } }, 'Every day'));
  drawDays();
  const notes = h('textarea', { rows: 2, placeholder: 'Notes (optional)' }, draft.notes || '');
  const save = () => {
    if (!title.value.trim()) { title.focus(); return; }
    if (!draft.days.length) { toast('Pick at least one day'); return; }
    store.put('routine', { ...draft, title: title.value.trim(), start: start.value, end: end.value, category: cat.value, notes: notes.value });
    closeSheet();
  };
  const actions = [h('button', { class: 'btn primary', onclick: save }, 'Save')];
  if (b) {
    actions.unshift(h('button', { class: 'btn ghost', onclick: () => { const { id, ...rest } = b; store.put('routine', { ...rest, title: `${b.title} (copy)` }); closeSheet(); } }, 'Duplicate'));
    actions.unshift(h('button', { class: 'btn danger ghost', onclick: () => { closeSheet(); store.remove('routine', b.id); toast('Block deleted', { label: 'Undo', run: () => store.put('routine', b) }); } }, icon('trash', 18), 'Delete'));
  }
  sheet(b ? 'Edit block' : 'New block', h('div', { class: 'form' }, title,
    h('div', { class: 'row2' }, field('Start', start), field('End', end)),
    field('Category', cat), field('Days', dayRow), notes,
    h('p', { class: 'muted small' }, 'Tip: a block that ends earlier than it starts (e.g. Sleep 22:30 → 06:30) runs past midnight.')), { actions });
}

// Today-screen card: now / next from your routine.
export function todayCard() {
  const cur = running();
  if (!blocks().length && !cur) return null;
  const { now, next, minute } = nowAndNext();
  return section('Routine', h('a', { class: 'btn ghost sm', href: '#/routine' }, 'Day view'),
    cur ? h('p', { class: 'small' }, h('b', null, 'Tracking: '), `${catOf(cur.category)[2]} ${cur.title} since ${fmtT(cur.start)}`) : null,
    !blocks().length ? null : now ? h('p', null, h('b', null, 'Now: '), `${catOf(now.block.category)[2]} ${now.block.title}`, h('span', { class: 'muted small' }, ` · ${fmtDur(now.to - minute)} left`)) : h('p', { class: 'muted' }, 'Free time right now'),
    next ? h('p', { class: 'small' }, h('b', null, 'Next: '), `${fmtT(next.block.start)} · ${next.block.title}`) : null);
}
