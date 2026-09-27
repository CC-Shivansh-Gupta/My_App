// HUD mode: full-screen, dark, for a laptop or an iPad on a stand. The orb in the middle (tap it,
// press Space, or say the wake word), your day as rings around it, what's next, systems status,
// running protocol timers, and a live feed of what Jarvis just did or noticed.

import * as D from '../dates.js';
import * as W from '../whisper.js';
import * as convo from '../jarvis/convo.js';
import * as P from '../jarvis/protocols.js';
import * as world from '../jarvis/world.js';
import { status } from '../jarvis/status.js';
import { createOrb } from '../jarvis/orb.js';
import { cameraButton, VIA } from '../jarvis/panel.js';
import { h, icon, s, money } from '../ui.js';

let orb = null;
let clockTimer = 0;
let detach = null;
let offConvo = null;
let offProto = null;
let keyHandler = null;
let live = null; // elements updated without a full re-render
let wx = null; let battery = null; let wxAt = 0;

export function onLeave() {
  clearInterval(clockTimer); clockTimer = 0;
  detach?.(); detach = null;
  offConvo?.(); offConvo = null;
  offProto?.(); offProto = null;
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

const talk = () => { W.unlockAudio(); convo.listen(); };

export function render(ctx) {
  if (!detach) {
    detach = convo.attach();
    offConvo = convo.subscribe((ev, data) => { if (ev === 'go') { location.hash = `#/${data}`; return; } updateLive(); });
    offProto = P.onChange(() => ctx.rerender());
    keyHandler = (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.key === ' ') { e.preventDefault(); talk(); }
      if (e.key === 'Escape') { if (convo.state.mode !== 'idle') convo.interrupt(); else location.hash = '#/today'; }
    };
    document.addEventListener('keydown', keyHandler);
    clockTimer = setInterval(tickClock, 1000);
    convo.warm();
  }
  if (Date.now() - wxAt > 15 * 60000) {
    wxAt = Date.now();
    wx = world.cached();
    if (world.cfg().on) world.weather().then((w) => { wx = w; ctx.rerender(); }).catch(() => {});
    world.battery().then((b) => { battery = b; });
  }
  orb = orb || createOrb({ label: `Talk to ${convo.name()} (Space)`, onTap: () => (convo.state.mode === 'speaking' ? convo.interrupt() : talk()) });

  const st = status();
  const now = new Date();
  live = {
    clock: h('div', { class: 'hud-clock' }, clockText(now)),
    secs: h('span', { class: 'hud-secs' }, String(now.getSeconds()).padStart(2, '0')),
    transcript: h('div', { class: 'hud-transcript', 'aria-live': 'polite' }),
    feed: h('ol', { class: 'hud-feed' }),
    mode: h('p', { class: 'hud-mode-label' }),
    timers: h('div', { class: 'hud-timers' }),
  };
  const typed = h('input', { class: 'hud-input', placeholder: `Talk or type to ${convo.name()}…`, 'data-key': 'hud-typed', autocomplete: 'off', enterkeyhint: 'send' });
  typed.addEventListener('keydown', (e) => { if (e.key === 'Enter' && typed.value.trim()) { convo.run(typed.value.trim()); typed.value = ''; } });
  const protocols = P.list().slice(0, 5);

  const page = h('div', { class: 'hud', 'data-mode': convo.state.mode },
    h('div', { class: 'hud-grid-bg', 'aria-hidden': 'true' }),
    h('header', { class: 'hud-top' },
      h('div', { class: 'hud-brand' }, h('span', { class: 'hud-name' }, convo.name().toUpperCase().split('').join('.')), live.mode),
      h('div', { class: 'hud-time' }, live.clock, live.secs, h('div', { class: 'hud-date' }, now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))),
      h('div', { class: 'hud-sys' },
        wx ? h('span', { class: 'hud-chip', 'data-tip': world.describe(wx) }, `${wx.emoji} ${wx.temp}°`) : world.cfg().on ? null : h('a', { class: 'hud-chip', href: '#/jarvis' }, '🌦️ Set up weather'),
        battery ? h('span', { class: 'hud-chip' }, `${battery.charging ? '⚡' : '🔋'} ${battery.level}%`) : null,
        h('button', { class: 'hud-icon', 'aria-label': 'Full screen', 'data-tip': 'Full screen', onclick: () => { (document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.())?.catch?.(() => {}); } }, icon('fit', 18)),
        h('a', { class: 'hud-icon', href: '#/today', 'aria-label': 'Leave HUD (Esc)', 'data-tip': 'Leave HUD (Esc)' }, icon('close', 18)))),
    h('div', { class: 'hud-main' },
      h('section', { class: 'hud-col' },
        panel('Today', h('div', { class: 'hud-rings' },
          ring(st.day, 'Day', `${Math.round(st.day * 100)}%`),
          ring(st.habits.total ? st.habits.done / st.habits.total : 0, 'Habits', `${st.habits.done}/${st.habits.total}`, st.habits.done === st.habits.total && st.habits.total ? 'good' : ''),
          ring(st.todos.total ? st.todos.done / st.todos.total : 0, 'To-dos', `${st.todos.done}/${st.todos.total}`),
          st.money.budget ? ring(Math.min(1, st.money.frac), 'Budget', `${Math.round(st.money.frac * 100)}%`, st.money.over ? 'bad' : st.money.ahead ? 'warn' : '') : null)),
        panel('Next', st.events.current ? h('p', { class: 'hud-now' }, h('b', null, 'Now '), `${st.events.current.title} · until ${D.fmtTime(st.events.current.endTime)}`) : null,
          st.events.upcoming.filter((e) => e !== st.events.current).length
            ? h('ul', { class: 'hud-list' }, st.events.upcoming.filter((e) => e !== st.events.current).map((e) => h('li', null, h('span', { class: 'hud-t' }, D.fmtTime(e.time)), e.title)))
            : h('p', { class: 'hud-dim' }, st.events.total ? 'Nothing else on the calendar today.' : 'A clear calendar.')),
        panel('Routine',
          st.routine.tracking ? h('p', null, h('b', null, '● '), `Tracking ${st.routine.tracking.title} since ${D.fmtTime(st.routine.tracking.start)}`) : null,
          st.routine.now ? h('p', null, `Now: ${st.routine.now.title} → ${D.fmtTime(st.routine.now.end)}`) : null,
          st.routine.next ? h('p', { class: 'hud-dim' }, `Next: ${st.routine.next.title} at ${D.fmtTime(st.routine.next.start)}`) : null,
          !st.routine.tracking && !st.routine.now && !st.routine.next ? h('p', { class: 'hud-dim' }, 'No routine blocks right now.') : null)),
      h('section', { class: 'hud-center' },
        h('div', { class: 'hud-orb' }, orb),
        live.timers,
        live.transcript),
      h('section', { class: 'hud-col' },
        st.xp ? panel('Systems', h('div', { class: 'hud-rings' },
          ring(st.xp.frac, `Level ${st.xp.level}`, st.xp.rank),
          h('div', { class: 'hud-stats' },
            stat(`${st.xp.today >= 0 ? '+' : ''}${st.xp.today}`, 'XP today'), stat(st.xp.streak, 'day streak'),
            stat(st.tasks.overdue, 'overdue', st.tasks.overdue ? 'warn' : ''), stat(money(st.money.spent, { compact: true }), 'this month', st.money.over ? 'bad' : ''))),
        st.streaks.length ? h('p', { class: 'hud-dim small' }, st.streaks.map((x) => `${x.emoji} ${x.name} ${x.n}d`).join(' · ')) : null,
        st.waiting.claude || st.waiting.agent ? h('p', null, h('a', { href: '#/jarvis' }, `✳️ ${st.waiting.claude} from Claude`), ' · ', h('a', { href: '#/agent' }, `${st.waiting.agent} suggestions`)) : null) : null,
        panel('Feed', live.feed))),
    h('footer', { class: 'hud-bottom' },
      protocols.length ? h('div', { class: 'hud-protocols' }, protocols.map((p) => h('button', { class: 'hud-proto', onclick: () => convo.run(`engage ${p.name} protocol`) }, icon('shield', 14), p.name))) : h('a', { class: 'hud-proto', href: '#/jarvis' }, icon('shield', 14), 'Add protocols'),
      h('div', { class: 'hud-ask' }, typed, cameraButton(() => { const v = typed.value.trim(); typed.value = ''; return v; }),
        h('button', { class: 'hud-mic', 'aria-label': 'Talk (Space)', onclick: talk }, icon('mic', 22)))));
  updateLive();
  requestAnimationFrame(() => orb.wake());
  return page;
}

