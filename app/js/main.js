// App shell: navigation, routing, re-rendering, quick add, service worker.

import * as store from './store.js';
import * as sync from './sync.js';
import * as D from './dates.js';
import { h, icon, installTooltips, isSheetOpen, closeSheet, toast } from './ui.js';
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
import * as brain from './views/brain.js';
import * as gym from './views/gym.js';
import * as goals from './views/goals.js';
import * as learn from './views/learnings.js';
import * as watch from './views/watch.js';
import * as routine from './views/routine.js';
import * as screen from './views/screen.js';
import * as stats from './views/stats.js';
import * as gamify from './gamify.js';
import * as friends from './views/friends.js';
import * as agent from './views/agent.js';
import * as jarvisView from './views/jarvis.js';
import * as hudView from './views/hud.js';
import * as jarvis from './jarvis/panel.js';
import * as llm from './jarvis/llm.js';
import * as asks from './jarvis/asks.js';
import * as convo from './jarvis/convo.js';
import * as P from './jarvis/protocols.js';
import * as world from './jarvis/world.js';
import * as home from './jarvis/home.js';
import * as promises from './jarvis/promises.js';
import * as persona from './jarvis/persona.js';
import * as proactive from './jarvis/proactive.js';
import * as companion from './jarvis/companion.js';
import * as notice from './jarvis/notice.js';
import { status as jarvisStatus } from './jarvis/status.js';
import * as social from './social.js';
import * as voice from './voice.js';
import * as G from './gym/model.js';
import { ROUTE_META, SIDEBAR, bottomTabs } from './routes.js';

const VIEWS = {
  today: [today, 'todo'], calendar: [calendar, 'event'], tasks: [tasks, 'task'], habits: [habits, 'todo'],
  goals: [goals, 'goal'], gym: [gym, 'todo'], money: [expenses, 'expense'], notes: [notes, 'note'], brain: [brain, 'note'],
  reading: [reading, 'reading'], news: [news, 'reading'], settings: [settings, 'todo'],
  friends: [friends, 'todo'], learn: [learn, 'learning'], watch: [watch, 'watch'], routine: [routine, 'track'], screen: [screen, 'todo'], stats: [stats, 'todo'], agent: [agent, 'todo'], jarvis: [jarvisView, 'todo'], hud: [hudView, 'todo'],
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
  const name = (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]) || 'today';
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
  const friendCount = social.unseenCount();
  const agentCount = agent.pendingCount();
  const st = sync.status();
  syncDot.className = ['sync-dot', !st.enabled ? 'off' : st.error ? 'bad' : st.busy ? 'busy' : 'ok'].join(' ');
  syncDot.setAttribute('data-tip', !st.enabled ? 'Sync is off — set it up in Settings'
    : st.error ? `Sync error: ${st.error}` : st.lastSync ? `Synced ${new Date(st.lastSync).toLocaleTimeString()}` : 'Syncing…');
  sidebar.replaceChildren(
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon.svg', alt: '', width: 28, height: 28 }), h('span', null, 'Daybook')),
    stats.levelChip(),
    ...SIDEBAR.map((n) => navLink(n, { badge: n === 'news' ? newsCount : n === 'friends' ? friendCount : n === 'agent' ? agentCount : 0 })),
    h('div', { class: 'sidebar-foot' }, navLink('settings'), h('a', { href: '#/settings', class: 'sync-status' }, syncDot)));
  const tabs = bottomTabs();
  const hidden = (k) => !tabs.includes(k);
  const moreBadge = (hidden('news') ? newsCount : 0) + (hidden('friends') ? friendCount : 0) + (hidden('agent') ? agentCount : 0);
  bottom.replaceChildren(...[...tabs, 'more'].map((n) => navLink(n, { badge: n === 'more' ? moreBadge : n === 'news' ? newsCount : n === 'friends' ? friendCount : n === 'agent' ? agentCount : 0 })));
  const w = G.activeWorkout();
  workoutPill.hidden = !w || current === 'gym';
  if (w) workoutPill.replaceChildren(icon('gym', 18), h('span', null, w.name), h('span', { class: 'w-clock' }, G.fmtClock((Date.now() - w.startedAt) / 1000)));
}

// Re-render at most once per microtask, and never re-entrantly (a blur handler that
// saves a field can fire while the old screen is being swapped out).
let renderQueued = false;
let rendering = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => { renderQueued = false; rerender(); });
}

export function rerender() {
  if (rendering) { scheduleRender(); return; }
  rendering = true;
  try { renderNow(); } finally { rendering = false; }
}

