// The conversation itself, apart from any screen: listening, thinking, speaking, and the log of
// what was said. The talk sheet (panel.js) and HUD mode (views/hud.js) are two views of it, so a
// conversation started in one carries on in the other.
//
// It speaks the AI's reply sentence by sentence while it's still being written, plays short cues
// (heard you, thinking, error), and lets you interrupt by just talking over it.

import * as store from '../store.js';
import * as voice from '../voice.js';
import * as W from '../whisper.js';
import * as A from './audio.js';
import * as llm from './llm.js';
import * as ctx from './context.js';
import * as vault from '../vault.js';
import * as wake from './wake.js';
import { createJarvis } from './core.js';
import { sentenceStream, remainder } from './stream.js';

export function name() {
  return store.pref('jarvisName', 'Jarvis') || 'Jarvis';
}

export function userName() {
  return store.pref('userName', '');
}

// Hooks other modules plug in without import cycles: plugins (protocols, weather, Home
// Assistant…), the persona prompt, the rules-path flavour, and what to note after each request.
export const hooks = { execute: null, plugins: [], persona: null, flavor: null, after: null };

let J = null;
export function brain() {
  J = J || createJarvis({
    execute: (cmd) => (hooks.execute || voice.execute)(cmd),
    llm: { engines: llm.engines, chat: llm.chat, vision: (...a) => llm.vision(...a) },
    snapshot: () => ctx.snapshot(),
    related: (t) => ctx.related(t),
    name, user: userName,
    setUser: (n) => store.setPref('userName', n),
    plugins: () => hooks.plugins,
    persona: () => hooks.persona?.() || '',
    flavor: (res, info) => (hooks.flavor ? hooks.flavor(res, info) : res),
    after: (res, text) => hooks.after?.(res, text),
  });
  return J;
}

// ---- State ---------------------------------------------------------------------------------------
// mode: 'idle' | 'listening' | 'thinking' | 'speaking'
export const state = { mode: 'idle', status: '', action: null, interim: '', busy: false, last: null };
export const log = []; // [{ who: 'you'|'jarvis', text?, res?, thinking?, at }]

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit(ev = 'change', data) {
  for (const fn of [...subs]) { try { fn(ev, data); } catch (e) { console.error(e); } }
}

// Views attach while they're on screen; when the last one goes, listening and speaking stop.
let views = 0;
export function attach() {
  views++;
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    views--;
    if (!views) { voice.stopListening(); voice.stopSpeaking(); A.stopMeter(); stopHum(); setMode('idle'); }
  };
}
export const attached = () => views > 0;

function setMode(m) {
  if (state.mode === m) return;
  state.mode = m;
  if (m !== 'listening') { state.interim = ''; A.stopMeter(); }
  // The wake word shares the mic: it rests while Jarvis listens, thinks or talks.
  if (m === 'idle') wake.resume(); else wake.pause();
  emit('mode', m);
  emit();
}
function setStatus(text, action = null) { state.status = text || ''; state.action = action; emit(); }

let humStop = null;
function stopHum() { humStop?.(); humStop = null; }

function push(item) {
  log.push({ at: Date.now(), ...item });
  while (log.length > 40) log.shift();
}

// ---- Running a request ---------------------------------------------------------------------------------
const looksShared = (t) => /\n/.test(t) || t.length > 220;
let listening = false;
let quiet = 0; // auto-listens in a row that heard nothing
let speech = null; // the speech queue now talking

