// Screen time across devices. Operating systems don't let web apps read screen
// time, but each device already measures it — this makes logging the daily
// number take seconds, then totals and trends it across all your devices.

import * as store from '../store.js';
import * as D from '../dates.js';
import { h, icon, section, empty, toast, field } from '../ui.js';
import * as C from '../charts.js';

const DEFAULT_DEVICES = ['Phone', 'iPad', 'Laptop'];
const WHERE = [
  ['iPhone / iPad', 'Settings → Screen Time → See All App & Website Activity → Day'],
  ['Android', 'Settings → Digital Wellbeing & parental controls (the dashboard shows today’s total)'],
  ['Mac', 'System Settings → Screen Time → App & Website Activity'],
  ['Windows 11', 'Settings → System → Power & battery → Battery usage → “Screen on” (or install ActivityWatch, free)'],
];

let viewDay = null;
let rerender = () => {};

export function devices() {
  return store.pref('screenDevices', DEFAULT_DEVICES);
}

export function limit() {
  return Number(store.pref('screenLimit', 240)); // minutes per day
}

// "3h 20m", "3:20", "3.5h", "200", "200m", "3 hours 20 minutes" → minutes
export function parseDuration(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:and\s*)?(?:(\d+)\s*(?:m|min|mins|minute|minutes))?$/);
  if (m && (m[1] || m[2])) return Math.round((Number(m[1]) || 0) * 60 + (Number(m[2]) || 0));
  m = s.match(/^(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1]) <= 16 ? Math.round(Number(m[1]) * 60) : Math.round(Number(m[1])); // "3.5" = hours, "200" = minutes
  return null;
}

export function fmtMin(m) {
  if (!m) return '0m';
  const hh = Math.floor(m / 60); const mm = Math.round(m % 60);
  return hh ? `${hh}h${mm ? ` ${mm}m` : ''}` : `${mm}m`;
}

const id = (date, device) => `${date}|${device}`;

export function entry(date, device) {
  return store.get('screentime', id(date, device));
}

export function setEntry(date, device, minutes) {
  if (minutes === null) { store.remove('screentime', id(date, device)); return; }
  store.put('screentime', { id: id(date, device), date, device, minutes });
}

export function totalOn(date) {
  const list = store.all('screentime').filter((e) => e.date === date);
  return list.length ? list.reduce((s, e) => s + e.minutes, 0) : null;
}

export function underLimitStreak() {
  let d = D.addDays(D.today(), -1);
  if (totalOn(D.today()) !== null && totalOn(D.today()) <= limit()) d = D.today();
  let n = 0;
  for (;;) {
    const t = totalOn(d);
    if (t === null || t > limit()) break;
    n++; d = D.addDays(d, -1);
  }
  return n;
}