function panel(title, ...children) {
  return h('div', { class: 'hud-panel' }, h('h2', { class: 'hud-h' }, title), ...children);
}

function stat(v, label, tone = '') {
  return h('div', { class: ['hud-stat', tone] }, h('b', null, String(v)), h('span', null, label));
}

// A thin progress ring with a value in the middle.
function ring(frac, label, value, tone = '') {
  const r = 26; const c = 2 * Math.PI * r;
  return h('div', { class: ['hud-ring', tone] },
    s('svg', { viewBox: '0 0 64 64', width: 64, height: 64, 'aria-hidden': 'true' },
      s('circle', { cx: 32, cy: 32, r, class: 'hud-ring-track' }),
      s('circle', { cx: 32, cy: 32, r, class: 'hud-ring-fill', 'stroke-dasharray': `${(Math.max(0, Math.min(1, frac)) * c).toFixed(1)} ${c.toFixed(1)}`, transform: 'rotate(-90 32 32)' })),
    h('b', null, value), h('span', null, label));
}

const clockText = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function tickClock() {
  if (!live?.clock.isConnected) return;
  const d = new Date();
  live.clock.textContent = clockText(d);
  live.secs.textContent = String(d.getSeconds()).padStart(2, '0');
  drawTimers();
}

function drawTimers() {
  const now = Date.now();
  live.timers.replaceChildren(...P.timers(now).map((x) => {
    const left = Math.max(0, x.endsAt - now);
    const frac = 1 - left / (x.endsAt - x.startedAt);
    const m = Math.floor(left / 60000); const sec = Math.floor((left % 60000) / 1000);
    return h('div', { class: 'hud-timer' },
      h('div', { class: 'hud-timer-bar' }, h('i', { style: { width: `${(frac * 100).toFixed(1)}%` } })),
      h('span', null, `${x.label}`), h('b', null, `${m}:${String(sec).padStart(2, '0')}`),
      h('button', { class: 'hud-icon', 'aria-label': `Cancel ${x.label}`, onclick: () => P.cancel({ name: x.run }) }, icon('close', 14)));
  }));
}