// opts: { spoken, isShared, image (data URL), sink(sentence) — send speech elsewhere (the laptop companion) }
export async function run(input, { spoken = false, isShared = false, image = null, sink = null } = {}) {
  const t = String(input || '').trim();
  if ((!t && !image) || state.busy) return null;
  const asShared = !image && (isShared || (!spoken && looksShared(t)));
  W.unlockAudio();
  interrupt({ quietly: true });
  state.busy = true;
  setStatus('');
  if (spoken) A.chime('ack');
  push({ who: 'you', text: image ? `📷 ${t || 'What’s this?'}` : asShared ? `📥 ${t.length > 300 ? `${t.slice(0, 300)}…` : t}` : t, image });
  const thinking = { who: 'jarvis', thinking: true, text: '', at: Date.now() };
  log.push(thinking);
  setMode('thinking');
  // Only say "thinking" (and hum) if it takes a moment, i.e. the AI is working.
  const slow = setTimeout(() => {
    const d = llm.describe();
    if (!thinking.streamed) thinking.text = llm.local.state === 'loading' ? 'Warming up the on-device AI…' : image ? 'Looking…' : `Thinking with ${d.label}…`;
    if (spoken) humStop = humStop || A.hum();
    emit();
  }, 450);

  // Speak the AI's reply as it streams in, a sentence at a time.
  const q = sink ? sinkQueue(sink) : voice.speechQueue();
  speech = q;
  const sentences = sentenceStream((s) => { stopHum(); q.add(s); if (q.on && state.mode === 'thinking') setMode('speaking'); });
  const onSay = (text, done) => {
    thinking.streamed = true;
    thinking.text = text;
    if (done) sentences.end(text); else sentences.push(text);
    emit('stream', text);
  };

  let res;
  try {
    const b = brain();
    res = image ? await b.handleImage(image, t) : asShared ? await b.handleShared(t) : await b.handle(t, { onSay });
  } catch (e) {
    console.error(e);
    res = { say: 'Something went wrong there.', title: `Error: ${e.message}`, via: 'rules', miss: true };
  }
  clearTimeout(slow);
  stopHum();
  const i = log.indexOf(thinking);
  if (i >= 0) log.splice(i, 1);
  state.busy = false;
  await reply(res, { spoken, queue: q, already: sentences.spoken(), remote: Boolean(sink) });
  return res;
}

// Speech that goes somewhere else instead of this device's speakers.
function sinkQueue(sink) {
  let stopped = false;
  return { on: true, add: (t) => { if (!stopped && t) sink(t); }, finish: () => Promise.resolve(), stop() { stopped = true; }, get stopped() { return stopped; } };
}

// The laptop companion heard the wake word / is listening: show it on the orb.
export function remote(mode) {
  if (!state.busy && ['idle', 'listening', 'thinking', 'speaking'].includes(mode)) setMode(mode);
}

// Shows and speaks a result. `already`: what was streamed out loud before the result was ready.
async function reply(res, { spoken, queue, already = '', remote = false }) {
  push({ who: 'jarvis', res });
  state.last = res;
  if (res.miss) A.chime('error');
  else if (!queue.on || !res.say) A.chime('done');
  emit('reply', res);
  const rest = remainder(res.say, already);
  if (rest && queue.on) { queue.add(rest); setMode('speaking'); }
  let interrupted = false;
  const stopWatch = spoken && !remote && queue.on && (rest || already) ? A.watchForSpeech({ onSpeech: () => { interrupted = true; queue.stop(); } }) : () => {};
  await queue.finish();
  stopWatch();
  if (speech === queue) speech = null;
  if (queue.stopped && !interrupted) return; // stopped by something else (a new request, closing)
  setMode('idle');
  if (remote) { if (res.go) emit('go', res.go); return; } // the companion keeps its own conversation going
  if (!attached()) return;
  if (interrupted) { A.chime('wake'); listen(); return; }
  if (res.go) { emit('go', res.go); return; }
  if (res.end) { emit('end', { spoken }); return; }
  // Keep the conversation going when it was spoken to (or it asked something).
  if ((spoken && llm.cfg().conversation) || res.ask) listen({ auto: true });
}

