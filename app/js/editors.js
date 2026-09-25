// Quick-add sheet plus full editor sheets for every kind of item.

import * as store from './store.js';
import { shareButton } from './share.js';
import * as D from './dates.js';
import * as M from './models.js';
import { h, sheet, closeSheet, field, segmented, toast, removeWithUndo, money, icon } from './ui.js';
import { dictateButton } from './voice.js';
import { addGoal, currentPeriod } from './views/goals.js';
import { addLearning } from './views/learnings.js';
import { addWatch } from './views/watch.js';
import { parseLog, track, logEntry } from './views/routine.js';

const KINDS = [['todo', 'To-do'], ['task', 'Task'], ['event', 'Event'], ['expense', 'Expense'], ['note', 'Note'], ['learning', 'Learning'],
  ['track', 'Time log'], ['goal', 'Goal'], ['reading', 'Book'], ['watch', 'Watch']];
const HINTS = {
  todo: 'e.g. “Buy milk” or “Call bank tomorrow”',
  task: 'e.g. “Finish report fri !high #work”',
  event: 'e.g. “Dentist tomorrow 3pm” or “Standup mon 9-9:30am”',
  expense: 'e.g. “250 lunch” or “1200 groceries yesterday”',
  reading: 'e.g. “Deep Work by Cal Newport”',
  note: 'Type or dictate a note',
  learning: 'What did you learn? e.g. “Compound interest beats timing the market”',
  track: 'What did you do? e.g. “9-11 deep work” — or “reading” to start a timer now',
  watch: 'e.g. “Dune movie on Prime” or “Severance show”',
  goal: 'e.g. “Read 24 books this year” or “Visit Japan someday”',
};

let lastKind = 'todo';

// ---- Quick add --------------------------------------------------------------------------
export function quickAdd({ kind, date, text = '' } = {}) {
  kind = kind || lastKind;
  const base = date || D.today();
  let category = null;
  const input = h('input', { class: 'qa-input', value: text, placeholder: HINTS[kind], autocomplete: 'off', enterkeyhint: 'done', autofocus: true });
  const preview = h('div', { class: 'qa-preview' });
  const extra = h('div', { class: 'qa-extra' });

  const update = () => {
    preview.replaceChildren(...previewFor(kind, input.value, base, category));
    if (kind === 'expense') {
      const parsed = D.parseExpense(input.value, base);
      const guess = category || M.normalizeCategory(parsed.category) || M.guessCategory(parsed.note);
      extra.replaceChildren(h('div', { class: 'chips' }, M.categories().map(([name, emoji]) =>
        h('button', { type: 'button', class: ['chip', name === guess && 'on'], onclick: () => { category = name; update(); input.focus(); } }, `${emoji} ${name}`))));
    } else extra.replaceChildren();
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); }
  });

  const save = () => {
    const v = input.value.trim();
    if (!v) return;
    const ok = saveQuick(kind, v, base, category);
    if (ok) { lastKind = kind; closeSheet(); toast(ok); }
  };

  const body = h('div', { class: 'qa' },
    segmented(KINDS, kind, (k) => { lastKind = k; quickAdd({ kind: k, date, text: input.value }); }, { small: true }),
    h('div', { class: 'qa-row' }, input, dictateButton(input)), preview, extra);
  sheet('Add', body, { actions: [h('button', { class: 'btn primary', onclick: save }, 'Add')] });
  update();
  requestAnimationFrame(() => input.focus());
}

function chip(text, cls) {
  return h('span', { class: ['pchip', cls] }, text);
}

