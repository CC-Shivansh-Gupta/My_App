// News: papers, jobs and posts collected every few hours by the GitHub Action
// (scripts/fetch-news.mjs → data/news.json), ranked here against your interests.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import { h, icon, section, empty, segmented, toast } from '../ui.js';

export const DEFAULT_INTERESTS = ['machine learning', 'LLM', 'language model', 'agents', 'reinforcement learning',
  'computer vision', 'robotics', 'research scientist', 'ML engineer', 'remote'];

const SEEN_KEY = 'daybook.newsSeen.v1';
let feed = null;      // { generatedAt, items, sources }
let loading = null;
let loadError = null;
let loadedAt = 0;
let tab = 'foryou';
let editing = false;
let rerender = () => {};

export function setRerender(fn) {
  rerender = fn;
}

export function interests() {
  return store.pref('interests', DEFAULT_INTERESTS);
}

export function load(force = false) {
  if (loading) return loading;
  if (!force && feed && Date.now() - loadedAt < 10 * 60000) return Promise.resolve(feed);
  loading = fetch('data/news.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((j) => { feed = j; loadError = null; loadedAt = Date.now(); })
    .catch((e) => { loadError = e.message; loadedAt = Date.now(); if (!feed) feed = { items: [], sources: [] }; })
    .finally(() => { loading = null; rerender(); });
  return loading;
}

function patterns() {
  return interests().map((k) => {
    const esc = k.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+');
    return [k, new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(s|es)?(?=$|[^\\p{L}\\p{N}])`, 'iu')];
  });
}

function scored() {
  if (!feed) return [];
  const pats = patterns();
  const marks = Object.fromEntries(store.all('newsMarks').map((m) => [m.id, m.status]));
  return feed.items.map((it) => {
    const matches = [];
    let score = 0;
    for (const [k, re] of pats) {
      if (re.test(it.title)) { score += 3; matches.push(k); } else if (re.test(it.summary || '')) { score += 1; matches.push(k); }
    }
    return { ...it, score, matches, mark: marks[it.id] || null };
  });
}

function seen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []); } catch { return new Set(); }
}

function markSeen(ids) {
  const s = seen();
  ids.forEach((id) => s.add(id));
  const keep = new Set((feed?.items || []).map((i) => i.id));
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].filter((id) => keep.has(id)))); } catch { /* ignore */ }
}

const byRank = (a, b) => b.score - a.score || (b.published || '').localeCompare(a.published || '');

// For the Today screen and the nav badge.
export function topNews(n) {
  if (!feed) { load(); return null; }
  const s = seen();
  return scored().filter((i) => i.score > 0 && !i.mark && !s.has(i.id)).sort(byRank).slice(0, n);
}

export function unseenCount() {
  if (!feed) return 0;
  const s = seen();
  return scored().filter((i) => i.score > 0 && !i.mark && !s.has(i.id)).length;
}

export function onLeave() {
  if (feed) markSeen(scored().filter((i) => i.score > 0).map((i) => i.id));
}

export function render(ctx) {
  load();
  const items = scored();
  const s = seen();
  const cats = [...new Set(items.map((i) => i.category))];

  let list;
  if (tab === 'saved') list = items.filter((i) => i.mark === 'saved');
  else if (tab === 'foryou') list = items.filter((i) => i.score > 0 && i.mark !== 'hidden');
  else list = items.filter((i) => i.category === tab && i.mark !== 'hidden');
  list.sort(tab === 'foryou' ? byRank : (a, b) => (b.published || '').localeCompare(a.published || '') || b.score - a.score);

  const save = (it) => {
    store.put('newsMarks', { id: it.id, status: 'saved' });
    if (!store.all('reading').some((r) => r.url === it.link)) {
      M.addReading({ title: it.title, author: it.source, url: it.link, type: it.category === 'papers' ? 'paper' : 'article' });
      toast('Saved to your reading list');
    }
  };

  const row = (it) => h('li', { class: ['news-item', !s.has(it.id) && it.score > 0 && 'unseen'] },
    h('a', { class: 'news-main', href: it.link, target: '_blank', rel: 'noopener' },
      h('span', { class: 'news-title' }, it.title),
      h('span', { class: 'row-sub' }, [it.source, it.published ? timeAgo(it.published) : ''].filter(Boolean).join(' · ')),
      it.summary ? h('span', { class: 'news-sum' }, it.summary) : null,
      it.matches.length ? h('span', { class: 'chips' }, it.matches.slice(0, 4).map((m) => h('span', { class: 'pchip' }, m))) : null),
    h('div', { class: 'news-actions' },
      h('button', { class: ['icon-btn', 'sm', it.mark === 'saved' && 'active'], 'aria-label': 'Save to reading list', 'data-tip': it.mark === 'saved' ? 'Saved' : 'Save to reading list',
        onclick: () => (it.mark === 'saved' ? store.remove('newsMarks', it.id) : save(it)) }, icon('bookmark', 18)),
      tab !== 'saved' ? h('button', { class: 'icon-btn sm', 'aria-label': 'Hide', 'data-tip': 'Not interested',
        onclick: () => { store.put('newsMarks', { id: it.id, status: 'hidden' }); toast('Hidden', { label: 'Undo', run: () => store.remove('newsMarks', it.id) }); } }, icon('eyeOff', 18)) : null));

  const labels = { papers: 'Papers', jobs: 'Jobs', news: 'News' };
  const tabs = [['foryou', 'For you'], ...cats.map((c) => [c, labels[c] || c[0].toUpperCase() + c.slice(1)]), ['saved', 'Saved']];

  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', null, 'News'),
      h('button', { class: 'btn ghost sm', onclick: () => load(true) }, icon('sync', 16), loading ? 'Loading…' : 'Refresh')),
    interestsCard(ctx),
    h('div', { class: 'tabs-scroll' }, segmented(tabs, tab, (v) => { tab = v; ctx.rerender(); }, { small: true })),
    section('', null,
      !feed || loading && !feed.items.length ? empty('Loading…')
        : list.length ? h('ul', { class: 'list news-list' }, list.slice(0, 150).map(row))
        : empty(tab === 'foryou' ? (feed.items.length ? 'Nothing matches your interests right now. Add more keywords above.' : noFeedText()) : 'Nothing here.'),
      h('p', { class: 'muted small footnote' }, feedFooter())));
}

function noFeedText() {
  return loadError
    ? `No news file yet (${loadError}). It is built by the GitHub Action every few hours once the app is deployed.`
    : 'No items yet. The feed refreshes every few hours.';
}

function feedFooter() {
  if (!feed || !feed.generatedAt) return 'Sources are listed in news/sources.json in your GitHub repo.';
  const failed = (feed.sources || []).filter((x) => !x.ok).map((x) => x.name);
  return `Updated ${timeAgo(feed.generatedAt)} from ${(feed.sources || []).length} sources` +
    (failed.length ? ` (couldn’t reach: ${failed.join(', ')})` : '') + '. Edit news/sources.json in your repo to change sources.';
}

function interestsCard(ctx) {
  const list = interests();
  const input = h('input', { class: 'chip-input', placeholder: 'Add interest…', 'data-key': 'interest-add', enterkeyhint: 'done' });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      const v = input.value.trim();
      if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) store.setPref('interests', [...list, v]);
      input.value = '';
    }
  });
  if (!editing) {
    return h('div', { class: 'interests' },
      h('span', { class: 'muted small interests-summary' }, `Ranking by: ${list.join(', ') || 'nothing yet'}`),
      h('button', { class: 'btn ghost sm', onclick: () => { editing = true; ctx.rerender(); } }, 'Edit interests'));
  }
  return h('div', { class: 'interests' },
    list.map((k) => h('span', { class: 'chip on removable' }, k,
      h('button', { 'aria-label': `Remove ${k}`, onclick: () => store.setPref('interests', list.filter((x) => x !== k)) }, '×'))),
    input,
    h('button', { class: 'btn primary sm', onclick: () => { editing = false; ctx.rerender(); } }, 'Done'));
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 14) return `${d}d ago`;
  return D.fmtDate(D.toStr(new Date(iso)), { relative: false, weekday: false });
}