function renderNow() {
  const name = route();
  if (name !== current && current) ROUTES[current].view.onLeave?.();
  const changedPage = name !== current;
  current = name;
  document.body.classList.toggle('hud-mode', name === 'hud');

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
  if (changedPage && name === 'friends') socialTick();

  if (key) {
    const again = main.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (again) {
      again.focus({ preventScroll: true });
      if (sel) { again.value = sel[2]; again.setSelectionRange?.(sel[0], sel[1]); }
    }
  }
}

// Floating "+10 XP" after you complete something; a toast when you level up.
let lastXP = null;
let xpTimer = null;
function xpCheck() {
  clearTimeout(xpTimer);
  xpTimer = setTimeout(() => {
    const s = gamify.summary();
    if (lastXP !== null && s.total < lastXP) {
      const el = h('div', { class: 'xp-pop loss' }, `−${lastXP - s.total} XP`);
      document.body.append(el);
      setTimeout(() => el.remove(), 1400);
      if (s.level.level < gamify.levelFor(lastXP).level) toast(`Level down to ${s.level.level} 😬 — earn it back!`);
    }
    if (lastXP !== null && s.total > lastXP) {
      const gain = s.total - lastXP;
      const el = h('div', { class: 'xp-pop' }, `+${gain} XP`);
      document.body.append(el);
      setTimeout(() => el.remove(), 1400);
      const before = gamify.levelFor(lastXP).level;
      if (s.level.level > before) {
        const lv = h('div', { class: 'levelup' }, h('span', { class: 'big-emoji' }, '🎉'), h('b', null, `Level ${s.level.level}!`), h('span', null, s.level.rank));
        document.body.append(lv);
        voice.speak(`Level up! You're now level ${s.level.level}.`);
        setTimeout(() => lv.remove(), 2600);
      }
    }
    lastXP = s.total;
  }, 350);
}

// Friends: publish your summary a few seconds after changes; pull the group every few minutes.
let publishTimer = null;
function schedulePublish() {
  if (!social.groups().length) return;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => social.publish().catch(() => {}), 8000);
}
let lastSocial = 0;
async function socialTick(force = true) {
  if (!social.groups().length || document.visibilityState !== 'visible') return;
  // Every 30s while Friends is open, otherwise every 3 minutes.
  if (!force && Date.now() - lastSocial < (current === 'friends' ? 25000 : 170000)) return;
  lastSocial = Date.now();
  await social.publish().catch(() => {});
  if (await social.refreshAll().catch(() => false)) { if (current === 'friends') rerender(); else renderNav(); }
}

const go = (r) => { location.hash = `#/${r}`; };
function openVoice() {
  jarvis.open({ go });
}

// ---- Jarvis: plugins, protocols, speaking first --------------------------------------------------------
const inHud = () => current === 'hud';
const inConvo = () => inHud() || jarvis.isOpen();
let place = null; let lastLocate = 0;

function startJarvis() {
  convo.hooks.plugins = [P.plugin, home.plugin, world.plugin, promises.plugin];
  convo.hooks.persona = persona.prompt;
  convo.hooks.flavor = (res, info) => persona.flavor(res, info);
  P.init({
    run: (cmd) => convo.brain().run(cmd),
    announce: (res) => notice.show(res, { force: true, go, inConvo }),
    ui: (r) => { if (jarvis.isOpen() && r === 'hud') closeSheet(); go(r); },
    notify: (text) => notice.system(text, go),
    env: () => ({ status: jarvisStatus(), weather: world.cached(), place, user: persona.address(), home: home.connected(), now: new Date() }),
  });
  jarvis.startWake(go, { hud: inHud });
  companion.start();
  if (home.connected()) home.states().catch(() => {});
  setInterval(() => P.tick().catch((e) => console.warn('Protocols', e)), 15000);
  setInterval(lookAround, 60000);
  setTimeout(() => { welcome(); lookAround(); }, 2500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { P.tick().catch(() => {}); welcome(); setTimeout(lookAround, 1500); } else seenNow();
  });
}

// The proactive watcher: at most one thing at a time, never the same thing twice.
async function lookAround() {
  if (document.visibilityState !== 'visible' || proactive.mode() === 'off') return;
  if (convo.state.busy || convo.state.mode !== 'idle') return;
  seenNow();
  let arrived = null;
  const w = world.cfg();
  if (w.on && world.places().length && Date.now() - lastLocate > 5 * 60000) {
    lastLocate = Date.now();
    try { const at = world.nearPlace(await world.locate()); if (at && at.name !== place?.name) arrived = at; place = at; } catch { /* no location */ }
  }
  if (w.on && Date.now() - (w.cache?.at || 0) > 30 * 60000) world.weather().catch(() => {});
  const c = proactive.next({ now: new Date(), weather: world.cached(), arrived });
  if (!c) return;
  proactive.markSeen(c.key);
  notice.show(c, { go, inConvo });
}

