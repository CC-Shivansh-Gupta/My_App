// Making a habit should take seconds: pick an idea (everything is filled in for you) or type it in
// plain words — “read 20 pages on weekdays”, “gym 3 times a week” — and the form fills itself in.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import { habitDays } from '../intents.js';
import { h, icon, sheet, closeSheet, field, segmented, toast } from '../ui.js';

const ALL = [0, 1, 2, 3, 4, 5, 6];

export const COLORS = [['blue', '#2a78d6'], ['green', '#1f9d55'], ['teal', '#0e9aa7'], ['purple', '#7c5cd6'],
  ['pink', '#d6409f'], ['red', '#d03b3b'], ['orange', '#e8710a'], ['amber', '#c99000']];
export const colorOf = (hb) => COLORS.find(([k]) => k === hb?.color)?.[1] || COLORS[0][1];

export const WHEN = [['any', 'Anytime', '🕒'], ['morning', 'Morning', '🌅'], ['afternoon', 'Afternoon', '☀️'], ['evening', 'Evening', '🌙']];

const idea = (emoji, name, extra = {}) => ({ emoji, name, kind: 'check', freq: 'days', days: ALL, when: 'any', color: 'blue', ...extra });
export const IDEAS = [
  ['Health', [
    idea('💧', 'Drink water', { kind: 'count', target: 8, unit: 'glasses', color: 'teal', why: 'More energy, fewer headaches' }),
    idea('😴', 'In bed by 11', { when: 'evening', color: 'purple', why: 'Wake up rested' }),
    idea('🥗', 'Eat fruit & veg', { kind: 'count', target: 5, unit: 'servings', color: 'green' }),
    idea('💊', 'Take vitamins', { when: 'morning', color: 'amber' }),
    idea('🪥', 'Floss', { when: 'evening', color: 'teal' }),
  ]],
  ['Fitness', [
    idea('💪', 'Work out', { freq: 'week', perWeek: 3, color: 'red', why: 'Feel strong and sleep better' }),
    idea('🚶', 'Walk', { kind: 'count', target: 8000, unit: 'steps', color: 'green' }),
    idea('🤸', 'Stretch', { kind: 'count', target: 10, unit: 'min', when: 'morning', color: 'orange' }),
    idea('🏃', 'Run', { freq: 'week', perWeek: 2, color: 'orange' }),
    idea('🏋️', 'Push-ups', { kind: 'count', target: 30, unit: 'reps', color: 'red' }),
  ]],
  ['Mind', [
    idea('🧘', 'Meditate', { kind: 'count', target: 10, unit: 'min', when: 'morning', color: 'purple', why: 'A calmer head' }),
    idea('✍️', 'Journal', { when: 'evening', color: 'blue' }),
    idea('🙏', 'Write 3 gratitudes', { when: 'evening', color: 'amber' }),
    idea('📵', 'No phone first hour', { when: 'morning', color: 'pink' }),
    idea('🌳', 'Time outside', { kind: 'count', target: 20, unit: 'min', color: 'green' }),
  ]],
  ['Growth', [
    idea('📖', 'Read', { kind: 'count', target: 20, unit: 'pages', when: 'evening', color: 'blue', why: 'A book a month adds up' }),
    idea('🗣️', 'Practise a language', { kind: 'count', target: 15, unit: 'min', color: 'teal' }),
    idea('🎸', 'Practise an instrument', { freq: 'week', perWeek: 4, color: 'pink' }),
    idea('💻', 'Side project', { freq: 'week', perWeek: 3, color: 'purple' }),
    idea('📚', 'Study', { kind: 'count', target: 30, unit: 'min', days: [1, 2, 3, 4, 5], color: 'blue' }),
  ]],
  ['Life', [
    idea('🛏️', 'Make the bed', { when: 'morning', color: 'orange' }),
    idea('🧹', 'Tidy up 10 min', { when: 'evening', color: 'amber' }),
    idea('📞', 'Call family', { freq: 'week', perWeek: 2, color: 'green', why: 'Stay close' }),
    idea('🗓️', 'Plan tomorrow', { when: 'evening', days: [1, 2, 3, 4, 5], color: 'blue' }),
    idea('💰', 'Log spending', { when: 'evening', color: 'green' }),
  ]],
];

