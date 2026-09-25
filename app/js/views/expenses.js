// Money: log spending in one line, see where it goes.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import * as E from '../editors.js';
import { h, icon, section, quickInput, empty, money, toast } from '../ui.js';
import * as C from '../charts.js';

let cursor = null; // "YYYY-MM-01" of the month shown
let catFilter = null;
let showAll = false;

export function render(ctx) {
  const t = D.today();
  cursor = cursor || t.slice(0, 8) + '01';
  const monthEnd = D.addDays(D.addMonths(cursor, 1), -1);
  const isCurrent = D.monthKey(cursor) === D.monthKey(t);
  const upTo = isCurrent ? t : monthEnd;
  const list = M.expensesBetween(cursor, monthEnd);
  const total = M.sum(list);

  // Same period last month for a fair comparison.
  const prevStart = D.addMonths(cursor, -1);
  const prevUpTo = isCurrent ? D.addMonths(t, -1) : D.addDays(cursor, -1);
  const prevTotal = M.sum(M.expensesBetween(prevStart, prevUpTo));
  const delta = prevTotal ? (total - prevTotal) / prevTotal : null;

  const budget = Number(store.pref('budget', 0)) || 0;
  const month = D.parse(cursor);
  const go = (n) => { cursor = D.addMonths(cursor, n); showAll = false; ctx.rerender(); };

  // Daily columns
  const days = [];
  for (let d = cursor; d <= monthEnd; d = D.addDays(d, 1)) days.push(d);
  const byDay = Object.fromEntries(days.map((d) => [d, 0]));
  for (const e of list) byDay[e.date] = (byDay[e.date] || 0) + e.amount;
  const elapsed = days.filter((d) => d <= upTo).length || 1;
  const avg = total / elapsed;
  const daily = days.map((d) => ({
    label: D.parse(d).getDate(), value: d <= upTo ? byDay[d] : 0, highlight: d === t,
    tip: `${D.fmtDate(d, { relative: false })}: ${money(byDay[d])}`,
  }));

  // Categories
  const byCat = {};
  for (const e of list) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  // Last 6 months
  const months = [...Array(6)].map((_, i) => D.addMonths(cursor, i - 5));
  const monthly = months.map((m) => {
    const v = M.sum(M.expensesBetween(m, D.addDays(D.addMonths(m, 1), -1)));
    const md = D.parse(m);
    return { label: D.MONTH_NAMES[md.getMonth()].slice(0, 3), value: v, highlight: m === cursor,
      tip: `${D.MONTH_NAMES[md.getMonth()]} ${md.getFullYear()}: ${money(v)}` };
  });

  // Transactions grouped by day
  const shown = list.filter((e) => !catFilter || e.category === catFilter)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const groups = [];
  const limit = showAll ? Infinity : 30;
  for (const e of shown.slice(0, limit)) {
    if (!groups.length || groups[groups.length - 1][0] !== e.date) groups.push([e.date, []]);
    groups[groups.length - 1][1].push(e);
  }

  const projected = isCurrent && elapsed > 3 ? avg * days.length : null;

  return h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('h1', null, `${D.MONTH_NAMES[month.getMonth()]} ${month.getFullYear()}`),
      h('div', { class: 'day-nav' },
        h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => go(-1) }, icon('left')),
        !isCurrent ? h('button', { class: 'btn ghost sm', onclick: () => { cursor = null; ctx.rerender(); } }, 'This month') : null,
        h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => go(1) }, icon('right')))),
    h('div', { class: 'grid-2' },
      h('div', { class: 'stack' },
        h('section', { class: 'card hero' },
          h('p', { class: 'stat-label' }, isCurrent ? 'Spent this month' : 'Spent'),
          h('p', { class: 'hero-value' }, money(total)),
          h('p', { class: 'muted small' },
            delta === null ? `${money(avg)} a day on average` : [
              h('span', { class: delta > 0 ? 'delta-bad' : 'delta-good' }, `${delta > 0 ? '▲' : '▼'} ${Math.abs(Math.round(delta * 100))}%`),
              ` vs ${isCurrent ? 'same point last month' : 'previous month'} · ${money(avg)}/day`]),
          budget ? h('div', { class: 'budget' },
            C.meter(total / budget, { state: total > budget ? 'bad' : total > budget * 0.85 ? 'warn' : 'ok' }),
            h('p', { class: 'muted small' }, total > budget ? `${money(total - budget)} over budget of ${money(budget)}`
              : `${money(budget - total)} left of ${money(budget)}${projected ? ` · on track for ${money(projected)}` : ''}`))
            : projected ? h('p', { class: 'muted small' }, `On track for about ${money(projected)} this month`) : null,
          quickInput('Add expense — e.g. “250 lunch” or “40 uber yesterday”', (v) => {
            const p = D.parseExpense(v, isCurrent ? t : upTo);
            if (!p.amount) { toast('Start with an amount, e.g. “250 lunch”'); return; }
            const e = M.addExpense(p);
            toast(`${money(e.amount)} · ${M.categoryEmoji(e.category)} ${e.category}`, { label: 'Undo', run: () => store.remove('expenses', e.id) });
          }, { key: 'expense-add' })),
        section('Daily spending', null,
          list.length ? C.columns(daily, { fmt: (v) => money(v, { compact: true }), labelEvery: 5, avg }) : empty('No spending logged this month.')),
        section('Last 6 months', null, C.columns(monthly, { fmt: (v) => money(v, { compact: true }), height: 120 }))),
      h('div', { class: 'stack' },
        section('By category', catFilter ? h('button', { class: 'btn ghost sm', onclick: () => { catFilter = null; ctx.rerender(); } }, 'Show all') : null,
          cats.length ? C.hbars(cats.map(([c, v]) => ({
            key: c, label: `${M.categoryEmoji(c)} ${c}`, value: v, sub: `${Math.round((v / total) * 100)}%`,
            tip: `${c}: ${money(v)} (${Math.round((v / total) * 100)}% of month) · tap to filter`,
          })), { fmt: (x) => money(x), active: catFilter, onPick: (d) => { catFilter = catFilter === d.key ? null : d.key; ctx.rerender(); } })
            : empty('Categories appear once you log something.')),
        section(catFilter ? `${M.categoryEmoji(catFilter)} ${catFilter}` : 'Transactions',
          h('button', { class: 'btn ghost sm', onclick: () => E.editExpense({ date: isCurrent ? t : upTo }) }, icon('plus', 16), 'Detailed'),
          groups.length ? groups.map(([d, es]) => h('div', { class: 'group' },
            h('p', { class: 'sub-head spread' }, h('span', null, D.fmtDate(d)), h('span', null, money(M.sum(es)))),
            h('ul', { class: 'list compact' }, es.map((e) => h('li', { class: 'row', onclick: () => E.editExpense(e) },
              h('span', { class: 'row-emoji' }, M.categoryEmoji(e.category)),
              h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, e.note || e.category),
                e.note ? h('span', { class: 'row-sub' }, e.category) : null),
              h('span', { class: 'amount' }, money(e.amount))))))) : empty('Nothing here yet.'),
          shown.length > limit ? h('button', { class: 'btn ghost sm', onclick: () => { showAll = true; ctx.rerender(); } }, `Show all ${shown.length}`) : null))));
}