const MODE = { idle: 'Standing by', listening: 'Listening', thinking: 'Processing', speaking: 'Speaking' };

function updateLive() {
  if (!live) return;
  const st = convo.state;
  live.mode.textContent = st.status && st.mode === 'idle' && !st.status.startsWith('“') ? st.status : MODE[st.mode] || '';
  live.clock.closest('.hud')?.setAttribute('data-mode', st.mode);
  const log = convo.log;
  const lastYou = [...log].reverse().find((x) => x.who === 'you');
  const thinking = log.find((x) => x.thinking);
  const lastBot = [...log].reverse().find((x) => x.who === 'jarvis' && x.res);
  live.transcript.replaceChildren(...[
    st.mode === 'listening' ? h('p', { class: 'hud-you' }, st.interim ? `“${st.interim}”` : 'Listening…')
      : lastYou ? h('p', { class: 'hud-you' }, lastYou.text) : h('p', { class: 'hud-dim' }, 'Tap the orb, press Space, or say my name.'),
    thinking ? h('p', { class: 'hud-bot' }, thinking.text || '…')
      : lastBot ? h('div', { class: 'hud-bot' }, h('p', null, lastBot.res.say),
        lastBot.res.lines?.length ? h('ul', { class: 'hud-list' }, lastBot.res.lines.slice(0, 5).map((l) => h('li', null, l))) : null,
        lastBot.res.undo && !lastBot.undone ? h('button', { class: 'hud-proto', onclick: () => convo.undo(lastBot) }, 'Undo') : null) : null,
    st.action ? h('button', { class: 'hud-proto', onclick: st.action.run }, st.action.label) : null].filter(Boolean));
  const items = log.filter((x) => x.who === 'jarvis' && x.res).slice(-8).reverse();
  live.feed.replaceChildren(...(items.length ? items.map((x) => {
    const [emoji] = VIA[x.res.via] || VIA.rules;
    const text = x.res.title || x.res.say || '';
    return h('li', { class: [x.res.miss && 'bad', x.notice && 'notice'] }, h('span', { class: 'hud-t' }, clockText(new Date(x.at))), /^\p{Extended_Pictographic}/u.test(text) ? text : `${emoji} ${text}`);
  }) : [h('li', { class: 'hud-dim' }, 'Nothing yet.')]));
  drawTimers();
}