const EMOJIS = ['✅', '💧', '🏃', '🚶', '📖', '🧘', '💪', '🥗', '😴', '✍️', '🎸', '🧠', '🌅', '📵', '🪥', '💊', '🙏', '🧹', '📞', '💰', '🌳', '🗣️', '💻', '🛏️', '🍎', '🚴', '🏊', '🎨', '☀️', '❤️'];
const UNITS = ['times', 'glasses', 'pages', 'min', 'steps', 'reps', 'km'];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];
const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// "Every day" · "Weekdays" · "Mon, Wed, Fri" · "3× a week"
export function freqText(hb) {
  if (M.isWeekly(hb)) return Number(hb.perWeek) === 1 ? 'Once a week' : `${hb.perWeek}× a week`;
  const days = M.planDays(hb);
  if (days.length === 7) return 'Every day';
  if (same(days, WEEKDAYS)) return 'Weekdays';
  if (same(days, WEEKEND)) return 'Weekends';
  const order = store.pref('weekStart', 1) === 1 ? [1, 2, 3, 4, 5, 6, 0] : ALL;
  return order.filter((d) => days.includes(d)).map((d) => D.DAY_NAMES[d].slice(0, 3)).join(', ');
}

export const goalText = (hb) => (M.isCount(hb) ? `${fmtNum(hb.target)} ${hb.unit || 'times'}` : '');
export const fmtNum = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

// One line that reads the habit back: "20 pages · Weekdays · Evenings".
export function describe(hb) {
  const when = WHEN.find(([k]) => k === hb.when && k !== 'any');
  return [goalText(hb), freqText(hb), when ? `${when[1]}s` : ''].filter(Boolean).join(' · ');
}

