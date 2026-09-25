// Tasks: everything on your plate, not tied to a specific day.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import * as E from '../editors.js';
import { h, icon, section, checkbox, quickInput, empty, segmented, toast } from '../ui.js';
import { taskMeta } from './today.js';

let filter = 'open';
let tag = null;

export function render(ctx) {
  const t = D.today();
  const all = store.all('tasks');
  const tags = [...new Set(all.filter((x) => !x.done).map((x) => x.tag).filter(Boolean))].sort();
  if (tag && !tags.includes(tag)) tag = null;

  let list = all.filter((x) => (filter === 'done' ? x.done : !x.done) && (!tag || x.tag === tag));

  const row = (x) => h('li', { class: ['row', x.done && 'done', x.priority === 3 && 'p-high'], onclick: () => E.editTask(x) },
    checkbox(x.done, (v) => {
      M.toggleTask(x, v);
      if (v) toast('Task done', { label: 'Undo', run: () => M.toggleTask(x, false) });
    }),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, x.title),
      taskMeta(x, t) ? h('span', { class: ['row-sub', x.due && x.due < t && !x.done && 'overdue'] }, taskMeta(x, t)) : null),
    !x.done ? h('button', {
      class: ['icon-btn', 'sm', x.planned === t && 'active'], 'aria-label': 'Do today', 'data-tip': x.planned === t ? 'Planned for today' : 'Do today',
      onclick: (e) => { e.stopPropagation(); store.put('tasks', { ...x, planned: x.planned === t ? null : t }); },
    }, icon('today', 18)) : null);

  let body;
  if (filter === 'done') {
    list.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    body = list.length ? h('ul', { class: 'list' }, list.slice(0, 100).map(row)) : empty('Nothing completed yet.');
  } else {
    const groups = [
      ['Overdue', list.filter((x) => x.due && x.due < t)],
      ['Today', list.filter((x) => x.due === t || (x.planned === t && !(x.due && x.due < t)))],
      ['Next 7 days', list.filter((x) => x.due && x.due > t && x.due <= D.addDays(t, 7) && x.planned !== t)],
      ['Later', list.filter((x) => x.due && x.due > D.addDays(t, 7) && x.planned !== t)],
      ['Someday', list.filter((x) => !x.due && x.planned !== t)],
    ].filter(([, g]) => g.length);
    body = groups.length
      ? groups.map(([name, g]) => h('div', { class: 'group' },
          h('p', { class: ['sub-head', name === 'Overdue' && 'overdue'] }, `${name} · ${g.length}`),
          h('ul', { class: 'list' }, g.sort(M.taskSort).map(row))))
      : empty('Nothing on your plate. Nice.');
  }

  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', null, 'Tasks'),
      segmented([['open', 'Open'], ['done', 'Done']], filter, (v) => { filter = v; ctx.rerender(); }, { small: true })),
    section('', null,
      quickInput('Add a task — try “Pay rent fri !high #home”', (v) => {
        const p = D.parseSmart(v);
        M.addTask(p);
      }, { key: 'task-add' }),
      tags.length ? h('div', { class: 'chips filter-chips' },
        h('button', { class: ['chip', !tag && 'on'], onclick: () => { tag = null; ctx.rerender(); } }, 'All'),
        tags.map((x) => h('button', { class: ['chip', tag === x && 'on'], onclick: () => { tag = tag === x ? null : x; ctx.rerender(); } }, `#${x}`))) : null,
      body));
}
