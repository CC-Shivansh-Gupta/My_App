// The Jarvis conversation: talk or type, see what it did (and undo or correct it), and keep
// going hands-free — after each reply it listens again until you say “thanks” or go quiet.

import * as store from '../store.js';
import * as voice from '../voice.js';
import * as W from '../whisper.js';
import { h, icon, sheet, closeSheet, isSheetOpen } from '../ui.js';
import { createJarvis } from './core.js';
import * as llm from './llm.js';
import * as ctx from './context.js';
import * as wake from './wake.js';
import * as vault from '../vault.js';

export function name() {
  return store.pref('jarvisName', 'Jarvis') || 'Jarvis';
}

export function userName() {
  return store.pref('userName', '');
}

let J = null;
export function brain() {
  J = J || createJarvis({
    execute: voice.execute,
    llm: { engines: llm.engines, chat: llm.chat },
    snapshot: () => ctx.snapshot(),
    related: (t) => ctx.related(t),
    name, user: userName,
    setUser: (n) => store.setPref('userName', n),
  });
  return J;
}

// What the panel shows, kept while the app is open so reopening continues the conversation.
const log = [];

// Run an answer Claude sent back (you tapped “Do it”); it joins the conversation, with Undo.
export async function applyAnswer(a) {
  const res = await brain().applyAnswer(a);
  log.push({ who: 'you', text: `✳️ ${a.text}` }, { who: 'jarvis', res });
  return res;
}

const EXAMPLES = ['What’s my day look like?', 'Remind me to call the bank tomorrow and pay rent on Friday', 'Spent 250 on lunch',
  'I’m feeling lazy, what should I do first?', 'Remember that my gym closes at 10 pm', 'When I say good night, stop tracking and brief me for tomorrow',
  'I was in meetings from 2 to 4', 'How much did I spend on food this month?', 'Plan my evening', 'Add Dune to my watch list'];

export const VIA = {
  rules: ['⚡', 'Rules · free'], skill: ['🧩', 'Learned phrase · free'], memory: ['🧠', 'Memory · free'],
  local: ['💻', 'On-device AI · free'], ollama: ['🦙', 'Ollama · free'], cloud: ['☁️', 'Cloud AI'], claude: ['✳️', 'Claude · your plan'],
};