// What a typed name says about the habit: days ("on weekdays"), a weekly count ("3 times a week") and an amount ("20 pages").
const NUM = { once: 1, twice: 2, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
export function readName(text) {
  const out = {};
  let name = text;
  const wk = name.match(/\s*,?\s*\b(\d|once|twice|one|two|three|four|five|six)(?:\s*(?:times?|x|×|days?))?\s*(?:a|per|each|every)\s+week\b/i);
  if (wk) {
    const n = NUM[wk[1].toLowerCase()] ?? Number(wk[1]);
    if (n >= 1 && n <= 6) { out.freq = 'week'; out.perWeek = n; name = name.replace(wk[0], ' '); }
  }
  const parsed = habitDays(name);
  if (!out.freq && parsed.days.length < 7) { out.freq = 'days'; out.days = parsed.days; }
  if (/\b(?:every\s*day|everyday|daily)\b/i.test(text)) { out.freq = out.freq || 'days'; out.days = out.days || ALL; }
  out.name = parsed.name || text.trim();
  const amt = out.name.match(/\b(\d+(?:[.,]\d+)?)\s*(pages?|glass(?:es)?|cups?|min(?:ute)?s?|hours?|hrs?|steps|reps|push-?ups|km|miles?|litres?|liters?|servings?|times)\b/i);
  if (amt) {
    out.kind = 'count';
    out.target = Number(amt[1].replace(',', '.'));
    out.unit = amt[2].toLowerCase().replace(/^minutes?$|^mins$/, 'min').replace(/^hrs?$/, 'hours');
  }
  return out;
}

// ---- The sheet -----------------------------------------------------------------------------------------
export function editHabit(hb = {}) {
  const isNew = !hb.id;
  const d = {
    name: hb.name || '', emoji: hb.emoji || '✅', color: hb.color || 'blue', kind: M.isCount(hb) ? 'count' : 'check',
    target: hb.target || 1, unit: hb.unit || 'times', freq: M.isWeekly(hb) ? 'week' : 'days',
    days: hb.days && hb.days.length ? [...hb.days] : [...ALL], perWeek: Number(hb.perWeek) || 3, when: hb.when || 'any', why: hb.why || '',
  };
  // What the person chose themselves; typing in the name only fills in the rest.
  const touched = { emoji: !isNew, freq: !isNew, kind: !isNew };

  const preview = h('div', { class: 'hf-preview' });
  const name = h('input', { class: 'hf-name', value: d.name, placeholder: 'e.g. Read 20 pages on weekdays', autocomplete: 'off', enterkeyhint: 'done', autofocus: isNew });
  const ideas = h('div', { class: 'hf-ideas' });
  const emojiRow = h('div', { class: 'chips hf-emoji' });
  const colorRow = h('div', { class: 'hf-colors' });
  const goal = h('div', { class: 'hf-block' });
  const often = h('div', { class: 'hf-block' });
  const when = h('div');
  const why = h('input', { value: d.why, placeholder: 'e.g. To have more energy for my kids', autocomplete: 'off' });
  why.addEventListener('input', () => { d.why = why.value; });

  const drawPreview = () => {
    const said = isNew ? readName(name.value) : {};
    const typed = (said.freq ? said.name : name.value.trim()) || '';
    const shown = { ...d, name: typed ? typed.charAt(0).toUpperCase() + typed.slice(1) : 'Your new habit', target: Number(d.target) || 1, perWeek: d.perWeek };
    if (shown.kind !== 'count') delete shown.target;
    if (shown.freq !== 'week') delete shown.perWeek;
    preview.replaceChildren(
      h('span', { class: 'hb-bubble lg', style: `--hc:${colorOf(d)};--p:66` }, h('span', null, d.emoji)),
      h('span', { class: 'hf-preview-text' }, h('b', null, shown.name), h('span', { class: 'row-sub' }, describe(shown))));
  };

  let cat = 0;
  const drawIdeas = () => {
    if (!isNew) return;
    ideas.replaceChildren(
      h('div', { class: 'tabs-scroll' }, segmented(IDEAS.map(([n], i) => [i, n]), cat, (i) => { cat = i; drawIdeas(); }, { small: true })),
      h('div', { class: 'chips' }, IDEAS[cat][1].map((x) => h('button', {
        type: 'button', class: 'chip idea-chip', style: `--hc:${colorOf(x)}`, onclick: () => useIdea(x),
      }, `${x.emoji} ${x.name}`))));
  };
  const useIdea = (x) => {
    Object.assign(d, { ...x, days: [...x.days], target: x.target || 1, unit: x.unit || 'times', perWeek: x.perWeek || 3, why: x.why || '' });
    name.value = x.name; why.value = d.why;
    Object.assign(touched, { emoji: true, freq: true, kind: true });
    drawAll();
  };

  const drawEmoji = () => {
    const suggested = M.habitEmoji(name.value);
    const list = [...new Set([d.emoji, suggested, ...EMOJIS])].slice(0, 24);
    const own = h('input', { class: 'hf-own-emoji', placeholder: '+', maxlength: 4, 'aria-label': 'Type any emoji' });
    own.addEventListener('input', () => { const v = own.value.trim(); if (v) { d.emoji = v; touched.emoji = true; drawPreview(); } });
    emojiRow.replaceChildren(...list.map((e) => h('button', {
      type: 'button', class: ['chip', 'emoji', e === d.emoji && 'on'], 'aria-label': `Icon ${e}`,
      onclick: () => { d.emoji = e; touched.emoji = true; drawEmoji(); drawPreview(); },
    }, e)), own);
  };

  const drawColors = () => colorRow.replaceChildren(...COLORS.map(([k, c]) => h('button', {
    type: 'button', class: ['swatch-btn', k === d.color && 'on'], style: `--hc:${c}`, 'aria-label': `Colour ${k}`, 'aria-pressed': String(k === d.color),
    onclick: () => { d.color = k; drawColors(); drawPreview(); },
  })));

  const drawGoal = () => {
    const parts = [segmented([['check', 'Just do it'], ['count', 'Hit a number']], d.kind, (k) => { d.kind = k; touched.kind = true; drawGoal(); drawPreview(); })];
    if (d.kind === 'count') {
      const target = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: d.target, class: 'hf-target', 'aria-label': 'Daily target' });
      const unit = h('input', { value: d.unit, class: 'hf-unit', placeholder: 'glasses, pages, min…', 'aria-label': 'Unit', autocomplete: 'off' });
      target.addEventListener('input', () => { d.target = Number(target.value) || 0; drawPreview(); });
      unit.addEventListener('input', () => { d.unit = unit.value.trim() || 'times'; drawPreview(); });
      parts.push(h('div', { class: 'hf-target-row' }, h('span', { class: 'muted' }, 'Each day:'), target, unit),
        h('div', { class: 'chips' }, UNITS.map((u) => h('button', { type: 'button', class: ['chip', 'sm', u === d.unit && 'on'], onclick: () => { d.unit = u; drawGoal(); drawPreview(); } }, u))));
    }
    goal.replaceChildren(...parts);
  };

  const order = store.pref('weekStart', 1) === 1 ? [1, 2, 3, 4, 5, 6, 0] : ALL;
  const drawOften = () => {
    const mode = d.freq === 'week' ? 'week' : d.days.length === 7 ? 'daily' : 'days';
    const parts = [segmented([['daily', 'Every day'], ['days', 'Some days'], ['week', 'Times a week']], mode, (m) => {
      touched.freq = true;
      if (m === 'week') d.freq = 'week';
      else { d.freq = 'days'; d.days = m === 'daily' ? [...ALL] : d.days.length === 7 ? [...WEEKDAYS] : d.days; }
      drawOften(); drawPreview();
    })];
    if (mode === 'days') {
      parts.push(h('div', { class: 'chips' }, order.map((x) => h('button', {
        type: 'button', class: ['chip', d.days.includes(x) && 'on'],
        onclick: () => { d.days = d.days.includes(x) ? d.days.filter((y) => y !== x) : [...d.days, x]; if (!d.days.length) d.days = [x]; touched.freq = true; drawOften(); drawPreview(); },
      }, D.DAY_NAMES[x].slice(0, 3)))));
    } else if (mode === 'week') {
      parts.push(h('div', { class: 'chips' }, [1, 2, 3, 4, 5, 6].map((n) => h('button', {
        type: 'button', class: ['chip', n === d.perWeek && 'on'], onclick: () => { d.perWeek = n; drawOften(); drawPreview(); },
      }, `${n}×`))), h('p', { class: 'field-hint' }, 'Any days you like. It stays on your list until the week’s count is done.'));
    }
    often.replaceChildren(...parts);
  };

  const drawWhen = () => when.replaceChildren(segmented(WHEN.map(([k, label, e]) => [k, `${e} ${label}`]), d.when, (k) => { d.when = k; drawWhen(); drawPreview(); }, { small: true }));

  const drawAll = () => { drawIdeas(); drawEmoji(); drawColors(); drawGoal(); drawOften(); drawWhen(); drawPreview(); };

  // Typing fills in what you haven't set yourself: icon, days, amount.
  name.addEventListener('input', () => {
    const r = readName(name.value);
    if (!touched.emoji) d.emoji = M.habitEmoji(name.value);
    if (!touched.freq) {
      d.freq = r.freq || 'days';
      if (r.freq === 'week') d.perWeek = r.perWeek;
      d.days = r.days || [...ALL];
      drawOften();
    }
    if (!touched.kind) {
      d.kind = r.kind || 'check';
      if (r.kind) { d.target = r.target; d.unit = r.unit; }
      drawGoal();
    }
    drawEmoji(); drawPreview();
  });

  const save = () => {
    const raw = name.value.trim();
    if (!raw) { name.focus(); return; }
    // "Read 20 pages on weekdays" → keep "Read 20 pages"; the days live in the schedule.
    const said = isNew ? readName(raw) : {};
    const clean = said.freq ? said.name || raw : raw;
    const rec = {
      ...hb, name: clean.charAt(0).toUpperCase() + clean.slice(1), emoji: d.emoji, color: d.color, when: d.when, why: d.why.trim(),
      kind: d.kind === 'count' && Number(d.target) > 0 ? 'count' : 'check', freq: d.freq,
      days: d.freq === 'week' ? [...ALL] : [...d.days].sort(),
    };
    if (rec.kind === 'count') { rec.target = Number(d.target); rec.unit = d.unit || 'times'; } else { delete rec.target; delete rec.unit; }
    if (d.freq === 'week') rec.perWeek = d.perWeek; else delete rec.perWeek;
    const saved = isNew ? M.addHabit(rec) : store.put('habits', rec);
    closeSheet();
    if (isNew) toast(`${saved.emoji} ${saved.name} added — tap ✓ when it’s done`, { label: 'View', run: () => { location.hash = `#/habits/${saved.id}`; } });
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } });

  const actions = [h('button', { class: 'btn primary', onclick: save }, isNew ? 'Start habit' : 'Save')];
  if (!isNew) {
    actions.unshift(h('button', { class: 'btn ghost', onclick: () => {
      store.put('habits', { ...hb, archived: true }); closeSheet();
      if (location.hash.startsWith(`#/habits/${hb.id}`)) location.hash = '#/habits';
      toast('Habit archived', { label: 'Undo', run: () => store.put('habits', { ...hb, archived: false }) });
    } }, 'Archive'));
  }

  drawAll();
  sheet(isNew ? 'New habit' : 'Edit habit', h('div', { class: 'form habit-form' },
    preview,
    field('What do you want to do?', name, isNew ? 'Plain words work: “gym 3 times a week”, “read 20 pages on weekdays”.' : null),
    isNew ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, h('span', null, icon('spark', 14), ' Or start from an idea')), ideas) : null,
    field('Goal', goal),
    field('How often', often),
    field('Time of day', when),
    field('Icon', emojiRow),
    field('Colour', colorRow),
    field('Why it matters (optional)', why, 'Shown when a streak is at risk. A good reason beats willpower.')), { actions });
}
