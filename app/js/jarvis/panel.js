// The Jarvis talk sheet: the orb, the conversation, and ways in (talk, type, or show it a photo).
// See what it did (and undo or correct it), and keep going hands-free — after each reply it
// listens again until you say “thanks” or go quiet. Talk over it to interrupt.
// The conversation itself lives in convo.js, so HUD mode shows the same one.

import * as voice from '../voice.js';
import * as W from '../whisper.js';
import { h, icon, sheet, closeSheet, isSheetOpen } from '../ui.js';
import * as convo from './convo.js';
import * as llm from './llm.js';
import * as wake from './wake.js';
import * as A from './audio.js';
import { createOrb } from './orb.js';

export const name = convo.name;
export const userName = convo.userName;
export const brain = convo.brain;
export const applyAnswer = convo.applyAnswer;

const EXAMPLES = ['What’s my day look like?', 'Remind me to call the bank tomorrow and pay rent on Friday', 'Spent 250 on lunch',
  'I’m feeling lazy, what should I do first?', 'Engage focus protocol', 'Remember that my gym closes at 10 pm', 'Do I need an umbrella?',
  'I was in meetings from 2 to 4', 'How much did I spend on food this month?', 'Plan my evening', 'Turn off the living room lights'];

export const VIA = {
  rules: ['⚡', 'Rules · free'], skill: ['🧩', 'Learned phrase · free'], memory: ['🧠', 'Memory · free'], protocol: ['🛡️', 'Protocol · free'],
  home: ['🏠', 'Home Assistant'], world: ['🌦️', 'Open-Meteo · free'],
  local: ['💻', 'On-device AI · free'], ollama: ['🦙', 'Ollama · free'], cloud: ['☁️', 'Cloud AI'], claude: ['✳️', 'Claude · your plan'],
};

function greetingWord() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Hello' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}

// One message in the conversation (shared with HUD mode).
export function bubble(item) {
  if (item.who === 'you') return h('div', { class: 'jv-msg you' }, item.image ? h('img', { class: 'jv-photo', src: item.image, alt: '' }) : null, h('p', null, item.text));
  if (item.thinking) {
    return item.streamed && item.text
      ? h('div', { class: 'jv-msg bot streaming' }, h('p', null, item.text, h('span', { class: 'jv-caret' })))
      : h('div', { class: 'jv-msg bot thinking' }, h('span', { class: 'jv-typing' }, h('i'), h('i'), h('i')), item.text ? h('span', { class: 'muted small' }, item.text) : null);
  }
  const res = item.res;
  const actions = [];
  if (res.undo && !item.undone) {
    actions.push(h('button', { class: 'btn ghost sm', onclick: () => convo.undo(item) }, 'Undo'));
    actions.push(h('button', { class: 'btn ghost sm', 'data-tip': 'Undo it and tell me what you meant — I’ll remember', onclick: () => convo.wrong(item) }, 'Wrong?'));
  }
  if (res.alt && !item.undone) actions.push(h('button', { class: 'btn ghost sm', onclick: () => convo.alternative(item) }, res.alt.label));
  if (res.news) actions.push(h('button', { class: 'btn ghost sm', onclick: () => { closeSheet(); location.hash = '#/news'; } }, 'Open News'));
  const showCard = res.lines?.length || res.sub || (res.title && res.title !== res.say && !res.chat);
  const [emoji, label] = VIA[res.via] || VIA.rules;
  const meta = [label, res.model && res.via !== 'rules' ? res.model : '', res.tokens ? `${res.tokens} tokens` : ''].filter(Boolean).join(' · ');
  return h('div', { class: ['jv-msg bot', item.undone && 'undone', item.notice && 'notice'] },
    h('p', null, res.say),
    showCard ? h('div', { class: 'voice-card' },
      res.title && res.title !== res.say ? h('p', { class: 'voice-title' }, res.title) : null,
      res.sub ? h('p', { class: 'muted small' }, res.sub) : null,
      res.lines?.length ? h('ul', { class: 'voice-lines' }, res.lines.slice(0, 12).map((l) => h('li', null, l))) : null) : null,
    res.learned?.source === 'learned' ? h('p', { class: 'jv-note' }, '🧩 Learned this phrase — next time it’s instant and free.') : null,
    res.remembered?.length ? h('p', { class: 'jv-note' }, `🧠 Remembered: ${res.remembered.join('; ')}`) : null,
    res.promise ? h('p', { class: 'jv-note' }, `📌 I’ll hold you to that: ${res.promise.what}${res.promise.dueLabel ? ` (${res.promise.dueLabel})` : ''}`) : null,
    h('div', { class: 'jv-foot' }, h('span', { class: 'jv-via', 'data-tip': meta }, `${emoji} ${meta}`), actions.length ? h('div', { class: 'btn-row' }, actions) : null));
}

// A photo from the camera or library, shrunk to at most `max` px on its long side (JPEG data URL).
export function photoToDataUrl(file, max = 1024) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Couldn’t read that image')); };
    img.src = url;
  });
}

// A camera button + hidden file input. `ask()` returns the text to send with the photo.
export function cameraButton(ask = () => '') {
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try { convo.run(ask(), { image: await photoToDataUrl(f) }); } catch (e) { console.error(e); }
  });
  const btn = h('button', { class: 'icon-btn', 'aria-label': 'Show it a photo', 'data-tip': 'Show it a photo: a book, a receipt, a whiteboard…', onclick: () => { W.unlockAudio(); input.click(); } }, icon('camera', 20));
  return h('span', null, btn, input);
}

