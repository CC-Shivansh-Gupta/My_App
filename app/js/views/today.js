// Today: the one screen you open every day — schedule, to-dos, habits, spend, reading, news.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import * as E from '../editors.js';
import { h, icon, section, checkbox, quickInput, empty, money, toast } from '../ui.js';
import { topNews } from './news.js';

let day = null; // date being viewed; null = follow the real "today"

export function render(ctx) {
  const t = D.today();
  const date = day || t;
  const isToday = date === t;
  const d = D.parse(date);

  const header = h('header', { class: 'page-head today-head' },
    h('div', null,
      h('p', { class: 'eyebrow' }, isToday ? greeting() : D.fmtDate(date)),
      h('h1', null, D.DAY_NAMES[d.getDay()] + ', ' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' }))),
    h('div', { class: 'day-nav' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => { day = D.addDays(date, -1); ctx.rerender(); } }, icon('left')),
      !isToday ? h('button', { class: 'btn ghost sm', onclick: () => { day = null; ctx.rerender(); } }, 'Today') : null,
      h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => { day = D.addDays(date, 1); ctx.rerender(); } }, icon('right'))));

  return h('div', { class: 'page' }, header,
    h('div', { class: 'grid-2' },
      h('div', { class: 'stack' }, todoCard(date, isToday), scheduleCard(date)),
      h('div', { class: 'stack' }, habitsCard(date), spendCard(date), readingCard(), isToday ? newsCard() : null)));
}

export function onLeave() { day = null; }

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}

function scheduleCard(date) {
  const evs = M.eventsOn(date);
  return section('Schedule',
    h('button', { class: 'btn ghost sm', onclick: () => E.editEvent({}, { date }) }, icon('plus', 16), 'Event'),
    evs.length
      ? h('ul', { class: 'list' }, evs.map((e) => h('li', { class: 'row event-row', onclick: () => E.editEvent(e, { occurrence: date }) },
          h('span', { class: 'ev-time' }, M.eventTimeLabel(e)),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, e.title),
            e.location ? h('span', { class: 'row-sub' }, e.location) : null))))
      : empty('Nothing scheduled.'));
}

function todoCard(date, isToday) {
  const todos = M.todosOn(date);
  const tasks = M.tasksForDay(date);
  const carry = isToday ? M.unfinishedBefore(date) : [];
  const done = todos.filter((x) => x.done).length;
  const total = todos.length;

  const row = (t) => h('li', { class: ['row', t.done && 'done'], onclick: () => E.editTodo(t) },
    checkbox(t.done, (v) => M.toggleTodo(t, v)),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t.title)));

  return section(isToday ? 'To-do today' : 'To-do',
    total ? h('span', { class: 'count' }, `${done}/${total}`) : null,
    quickInput('Add a to-do and press Enter', (v) => {
      const p = D.parseSmart(v, date);
      M.addTodo(p.title || v, p.date || date);
      if (p.date && p.date !== date) toast(`Added for ${D.fmtDate(p.date)}`);
    }, { key: `todo-${date}` }),
    todos.length || tasks.length ? null : empty(isToday ? 'A clear day. Add what matters most.' : 'No to-dos for this day.'),
    h('ul', { class: 'list' }, todos.map(row)),
    tasks.length ? h('div', { class: 'sub-block' },
      h('p', { class: 'sub-head' }, 'From your tasks'),
      h('ul', { class: 'list' }, tasks.map((t) => h('li', { class: 'row', onclick: () => E.editTask(t) },
        checkbox(false, (v) => M.toggleTask(t, v)),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t.title),
          h('span', { class: 'row-sub' }, taskMeta(t, date))))))) : null,
    carry.length ? h('div', { class: 'sub-block carry' },
      h('div', { class: 'sub-head-row' },
        h('p', { class: 'sub-head' }, `${carry.length} unfinished from earlier`),
        h('button', { class: 'btn ghost sm', onclick: () => {
          carry.forEach((c) => store.put('todos', { ...c, date }));
          toast(`Moved ${carry.length} to today`);
        } }, 'Move all to today')),
      h('ul', { class: 'list' }, carry.slice(0, 8).map((t) => h('li', { class: 'row' },
        checkbox(false, (v) => M.toggleTodo(t, v)),
        h('span', { class: 'row-main', onclick: () => E.editTodo(t) }, h('span', { class: 'row-title' }, t.title),
          h('span', { class: 'row-sub' }, D.fmtDate(t.date))),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Move to today', 'data-tip': 'Move to today',
          onclick: () => store.put('todos', { ...t, date }) }, icon('arrowRight', 18)))))) : null);
}

