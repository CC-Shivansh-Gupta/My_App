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
import * as notes from './views/notes.js';
import * as gym from './views/gym.js';
import * as goals from './views/goals.js';
import * as voice from './voice.js';
import * as G from './gym/model.js';
import { ROUTE_META, SIDEBAR, bottomTabs } from './routes.js';

const VIEWS = {
  today: [today, 'todo'], calendar: [calendar, 'event'], tasks: [tasks, 'task'], habits: [habits, 'todo'],
  goals: [goals, 'goal'], gym: [gym, 'todo'], money: [expenses, 'expense'], notes: [notes, 'note'],
  reading: [reading, 'reading'], news: [news, 'reading'], settings: [settings, 'todo'],
  more: [{ render: settings.renderMore }, 'todo'],
};
const ROUTES = Object.fromEntries(Object.entries(VIEWS).map(([k, [view, add]]) => [k, { ...ROUTE_META[k], view, add }]));

let current = null;
let currentDay = D.today();
const main = h('main', { id: 'main', tabindex: '-1' });
const sidebar = h('nav', { class: 'sidebar', 'aria-label': 'Sections' });
const bottom = h('nav', { class: 'bottombar', 'aria-label': 'Sections' });
const syncDot = h('span', { class: 'sync-dot' });
const workoutPill = h('a', { class: 'workout-pill', href: '#/gym' });

function route() {
  const name = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'today';
  return ROUTES[name] ? name : 'today';
}

function navLink(name, { badge } = {}) {
  const r = ROUTES[name];
  const active = current === name || (name === 'more' && Boolean(current) && !bottomTabs().includes(current));
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
  const tabs = bottomTabs();
  bottom.replaceChildren(...[...tabs, 'more'].map((n) => navLink(n, { badge: n === 'more' && !tabs.includes('news') ? newsCount : n === 'news' ? newsCount : 0 })));
  const w = G.activeWorkout();
  workoutPill.hidden = !w || current === 'gym';
  if (w) workoutPill.replaceChildren(icon('gym', 18), h('span', null, w.name), h('span', { class: 'w-clock' }, G.fmtClock((Date.now() - w.startedAt) / 1000)));
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

function openVoice() {
  voice.openVoice({ go: (r) => { location.hash = `#/${r}`; } });
}

function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  store.load();

  const fab = h('button', { class: 'fab', 'aria-label': 'Add (N)', 'data-tip': 'Add something (N)',
    onclick: () => quickAdd({ kind: ROUTES[current].add }) }, icon('plus', 26));
  const micFab = h('button', { class: 'fab mic-fab', 'aria-label': 'Voice (V)', 'data-tip': 'Voice assistant (V)',
    onclick: openVoice }, icon('mic', 24));
  document.body.append(h('div', { class: 'shell' }, sidebar, main), bottom, workoutPill, micFab, fab);

  store.subscribe((source) => { if (source !== 'silent') rerender(); });
  sync.onStatus(() => renderNav());
  news.setRerender(rerender);
  window.addEventListener('hashchange', rerender);
  installTooltips();

  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape' && isSheetOpen()) { closeSheet(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isSheetOpen()) return;
    if (e.key === 'n' || e.key === 'N' || e.key === '+') { e.preventDefault(); quickAdd({ kind: ROUTES[current].add }); return; }
    if (e.key === 'v' || e.key === 'V') { e.preventDefault(); openVoice(); return; }
    const jump = { t: 'today', c: 'calendar', k: 'tasks', h: 'habits', g: 'goals', y: 'gym', m: 'money', o: 'notes', r: 'reading', w: 'news' }[e.key];
    if (jump && !isSheetOpen()) location.hash = `#/${jump}`;
  });

  // Roll over to a new day if the app stays open past midnight.
  const checkDay = () => {
    if (D.today() !== currentDay) { currentDay = D.today(); rerender(); }
  };
  setInterval(checkDay, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { checkDay(); news.load(); } });

  rerender();
  gym.startTicker();
  sync.start();
  news.load();

  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  }
}

boot();