function previewFor(kind, text, base, category) {
  if (!text.trim()) return [];
  if (kind === 'expense') {
    const p = D.parseExpense(text, base);
    const cat = category || M.normalizeCategory(p.category) || M.guessCategory(p.note);
    return [p.amount ? chip(money(p.amount)) : chip('Add an amount', 'warn'), p.note ? chip(p.note) : null,
      chip(`${M.categoryEmoji(cat)} ${cat}`), chip(D.fmtDate(p.date))];
  }
  if (kind === 'reading') {
    const { title, author } = splitBy(text);
    return [chip(title), author ? chip(`by ${author}`) : null];
  }
  if (kind === 'note') return [chip('📝 Note')];
  if (kind === 'learning') return [chip('💡 Learning'), chip('+10 XP')];
  if (kind === 'watch') return [chip(text.trim())];
  if (kind === 'track') {
    const p = parseLog(text, base);
    return p.running ? [chip(`⏱️ Start now: ${p.title}`)] : [chip(p.title), chip(`🕑 ${D.fmtTime(p.start)} – ${D.fmtTime(p.end)}`)];
  }
  if (kind === 'goal') {
    const g = goalFromText(text);
    return [chip(g.title), chip(g.horizon === 'life' ? '🌟 Life goal' : g.horizon === 'year' ? '📆 This year' : '🗓 This month')];
  }
  const p = D.parseSmart(text, base);
  const out = [chip(p.title || '…')];
  if (kind === 'event' || p.date) out.push(chip(`📅 ${D.fmtDate(p.date || base)}`));
  if (p.time) out.push(chip(`🕑 ${D.fmtTime(p.time)}${p.endTime ? ' – ' + D.fmtTime(p.endTime) : ''}`));
  if (p.priority) out.push(chip(['', 'Low', 'Medium', 'High'][p.priority] + ' priority'));
  if (p.tag) out.push(chip(`#${p.tag}`));
  return out;
}

// "Read 24 books this year" → year goal; "… someday" / "life: …" → life goal; default this month.
function goalFromText(text) {
  let horizon = 'month';
  const title = text
    .replace(/^\s*(life|year|yearly|month|monthly)\s*[:-]\s*/i, (_, w) => { horizon = /^life/i.test(w) ? 'life' : /^year/i.test(w) ? 'year' : 'month'; return ''; })
    .replace(/\s+(this|in the)\s+(year|month)\s*$/i, (_, _a, u) => { horizon = u.toLowerCase(); return ''; })
    .replace(/\s+(someday|one day|in (my )?life(time)?|before i die)\s*$/i, () => { horizon = 'life'; return ''; })
    .trim();
  return { title, horizon };
}

function splitBy(text) {
  const m = text.match(/^(.*?)\s+by\s+(.+)$/i);
  return m ? { title: m[1].trim(), author: m[2].trim() } : { title: text.trim(), author: '' };
}

function saveQuick(kind, text, base, category) {
  if (kind === 'expense') {
    const p = D.parseExpense(text, base);
    if (!p.amount) { toast('Type an amount, e.g. “250 lunch”'); return null; }
    M.addExpense({ ...p, category: category || p.category });
    return `Spent ${money(p.amount)}`;
  }
  if (kind === 'note') { store.put('notes', { text, pinned: false }); return 'Note saved'; }
  if (kind === 'learning') { addLearning({ text: text.replace(/^(til|today i learned)[:,]?\s*/i, '') }); return 'Learning saved'; }
  if (kind === 'watch') { addWatch({ title: text }); return 'Added to your watch list'; }
  if (kind === 'track') {
    const p = parseLog(text, base);
    if (p.running) { track(p.title, p.category); return `Tracking: ${p.title}`; }
    logEntry(p); return `Logged ${D.fmtTime(p.start)}–${D.fmtTime(p.end)}`;
  }
  if (kind === 'goal') { const g = goalFromText(text); addGoal({ title: g.title, horizon: g.horizon, period: currentPeriod(g.horizon) }); return 'Goal added'; }
  if (kind === 'reading') {
    const { title, author } = splitBy(text);
    const isUrl = /^https?:\/\//i.test(title);
    M.addReading({ title, author, url: isUrl ? title : '', type: isUrl ? 'article' : 'book' });
    return 'Added to reading list';
  }
  const p = D.parseSmart(text, base);
  if (!p.title) return null;
  if (kind === 'todo') { M.addTodo(p.title, p.date || base); return p.date && p.date !== D.today() ? `To-do added for ${D.fmtDate(p.date)}` : 'To-do added'; }
  if (kind === 'task') { M.addTask(p); return 'Task added'; }
  if (kind === 'event') {
    store.put('events', { title: p.title, date: p.date || base, time: p.time, endTime: p.endTime, allDay: !p.time, repeat: 'none', notes: '' });
    return `Event added for ${D.fmtDate(p.date || base)}`;
  }
  return null;
}