export function open({ go, text = null, shared = null, listen = true, spoken = false } = {}) {
  let listening = false;
  let busy = false;
  let quiet = 0; // auto-listens in a row that heard nothing
  const who = name();
  const chat = h('div', { class: 'jv-chat', 'aria-live': 'polite' });
  const status = h('p', { class: 'jv-status' });
  const brainChip = h('a', { class: 'jv-brain', href: '#/jarvis', onclick: () => closeSheet() });
  const mic = h('button', { class: 'voice-mic jv-mic', 'aria-label': 'Talk' }, icon('mic', 30));
  const typed = h('input', { class: 'voice-typed jv-input', placeholder: `Ask ${who} anything…`, autocomplete: 'off', enterkeyhint: 'send', 'data-key': 'jarvis-typed' });
  const send = h('button', { class: 'icon-btn', 'aria-label': 'Send', onclick: () => submitTyped() }, icon('arrowRight', 20));

  const setBrain = () => {
    const d = llm.describe();
    const l = llm.local;
    brainChip.replaceChildren(h('span', { class: ['jv-dot', llm.engines().length ? 'on' : ''] }),
      l.state === 'loading' ? `Loading on-device AI… ${Math.round(l.progress * 100)}%` : `${d.label}${d.detail ? ` · ${d.detail}` : ''}`);
  };
  setBrain();
  const offChange = llm.onChange(setBrain);
  llm.warm();
  if (vault.connected()) vault.load(); // so the AI can use your vault's notes

  const scroll = () => requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });

  const examples = () => h('div', { class: 'voice-examples' },
    h('p', { class: 'sub-head' }, 'Try'),
    h('div', { class: 'chips' }, EXAMPLES.map((ex) => h('button', { class: 'chip', onclick: () => run(ex) }, `“${ex}”`))));

  const drawAll = () => {
    chat.replaceChildren(...(log.length ? log.map(bubble) : [h('div', { class: 'jv-hello' },
      h('p', { class: 'jv-hello-title' }, `${greetingWord()}${userName() ? `, ${userName()}` : ''}. I’m ${who}.`),
      h('p', { class: 'muted small' }, 'Talk to me like a person. I handle the everyday stuff instantly and for free, and I learn your phrases as we go.'),
      examples())]));
    scroll();
  };

  function bubble(item) {
    if (item.who === 'you') return h('div', { class: 'jv-msg you' }, h('p', null, item.text));
    if (item.thinking) return h('div', { class: 'jv-msg bot thinking' }, h('span', { class: 'jv-typing' }, h('i'), h('i'), h('i')), item.text ? h('span', { class: 'muted small' }, item.text) : null);
    const res = item.res;
    const actions = [];
    if (res.undo && !item.undone) {
      actions.push(h('button', { class: 'btn ghost sm', onclick: () => {
        const u = brain().undoResult(res);
        item.undone = true;
        say(u, { spoken: false });
      } }, 'Undo'));
      actions.push(h('button', { class: 'btn ghost sm', 'data-tip': 'Undo it and tell me what you meant — I’ll remember', onclick: () => {
        brain().undoResult(res);
        item.undone = true;
        say({ say: 'Sorry. What did you mean?', title: 'Sorry — what did you mean?', via: 'rules' }, { spoken: false });
        startListening();
      } }, 'Wrong?'));
    }
    if (res.alt && !item.undone) {
      actions.push(h('button', { class: 'btn ghost sm', onclick: async () => {
        W.unlockAudio();
        const alt = res.alt;
        if (alt.keep) res.alt = null; else item.undone = true; // “keep” alternatives add to the result instead of replacing it
        say(await alt.run(), { spoken: false });
      } }, res.alt.label));
    }
    if (res.news) actions.push(h('button', { class: 'btn ghost sm', onclick: () => { closeSheet(); go?.('news'); } }, 'Open News'));
    const showCard = res.lines?.length || res.sub || (res.title && res.title !== res.say && !res.chat);
    const [emoji, label] = VIA[res.via] || VIA.rules;
    const meta = [label, res.model && res.via !== 'rules' ? res.model : '', res.tokens ? `${res.tokens} tokens` : ''].filter(Boolean).join(' · ');
    return h('div', { class: ['jv-msg bot', item.undone && 'undone'] },
      h('p', null, res.say),
      showCard ? h('div', { class: 'voice-card' },
        res.title && res.title !== res.say ? h('p', { class: 'voice-title' }, res.title) : null,
        res.sub ? h('p', { class: 'muted small' }, res.sub) : null,
        res.lines?.length ? h('ul', { class: 'voice-lines' }, res.lines.slice(0, 12).map((l) => h('li', null, l))) : null) : null,
      res.learned?.source === 'learned' ? h('p', { class: 'jv-note' }, '🧩 Learned this phrase — next time it’s instant and free.') : null,
      res.remembered?.length ? h('p', { class: 'jv-note' }, `🧠 Remembered: ${res.remembered.join('; ')}`) : null,
      h('div', { class: 'jv-foot' }, h('span', { class: 'jv-via', 'data-tip': meta }, `${emoji} ${meta}`), actions.length ? h('div', { class: 'btn-row' }, actions) : null));
  }

  function greetingWord() {
    const hr = new Date().getHours();
    return hr < 5 ? 'Hello' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  }

  async function say(res, { spoken }) {
    log.push({ who: 'jarvis', res });
    trim();
    drawAll();
    await voice.speak(res.say);
    if (!panelOpen()) return;
    if (res.go) { setTimeout(() => { closeSheet(); go?.(res.go); }, 300); return; }
    if (res.end) { if (spoken) setTimeout(closeSheet, 400); return; }
    // Keep the conversation going when it was spoken to (or it asked something).
    if ((spoken && llm.cfg().conversation) || res.ask) startListening({ auto: true });
  }

  function trim() { while (log.length > 40) log.shift(); }

  // A pasted or shared message (several lines, or long) is read for what it asks of you.
  const looksShared = (t) => /\n/.test(t) || t.length > 220;

  async function run(input, { spoken: fromVoice = false, isShared = false } = {}) {
    const t = String(input || '').trim();
    if (!t || busy) return;
    const asShared = isShared || (!fromVoice && looksShared(t));
    W.unlockAudio();
    if (listening) { voice.stopListening(); setListening(false); }
    busy = true;
    status.textContent = '';
    log.push({ who: 'you', text: asShared ? `📥 ${t.length > 300 ? `${t.slice(0, 300)}…` : t}` : t });
    const thinking = { who: 'jarvis', thinking: true, text: '' };
    log.push(thinking);
    drawAll();
    // Only say "thinking" if it takes a moment (i.e. the AI is working).
    const slow = setTimeout(() => {
      const d = llm.describe();
      thinking.text = llm.local.state === 'loading' ? 'Warming up the on-device AI…' : `Thinking with ${d.label}…`;
      drawAll();
    }, 350);
    let res;
    try {
      res = asShared ? await brain().handleShared(t) : await brain().handle(t);
    } catch (e) {
      console.error(e);
      res = { say: 'Something went wrong there.', title: `Error: ${e.message}`, via: 'rules' };
    }
    clearTimeout(slow);
    setBrain();
    log.splice(log.indexOf(thinking), 1);
    busy = false;
    await say(res, { spoken: fromVoice });
  }

  const setListening = (on) => {
    listening = on;
    mic.classList.toggle('on', on);
    mic.setAttribute('aria-label', on ? 'Stop listening' : 'Talk');
    status.textContent = on ? 'Listening…' : '';
  };

  function startListening({ auto = false } = {}) {
    W.unlockAudio();
    if (listening) { voice.finishListening(); return; }
    if (!voice.supported()) {
      status.textContent = 'Voice input isn’t available in this browser. Type below, or turn on on-device Whisper in Settings → Voice assistant.';
      typed.focus();
      return;
    }
    setListening(true);
    voice.listen({
      onInterim: (tx) => { status.textContent = tx ? `“${tx}”` : 'Listening…'; },
      onStatus: (m) => { status.textContent = m; if (m !== 'Listening…') mic.classList.remove('on'); },
      onFinal: (tx) => { quiet = 0; setListening(false); run(tx, { spoken: true }); },
      onError: (m) => {
        setListening(false);
        if (auto && m !== 'not-allowed') { quiet++; status.textContent = quiet > 1 ? '' : 'Tap the mic when you need me.'; return; }
        if (m === 'not-allowed') blocked();
        else status.textContent = m === 'unsupported'
          ? 'Voice input isn’t available here. Turn on Whisper in Settings → Voice assistant, or type below.'
          : m;
      },
      onEnd: () => { if (listening) setListening(false); },
    });
  }

  function blocked() {
    const help = voice.micHelp();
    log.push({ who: 'jarvis', res: { say: `🎙️ ${help.title}`, title: '', lines: help.steps, via: 'rules' } });
    drawAll();
    status.replaceChildren(h('button', { class: 'btn primary sm', onclick: async () => { if (await voice.requestMic()) startListening(); else status.textContent = 'Still blocked — follow the steps above, then try again.'; } }, 'Try again'));
  }

  function submitTyped() {
    const v = typed.value.trim();
    if (!v) return;
    typed.value = '';
    run(v);
  }

  mic.addEventListener('click', () => startListening());
  typed.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitTyped(); } });

  const panel = sheet(who, h('div', { class: 'jv' }, brainChip, chat, status, h('div', { class: 'jv-bar' }, mic, h('div', { class: 'jv-type' }, typed, send))));
  panel.classList.add('voice-sheet', 'jarvis-sheet');
  const panelOpen = () => document.body.contains(panel);
  const obs = new MutationObserver(() => {
    if (!panelOpen()) { voice.stopListening(); voice.stopSpeaking(); offChange(); wake.resume(); obs.disconnect(); }
  });
  obs.observe(document.body, { childList: true });
  wake.pause();
  drawAll();
  if (shared) run(shared, { isShared: true });
  else if (text) run(text, { spoken });
  else if (listen && voice.supported()) startListening();
}

export function isOpen() {
  return isSheetOpen() && Boolean(document.querySelector('.jarvis-sheet'));
}

// Hands-free wake word, if switched on for this device.
export function startWake(go) {
  if (!llm.cfg().wake) { wake.stop(); return; }
  wake.start({
    name: name(), lang: voice.lang(),
    onWake: (rest) => {
      if (isOpen()) return;
      open({ go, text: rest || null, listen: true, spoken: true });
    },
  });
}
