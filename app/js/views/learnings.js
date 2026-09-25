// Learnings: a "today I learned" journal plus spaced-repetition review, so the
// things you learn actually stick (inspired by TIL logs, Readwise and Anki).

import * as store from '../store.js';
import { shareButton } from '../share.js';
import * as D from '../dates.js';
import { h, icon, section, empty, segmented, toast, sheet, closeSheet, field, removeWithUndo } from '../ui.js';
import { dictateButton } from '../voice.js';

export const TYPES = [['insight', '💡', 'Insight'], ['lesson', '🧭', 'Life lesson'], ['fact', '📌', 'Fact'], ['skill', '🛠️', 'Skill'], ['question', '❓', 'Question']];
const typeOf = (k) => TYPES.find(([id]) => id === k) || TYPES[0];

let tab = 'journal';
let topic = null;
let query = '';
let composeType = 'insight';
let rerender = () => {};

// ---- Model ---------------------------------------------------------------------------------------------
export function addLearning({ text, details = '', type = 'insight', topics = [], source = '' }) {
  return store.put('learnings', {
    text: text.trim(), details, type, topics, source, fav: false,
    interval: 1, due: D.addDays(D.today(), 1), reviewDates: [], noReview: false,
  });
}

export function dueCards(date = D.today()) {
  return store.all('learnings').filter((l) => !l.noReview && (l.due || '') <= date).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
}

// grade: 0 forgot · 1 remembered · 2 easy
export function review(l, grade) {
  const t = D.today();
  const interval = grade === 0 ? 1 : Math.max(2, Math.round((l.interval || 1) * (grade === 2 ? 3.2 : 2.2)));
  store.put('learnings', { ...l, interval, due: D.addDays(t, interval), reviewDates: [...(l.reviewDates || []).filter((d) => d !== t), t].slice(-60) });
}

