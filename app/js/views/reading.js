// Reading list: what you're reading, what's next, what you've finished.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';
import * as E from '../editors.js';
import { h, icon, section, quickInput, empty, segmented, toast } from '../ui.js';

let tab = 'reading';

export function render(ctx) {
  const all = store.all('reading');
  const counts = Object.fromEntries(M.READING_STATUS.map(([k]) => [k, all.filter((r) => r.status === k).length]));
  const year = String(new Date().getFullYear());
  const finishedThisYear = all.filter((r) => r.status === 'done' && (r.finishedAt || '').startsWith(year)).length;

  let list = all.filter((r) => r.status === tab);
  if (tab === 'done') list.sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || ''));
  else list.sort((a, b) => b.updatedAt - a.updatedAt);

  const setStatus = (r, status) => {
    store.put('reading', {
      ...r, status, progress: status === 'done' ? 100 : r.progress,
      startedAt: r.startedAt || (status !== 'toread' ? D.today() : null),
      finishedAt: status === 'done' ? D.today() : null,
    });
    if (status === 'done') toast(`Finished “${r.title}” 🎉`);
  };

  const row = (r) => h('li', { class: 'row reading-row', onclick: () => E.editReading(r) },
    h('span', { class: 'row-emoji' }, M.readingIcon(r.type)),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, r.title),
      h('span', { class: 'row-sub' }, [r.author, r.url ? hostOf(r.url) : '', r.status === 'done' && r.finishedAt ? `Finished ${D.fmtDate(r.finishedAt)}` : '',
        r.rating ? '★'.repeat(r.rating) : ''].filter(Boolean).join(' · ')),
      r.status === 'reading' ? h('span', { class: 'progress-row' },
        h('span', { class: 'progress' }, h('span', { style: { width: `${r.progress || 0}%` } })),
        h('span', { class: 'row-sub' }, `${r.progress || 0}%`),
        h('button', { class: 'btn ghost xs', onclick: (e) => { e.stopPropagation(); store.put('reading', { ...r, progress: Math.min(100, (r.progress || 0) + 10) }); } }, '+10%')) : null),
    r.url ? h('a', { class: 'icon-btn sm', href: r.url, target: '_blank', rel: 'noopener', 'aria-label': 'Open link', onclick: (e) => e.stopPropagation() }, icon('external', 18)) : null,
    r.status === 'toread' ? h('button', { class: 'btn ghost xs', onclick: (e) => { e.stopPropagation(); setStatus(r, 'reading'); } }, 'Start') : null,
    r.status === 'reading' ? h('button', { class: 'btn ghost xs', onclick: (e) => { e.stopPropagation(); setStatus(r, 'done'); } }, 'Finish') : null);

  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', null, 'Reading'),
      h('span', { class: 'muted' }, `${finishedThisYear} finished in ${year}`)),
    section('', null,
      quickInput('Add a title, “Title by Author”, or paste a link', (v) => {
        const m = v.match(/^(.*?)\s+by\s+(.+)$/i);
        const isUrl = /^https?:\/\//i.test(v);
        M.addReading({
          title: m ? m[1] : v, author: m ? m[2] : '', url: isUrl ? v : '', type: isUrl ? 'article' : 'book',
          status: tab === 'done' ? 'done' : tab,
        });
      }, { key: 'reading-add' }),
      segmented(M.READING_STATUS.map(([k, l]) => [k, `${l} ${counts[k] ? counts[k] : ''}`.trim()]), tab, (v) => { tab = v; ctx.rerender(); }),
      list.length ? h('ul', { class: 'list' }, list.map(row))
        : empty({ reading: 'Nothing in progress. Start something from “Up next”.', toread: 'Your queue is empty. Save papers from News or add a book above.', done: 'Finished items show up here.' }[tab])));
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