// Says something Jarvis came up with itself (a proactive notice, a protocol step).
export async function announce(res, { listenAfter = false } = {}) {
  if (state.busy) return;
  interrupt({ quietly: true });
  const q = voice.speechQueue();
  speech = q;
  A.chime('alert');
  push({ who: 'jarvis', res: { via: 'rules', ...res }, notice: true });
  emit('reply', res);
  if (res.say && q.on) { q.add(res.say); setMode('speaking'); }
  await q.finish();
  if (speech === q) speech = null;
  if (!q.stopped) setMode('idle');
  if (listenAfter && attached() && !q.stopped) listen({ auto: true });
}

// Stop talking (and listening). `quietly`: don't touch the status line.
export function interrupt({ quietly = false } = {}) {
  speech?.stop();
  speech = null;
  voice.stopSpeaking();
  if (listening) { voice.stopListening(); listening = false; }
  if (!state.busy) setMode('idle');
  if (!quietly) setStatus('');
}

// ---- Listening -------------------------------------------------------------------------------------------
export function listen({ auto = false } = {}) {
  W.unlockAudio();
  if (listening) { voice.finishListening(); return; }
  if (state.mode === 'speaking') interrupt({ quietly: true });
  if (!voice.supported()) {
    setStatus('Voice input isn’t available in this browser. Type instead, or turn on on-device Whisper in Settings → Voice assistant.');
    emit('focus-typing');
    return;
  }
  listening = true;
  setMode('listening');
  setStatus('Listening…');
  if (!W.listeningOn()) A.meterMic();
  voice.listen({
    onInterim: (tx) => { state.interim = tx; A.reportInput(0.5 + Math.random() * 0.3); setStatus(tx ? `“${tx}”` : 'Listening…'); },
    onStatus: (m) => setStatus(m),
    onFinal: (tx) => { quiet = 0; listening = false; setMode('idle'); run(tx, { spoken: true }); },
    onError: (m) => {
      listening = false;
      setMode('idle');
      if (auto && m !== 'not-allowed') { quiet++; setStatus(quiet > 1 ? '' : 'Tap the mic when you need me.'); return; }
      if (m === 'not-allowed') blocked();
      else setStatus(m === 'unsupported' ? 'Voice input isn’t available here. Turn on Whisper in Settings → Voice assistant, or type.' : m);
    },
    onEnd: () => { if (listening) { listening = false; setMode('idle'); } },
  });
}
export const isListening = () => listening;

function blocked() {
  const help = voice.micHelp();
  push({ who: 'jarvis', res: { say: `🎙️ ${help.title}`, title: '', lines: help.steps, via: 'rules' } });
  setStatus('', { label: 'Try again', run: async () => { if (await voice.requestMic()) listen(); else setStatus('Still blocked — follow the steps above, then try again.'); } });
}

// ---- Buttons on a reply --------------------------------------------------------------------------------------
export function undo(item) {
  const u = brain().undoResult(item.res);
  item.undone = true;
  push({ who: 'jarvis', res: u });
  emit();
  voice.speak(u.say);
}
export function wrong(item) {
  brain().undoResult(item.res);
  item.undone = true;
  push({ who: 'jarvis', res: { say: 'Sorry. What did you mean?', title: 'Sorry — what did you mean?', via: 'rules' } });
  emit();
  listen();
}
export async function alternative(item) {
  W.unlockAudio();
  const alt = item.res.alt;
  if (alt.keep) item.res.alt = null; else item.undone = true; // “keep” alternatives add to the result instead of replacing it
  const r = await alt.run();
  push({ who: 'jarvis', res: r });
  emit();
  voice.speak(r.say);
}

// Run an answer Claude sent back (you tapped “Do it”); it joins the conversation, with Undo.
export async function applyAnswer(a) {
  const res = await brain().applyAnswer(a);
  push({ who: 'you', text: `✳️ ${a.text}` });
  push({ who: 'jarvis', res });
  emit();
  return res;
}

export function warm() {
  llm.warm();
  if (vault.connected()) vault.load(); // so the AI can use your vault's notes
}