export function open({ go, text = null, shared = null, listen = true, spoken = false } = {}) {
  const who = name();
  const chat = h('div', { class: 'jv-chat', 'aria-live': 'polite' });
  const status = h('p', { class: 'jv-status' });
  const brainChip = h('a', { class: 'jv-brain', href: '#/jarvis', onclick: () => closeSheet() });
  const hudLink = h('a', { class: 'jv-brain', href: '#/hud', onclick: () => closeSheet(), 'data-tip': 'Full-screen HUD (D)' }, icon('fit', 14), 'HUD');
  const talk = () => { W.unlockAudio(); convo.listen(); };
  const orb = createOrb({ label: 'Talk', onTap: talk });
  const mic = h('button', { class: 'voice-mic jv-mic', 'aria-label': 'Talk', onclick: talk }, icon('mic', 30));
  const typed = h('input', { class: 'voice-typed jv-input', placeholder: `Ask ${who} anything…`, autocomplete: 'off', enterkeyhint: 'send', 'data-key': 'jarvis-typed' });
  const send = h('button', { class: 'icon-btn', 'aria-label': 'Send', onclick: () => submitTyped() }, icon('arrowRight', 20));
  const cam = cameraButton(() => { const v = typed.value.trim(); typed.value = ''; return v; });

  const setBrain = () => {
    const d = llm.describe();
    const l = llm.local;
    brainChip.replaceChildren(h('span', { class: ['jv-dot', llm.engines().length ? 'on' : ''] }),
      l.state === 'loading' ? `Loading on-device AI… ${Math.round(l.progress * 100)}%` : `${d.label}${d.detail ? ` · ${d.detail}` : ''}`);
  };
  setBrain();
  const offChange = llm.onChange(setBrain);
  convo.warm();

  const examples = () => h('div', { class: 'voice-examples' },
    h('p', { class: 'sub-head' }, 'Try'),
    h('div', { class: 'chips' }, EXAMPLES.map((ex) => h('button', { class: 'chip', onclick: () => convo.run(ex) }, `“${ex}”`))));

  let queued = false;
  const draw = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const log = convo.log;
      chat.replaceChildren(...(log.length ? log.map(bubble) : [h('div', { class: 'jv-hello' },
        h('p', { class: 'jv-hello-title' }, `${greetingWord()}${userName() ? `, ${userName()}` : ''}. I’m ${who}.`),
        h('p', { class: 'muted small' }, 'Talk to me like a person. I handle the everyday stuff instantly and for free, and I learn your phrases as we go. Talk over me to interrupt.'),
        examples())]));
      chat.scrollTop = chat.scrollHeight;
      const st = convo.state;
      mic.classList.toggle('on', st.mode === 'listening');
      mic.setAttribute('aria-label', st.mode === 'listening' ? 'Stop listening' : st.mode === 'speaking' ? 'Interrupt' : 'Talk');
      status.replaceChildren(st.action ? h('button', { class: 'btn primary sm', onclick: st.action.run }, st.action.label) : st.status);
      setBrain();
    });
  };

  const off = convo.subscribe((ev, data) => {
    if (ev === 'go') { setTimeout(() => { closeSheet(); go?.(data); }, 300); return; }
    if (ev === 'end') { if (data?.spoken) setTimeout(closeSheet, 400); return; }
    if (ev === 'focus-typing') typed.focus();
    draw();
  });

  function submitTyped() {
    const v = typed.value.trim();
    if (!v) return;
    typed.value = '';
    convo.run(v);
  }
  typed.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitTyped(); } });

  const panel = sheet(who, h('div', { class: 'jv' },
    h('div', { class: 'jv-top' }, brainChip, hudLink),
    h('div', { class: 'jv-orb-wrap' }, orb),
    chat, status,
    h('div', { class: 'jv-bar' }, mic, h('div', { class: 'jv-type' }, typed, cam, send))));
  panel.classList.add('voice-sheet', 'jarvis-sheet');
  const detach = convo.attach();
  const panelOpen = () => document.body.contains(panel);
  const obs = new MutationObserver(() => {
    if (!panelOpen()) { off(); detach(); offChange(); obs.disconnect(); orb.destroy(); }
  });
  obs.observe(document.body, { childList: true });
  requestAnimationFrame(() => orb.wake());
  draw();
  if (shared) convo.run(shared, { isShared: true });
  else if (text) convo.run(text, { spoken });
  else if (listen && voice.supported()) { A.chime('wake'); convo.listen(); }
}

export function isOpen() {
  return isSheetOpen() && Boolean(document.querySelector('.jarvis-sheet'));
}

// Hands-free wake word, if switched on for this device. With the sheet or HUD mode open it
// answers right there; otherwise it opens the sheet.
export function startWake(go, { hud = () => false } = {}) {
  if (!llm.cfg().wake) { wake.stop(); return; }
  wake.start({
    name: name(), lang: voice.lang(),
    onWake: (rest) => {
      if (isOpen() || hud()) {
        A.chime('wake');
        if (rest) convo.run(rest, { spoken: true }); else convo.listen();
        return;
      }
      open({ go, text: rest || null, listen: true, spoken: true });
    },
  });
}