// ---- Shared form helpers ---------------------------------------------------------------------
function input(value, props = {}) {
  return h('input', { value: value ?? '', autocomplete: 'off', ...props });
}

function select(options, value) {
  return h('select', null, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}

function deleteBtn(col, id, label) {
  return h('button', { class: 'btn danger ghost', onclick: () => { closeSheet(); removeWithUndo(col, id, label); } }, icon('trash', 18), 'Delete');
}

// ---- Event ----------------------------------------------------------------------------------
export function editEvent(ev = {}, { date, occurrence } = {}) {
  const isNew = !ev.id;
  const title = input(ev.title, { placeholder: 'Title' });
  const dateIn = input(ev.date || date || D.today(), { type: 'date' });
  const allDay = h('input', { type: 'checkbox', checked: ev.allDay ?? !ev.time });
  const start = input(ev.time || '09:00', { type: 'time' });
  const end = input(ev.endTime || '', { type: 'time' });
  const repeat = select([['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday'],
    ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']], ev.repeat || 'none');
  const until = input(ev.until || '', { type: 'date' });
  const where = input(ev.location, { placeholder: 'Location (optional)' });
  const notes = h('textarea', { rows: 3, placeholder: 'Notes' }, ev.notes || '');
  const times = h('div', { class: 'row2' }, field('Starts', start), field('Ends', end));
  const untilField = field('Repeat until (optional)', until);
  const sync = () => {
    times.style.display = allDay.checked ? 'none' : '';
    untilField.style.display = repeat.value === 'none' ? 'none' : '';
  };
  allDay.addEventListener('change', sync);
  repeat.addEventListener('change', sync);

  const save = () => {
    if (!title.value.trim()) { title.focus(); return; }
    store.put('events', {
      ...ev, title: title.value.trim(), date: dateIn.value || D.today(), allDay: allDay.checked,
      time: allDay.checked ? null : start.value || null, endTime: allDay.checked ? null : end.value || null,
      repeat: repeat.value, until: repeat.value === 'none' ? null : until.value || null,
      location: where.value.trim(), notes: notes.value,
    });
    closeSheet();
  };
  const actions = [h('button', { class: 'btn primary', onclick: save }, 'Save')];
  if (!isNew && ev.repeat && ev.repeat !== 'none' && occurrence && occurrence !== ev.date) {
    actions.unshift(h('button', { class: 'btn ghost', onclick: () => {
      store.put('events', { ...ev, skip: [...(ev.skip || []), occurrence] });
      closeSheet(); toast('Removed this occurrence');
    } }, 'Skip this day'));
  }
  if (!isNew) actions.unshift(deleteBtn('events', ev.id, 'Event deleted'));
  sheet(isNew ? 'New event' : 'Edit event', h('div', { class: 'form' },
    title, field('Date', dateIn),
    h('label', { class: 'switch' }, allDay, h('span', null, 'All day')),
    times, field('Repeat', repeat), untilField, where, notes), { actions });
  sync();
}

// ---- To-do ----------------------------------------------------------------------------------
export function editTodo(t) {
  const title = input(t.title);
  const dateIn = input(t.date, { type: 'date' });
  const notes = h('textarea', { rows: 3, placeholder: 'Notes' }, t.notes || '');
  const save = () => {
    if (!title.value.trim()) return;
    store.put('todos', { ...t, title: title.value.trim(), date: dateIn.value || t.date, notes: notes.value });
    closeSheet();
  };
  sheet('To-do', h('div', { class: 'form' }, title, field('Day', dateIn), notes), {
    actions: [deleteBtn('todos', t.id, 'To-do deleted'),
      h('button', { class: 'btn ghost', onclick: () => { store.put('todos', { ...t, date: D.addDays(D.today(), 1) }); closeSheet(); toast('Moved to tomorrow'); } }, 'Tomorrow'),
      h('button', { class: 'btn primary', onclick: save }, 'Save')],
  });
}

// ---- Task -----------------------------------------------------------------------------------
export function editTask(t = {}) {
  const isNew = !t.id;
  const title = input(t.title, { placeholder: 'What needs doing?' });
  const due = input(t.due || '', { type: 'date' });
  const prio = select([['0', 'None'], ['1', 'Low'], ['2', 'Medium'], ['3', 'High']], String(t.priority || 0));
  const tags = [...new Set(store.all('tasks').map((x) => x.tag).filter(Boolean))];
  const tag = input(t.tag || '', { placeholder: 'e.g. work, home', list: 'tag-list' });
  const notes = h('textarea', { rows: 4, placeholder: 'Notes' }, t.notes || '');
  const heading = select([['', '— No heading —'], ...M.taskHeadings().map((g) => [g.id, g.name])], t.heading || '');
  const save = () => {
    if (!title.value.trim()) { title.focus(); return; }
    store.put('tasks', {
      ...t, title: title.value.trim(), due: due.value || null, priority: Number(prio.value),
      tag: tag.value.trim().replace(/^#/, '') || null, notes: notes.value, done: t.done || false,
      heading: heading.value || null,
    });
    closeSheet();
  };
  const actions = [h('button', { class: 'btn primary', onclick: save }, 'Save')];
  if (!isNew) {
    actions.unshift(h('button', { class: 'btn ghost', onclick: () => {
      store.put('tasks', { ...t, planned: t.planned === D.today() ? null : D.today() }); closeSheet();
    } }, t.planned === D.today() ? 'Unplan' : 'Do today'));
    actions.unshift(deleteBtn('tasks', t.id, 'Task deleted'));
  }
  sheet(isNew ? 'New task' : 'Task', h('div', { class: 'form' },
    title,
    h('div', { class: 'row2' }, field('Due', due), field('Priority', prio)),
    h('div', { class: 'row2' }, field('Heading', heading), field('Tag', tag)), h('datalist', { id: 'tag-list' }, tags.map((x) => h('option', { value: x }))),
    notes), { actions });
}

// ---- Reading --------------------------------------------------------------------------------
export function editReading(r = {}) {
  const isNew = !r.id;
  const title = input(r.title, { placeholder: 'Title' });
  const author = input(r.author, { placeholder: 'Author / source' });
  const url = input(r.url, { placeholder: 'Link (optional)', type: 'url', inputmode: 'url' });
  const type = select(M.READING_TYPES, r.type || 'book');
  const status = select(M.READING_STATUS, r.status || 'toread');
  const progress = input(r.progress || 0, { type: 'range', min: 0, max: 100, step: 5 });
  const progLabel = h('span', { class: 'field-hint' }, `${r.progress || 0}%`);
  progress.addEventListener('input', () => { progLabel.textContent = `${progress.value}%`; });
  let rating = r.rating || 0;
  const stars = h('div', { class: 'stars' });
  const drawStars = () => stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', {
    type: 'button', class: ['star', n <= rating && 'on'], 'aria-label': `${n} stars`,
    onclick: () => { rating = rating === n ? 0 : n; drawStars(); },
  }, icon('star', 22))));
  drawStars();
  const notes = h('textarea', { rows: 4, placeholder: 'Notes, highlights, takeaways' }, r.notes || '');
  const save = () => {
    if (!title.value.trim()) { title.focus(); return; }
    const st = status.value;
    store.put('reading', {
      ...r, title: title.value.trim(), author: author.value.trim(), url: url.value.trim(), type: type.value,
      status: st, progress: st === 'done' ? 100 : Number(progress.value), rating, notes: notes.value,
      startedAt: r.startedAt || (st !== 'toread' ? D.today() : null),
      finishedAt: st === 'done' ? r.finishedAt || D.today() : null,
    });
    closeSheet();
  };
  const actions = [h('button', { class: 'btn primary', onclick: save }, 'Save')];
  if (!isNew) {
    actions.unshift(shareButton(() => ({ type: r.type === 'paper' ? 'paper' : r.type === 'article' ? 'article' : 'book', title: title.value.trim() || r.title, author: author.value.trim(), url: url.value.trim(), kind: r.type, body: rating ? '★'.repeat(rating) : '' })));
    actions.unshift(deleteBtn('reading', r.id, 'Removed from reading list'));
  }
  sheet(isNew ? 'Add to reading list' : 'Reading', h('div', { class: 'form' },
    title, author, url,
    h('div', { class: 'row2' }, field('Type', type), field('Status', status)),
    field('Progress', progress, progLabel), field('Rating', stars), notes), { actions });
}

