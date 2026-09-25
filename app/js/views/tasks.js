// Tasks: everything on your plate, grouped under your own headings
// (or by due date), not tied to a specific day.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import * as E from '../editors.js';
import { h, icon, section, checkbox, quickInput, empty, segmented, toast, sheet, closeSheet } from '../ui.js';
import { taskMeta } from './today.js';

let mode = null; // resolved from the saved preference on first render
let tag = null;
let dragId = null;

export function render(ctx) {
  mode = mode || store.pref('tasksView', 'headings');
  const t = D.today();
  const all = store.all('tasks');
  const tags = [...new Set(all.filter((x) => !x.done).map((x) => x.tag).filter(Boolean))].sort();
  if (tag && !tags.includes(tag)) tag = null;
  const open = all.filter((x) => !x.done && (!tag || x.tag === tag));

  const setMode = (v) => { mode = v; if (v !== 'done') store.setPref('tasksView', v); else ctx.rerender(); };

  let body;
  if (mode === 'done') body = doneList(all, t);
  else if (mode === 'dates') body = byDate(open, t);
  else body = byHeading(open, t, ctx);

  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', null, 'Tasks'),
      segmented([['headings', 'Headings'], ['dates', 'By date'], ['done', 'Done']], mode, setMode, { small: true })),
    section('', null,
      quickInput(mode === 'headings' ? 'Add a task (no heading) — try “Pay rent fri !high”' : 'Add a task — try “Pay rent fri !high #home”', (v) => {
        M.addTask(D.parseSmart(v));
      }, { key: 'task-add' }),
      tags.length ? h('div', { class: 'chips filter-chips' },
        h('button', { class: ['chip', !tag && 'on'], onclick: () => { tag = null; ctx.rerender(); } }, 'All'),
        tags.map((x) => h('button', { class: ['chip', tag === x && 'on'], onclick: () => { tag = tag === x ? null : x; ctx.rerender(); } }, `#${x}`))) : null,
      body));
}

function taskRow(x, t) {
  const row = h('li', {
    class: ['row', x.done && 'done', x.priority === 3 && 'p-high'], draggable: x.done ? null : 'true', 'data-task': x.id,
    onclick: () => E.editTask(x),
  },
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
  row.addEventListener('dragstart', (e) => { dragId = x.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.id); row.classList.add('dragging'); });
  row.addEventListener('dragend', () => { dragId = null; row.classList.remove('dragging'); });
  return row;
}

// Drop a dragged task onto a heading group.
function dropZone(el, headingId) {
  el.addEventListener('dragover', (e) => { if (dragId) { e.preventDefault(); el.classList.add('drop'); } });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
  el.addEventListener('drop', (e) => {
    e.preventDefault(); el.classList.remove('drop');
    const task = store.get('tasks', dragId || e.dataTransfer.getData('text/plain'));
    if (task && (task.heading || null) !== headingId) store.put('tasks', { ...task, heading: headingId });
  });
  return el;
}

