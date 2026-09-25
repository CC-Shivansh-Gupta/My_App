// Settings: sync, preferences, backups, install help.

import * as store from '../store.js';
import * as sync from '../sync.js';
import * as M from '../models.js';
import { h, icon, section, field, segmented, toast } from '../ui.js';
import { applyTheme } from '../theme.js';

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Daybook%20sync';

export function render(ctx) {
  return h('div', { class: 'page narrow' },
    h('header', { class: 'page-head' }, h('h1', null, 'Settings')),
    syncCard(ctx), prefsCard(ctx), categoriesCard(), archivedCard(), dataCard(), installCard());
}

function syncCard(ctx) {
  const st = sync.status();
  if (st.enabled) {
    return section('Sync across devices', h('span', { class: ['badge', st.error ? 'bad' : 'good'] }, st.error ? 'Error' : 'On'),
      h('p', { class: 'small' }, `Syncing as ${st.user || 'GitHub user'} through a secret gist. `,
        st.lastSync ? `Last synced ${new Date(st.lastSync).toLocaleString()}.` : 'Not synced yet.'),
      st.error ? h('p', { class: 'small error' }, st.error) : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: async () => { await sync.syncNow(); ctx.rerender(); toast(sync.status().error ? 'Sync failed' : 'Synced'); } }, icon('sync', 18), 'Sync now'),
        h('button', { class: 'btn ghost', onclick: () => { sync.disconnect(); ctx.rerender(); toast('Sync turned off on this device'); } }, 'Turn off on this device')));
  }
  const token = h('input', { type: 'password', placeholder: 'ghp_…', autocomplete: 'off', spellcheck: 'false' });
  const btn = h('button', { class: 'btn primary', onclick: async () => {
    if (!token.value.trim()) { token.focus(); return; }
    btn.disabled = true; btn.textContent = 'Connecting…';
    try {
      await sync.connect(token.value);
      toast('Sync is on');
    } catch (e) {
      toast(`Couldn’t connect: ${e.message}`);
    }
    ctx.rerender();
  } }, 'Connect');
  return section('Sync across devices', h('span', { class: 'badge' }, 'Off'),
    h('p', { class: 'small' }, 'Your data lives on this device. To see it on your phone, iPad and laptop, connect a free GitHub token — everything is stored in a private (secret) gist on your account. Do this once per device with the same token.'),
    h('ol', { class: 'small steps' },
      h('li', null, h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener' }, 'Create a token'), ' (classic, only the “gist” box ticked, set expiration to “No expiration”).'),
      h('li', null, 'Paste it below and press Connect.')),
    field('GitHub token', token), btn);
}

function prefsCard(ctx) {
  const cur = h('input', { value: store.pref('currency', '₹'), maxlength: 4, class: 'short' });
  cur.addEventListener('change', () => store.setPref('currency', cur.value.trim() || '₹'));
  const budget = h('input', { type: 'number', inputmode: 'decimal', value: store.pref('budget', '') || '', placeholder: 'none', class: 'short' });
  budget.addEventListener('change', () => store.setPref('budget', Number(budget.value) || 0));
  return section('Preferences', null,
    h('div', { class: 'form' },
      h('div', { class: 'row2' }, field('Currency symbol', cur), field('Monthly budget', budget)),
      field('Week starts on', segmented([[1, 'Monday'], [0, 'Sunday']], store.pref('weekStart', 1), (v) => { store.setPref('weekStart', v); })),
      field('Appearance', segmented([['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], localTheme(), (v) => {
        try { localStorage.setItem('daybook.theme', v); } catch { /* ignore */ }
        applyTheme(); ctx.rerender();
      }))));
}

function localTheme() {
  try { return localStorage.getItem('daybook.theme') || 'auto'; } catch { return 'auto'; }
}

function categoriesCard() {
  const ta = h('textarea', { rows: 6 }, M.categories().map(([n, e]) => `${e} ${n}`).join('\n'));
  ta.addEventListener('change', () => {
    const cats = ta.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(\S+)\s+(.+)$/);
      return m && /\p{Extended_Pictographic}/u.test(m[1]) ? [m[2].trim(), m[1]] : [l, '📦'];
    });
    if (cats.length) { store.setPref('categories', cats); toast('Categories saved'); }
  });
  return section('Expense categories', null,
    h('p', { class: 'small muted' }, 'One per line: an emoji, a space, then the name.'), ta);
}

function archivedCard() {
  const archived = store.all('habits').filter((x) => x.archived);
  if (!archived.length) return null;
  return section('Archived habits', null, h('ul', { class: 'list compact' }, archived.map((hb) => h('li', { class: 'row' },
    h('span', { class: 'row-main' }, `${hb.emoji || '✅'} ${hb.name}`),
    h('button', { class: 'btn ghost sm', onclick: () => store.put('habits', { ...hb, archived: false }) }, 'Restore')))));
}

function dataCard() {
  const file = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      store.merge(j.data || j);
      toast('Backup imported and merged');
    } catch (e) {
      toast(`Import failed: ${e.message}`);
    }
  });
  return section('Your data', null,
    h('p', { class: 'small muted' }, 'Everything is stored on your device (and in your gist if sync is on). Nothing is sent anywhere else.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost', onclick: exportData }, icon('download', 18), 'Export backup'),
      h('button', { class: 'btn ghost', onclick: () => file.click() }, icon('upload', 18), 'Import backup'), file,
      h('button', { class: 'btn danger ghost', onclick: () => {
        if (confirm('Erase all data on this device? (Synced data in your gist is not touched, but will sync back unless you turn sync off first.)')) {
          store.reset(); toast('All local data erased');
        }
      } }, icon('trash', 18), 'Erase this device')));
}

function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'daybook', exportedAt: new Date().toISOString(), data: store.snapshot() }, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `daybook-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function installCard() {
  return section('Install on your devices', null,
    h('ul', { class: 'small steps' },
      h('li', null, h('b', null, 'iPad / iPhone: '), 'open this page in Safari → Share → “Add to Home Screen”.'),
      h('li', null, h('b', null, 'Android: '), 'open in Chrome → ⋮ menu → “Install app” (or “Add to Home screen”).'),
      h('li', null, h('b', null, 'Laptop: '), 'in Chrome or Edge click the install icon in the address bar (or ⋮ → “Install Daybook”). On a Mac with Safari: File → “Add to Dock”.')),
    h('p', { class: 'small muted' }, 'It works offline. Tip: press N anywhere (on a keyboard) to add something.'));
}

// "More" page for phones: the sections that don't fit in the bottom bar.
export function renderMore() {
  const tiles = [['reading', 'Reading', 'What you’re reading & up next'], ['news', 'News', 'Papers, jobs & posts for you'],
    ['settings', 'Settings', 'Sync, budget, backup, install']];
  return h('div', { class: 'page narrow' },
    h('header', { class: 'page-head' }, h('h1', null, 'More')),
    h('div', { class: 'tiles' }, tiles.map(([k, name, sub]) => h('a', { class: 'tile card', href: `#/${k}` },
      icon(k, 26), h('span', null, h('b', null, name), h('small', null, sub))))));
}
