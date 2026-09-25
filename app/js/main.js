// App shell: navigation, routing, re-rendering, quick add, service worker.

import * as store from './store.js';
import * as sync from './sync.js';
import * as D from './dates.js';
import { h, icon, installTooltips, isSheetOpen, closeSheet } from './ui.js';
import { quickAdd } from './editors.js';
import { applyTheme } from './theme.js';
import * as today from './views/today.js';
import * as calendar from './views/calendar.js';
import * as tasks from './views/tasks.js';
import * as reading from './views/reading.js';
import * as habits from './views/habits.js';
import * as expenses from './views/expenses.js';
import * as news from './views/news.js';
import * as settings from './views/settings.js';

const ROUTES = {
  today: { title: 'Today', icon: 'today', view: today, add: 'todo' },
  calendar: { title: 'Calendar', icon: 'calendar', view: calendar, add: 'event' },
  tasks: { title: 'Tasks', icon: 'tasks', view: tasks, add: 'task' },
  habits: { title: 'Habits', icon: 'habits', view: habits, add: 'todo' },
  money: { title: 'Money', icon: 'money', view: expenses, add: 'expense' },
  reading: { title: 'Reading', icon: 'reading', view: reading, add: 'reading' },
  news: { title: 'News', icon: 'news', view: news, add: 'reading' },
  settings: { title: 'Settings', icon: 'settings', view: settings, add: 'todo' },
  more: { title: 'More', icon: 'more', view: { render: settings.renderMore }, add: 'todo' },
};
const SIDEBAR = ['today', 'calendar', 'tasks', 'habits', 'money', 'reading', 'news'];
const BOTTOM = ['today', 'calendar', 'tasks', 'habits', 'money', 'more'];

let current = null;
let currentDay = D.today();
const main = h('main', { id: 'main', tabindex: '-1' });
const sidebar = h('nav', { class: 'sidebar', 'aria-label': 'Sections' });
const bottom = h('nav', { class: 'bottombar', 'aria-label': 'Sections' });
const syncDot = h('span', { class: 'sync-dot' });

function route() {
  const name = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'today';
  return ROUTES[name] ? name : 'today';
}

function navLink(name, { badge } = {}) {
  const r = ROUTES[name];
  const active = current === name || (name === 'more' && ['reading', 'news', 'settings'].includes(current));
  return h('a', { href: `#/${name}`, class: ['nav-link', active && 'active'], 'aria-current': active ? 'page' : null },
    icon(r.icon), h('span', null, r.title), badge ? h('i', { class: 'nav-badge' }, badge > 99 ? '99+' : badge) : null);
}

function renderNav() {
  const newsCount = news.unseenCount();
  const st = sync.status();
  syncDot.className = ['sync-dot', !st.enabled ? 'off' : st.error ? 'bad' : st.busy ? 'busy' : 'ok'].join(' ');
  syncDot.setAttribute('data-tip', !st.enabled ? 'Sync is off — set it up in Settings'
    : st.error ? `Sync error: ${st.error}` : st.lastSync ? `Synced ${new Date(st.lastSync).toLocaleTimeString()}` : 'Syncing…');
  sidebar.replaceChildren(
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon.svg', alt: '', width: 28, height: 28 }), h('span', null, 'Daybook')),
    ...SIDEBAR.map((n) => navLink(n, { badge: n === 'news' ? newsCount : 0 })),
    h('div', { class: 'sidebar-foot' }, navLink('settings'), h('a', { href: '#/settings', class: 'sync-status' }, syncDot)));
  bottom.replaceChildren(...BOTTOM.map((n) => navLink(n, { badge: n === 'more' ? newsCount : 0 })));
}

export function rerender() {
  const name = route();
  if (name !== current && current) ROUTES[current].view.onLeave?.();
  const changedPage = name !== current;
  current = name;

  // Keep focus (e.g. in a quick-add box) across re-renders.
  const active = document.activeElement;
  const key = active?.getAttribute?.('data-key');
  const sel = key && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd, active.value] : null;

  let content;
  try {
    content = ROUTES[name].view.render({ rerender });
  } catch (e) {
    console.error(e);
    content = h('div', { class: 'page' }, h('p', { class: 'error' }, `Something went wrong: ${e.message}`));
  }
  main.replaceChildren(content);
  renderNav();
  document.title = `${ROUTES[name].title} · Daybook`;
  if (changedPage) window.scrollTo(0, 0);

  if (key) {
    const again = main.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (again) {
      again.focus({ preventScroll: true });
      if (sel) { again.value = sel[2]; again.setSelectionRange?.(sel[0], sel[1]); }
    }
  }
}

function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  store.load();

  const fab = h('button', { class: 'fab', 'aria-label': 'Add (N)', 'data-tip': 'Add something (N)',
    onclick: () => quickAdd({ kind: ROUTES[current].add }) }, icon('plus', 26));
  document.body.append(h('div', { class: 'shell' }, sidebar, main), bottom, fab);

  store.subscribe(() => rerender());
  sync.onStatus(() => renderNav());
  news.setRerender(rerender);
  window.addEventListener('hashchange', rerender);
  installTooltips();

  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape' && isSheetOpen()) { closeSheet(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n' || e.key === 'N' || e.key === '+') { e.preventDefault(); quickAdd({ kind: ROUTES[current].add }); }
    const jump = { t: 'today', c: 'calendar', k: 'tasks', h: 'habits', m: 'money', r: 'reading', w: 'news' }[e.key];
    if (jump && !isSheetOpen()) location.hash = `#/${jump}`;
  });

  // Roll over to a new day if the app stays open past midnight.
  const checkDay = () => {
    if (D.today() !== currentDay) { currentDay = D.today(); rerender(); }
  };
  setInterval(checkDay, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { checkDay(); news.load(); } });

  rerender();
  sync.start();
  news.load();

  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  }
}

boot();