// ---- Habit ----------------------------------------------------------------------------------
const EMOJIS = ['💧', '🏃', '📖', '🧘', '💪', '🥗', '😴', '✍️', '🎸', '🧠', '🚭', '🌅', '📵', '🦷', '💊', '🙏'];

export function editHabit(hb = {}) {
  const isNew = !hb.id;
  const name = input(hb.name, { placeholder: 'e.g. Drink 2L water' });
  let emoji = hb.emoji || '✅';
  const emojiRow = h('div', { class: 'chips' });
  const drawEmoji = () => emojiRow.replaceChildren(...EMOJIS.map((e) => h('button', {
    type: 'button', class: ['chip', 'emoji', e === emoji && 'on'], onclick: () => { emoji = e; drawEmoji(); },
  }, e)));
  drawEmoji();
  let days = hb.days && hb.days.length ? [...hb.days] : [0, 1, 2, 3, 4, 5, 6];
  const dayRow = h('div', { class: 'chips' });
  const order = store.pref('weekStart', 1) === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const drawDays = () => dayRow.replaceChildren(...order.map((d) => h('button', {
    type: 'button', class: ['chip', days.includes(d) && 'on'],
    onclick: () => { days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d]; if (!days.length) days = [d]; drawDays(); },
  }, D.DAY_NAMES[d].slice(0, 3))));
  drawDays();
  const save = () => {
    if (!name.value.trim()) { name.focus(); return; }
    store.put('habits', { ...hb, name: name.value.trim(), emoji, days: days.sort() });
    closeSheet();
  };
  const actions = [h('button', { class: 'btn primary', onclick: save }, 'Save')];
  if (!isNew) {
    actions.unshift(h('button', { class: 'btn ghost', onclick: () => {
      store.put('habits', { ...hb, archived: true }); closeSheet();
      toast('Habit archived', { label: 'Undo', run: () => store.put('habits', { ...hb, archived: false }) });
    } }, 'Archive'));
  }
  sheet(isNew ? 'New habit' : 'Edit habit', h('div', { class: 'form' },
    name, field('Icon', emojiRow), field('Which days?', dayRow)), { actions });
}