export function allTopics() {
  const counts = {};
  for (const l of store.all('learnings')) for (const tp of l.topics || []) counts[tp] = (counts[tp] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

export function learningStreak() {
  const days = new Set(store.all('learnings').map((l) => D.toStr(new Date(l.createdAt))));
  let d = D.today();
  if (!days.has(d)) d = D.addDays(d, -1);
  let n = 0;
  while (days.has(d)) { n++; d = D.addDays(d, -1); }
  return n;
}

const parseTopics = (s) => [...new Set(s.split(/[,#]/).map((x) => x.trim().toLowerCase()).filter(Boolean))];

// ---- View ------------------------------------------------------------------------------------------------
export function render(ctx) {
  rerender = ctx.rerender;
  const due = dueCards().length;
  const tabs = segmented([['journal', 'Journal'], ['review', due ? `Review · ${due}` : 'Review'], ['topics', 'Topics']], tab, (v) => { tab = v; ctx.rerender(); }, { small: true });
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', null, 'Learnings'), tabs),
    tab === 'review' ? reviewTab() : tab === 'topics' ? topicsTab() : journalTab());
}

function journalTab() {
  const all = store.all('learnings');
  const text = h('textarea', { class: 'note-compose', rows: 2, placeholder: 'What did you learn today?', 'data-key': 'learn-text' });
  const topicsIn = h('input', { class: 'quick', placeholder: 'Topics (comma separated)', list: 'learn-topics', 'data-key': 'learn-topics' });
  const sourceIn = h('input', { class: 'quick', placeholder: 'Source — book, course, person… (optional)', list: 'learn-sources', 'data-key': 'learn-source' });
  const typeRow = h('div', { class: 'chips' }, TYPES.map(([k, e, l]) => h('button', {
    type: 'button', class: ['chip', composeType === k && 'on'], onclick: () => { composeType = k; typeRow.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', TYPES[i][0] === k)); },
  }, `${e} ${l}`)));
  const save = () => {
    if (!text.value.trim()) { text.focus(); return; }
    addLearning({ text: text.value, type: composeType, topics: parseTopics(topicsIn.value), source: sourceIn.value.trim() });
    toast('Learning saved · +10 XP');
  };
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } });
  const sources = [...new Set([...store.all('reading').map((r) => r.title), ...store.all('watch').map((w) => w.title), ...all.map((l) => l.source).filter(Boolean)])];

  const q = query.trim().toLowerCase();
  const list = all.filter((l) => (!topic || (l.topics || []).includes(topic)) && (!q || `${l.text} ${l.details} ${l.source}`.toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt - a.createdAt);
  const groups = [];
  for (const l of list) {
    const d = D.toStr(new Date(l.createdAt));
    if (!groups.length || groups[groups.length - 1][0] !== d) groups.push([d, []]);
    groups[groups.length - 1][1].push(l);
  }
  const week = all.filter((l) => l.createdAt > Date.now() - 7 * 86400000).length;
  const streak = learningStreak();
  const search = h('input', { type: 'search', class: 'quick', placeholder: 'Search learnings', value: query, 'data-key': 'learn-search' });
  search.addEventListener('input', () => { query = search.value; rerender(); });

  return h('div', { class: 'stack' },
    h('section', { class: 'card' },
      text, typeRow,
      h('div', { class: 'row2' }, topicsIn, sourceIn),
      h('datalist', { id: 'learn-topics' }, allTopics().map(([t]) => h('option', { value: t }))),
      h('datalist', { id: 'learn-sources' }, sources.map((s) => h('option', { value: s }))),
      h('div', { class: 'compose-actions' }, dictateButton(text), h('span', { class: 'muted small' }, `🔥 ${streak}-day streak · ${week} this week · ${all.length} total`), h('button', { class: 'btn primary sm', onclick: save }, 'Save'))),
    all.length > 4 ? search : null,
    topic ? h('div', { class: 'chips' }, h('button', { class: 'chip on removable', onclick: () => { topic = null; rerender(); } }, `#${topic}`, h('span', null, ' ×'))) : null,
    groups.length ? groups.map(([d, ls]) => h('div', { class: 'group' },
      h('p', { class: 'sub-head' }, D.fmtDate(d)),
      h('div', { class: 'learn-list' }, ls.map(learnCard))))
      : section('', null, empty(all.length ? 'Nothing matches.' : 'Your learning journal is empty. One line a day adds up — try “TIL …” with the mic.')));
}

function learnCard(l) {
  const [, emoji, label] = typeOf(l.type);
  return h('article', { class: ['card', 'learn-card', `lt-${l.type}`], onclick: () => editLearning(l) },
    h('div', { class: 'learn-top' },
      h('span', { class: 'learn-type', 'data-tip': label }, emoji),
      h('p', { class: 'learn-text' }, l.text),
      h('button', { class: ['icon-btn', 'sm', l.fav && 'active'], 'aria-label': 'Favourite', onclick: (e) => { e.stopPropagation(); store.put('learnings', { ...l, fav: !l.fav }); } }, icon('star', 16))),
    l.details ? h('p', { class: 'learn-details' }, l.details) : null,
    h('div', { class: 'learn-meta' },
      (l.topics || []).map((t) => h('button', { class: 'pchip', onclick: (e) => { e.stopPropagation(); topic = t; tab = 'journal'; rerender(); } }, `#${t}`)),
      l.source ? h('span', { class: 'muted small' }, `— ${l.source}`) : null));
}

export function editLearning(l) {
  const text = h('textarea', { rows: 3 }, l.text);
  const details = h('textarea', { rows: 3, placeholder: 'Details, example, or the answer (shown on the back of the review card)' }, l.details || '');
  const type = h('select', null, TYPES.map(([k, e, lab]) => h('option', { value: k, selected: k === l.type }, `${e} ${lab}`)));
  const topics = h('input', { value: (l.topics || []).join(', ') });
  const source = h('input', { value: l.source || '' });
  const noReview = h('input', { type: 'checkbox', checked: !l.noReview });
  sheet('Learning', h('div', { class: 'form' }, text, details, h('div', { class: 'row2' }, field('Type', type), field('Topics', topics)), field('Source', source),
    h('label', { class: 'switch' }, noReview, h('span', null, 'Include in review')),
    h('p', { class: 'muted small' }, `Next review: ${l.noReview ? 'off' : D.fmtDate(l.due || D.today())} · reviewed ${(l.reviewDates || []).length}×`)), {
    actions: [
      h('button', { class: 'btn danger ghost', onclick: () => { closeSheet(); removeWithUndo('learnings', l.id, 'Learning deleted'); } }, icon('trash', 18), 'Delete'),
      shareButton(() => ({ type: 'learning', title: text.value.trim(), body: details.value.trim(), topics: parseTopics(topics.value) })),
      h('button', { class: 'btn primary', onclick: () => {
        if (!text.value.trim()) return;
        store.put('learnings', { ...l, text: text.value.trim(), details: details.value.trim(), type: type.value, topics: parseTopics(topics.value), source: source.value.trim(), noReview: !noReview.checked });
        closeSheet();
      } }, 'Save'),
    ],
  });
}

// ---- Review (spaced repetition) ----------------------------------------------------------------------------
let revealed = false;

function reviewTab() {
  const cards = dueCards();
  const reviewedToday = store.all('learnings').filter((l) => (l.reviewDates || []).includes(D.today())).length;
  if (!cards.length) {
    const next = store.all('learnings').filter((l) => !l.noReview).sort((a, b) => (a.due || '').localeCompare(b.due || ''))[0];
    return section('', null, h('div', { class: 'review-done' },
      h('p', { class: 'big-emoji' }, reviewedToday ? '🎉' : '🌱'),
      h('h3', null, reviewedToday ? `All caught up — ${reviewedToday} reviewed today` : 'Nothing to review yet'),
      h('p', { class: 'muted' }, next ? `Next card is due ${D.fmtDate(next.due).toLowerCase()}.` : 'Learnings you save come back for review the next day, then at growing intervals.')));
  }
  const c = cards[0];
  const [, emoji, label] = typeOf(c.type);
  const hasBack = Boolean(c.details);
  const grade = (g) => { revealed = false; review(c, g); };
  return h('div', { class: 'stack review' },
    h('p', { class: 'muted small center' }, `${cards.length} due · ${reviewedToday} done today`),
    h('section', { class: 'card flash' },
      h('p', { class: 'muted small' }, `${emoji} ${label}${c.source ? ` · ${c.source}` : ''} · saved ${D.fmtDate(D.toStr(new Date(c.createdAt))).toLowerCase()}`),
      h('p', { class: 'flash-text' }, c.text),
      hasBack && revealed ? h('p', { class: 'flash-back' }, c.details) : null,
      (c.topics || []).length ? h('div', { class: 'learn-meta' }, c.topics.map((t) => h('span', { class: 'pchip' }, `#${t}`))) : null),
    hasBack && !revealed
      ? h('button', { class: 'btn primary big', onclick: () => { revealed = true; rerender(); } }, 'Show answer')
      : h('div', { class: 'grade-row' },
          h('button', { class: 'btn grade g0', onclick: () => grade(0) }, 'Forgot', h('small', null, '1 day')),
          h('button', { class: 'btn grade g1', onclick: () => grade(1) }, 'Remembered', h('small', null, `${Math.max(2, Math.round((c.interval || 1) * 2.2))} days`)),
          h('button', { class: 'btn grade g2', onclick: () => grade(2) }, 'Easy', h('small', null, `${Math.max(2, Math.round((c.interval || 1) * 3.2))} days`))),
    h('p', { class: 'muted small center' }, 'Reflect for a moment: how could you apply this today?'));
}

function topicsTab() {
  const ts = allTopics();
  if (!ts.length) return section('', null, empty('Add topics to your learnings (e.g. “psychology, investing”) to see them grouped here.'));
  const max = ts[0][1];
  return section(`${ts.length} topics`, null, h('div', { class: 'hbars' }, ts.map(([t, n]) => h('button', {
    class: 'hbar', type: 'button', onclick: () => { topic = t; tab = 'journal'; rerender(); },
  }, h('span', { class: 'hbar-label' }, `#${t}`), h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill', style: { width: `${(n / max) * 100}%` } })), h('span', { class: 'hbar-value' }, n)))));
}

// Today-screen card: resurfaces one learning.
export function todayCard() {
  const due = dueCards();
  const all = store.all('learnings');
  if (!all.length) return null;
  const pick = due[0] || all[Math.floor((Date.now() / 86400000) % all.length)];
  return section('From your learnings', h('a', { class: 'btn ghost sm', href: '#/learn' }, due.length ? `Review ${due.length}` : 'Open'),
    h('p', { class: 'learn-text' }, `${typeOf(pick.type)[1]} ${pick.text}`),
    pick.source ? h('p', { class: 'muted small' }, `— ${pick.source}`) : null);
}
