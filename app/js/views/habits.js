// Habits: tick off the week at a glance, then see streaks and trends.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import * as E from '../editors.js';
import { h, icon, section, empty } from '../ui.js';
import * as C from '../charts.js';

export function render() {
  const t = D.today();
  const list = M.habits();
  const week = [...Array(7)].map((_, i) => D.addDays(t, i - 6));

  const head = h('header', { class: 'page-head' }, h('h1', null, 'Habits'),
    h('button', { class: 'btn primary sm', onclick: () => E.editHabit() }, icon('plus', 16), 'New habit'));

  if (!list.length) {
    return h('div', { class: 'page' }, head, section('', null,
      empty('Track small daily wins. Add your first habit — e.g. “Read 20 pages”, “Walk 8k steps”, “No phone after 11pm”.'),
      h('div', { class: 'chips' }, [['📖', 'Read 20 pages'], ['🏃', 'Exercise'], ['💧', 'Drink 2L water'], ['🧘', 'Meditate'], ['😴', 'Sleep by 11']].map(([emoji, name]) =>
        h('button', { class: 'chip', onclick: () => store.put('habits', { name, emoji, days: [0, 1, 2, 3, 4, 5, 6] }) }, `${emoji} ${name}`)))));
  }

  const grid = h('div', { class: 'habit-grid' },
    h('div', { class: 'hg-row hg-head' }, h('span'),
      week.map((d) => h('span', { class: ['hg-day', d === t && 'is-today'] },
        h('small', null, D.DAY_NAMES[D.weekday(d)].slice(0, 1)), D.parse(d).getDate())),
      h('span', { class: 'hg-stat' }, 'Streak')),
    list.map((hb) => h('div', { class: 'hg-row' },
      h('button', { class: 'hg-name', onclick: () => E.editHabit(hb) }, h('span', null, hb.emoji || '✅'), h('span', null, hb.name)),
      week.map((d) => {
        const sched = M.scheduledOn(hb, d);
        const on = M.isDone(hb.id, d);
        return h('button', {
          class: ['hg-cell', on && 'on', !sched && 'rest'], 'aria-pressed': String(on),
          'aria-label': `${hb.name} on ${D.fmtDate(d)}`,
          onclick: () => M.setDone(hb.id, d, !on),
        }, on ? icon('check', 16) : null);
      }),
      h('span', { class: 'hg-stat' }, `🔥 ${M.streak(hb, t)}`))));

  // Overall daily completion % for the last 30 days.
  const days30 = [...Array(30)].map((_, i) => D.addDays(t, i - 29));
  const pts = days30.map((d) => {
    const sched = list.filter((hb) => M.scheduledOn(hb, d));
    const done = sched.filter((hb) => M.isDone(hb.id, d)).length;
    const v = sched.length ? Math.round((done / sched.length) * 100) : 0;
    return { label: D.parse(d).getDate(), value: v, tip: `${D.fmtDate(d, { relative: false })}: ${done}/${sched.length} habits (${v}%)` };
  });

  const weeks = 18;
  const start = D.addDays(t, -(weeks * 7 - 1));
  const firstCol = D.addDays(start, -((D.weekday(start) - store.pref('weekStart', 1) + 7) % 7));

  return h('div', { class: 'page' }, head,
    section('This week', h('span', { class: 'muted small' }, 'Tap a square to tick it'), grid),
    section('Daily completion · last 30 days', null, C.line(pts, { max: 100, fmt: (v) => `${v}%` })),
    h('div', { class: 'grid-2' }, list.map((hb) => {
      const cells = [];
      const hs = M.habitStart(hb);
      for (let d = firstCol; d <= t; d = D.addDays(d, 1)) {
        const sched = M.scheduledOn(hb, d) && d >= hs;
        const on = M.isDone(hb.id, d);
        cells.push({ date: d, today: d === t, level: !sched && !on ? null : on ? 4 : 0, tip: `${D.fmtDate(d, { relative: false })}: ${on ? 'done' : sched ? 'missed' : 'rest day'}` });
      }
      const rate = M.completionRate(hb, 30, t);
      const best = bestStreak(hb, t);
      return section(`${hb.emoji || '✅'} ${hb.name}`, null,
        h('div', { class: 'stat-row' },
          stat('Current streak', `${M.streak(hb, t)}d`),
          stat('Best streak', `${best}d`),
          stat('Last 30 days', rate === null ? '—' : `${Math.round(rate * 100)}%`)),
        C.heatmap(cells));
    })));
}

function stat(label, value) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
}

function bestStreak(hb, t) {
  const created = M.habitStart(hb);
  let best = 0; let cur = 0;
  for (let d = created; d <= t; d = D.addDays(d, 1)) {
    if (!M.scheduledOn(hb, d)) continue;
    if (M.isDone(hb.id, d)) { cur++; best = Math.max(best, cur); } else if (d !== t) cur = 0;
  }
  return best;
}