// ---- Expense --------------------------------------------------------------------------------
export function editExpense(e = {}) {
  const isNew = !e.id;
  const amount = input(e.amount ?? '', { type: 'number', inputmode: 'decimal', step: '0.01', placeholder: '0' });
  const note = input(e.note, { placeholder: 'What was it for?' });
  const cat = select(M.categories().map(([n, em]) => [n, `${em} ${n}`]), e.category || 'Other');
  if (e.category && !M.categories().some(([n]) => n === e.category)) cat.append(h('option', { value: e.category, selected: true }, e.category));
  const dateIn = input(e.date || D.today(), { type: 'date' });
  note.addEventListener('change', () => { if (isNew) cat.value = M.guessCategory(note.value); });
  const save = () => {
    const a = Number(amount.value);
    if (!a) { amount.focus(); return; }
    store.put('expenses', { ...e, amount: Math.round(a * 100) / 100, note: note.value.trim(), category: cat.value, date: dateIn.value || D.today() });
    closeSheet();
  };
  const actions = [h('button', { class: 'btn primary', onclick: save }, 'Save')];
  if (!isNew) actions.unshift(deleteBtn('expenses', e.id, 'Expense deleted'));
  sheet(isNew ? 'New expense' : 'Expense', h('div', { class: 'form' },
    field(`Amount (${store.pref('currency', '₹')})`, amount), note,
    h('div', { class: 'row2' }, field('Category', cat), field('Date', dateIn))), { actions });
}
