// Jarvis's sound: short synthesized cues (no audio files), a level meter for the orb, and
// voice-activity detection so you can interrupt it by talking.
//
//   chime(kind)        — 'wake' | 'ack' | 'done' | 'error' | 'alert' | 'engage'
//   hum()              — a quiet "thinking" hum; returns stop()
//   output(ctx)        — the node every spoken reply plays through, so its loudness can be measured
//   level() / bands()  — how loud Jarvis or you are right now (0..1), for the orb
//   watchForSpeech()   — listens while Jarvis talks and calls back when you start speaking
//   createVAD()        — the detector itself (pure, tested)

import * as W from '../whisper.js';

const PREFS = 'daybook.jarvis.fx';
export function prefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREFS)) || {}; } catch { /* default */ }
  // On iPhone/iPad an open mic can drop the speaker to the quiet earpiece, so interrupting is opt-in there.
  return { sounds: true, bargeIn: !apple(), ...p };
}
export function setPrefs(patch) {
  try { localStorage.setItem(PREFS, JSON.stringify({ ...prefs(), ...patch })); } catch { /* ignore */ }
}

// ---- Voice activity detection ----------------------------------------------------------------------
// Feed it the loudness (RMS) of each audio frame. For the first `calibrateMs` it learns the room,
// including Jarvis's own voice leaking back from the speakers; after that, sound well above that
// floor for `holdMs` counts as you talking. Returns true once, when speech starts.
export function createVAD({ calibrateMs = 350, ratio = 2.6, min = 0.02, holdMs = 220 } = {}) {
  let start = null; let floor = 0; let loudSince = 0; let fired = false;
  return {
    feed(rms, t) {
      if (start === null) start = t;
      if (t - start < calibrateMs) { floor = Math.max(floor, rms); return false; }
      if (fired) return false;
      const loud = rms > Math.max(min, floor * ratio);
      if (!loud) {
        // The floor follows steady background (a fan, a louder sentence of TTS) slowly.
        floor = rms > floor ? floor + (rms - floor) * 0.02 : floor * 0.998;
        loudSince = 0;
        return false;
      }
      if (!loudSince) loudSince = t;
      if (t - loudSince >= holdMs) { fired = true; return true; }
      return false;
    },
    get floor() { return floor; },
  };
}

export const rms = (buf) => {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / (buf.length || 1));
};

// ---- Output: what Jarvis says goes through one analyser ---------------------------------------------
let out = null;
export function output(ctx = W.unlockAudio()) {
  if (!ctx) return null;
  if (out && out.context === ctx) return out;
  out = ctx.createAnalyser();
  out.fftSize = 256;
  out.smoothingTimeConstant = 0.7;
  out.connect(ctx.destination);
  return out;
}

// Plays an AudioBuffer; resolves when it ends. Returns { done, stop }.
export function play(buffer, ctx = W.unlockAudio()) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(output(ctx) || ctx.destination);
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  src.onended = () => { playing.delete(src); resolve(); };
  playing.add(src);
  src.start();
  return { done, stop() { try { src.stop(); } catch { /* ended */ } } };
}
const playing = new Set();
export function isPlaying() { return playing.size > 0 || synthSpeaking; }

// The device voice (speechSynthesis) can't be measured, so the orb is told when it talks.
let synthSpeaking = false;
export function setSynthSpeaking(on) { synthSpeaking = on; }

// ---- Input: your voice ---------------------------------------------------------------------------------
let inputLevel = 0; let inputAt = 0;
export function reportInput(v) { inputLevel = v; inputAt = Date.now(); }

