// Notes: quick plain-text notes with search, pinning, checklists and dictation.
// The first line of a note is its title. Lines starting with "[ ]" or "[x]" become checkboxes.

import * as store from '../store.js';
import { shareButton } from '../share.js';
import * as D from '../dates.js';
import { h, icon, sheet, closeSheet, empty, toast, removeWithUndo } from '../ui.js';
import { dictateButton } from '../voice.js';
import { noteTitle } from '../graph.js';
import * as vault from '../vault.js';

let query = '';

const CHECK_RE = /^(\s*(?:[-*]\s*)?)\[( |x|X)\]\s?(.*)$/;

export function titleOf(n) {
  return noteTitle(n.text || '');
}

// "see [[Deep work|this]]" → text with tappable links that open the page on the knowledge map.
function linkify(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(/\[\[([^\[\]\n]+?)\]\]/g)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [target, ...alias] = m[1].split('|');
    out.push(h('a', { class: 'wikilink', href: `#/brain?n=${encodeURIComponent(target.split('#')[0].trim())}`, onclick: (e) => e.stopPropagation() }, alias.length ? alias.join('|') : target));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Titles a [[link]] can point to: vault pages, notes, books, shows and goals.
function linkTitles() {
  const titles = new Set(vault.all().filter((f) => !f.path.startsWith('raw/')).map((f) => f.path.split('/').pop().replace(/\.md$/i, '')));
  for (const n of store.all('notes')) titles.add(titleOf(n));
  for (const col of ['reading', 'watch', 'goals']) for (const r of store.all(col)) if (r.title) titles.add(r.title);
  return [...titles];
}

// Typing "[[" in a textarea suggests pages to link to.
export function linkSuggest(ta) {
  const box = h('div', { class: 'link-suggest', role: 'listbox' });
  box.hidden = true;
  const update = () => {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/\[\[([^\[\]\n|]*)$/);
    if (!m) { box.hidden = true; return; }
    const q = m[1].toLowerCase();
    const hits = linkTitles().filter((t) => t.toLowerCase().includes(q))
      .sort((a, b) => a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q) || a.length - b.length).slice(0, 6);
    if (m[1].trim() && !hits.some((t) => t.toLowerCase() === q)) hits.push(m[1].trim());
    box.replaceChildren(...hits.map((t) => h('button', { type: 'button', role: 'option', onmousedown: (e) => e.preventDefault(), onclick: () => {
      const start = before.length - m[1].length;
      const after = ta.value.slice(ta.selectionStart).replace(/^[^\[\]\n]*\]\]/, '');
      ta.value = `${ta.value.slice(0, start)}${t}]]${after}`;
      const caret = start + t.length + 2;
      ta.setSelectionRange(caret, caret);
      ta.focus();
      box.hidden = true;
      ta.dispatchEvent(new Event('input'));
    } }, t)));
    box.hidden = !hits.length;
  };
  ta.addEventListener('input', update);
  ta.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow')) update(); });
  ta.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
  return box;
}

function bodyOf(n) {
  const lines = (n.text || '').split('\n');
  const i = lines.findIndex((l) => l.trim());
  return lines.slice(i + 1).join('\n').trim();
}

export function render(ctx) {
  const q = query.trim().toLowerCase();
  const notes = store.all('notes')
    .filter((n) => !q || (n.text || '').toLowerCase().includes(q))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);

  const search = h('input', { type: 'search', class: 'quick', placeholder: 'Search notes', value: query, 'data-key': 'notes-search', autocomplete: 'off' });
  search.addEventListener('input', () => { query = search.value; ctx.rerender(); });

  const compose = h('textarea', { class: 'note-compose', rows: 3, placeholder: 'Write a note… (first line is the title, “[ ] item” makes a checklist)', 'data-key': 'note-compose' });
  const save = () => {
    const text = compose.value.trim();
    if (!text) return;
    store.put('notes', { text, pinned: false });
    compose.value = '';
    toast('Note saved');
  };
  compose.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  });

  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', null, 'Notes'),
      h('span', { class: 'muted small' }, `${store.all('notes').length} notes`)),
    h('section', { class: 'card' },
      h('div', { class: 'link-wrap' }, compose, linkSuggest(compose)),
      h('div', { class: 'compose-actions' },
        dictateButton(compose),
        h('span', { class: 'muted small hide-sm' }, '⌘/Ctrl + Enter to save'),
        h('button', { class: 'btn primary sm', onclick: save }, 'Save note'))),
    store.all('notes').length > 3 ? search : null,
    notes.length
      ? h('div', { class: 'notes-grid' }, notes.map((n) => noteCard(n)))
      : empty(q ? 'No notes match your search.' : 'No notes yet. Jot something above, or tap the mic and say “note …”.'));
}