function byHeading(open, t, ctx) {
  const heads = M.taskHeadings();
  const ids = new Set(heads.map((g) => g.id));
  const loose = open.filter((x) => !x.heading || !ids.has(x.heading)).sort(M.taskSort);
  const addHeadingInput = quickInput('New heading — e.g. “Work”, “Home”, “Trip to Goa”', (v) => M.addHeading(v), { key: 'heading-add' });
  addHeadingInput.classList.add('heading-add');

  return h('div', { class: 'headings' },
    loose.length || !heads.length ? dropZone(h('div', { class: 'group' },
      heads.length ? h('p', { class: 'sub-head' }, `No heading · ${loose.length}`) : null,
      loose.length ? h('ul', { class: 'list' }, loose.map((x) => taskRow(x, t))) : empty('Nothing on your plate. Nice.')), null) : null,
    heads.map((g, i) => {
      const items = open.filter((x) => x.heading === g.id).sort(M.taskSort);
      const doneCount = store.all('tasks').filter((x) => x.heading === g.id && x.done).length;
      return dropZone(h('div', { class: ['group', 'heading-group', g.collapsed && 'collapsed'] },
        h('div', { class: 'heading-row' },
          h('button', { class: 'heading-toggle', 'aria-expanded': String(!g.collapsed), onclick: () => store.put('taskGroups', { ...g, collapsed: !g.collapsed }) },
            h('span', { class: 'chev' }, icon('right', 16)), h('span', { class: 'heading-name' }, g.name),
            h('span', { class: 'count' }, `${items.length}${doneCount ? ` · ${doneCount} done` : ''}`)),
          h('button', { class: 'icon-btn sm', 'aria-label': `Options for ${g.name}`, onclick: () => headingMenu(g, i, heads) }, icon('dots', 18))),
        g.collapsed ? null : [
          items.length ? h('ul', { class: 'list' }, items.map((x) => taskRow(x, t))) : null,
          quickInput(`Add to ${g.name}`, (v) => M.addTask({ ...D.parseSmart(v), heading: g.id }), { key: `task-add-${g.id}` }),
        ]), g.id);
    }),
    addHeadingInput,
    heads.length ? h('p', { class: 'muted small' }, 'Tip: drag tasks between headings on a laptop, or change the heading inside a task.') : null);
}

function headingMenu(g, i, heads) {
  const name = h('input', { value: g.name });
  const move = (d) => () => {
    const j = i + d;
    if (j < 0 || j >= heads.length) return;
    const a = heads[i]; const b = heads[j];
    const ao = a.order ?? a.createdAt; const bo = b.order ?? b.createdAt;
    store.put('taskGroups', { ...a, order: bo });
    store.put('taskGroups', { ...b, order: ao === bo ? ao + (d > 0 ? -1 : 1) : ao });
    closeSheet();
  };
  sheet('Heading', h('div', { class: 'form' },
    name,
    h('div', { class: 'menu-list' },
      i > 0 ? h('button', { class: 'menu-item', onclick: move(-1) }, 'Move up') : null,
      i < heads.length - 1 ? h('button', { class: 'menu-item', onclick: move(1) }, 'Move down') : null,
      h('button', { class: 'menu-item', onclick: () => {
        const tasks = store.all('tasks').filter((x) => x.heading === g.id && x.done);
        tasks.forEach((x) => store.remove('tasks', x.id));
        closeSheet(); toast(`Cleared ${tasks.length} completed`);
      } }, 'Clear completed tasks'),
      h('button', { class: 'menu-item danger', onclick: () => {
        closeSheet();
        store.remove('taskGroups', g.id);
        toast(`Heading “${g.name}” deleted — its tasks moved to No heading`, { label: 'Undo', run: () => store.put('taskGroups', g) });
      } }, icon('trash', 18), 'Delete heading (keeps tasks)'))), {
    actions: [h('button', { class: 'btn primary', onclick: () => { if (name.value.trim()) store.put('taskGroups', { ...g, name: name.value.trim() }); closeSheet(); } }, 'Save')],
  });
}

function byDate(list, t) {
  const groups = [
    ['Overdue', list.filter((x) => x.due && x.due < t)],
    ['Today', list.filter((x) => x.due === t || (x.planned === t && !(x.due && x.due < t)))],
    ['Next 7 days', list.filter((x) => x.due && x.due > t && x.due <= D.addDays(t, 7) && x.planned !== t)],
    ['Later', list.filter((x) => x.due && x.due > D.addDays(t, 7) && x.planned !== t)],
    ['Someday', list.filter((x) => !x.due && x.planned !== t)],
  ].filter(([, g]) => g.length);
  return groups.length
    ? groups.map(([name, g]) => h('div', { class: 'group' },
        h('p', { class: ['sub-head', name === 'Overdue' && 'overdue'] }, `${name} · ${g.length}`),
        h('ul', { class: 'list' }, g.sort(M.taskSort).map((x) => taskRow(x, t)))))
    : empty('Nothing on your plate. Nice.');
}

function doneList(all, t) {
  const list = all.filter((x) => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  return list.length ? h('ul', { class: 'list' }, list.slice(0, 100).map((x) => taskRow(x, t))) : empty('Nothing completed yet.');
}
