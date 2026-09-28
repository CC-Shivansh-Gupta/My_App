// The bridge to the laptop companion (companion/jarvis_companion.py). The companion runs on your
// computer, always listening for "Hey Jarvis" with an open-weights wake-word model, even when
// this tab is in the background or the screen is locked. It transcribes what you say on the
// computer (Whisper) and sends the text here; Jarvis runs it with all your data and sends the
// reply back, sentence by sentence, for the companion to speak (Piper). If no Daybook tab is
// open, the companion opens one with ?ask=… and the request runs as soon as it connects.
//
// The link is a WebSocket to 127.0.0.1 only; nothing leaves your computer.
//
// Messages:  companion → app  { type: 'hello' | 'wake' | 'listening' | 'thinking' | 'idle' | 'text', id?, text? }
//            app → companion  { type: 'hello', name } · { type: 'say', id, text } · { type: 'reply', id, say, title, ask, end }

import * as convo from './convo.js';

const KEY = 'daybook.companion.v1';

export function cfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* default */ }
  return { on: false, port: 8765, ...c };
}
export function setCfg(patch) {
  const next = { ...cfg(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  if (next.on) connect(); else disconnect();
  return next;
}

export const state = { status: 'off', error: '' }; // off | connecting | connected | waiting
const watchers = new Set();
export function onChange(fn) { watchers.add(fn); return () => watchers.delete(fn); }
function changed() { for (const fn of watchers) { try { fn(); } catch { /* ignore */ } } }

let ws = null; let retry = 0; let timer = 0; let wanted = false;
const pending = []; // requests from ?ask= waiting for the connection

export function connect() {
  wanted = true;
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  clearTimeout(timer);
  state.status = 'connecting'; state.error = '';
  changed();
  let sock;
  try { sock = new WebSocket(`ws://127.0.0.1:${cfg().port}`); } catch (e) { state.error = e.message; schedule(); return; }
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    state.status = 'connected';
    changed();
    send({ type: 'hello', name: convo.name(), user: convo.userName() });
    while (pending.length) handle({ type: 'text', id: `ask-${Date.now()}`, text: pending.shift(), spoken: true });
  };
  sock.onmessage = (e) => { let m = null; try { m = JSON.parse(e.data); } catch { return; } handle(m); };
  sock.onclose = () => { if (ws === sock) ws = null; state.status = wanted ? 'waiting' : 'off'; changed(); if (wanted) schedule(); };
  sock.onerror = () => { state.error = 'Companion not running (or the browser blocked the local connection).'; };
}

function schedule() {
  clearTimeout(timer);
  retry = Math.min(retry + 1, 6);
  timer = setTimeout(connect, [2, 4, 8, 15, 30, 60][retry - 1] * 1000);
}

export function disconnect() {
  wanted = false;
  clearTimeout(timer);
  try { ws?.close(); } catch { /* ignore */ }
  ws = null;
  state.status = 'off';
  changed();
}

export const connected = () => ws?.readyState === 1;

function send(m) { try { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); } catch { /* ignore */ } }

async function handle(m) {
  if (!m || typeof m !== 'object') return;
  if (['wake', 'listening', 'thinking', 'idle'].includes(m.type)) { convo.remote(m.type === 'wake' ? 'listening' : m.type); return; }
  if (m.type === 'text' && m.text) {
    const id = m.id || String(Date.now());
    const res = await convo.run(String(m.text).slice(0, 2000), { spoken: true, sink: (text) => send({ type: 'say', id, text }) });
    if (res) send({ type: 'reply', id, say: res.say, title: res.title || '', ask: Boolean(res.ask), end: Boolean(res.end), miss: Boolean(res.miss) });
    else send({ type: 'reply', id, say: '', title: 'Busy', busy: true });
  }
}

// A request that arrived in the URL (the companion opened this tab with ?ask=…).
// Runs through the companion once it connects, or here after a few seconds if it doesn't.
export function askWhenConnected(text, fallback) {
  if (connected()) { handle({ type: 'text', id: `ask-${Date.now()}`, text }); return; }
  pending.push(text);
  if (!wanted) connect();
  setTimeout(() => {
    const i = pending.indexOf(text);
    if (i >= 0) { pending.splice(i, 1); fallback?.(text); }
  }, 6000);
}

export function start() { if (cfg().on) connect(); }
