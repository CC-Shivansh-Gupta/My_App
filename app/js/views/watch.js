// Watch list: movies, shows, documentaries and videos — like the reading list,
// with episode tracking for shows.

import * as store from '../store.js';
import { shareButton } from '../share.js';
import * as D from '../dates.js';
import { h, icon, section, quickInput, empty, segmented, toast, sheet, closeSheet, field, removeWithUndo } from '../ui.js';

export const TYPES = [['movie', '🎬', 'Movie'], ['show', '📺', 'Show'], ['documentary', '🎞️', 'Documentary'], ['video', '▶️', 'Video / talk'], ['anime', '🌸', 'Anime'], ['other', '🍿', 'Other']];
export const STATUS = [['watching', 'Watching'], ['towatch', 'Up next'], ['done', 'Watched']];
const PLATFORMS = ['Netflix', 'Prime Video', 'Disney+ Hotstar', 'JioCinema', 'YouTube', 'Apple TV+', 'HBO Max', 'SonyLIV', 'Zee5', 'Theatre', 'Mubi', 'Crunchyroll'];

const emojiOf = (t) => (TYPES.find(([k]) => k === t) || TYPES[5])[1];
let tab = 'towatch';

// "Breaking Bad show", "Oppenheimer movie on Prime", "https://youtube.com/…"
export function guessType(text) {
  if (/youtube\.com|youtu\.be|vimeo|ted\.com/i.test(text)) return 'video';
  if (/\b(series|show|season|tv)\b/i.test(text)) return 'show';
  if (/\bdocumentar(y|ies)|docu\b/i.test(text)) return 'documentary';
  if (/\banime\b/i.test(text)) return 'anime';
  return 'movie';
}

export function addWatch({ title, type, status = 'towatch', platform = '', url = '' }) {
  let clean = title.trim();
  let plat = platform;
  clean = clean.replace(/\s+on\s+(netflix|prime(?: video)?|amazon prime|hotstar|disney\+?(?: hotstar)?|jiocinema|youtube|apple tv\+?|hbo(?: max)?|sonyliv|zee5|mubi|crunchyroll)\s*$/i, (_, p) => {
    const key = p.toLowerCase().split(' ')[0].replace(/\+$/, '');
    plat = PLATFORMS.find((x) => x.toLowerCase().split(/[\s+]/).includes(key)) || p.charAt(0).toUpperCase() + p.slice(1); return '';
  });
  clean = clean.replace(/\s+(?:the\s+)?(movie|film|show|series|tv show|documentary|anime)$/i, '').trim();
  const isUrl = /^https?:\/\//i.test(clean);
  const t = type || guessType(title);
  return store.put('watch', {
    title: clean, type: t, status, platform: plat, url: url || (isUrl ? clean : ''), rating: 0, notes: '',
    season: t === 'show' || t === 'anime' ? 1 : null, episode: t === 'show' || t === 'anime' ? 0 : null, episodesWatched: 0,
    startedAt: status === 'watching' ? D.today() : null, finishedAt: status === 'done' ? D.today() : null,
  });
}

function setStatus(w, status) {
  store.put('watch', { ...w, status, startedAt: w.startedAt || (status !== 'towatch' ? D.today() : null), finishedAt: status === 'done' ? D.today() : null });
  if (status === 'done') toast(`Watched “${w.title}” 🍿`, { label: 'Rate', run: () => editWatch({ ...w, status }) });
}

function nextEpisode(w) {
  store.put('watch', { ...w, status: 'watching', episode: (w.episode || 0) + 1, episodesWatched: (w.episodesWatched || 0) + 1, startedAt: w.startedAt || D.today() });
}