// Back after a few hours: a short "while you were away".
const LAST = 'daybook.lastActive';
function seenNow() { try { localStorage.setItem(LAST, String(Date.now())); } catch { /* ignore */ } }
function welcome() {
  let last = 0;
  try { last = Number(localStorage.getItem(LAST)) || 0; } catch { /* ignore */ }
  seenNow();
  if (!last || Date.now() - last < 4 * 3600000 || proactive.mode() === 'off') return;
  const w = proactive.welcomeBack(last, { weather: world.cached() });
  if (w) notice.show(w, { go, inConvo });
}

function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  store.load();

  const fab = h('button', { class: 'fab', 'aria-label': 'Add (N)', 'data-tip': 'Add something (N)',
    onclick: () => quickAdd({ kind: ROUTES[current].add }) }, icon('plus', 26));
  const micFab = h('button', { class: 'fab mic-fab', 'aria-label': `${jarvis.name()} (V)`, 'data-tip': `Talk to ${jarvis.name()} (V)`,
    onclick: openVoice }, icon('mic', 24));
  document.body.append(h('div', { class: 'shell' }, sidebar, main), bottom, workoutPill, micFab, fab);

  let claudeReady = asks.answered().length;
  store.subscribe((source) => {
    if (source !== 'silent') scheduleRender();
    if (source === 'remote') {
      // Claude answered something you asked (via the agent): point to it, don't act on it.
      const n = asks.answered().length;
      if (n > claudeReady) toast(`✳️ Claude answered ${n === 1 ? 'your request' : `${n} requests`}`, { label: 'Review', run: () => { location.hash = '#/jarvis'; } });
      claudeReady = n;
    } else claudeReady = asks.answered().length;
    if (source === 'local') xpCheck();
    if (source !== 'silent') schedulePublish();
  });
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
    const jump = { d: 'hud', j: 'jarvis', t: 'today', c: 'calendar', k: 'tasks', h: 'habits', u: 'routine', g: 'goals', y: 'gym', m: 'money', o: 'notes', i: 'brain', l: 'learn', r: 'reading', b: 'watch', w: 'news', s: 'stats', f: 'friends', a: 'agent' }[e.key];
    if (jump && !isSheetOpen()) location.hash = `#/${jump}`;
  });

  // Roll over to a new day if the app stays open past midnight.
  const checkDay = () => {
    if (D.today() !== currentDay) { currentDay = D.today(); rerender(); }
  };
  setInterval(checkDay, 60000);
  // Keep the day tracker's running timer fresh without re-rendering.
  setInterval(() => {
    for (const el of document.querySelectorAll('.live-dur')) {
      const [hh, mm] = el.dataset.start.split(':').map(Number);
      const d = new Date(); const m = d.getHours() * 60 + d.getMinutes() - (hh * 60 + mm);
      el.textContent = m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.max(0, m)}m`;
    }
  }, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { checkDay(); news.load(); } });

  rerender();
  lastXP = gamify.summary().total;
  // Shared to Daybook (Android share sheet, or an iPhone Shortcut opening ?text=…): Jarvis reads it.
  const q = new URLSearchParams(location.search);
  const shared = ['title', 'text', 'url'].map((k) => q.get(k)).filter(Boolean).join('\n').trim();
  // The laptop companion (or a Siri Shortcut) opened Daybook to ask something: ?ask=…
  const ask = q.get('ask');
  if (ask) {
    history.replaceState(null, '', location.pathname + (location.hash || '#/today'));
    const here = (t) => jarvis.open({ go, text: t, spoken: true });
    if (companion.cfg().on) companion.askWhenConnected(ask, here); else setTimeout(() => here(ask), 300);
  } else if (shared || q.has('jarvis')) {
    history.replaceState(null, '', location.pathname + (location.hash || '#/today'));
    setTimeout(() => jarvis.open({ go, shared: shared || null, listen: !shared }), 300);
  }
  setTimeout(socialTick, 3000);
  setInterval(() => socialTick(false), 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') socialTick(); });
  gym.startTicker();
  startJarvis();
  let wakeOn = llm.cfg().wake;
  let keySync = 0;
  llm.onChange(() => {
    if (llm.cfg().wake !== wakeOn) { wakeOn = llm.cfg().wake; jarvis.startWake(go, { hud: inHud }); }
    clearTimeout(keySync); keySync = setTimeout(() => sync.syncNow(), 3000); // a new key reaches your other devices soon
  });
  sync.start();
  news.load();

  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  }
}

boot();