let meter = null; // { stream, an, stop }
// Measures the mic for the orb while the browser's recognizer listens (it doesn't share levels).
// Not on iPhone/iPad, where a second mic stream can cut the recognizer off.
export async function meterMic() {
  stopMeter();
  if (apple() || !navigator.mediaDevices?.getUserMedia) return;
  const ctx = W.unlockAudio();
  if (!ctx) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let raf = 0;
    const tick = () => { an.getFloatTimeDomainData(buf); reportInput(Math.min(1, rms(buf) * 6)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    meter = { stop() { cancelAnimationFrame(raf); src.disconnect(); stream.getTracks().forEach((t) => t.stop()); } };
  } catch { /* no mic: the orb just breathes */ }
}
export function stopMeter() { meter?.stop(); meter = null; }

function apple() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// ---- What the orb reads ------------------------------------------------------------------------------------
const freq = new Uint8Array(128);
// 0..1: Jarvis's voice when it's talking, otherwise yours.
export function level() {
  if (out && playing.size) {
    out.getByteFrequencyData(freq);
    let s = 0;
    for (let i = 2; i < 48; i++) s += freq[i];
    return Math.min(1, s / (46 * 160));
  }
  if (synthSpeaking) { const t = Date.now() / 1000; return 0.35 + 0.25 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 3.1)); }
  return Date.now() - inputAt < 400 ? inputLevel : 0;
}
// `n` bands (0..1) for the ring of bars around the orb.
export function bands(n = 48) {
  const res = new Array(n).fill(0);
  if (out && playing.size) {
    out.getByteFrequencyData(freq);
    for (let i = 0; i < n; i++) res[i] = freq[2 + Math.floor((i / n) * 60)] / 255;
    return res;
  }
  const l = level();
  const t = Date.now() / 1000;
  for (let i = 0; i < n; i++) res[i] = l * (0.55 + 0.45 * Math.sin(i * 1.7 + t * 9) * Math.sin(i * 0.6 - t * 4));
  return res;
}

// ---- Interrupting: listen while it talks ------------------------------------------------------------------
// Calls onSpeech() once when you start talking over Jarvis. Returns stop().
export function watchForSpeech({ onSpeech }) {
  let stopped = false; let raf = 0; let stream = null; let src = null;
  const ctx = W.unlockAudio();
  if (!ctx || !navigator.mediaDevices?.getUserMedia || !prefs().bargeIn) return () => {};
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
    } catch { return; }
    if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src = ctx.createMediaStreamSource(stream);
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const vad = createVAD();
    const tick = () => {
      if (stopped) return;
      an.getFloatTimeDomainData(buf);
      const v = rms(buf);
      reportInput(Math.min(1, v * 6));
      if (vad.feed(v, performance.now())) { cleanup(); onSpeech(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  })();
  function cleanup() {
    stopped = true;
    cancelAnimationFrame(raf);
    try { src?.disconnect(); } catch { /* ignore */ }
    stream?.getTracks().forEach((t) => t.stop());
  }
  return cleanup;
}

// ---- Cues -------------------------------------------------------------------------------------------------
// Each cue: [frequency Hz, start s, length s, type, gain]
const CUES = {
  wake: [[660, 0, 0.09, 'sine', 0.12], [990, 0.08, 0.14, 'sine', 0.1]],
  ack: [[1180, 0, 0.06, 'sine', 0.08]],
  done: [[880, 0, 0.05, 'triangle', 0.07], [1320, 0.05, 0.09, 'sine', 0.06]],
  error: [[440, 0, 0.12, 'triangle', 0.1], [311, 0.11, 0.2, 'triangle', 0.09]],
  alert: [[784, 0, 0.1, 'sine', 0.1], [988, 0.12, 0.1, 'sine', 0.1], [1319, 0.24, 0.18, 'sine', 0.09]],
  engage: [[220, 0, 0.35, 'sawtooth', 0.035], [440, 0.05, 0.3, 'sine', 0.08], [880, 0.2, 0.3, 'sine', 0.07], [1760, 0.34, 0.25, 'sine', 0.04]],
};

export function chime(kind) {
  if (!prefs().sounds) return;
  const ctx = W.unlockAudio();
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + 0.01;
  for (const [f, at, len, type, g] of CUES[kind] || []) {
    const o = ctx.createOscillator();
    const v = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0 + at);
    v.gain.setValueAtTime(0.0001, t0 + at);
    v.gain.exponentialRampToValueAtTime(g, t0 + at + 0.012);
    v.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
    o.connect(v).connect(ctx.destination);
    o.start(t0 + at);
    o.stop(t0 + at + len + 0.02);
  }
}

// A soft, slowly pulsing low tone while the AI works. Returns stop().
export function hum() {
  if (!prefs().sounds) return () => {};
  const ctx = W.unlockAudio();
  if (!ctx || ctx.state !== 'running') return () => {};
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  g.connect(ctx.destination);
  const oscs = [110, 165.4].map((f) => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(g); o.start(); return o; });
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  lfo.frequency.value = 0.8;
  depth.gain.value = 0.012;
  lfo.connect(depth).connect(g.gain);
  lfo.start();
  g.gain.exponentialRampToValueAtTime(0.018, ctx.currentTime + 0.4);
  return () => {
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    for (const o of [...oscs, lfo]) o.stop(t + 0.3);
  };
}