export function render(ctx) {
  const all = store.all('watch');
  const counts = Object.fromEntries(STATUS.map(([k]) => [k, all.filter((w) => w.status === k).length]));
  const year = String(new Date().getFullYear());
  const doneYear = all.filter((w) => w.status === 'done' && (w.finishedAt || '').startsWith(year)).length;
  const list = all.filter((w) => w.status === tab).sort((a, b) => (tab === 'done' ? (b.finishedAt || '').localeCompare(a.finishedAt || '') : b.updatedAt - a.updatedAt));

  const row = (w) => h('li', { class: 'row reading-row', onclick: () => editWatch(w) },
    h('span', { class: 'row-emoji' }, emojiOf(w.type)),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, w.title),
      h('span', { class: 'row-sub' }, [w.platform, w.season ? `S${w.season}${w.episode ? ` · E${w.episode}` : ''}` : '', w.recommendedBy ? `rec. by ${w.recommendedBy}` : '',
        w.status === 'done' && w.finishedAt ? D.fmtDate(w.finishedAt) : '', w.rating ? '★'.repeat(w.rating) : ''].filter(Boolean).join(' · '))),
    w.url ? h('a', { class: 'icon-btn sm', href: w.url, target: '_blank', rel: 'noopener', 'aria-label': 'Open link', onclick: (e) => e.stopPropagation() }, icon('external', 18)) : null,
    w.status !== 'done' && (w.type === 'show' || w.type === 'anime') ? h('button', { class: 'btn ghost xs', onclick: (e) => { e.stopPropagation(); nextEpisode(w); } }, '+1 ep') : null,
    w.status === 'towatch' && w.type !== 'show' && w.type !== 'anime' ? h('button', { class: 'btn ghost xs', onclick: (e) => { e.stopPropagation(); setStatus(w, 'watching'); } }, 'Start') : null,
    w.status !== 'done' ? h('button', { class: 'btn ghost xs', onclick: (e) => { e.stopPropagation(); setStatus(w, 'done'); } }, 'Watched') : null);

  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', null, 'Watch list'), h('span', { class: 'muted' }, `${doneYear} watched in ${year}`)),
    section('', null,
      quickInput('Add a movie, show or link — e.g. “Dune movie on Prime”', (v) => { addWatch({ title: v, status: tab }); toast('Added to your watch list'); }, { key: 'watch-add' }),
      segmented(STATUS.map(([k, l]) => [k, `${l} ${counts[k] || ''}`.trim()]), tab, (v) => { tab = v; ctx.rerender(); }),
      list.length ? h('ul', { class: 'list' }, list.map(row))
        : empty({ watching: 'Nothing in progress. Start something from “Up next”.', towatch: 'Your watch list is empty. Add something a friend recommended.', done: 'Things you finish show up here.' }[tab])));
}

export function editWatch(w = {}) {
  const isNew = !w.id;
  const title = h('input', { value: w.title || '', placeholder: 'Title' });
  const type = h('select', null, TYPES.map(([k, e, l]) => h('option', { value: k, selected: k === (w.type || 'movie') }, `${e} ${l}`)));
  const status = h('select', null, STATUS.map(([k, l]) => h('option', { value: k, selected: k === (w.status || 'towatch') }, l)));
  const platform = h('input', { value: w.platform || '', list: 'platforms', placeholder: 'Netflix, Prime…' });
  const url = h('input', { value: w.url || '', type: 'url', inputmode: 'url', placeholder: 'Link (optional)' });
  const season = h('input', { value: w.season ?? '', inputmode: 'numeric' });
  const episode = h('input', { value: w.episode ?? '', inputmode: 'numeric' });
  const epRow = h('div', { class: 'row2' }, field('Season', season), field('Episode', episode));
  const rec = h('input', { value: w.recommendedBy || '', placeholder: 'Who recommended it?' });
  let rating = w.rating || 0;
  const stars = h('div', { class: 'stars' });
  const drawStars = () => stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: ['star', n <= rating && 'on'], 'aria-label': `${n} stars`, onclick: () => { rating = rating === n ? 0 : n; drawStars(); } }, icon('star', 22))));
  drawStars();
  const notes = h('textarea', { rows: 3, placeholder: 'Thoughts, favourite scenes…' }, w.notes || '');
  const sync = () => { epRow.style.display = type.value === 'show' || type.value === 'anime' ? '' : 'none'; };
  type.addEventListener('change', sync);
  const save = () => {
    if (!title.value.trim()) { title.focus(); return; }
    const st = status.value;
    store.put('watch', {
      ...w, title: title.value.trim(), type: type.value, status: st, platform: platform.value.trim(), url: url.value.trim(),
      season: Number(season.value) || null, episode: Number(episode.value) || 0, recommendedBy: rec.value.trim(), rating, notes: notes.value,
      startedAt: w.startedAt || (st !== 'towatch' ? D.today() : null), finishedAt: st === 'done' ? w.finishedAt || D.today() : null,
    });
    closeSheet();
  };
  const actions = [h('button', { class: 'btn primary', onclick: save }, 'Save')];
  if (!isNew) {
    actions.unshift(shareButton(() => ({ type: 'watch', title: title.value.trim() || w.title, kind: type.value, platform: platform.value.trim(), url: url.value.trim(), body: [platform.value.trim(), rating ? '★'.repeat(rating) : ''].filter(Boolean).join(' · ') })));
    actions.unshift(h('button', { class: 'btn danger ghost', onclick: () => { closeSheet(); removeWithUndo('watch', w.id, 'Removed from watch list'); } }, icon('trash', 18), 'Delete'));
  }
  sheet(isNew ? 'Add to watch list' : 'Watch list', h('div', { class: 'form' }, title,
    h('div', { class: 'row2' }, field('Type', type), field('Status', status)),
    h('div', { class: 'row2' }, field('Platform', platform), field('Recommended by', rec)),
    h('datalist', { id: 'platforms' }, PLATFORMS.map((p) => h('option', { value: p }))),
    epRow, url, field('Rating', stars), notes), { actions });
  sync();
}
