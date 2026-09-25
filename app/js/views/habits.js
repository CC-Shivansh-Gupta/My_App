// Habits: tick off the week at a glance, then see streaks and trends.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import * as E from '../editors.js';
import { h, icon, section, empty, sheet, closeSheet, field, segmented, toast } from '../ui.js';
import * as V from '../vices.js';
import { ATTRS, SEVERITY } from '../gamify.js';
import * as C from '../charts.js';

export function render() {
  const t = D.today();
  const list = M.habits();
  const week = [...Array(7)].map((_, i) => D.addDays(t, i - 6));

  const head = h('header', { class: 'page-head' }, h('h1', null, 'Habits'),
    h('button', { class: 'btn primary sm', onclick: () => E.editHabit() }, icon('plus', 16), 'New habit'));

  if (!list.length) {
    return h('div', { class: 'page' }, head, vicesSection(), section('', null,
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
    vicesSection(),
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
      h('p', { class: 'small muted' }, 'Things you want to do less. Each slip costs XP; every clean day earns +2. Tap one to start:'),
      h('div', { class: 'chips' }, V.SUGGESTIONS.map(([emoji, name, penalty, attr]) => h('button', { class: 'chip', onclick: () => store.put('vices', { name, emoji, penalty, attr }) }, `${emoji} ${name}`)))));
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