export function taskMeta(t, ref = D.today()) {
  const bits = [];
  if (t.due) bits.push(t.due < ref ? `Overdue · ${D.fmtDate(t.due)}` : `Due ${D.fmtDate(t.due)}`);
  else if (t.planned) bits.push('Planned for today');
  if (t.priority) bits.push(['', 'Low', 'Medium', 'High'][t.priority]);
  if (t.tag) bits.push(`#${t.tag}`);
  return bits.join(' · ');
}

function habitsCard(date) {
  const list = M.habits().filter((hb) => M.scheduledOn(hb, date) || M.isDone(hb.id, date));
  const done = list.filter((hb) => M.isDone(hb.id, date)).length;
  return section('Habits',
    list.length ? h('span', { class: 'count' }, `${done}/${list.length}`) : null,
    list.length
      ? h('div', { class: 'habit-chips' }, list.map((hb) => {
          const on = M.isDone(hb.id, date);
          const st = M.streak(hb, date);
          return h('button', {
            class: ['habit-chip', on && 'on'], 'aria-pressed': String(on),
            onclick: () => M.setDone(hb.id, date, !on),
          }, h('span', { class: 'habit-emoji' }, hb.emoji || '✅'),
          h('span', { class: 'habit-name' }, hb.name),
          st > 1 ? h('span', { class: 'habit-streak', 'data-tip': `${st}-day streak` }, `🔥${st}`) : null);
        }))
      : h('div', null, empty('No habits yet.'),
          h('button', { class: 'btn ghost sm', onclick: () => E.editHabit() }, icon('plus', 16), 'Add a habit')));
}

function spendCard(date) {
  const list = M.expensesBetween(date, date);
  const monthStart = date.slice(0, 8) + '01';
  const monthTotal = M.sum(M.expensesBetween(monthStart, date));
  return section('Spent',
    h('span', { class: 'count' }, `${money(M.sum(list))} · ${money(monthTotal, { compact: true })} this month`),
    quickInput('e.g. 250 lunch', (v) => {
      const p = D.parseExpense(v, date);
      if (!p.amount) { toast('Start with an amount, e.g. “250 lunch”'); return; }
      const e = M.addExpense(p);
      toast(`${money(e.amount)} · ${e.category}`, { label: 'Undo', run: () => store.remove('expenses', e.id) });
    }, { key: `spend-${date}` }),
    list.length ? h('ul', { class: 'list compact' }, list.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map((e) =>
      h('li', { class: 'row', onclick: () => E.editExpense(e) },
        h('span', { class: 'row-emoji' }, M.categoryEmoji(e.category)),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, e.note || e.category)),
        h('span', { class: 'amount' }, money(e.amount))))) : null);
}

function readingCard() {
  const list = store.all('reading').filter((r) => r.status === 'reading').slice(0, 4);
  if (!list.length) return null;
  return section('Reading now', h('a', { class: 'btn ghost sm', href: '#/reading' }, 'All'),
    h('ul', { class: 'list compact' }, list.map((r) => h('li', { class: 'row', onclick: () => E.editReading(r) },
      h('span', { class: 'row-emoji' }, M.readingIcon(r.type)),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.title),
        h('span', { class: 'progress' }, h('span', { style: { width: `${r.progress || 0}%` } }))),
      h('span', { class: 'row-sub' }, `${r.progress || 0}%`)))));
}

function newsCard() {
  const items = topNews(3);
  if (!items) return null;
  return section('For you', h('a', { class: 'btn ghost sm', href: '#/news' }, 'News'),
    items.length ? h('ul', { class: 'list compact' }, items.map((it) => h('li', { class: 'row' },
      h('a', { class: 'row-main', href: it.link, target: '_blank', rel: 'noopener' },
        h('span', { class: 'row-title' }, it.title),
        h('span', { class: 'row-sub' }, `${it.source} · ${it.category}`)))))
      : empty('No new matches. Tune your interests in News.'));
}
