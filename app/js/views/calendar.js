// Calendar: month grid with dots, plus the selected day's agenda.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import * as E from '../editors.js';
import { h, icon, section, empty, checkbox } from '../ui.js';

let selected = null;
let cursor = null; // any date inside the month being shown

export function render(ctx) {
  const t = D.today();
  selected = selected || t;
  cursor = cursor || selected;
  const weekStart = store.pref('weekStart', 1);
  const weeks = D.monthMatrix(cursor, weekStart);
  const month = D.parse(cursor);
  const curMonth = D.monthKey(cursor);

  const events = store.all('events');
  const todos = store.all('todos');
  const dueTasks = M.openTasks().filter((x) => x.due);
  const names = [...Array(7)].map((_, i) => D.DAY_NAMES[(i + weekStart) % 7].slice(0, 3));

  const go = (n) => { cursor = D.addMonths(cursor, n); ctx.rerender(); };

  const grid = h('div', { class: 'cal' },
    names.map((n) => h('div', { class: 'cal-dow' }, n)),
    weeks.flat().map((date) => {
      const evs = events.filter((e) => D.occursOn(e, date));
      const hasTodo = todos.some((x) => x.date === date && !x.done);
      const hasDue = dueTasks.some((x) => x.due === date);
      return h('button', {
        class: ['cal-day', D.monthKey(date) !== curMonth && 'out', date === t && 'is-today', date === selected && 'sel'],
        'aria-label': `${D.fmtDate(date, { relative: false })}${evs.length ? `, ${evs.length} events` : ''}`,
        onclick: () => { selected = date; if (D.monthKey(date) !== curMonth) cursor = date; ctx.rerender(); },
        ondblclick: () => E.editEvent({}, { date }),
      },
      h('span', { class: 'cal-num' }, D.parse(date).getDate()),
      h('span', { class: 'cal-evs' }, evs.slice(0, 2).map((e) => h('span', { class: 'cal-ev' }, e.title)),
        evs.length > 2 ? h('span', { class: 'cal-more' }, `+${evs.length - 2}`) : null),
      h('span', { class: 'cal-dots' },
        evs.length ? h('i', { class: 'dot ev' }) : null,
        hasTodo ? h('i', { class: 'dot todo' }) : null,
        hasDue ? h('i', { class: 'dot due' }) : null));
    }));

  return h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('h1', null, `${D.MONTH_NAMES[month.getMonth()]} ${month.getFullYear()}`),
      h('div', { class: 'day-nav' },
        h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => go(-1) }, icon('left')),
        h('button', { class: 'btn ghost sm', onclick: () => { selected = t; cursor = t; ctx.rerender(); } }, 'Today'),
        h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => go(1) }, icon('right')))),
    h('div', { class: 'cal-layout' },
      h('div', { class: 'card cal-card' }, grid,
        h('div', { class: 'legend' },
          h('span', null, h('i', { class: 'dot ev' }), 'Event'),
          h('span', null, h('i', { class: 'dot todo' }), 'To-do'),
          h('span', null, h('i', { class: 'dot due' }), 'Task due'))),
      dayPanel(selected), upcoming(t)));
}

function dayPanel(date) {
  const evs = M.eventsOn(date);
  const todos = M.todosOn(date);
  const due = M.openTasks().filter((x) => x.due === date);
  return section(D.fmtDate(date),
    h('button', { class: 'btn primary sm', onclick: () => E.editEvent({}, { date }) }, icon('plus', 16), 'Event'),
    evs.length || todos.length || due.length ? null : empty('Free day.'),
    evs.length ? h('ul', { class: 'list' }, evs.map((e) => h('li', { class: 'row event-row', onclick: () => E.editEvent(e, { occurrence: date }) },
      h('span', { class: 'ev-time' }, M.eventTimeLabel(e)),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, e.title),
        h('span', { class: 'row-sub' }, [e.location, e.repeat && e.repeat !== 'none' ? `Repeats ${e.repeat}` : ''].filter(Boolean).join(' · ')))))) : null,
    todos.length ? h('div', { class: 'sub-block' }, h('p', { class: 'sub-head' }, 'To-dos'),
      h('ul', { class: 'list compact' }, todos.map((t) => h('li', { class: ['row', t.done && 'done'], onclick: () => E.editTodo(t) },
        checkbox(t.done, (v) => M.toggleTodo(t, v)), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t.title)))))) : null,
    due.length ? h('div', { class: 'sub-block' }, h('p', { class: 'sub-head' }, 'Tasks due'),
      h('ul', { class: 'list compact' }, due.map((t) => h('li', { class: 'row', onclick: () => E.editTask(t) },
        checkbox(false, (v) => M.toggleTask(t, v)), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t.title)))))) : null);
}

function upcoming(t) {
  const rows = [];
  for (let i = 1; i <= 14 && rows.length < 8; i++) {
    const d = D.addDays(t, i);
    for (const e of M.eventsOn(d)) rows.push([d, e]);
  }
  if (!rows.length) return null;
  return section('Coming up', null,
    h('ul', { class: 'list compact' }, rows.slice(0, 8).map(([d, e]) => h('li', { class: 'row', onclick: () => E.editEvent(e, { occurrence: d }) },
      h('span', { class: 'ev-time' }, D.fmtDate(d)),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, e.title),
        h('span', { class: 'row-sub' }, M.eventTimeLabel(e)))))));
}