// ---- View -----------------------------------------------------------------------------------------------
export function render(ctx) {
  rerender = ctx.rerender;
  const t = D.today();
  const date = viewDay || t;
  const devs = devices();
  const total = totalOn(date);
  const lim = limit();

  const days = Array.from({ length: 14 }, (_, i) => D.addDays(t, i - 13));
  const pts = days.map((d) => {
    const tot = totalOn(d) || 0;
    const parts = store.all('screentime').filter((e) => e.date === d).map((e) => `${e.device} ${fmtMin(e.minutes)}`).join(', ');
    return { label: D.parse(d).getDate(), value: Math.round((tot / 60) * 10) / 10, highlight: d === date, tip: `${D.fmtDate(d, { relative: false })}: ${fmtMin(tot)}${parts ? ` (${parts})` : ''}` };
  });
  const week = days.slice(7).map(totalOn).filter((x) => x !== null);
  const prevWeek = days.slice(0, 7).map(totalOn).filter((x) => x !== null);
  const avg = week.length ? week.reduce((a, b) => a + b, 0) / week.length : null;
  const prevAvg = prevWeek.length ? prevWeek.reduce((a, b) => a + b, 0) / prevWeek.length : null;
  const byDevice = devs.map((dv) => {
    const es = store.all('screentime').filter((e) => e.device === dv && e.date > D.addDays(t, -7));
    return { key: dv, label: dv, value: es.length ? Math.round(es.reduce((s, e) => s + e.minutes, 0) / es.length) : 0 };
  });

  return h('div', { class: 'page narrow' },
    h('header', { class: 'page-head' }, h('h1', null, 'Screen time'),
      h('div', { class: 'day-nav' },
        h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => { viewDay = D.addDays(date, -1); rerender(); } }, icon('left')),
        date !== t ? h('button', { class: 'btn ghost sm', onclick: () => { viewDay = null; rerender(); } }, 'Today') : null,
        h('button', { class: 'icon-btn', 'aria-label': 'Next day', disabled: date >= t, onclick: () => { viewDay = D.addDays(date, 1); rerender(); } }, icon('right')))),
    h('section', { class: 'card hero' },
      h('p', { class: 'stat-label' }, `${D.fmtDate(date)} · all devices`),
      h('p', { class: 'hero-value' }, total === null ? '—' : fmtMin(total)),
      total !== null ? C.meter(total / lim, { state: total > lim ? 'bad' : total > lim * 0.85 ? 'warn' : 'ok' }) : null,
      h('p', { class: 'muted small' }, total === null ? `Daily limit ${fmtMin(lim)}` : total > lim ? `${fmtMin(total - lim)} over your ${fmtMin(lim)} limit` : `${fmtMin(lim - total)} under your ${fmtMin(lim)} limit · 🔥 ${underLimitStreak()}-day streak`),
      entryForm(date)),
    section('Last 14 days (hours)', avg !== null ? h('span', { class: 'count' }, `avg ${fmtMin(avg)}/day${prevAvg ? ` · ${avg <= prevAvg ? '▼' : '▲'} ${Math.abs(Math.round(((avg - prevAvg) / prevAvg) * 100))}% vs last week` : ''}`) : null,
      pts.some((p) => p.value) ? C.columns(pts, { fmt: (v) => `${v}h`, height: 110, labelEvery: 2, avg: lim / 60, avgLabel: `Limit ${fmtMin(lim)}` }) : empty('Log a few days to see your trend.')),
    section('Average per device · last 7 days', null, byDevice.some((d) => d.value) ? C.hbars(byDevice, { fmt: fmtMin }) : empty('No data yet.')),
    settingsCard(),
    section('Where to find today’s number', null, h('ul', { class: 'small steps' }, WHERE.map(([k, v]) => h('li', null, h('b', null, `${k}: `), v)))));
}

// Inputs for each device. Saves on change/Enter.
export function entryForm(date, { compact = false } = {}) {
  return h('div', { class: ['screen-form', compact && 'compact'] }, devices().map((dv) => {
    const e = entry(date, dv);
    const inp = h('input', { inputmode: 'text', placeholder: '0h 0m', value: e ? fmtMin(e.minutes) : '', 'data-key': `screen-${date}-${dv}`, enterkeyhint: 'done', autocomplete: 'off' });
    const commit = () => {
      const m = parseDuration(inp.value);
      if (inp.value.trim() && m === null) { toast('Try formats like 3h 20m, 3:20 or 200'); return; }
      const prev = entry(date, dv)?.minutes ?? null;
      if (m !== prev) { setEntry(date, dv, m); if (m !== null) toast(`${dv}: ${fmtMin(m)}`); }
    };
    inp.addEventListener('change', commit);
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } });
    return field(dv, inp);
  }));
}

function settingsCard() {
  const lim = h('input', { value: fmtMin(limit()), class: 'short' });
  lim.addEventListener('change', () => { const m = parseDuration(lim.value); if (m) store.setPref('screenLimit', m); });
  const devs = h('input', { value: devices().join(', ') });
  devs.addEventListener('change', () => {
    const list = devs.value.split(',').map((x) => x.trim()).filter(Boolean);
    if (list.length) store.setPref('screenDevices', list);
  });
  return section('Settings', null, h('div', { class: 'row2' }, field('Daily limit', lim), field('Devices (comma separated)', devs)));
}

// Today-screen card: evening nudge to log the numbers.
export function todayCard() {
  const t = D.today();
  const hour = new Date().getHours();
  const total = totalOn(t);
  const yesterday = totalOn(D.addDays(t, -1));
  if (total === null && hour < 18 && yesterday !== null) return null;
  const date = total === null && hour < 18 ? D.addDays(t, -1) : t;
  return section(date === t ? 'Screen time today' : 'Log yesterday’s screen time', h('a', { class: 'btn ghost sm', href: '#/screen' }, total !== null ? fmtMin(total) : 'Trends'),
    entryForm(date, { compact: true }));
}
