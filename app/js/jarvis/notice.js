// How Jarvis speaks first: in HUD mode or with the talk sheet open, it joins the conversation
// (out loud); elsewhere a banner slides in at the top, and it says it too if you chose "voice".
// Used by the proactive watcher, protocols and the "welcome back" briefing.

import * as voice from '../voice.js';
import * as convo from './convo.js';
import * as A from './audio.js';
import * as proactive from './proactive.js';
import { h, icon } from '../ui.js';

let banner = null; let hideTimer = 0;

// res: { say, title, lines?, action?: { label, cmd?, then? }, go?, dismiss? }. opts.force: say it even in quiet mode.
export function show(res, { force = false, go = () => {}, inConvo = () => false } = {}) {
  const mode = proactive.mode();
  if (inConvo() && !convo.state.busy) { convo.announce(res); return; }
  showBanner(res, go);
  A.chime('alert');
  if ((force || mode === 'voice') && !convo.state.busy) voice.speak(res.say); // never talk over a reply in progress
}

function showBanner(res, go) {
  banner?.remove();
  clearTimeout(hideTimer);
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); if (banner === el) banner = null; };
  const act = res.action ? h('button', { class: 'btn sm', onclick: async () => {
    close();
    if (res.action.cmd) { await convo.run(res.action.cmd); res.action.then?.(); }
  } }, res.action.label) : null;
  const open = res.go ? h('button', { class: 'btn sm', onclick: () => { close(); go(res.go); } }, 'Show me') : null;
  const let_go = res.dismiss ? h('button', { class: 'btn sm', onclick: () => { res.dismiss(); close(); } }, 'Let it go') : null;
  const el = h('div', { class: 'jv-banner', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'jv-banner-dot' }),
    h('div', { class: 'jv-banner-main' }, h('p', null, res.say),
      res.lines?.length > 1 && !res.action ? h('p', { class: 'small', style: { opacity: 0.75 } }, res.lines.slice(0, 3).join(' · ')) : null,
      act || open || let_go ? h('div', { class: 'btn-row' }, act, open, let_go) : null),
    h('button', { class: 'icon-btn sm', 'aria-label': 'Dismiss', onclick: close }, icon('close', 16)));
  document.body.append(el);
  banner = el;
  requestAnimationFrame(() => el.classList.add('show'));
  hideTimer = setTimeout(close, res.action || res.go ? 20000 : 12000);
}

// A system notification (for protocols' "notify" step), or a banner if they're not allowed.
export async function system(text, go) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg) { await reg.showNotification(convo.name(), { body: text, icon: 'icons/icon-192.png', tag: 'jarvis' }); return; }
      new Notification(convo.name(), { body: text }); // eslint-disable-line no-new
      return;
    }
  } catch { /* fall through to the banner */ }
  showBanner({ say: text }, go);
}