function noteCard(n) {
  const body = bodyOf(n);
  const lines = body.split('\n').slice(0, 8);
  return h('article', { class: ['card', 'note-card', n.pinned && 'pinned'], onclick: () => editNote(n) },
    h('div', { class: 'note-head' },
      h('h3', null, titleOf(n)),
      h('button', {
        class: ['icon-btn', 'sm', n.pinned && 'active'], 'aria-label': n.pinned ? 'Unpin' : 'Pin', 'data-tip': n.pinned ? 'Unpin' : 'Pin to top',
        onclick: (e) => { e.stopPropagation(); store.put('notes', { ...n, pinned: !n.pinned }); },
      }, icon('pin', 17))),
    body ? h('div', { class: 'note-body' }, lines.map((l, i) => {
      const m = l.match(CHECK_RE);
      if (!m) return h('p', null, l ? linkify(l) : ' ');
      const checked = m[2].toLowerCase() === 'x';
      return h('label', { class: ['note-check', checked && 'done'], onclick: (e) => e.stopPropagation() },
        h('input', { type: 'checkbox', checked, onchange: () => toggleLine(n, i, !checked) }), h('span', null, linkify(m[3])));
    })) : null,
    h('p', { class: 'note-date' }, D.fmtDate(D.toStr(new Date(n.updatedAt)))));
}

// Toggle the checkbox on the i-th displayed body line (body = lines after the title, leading blanks trimmed).
function toggleLine(n, bodyIndex, on) {
  const lines = (n.text || '').split('\n');
  let idx = lines.findIndex((l) => l.trim()) + 1;
  while (idx < lines.length && !lines[idx].trim()) idx++;
  idx += bodyIndex;
  if (!lines[idx]) return;
  lines[idx] = lines[idx].replace(CHECK_RE, (_, pre, _x, rest) => `${pre}[${on ? 'x' : ' '}] ${rest}`);
  store.put('notes', { ...n, text: lines.join('\n') });
}

export function editNote(n = null) {
  let rec = n;
  let gone = false;
  const ta = h('textarea', { class: 'note-editor', rows: 14, placeholder: 'Start typing… type [[ to link another page', autofocus: true }, n ? n.text : '');
  let timer = null;
  const persist = () => {
    const text = ta.value;
    if (gone || (!rec && !text.trim())) return;
    if (rec && text === rec.text) return;
    rec = store.put('notes', { ...(rec || { pinned: false }), text });
  };
  ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(persist, 500); });
  const done = () => { clearTimeout(timer); persist(); closeSheet(); };
  const actions = [
    dictateButton(ta, { onDone: persist }),
    h('button', { class: 'btn ghost', onclick: () => { clearTimeout(timer); persist(); if (rec) { store.put('notes', { ...rec, pinned: !rec.pinned }); } closeSheet(); } }, icon('pin', 18), n?.pinned ? 'Unpin' : 'Pin'),
    h('button', { class: 'btn primary', onclick: done }, 'Done'),
  ];
  if (n) actions.unshift(h('button', { class: 'btn ghost', onclick: () => { clearTimeout(timer); persist(); closeSheet(); location.hash = `#/brain?n=${encodeURIComponent(titleOf({ text: ta.value }))}`; } }, icon('graph', 18), 'Map'));
  if (n) actions.unshift(shareButton(() => { const cur = { text: ta.value }; return { type: 'note', title: titleOf(cur), body: bodyOf(cur) }; }));
  if (n) actions.unshift(h('button', { class: 'btn danger ghost', onclick: () => { clearTimeout(timer); gone = true; closeSheet(); removeWithUndo('notes', n.id, 'Note deleted'); } }, icon('trash', 18), 'Delete'));
  const panel = sheet(n ? 'Note' : 'New note', h('div', { class: 'link-wrap' }, ta, linkSuggest(ta)), { actions });
  // Save whatever was typed if the sheet is dismissed another way.
  const obs = new MutationObserver(() => {
    if (!document.body.contains(panel)) { clearTimeout(timer); persist(); obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true });
}
