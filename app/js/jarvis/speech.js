// Free, private speech that runs in the browser with open-weights models (Transformers.js):
//   hearing — Whisper (base, ~80 MB): works where the built-in recognizer doesn't (iPad/iPhone
//             home-screen app, Firefox) and needs no key.
//   voice   — Kokoro (82M, ~90 MB): a natural voice, including British ones for the full Jarvis effect.
// Both download once on first use and are cached by the browser.

const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
const KOKORO = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';

export const KOKORO_VOICES = [
  ['bm_george', 'George — British, calm (Jarvis)'], ['bm_lewis', 'Lewis — British, deep'], ['bm_daniel', 'Daniel — British'],
  ['bf_emma', 'Emma — British'], ['bf_isabella', 'Isabella — British'], ['am_michael', 'Michael — American'],
  ['am_adam', 'Adam — American'], ['af_heart', 'Heart — American, warm'], ['af_bella', 'Bella — American'], ['af_nicole', 'Nicole — American, soft'],
];

export const status = { stt: 'idle', tts: 'idle', progress: '' };
const progress = (kind) => (p) => {
  if (p?.status === 'progress' && p.file && /onnx|bin/.test(p.file)) status.progress = `${kind}: ${Math.round(p.progress || 0)}%`;
};

async function hasWebGPU() {
  try { return Boolean(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { return false; }
}

// ---- Hearing ------------------------------------------------------------------------------------
let asr = null;
async function recognizer() {
  if (asr) return asr;
  status.stt = 'loading';
  asr = (async () => {
    const { pipeline } = await import(TRANSFORMERS);
    const gpu = await hasWebGPU();
    const p = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', gpu
      ? { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback: progress('Whisper') }
      : { dtype: 'q8', progress_callback: progress('Whisper') });
    status.stt = 'ready'; status.progress = '';
    return p;
  })();
  asr.catch(() => { asr = null; status.stt = 'error'; });
  return asr;
}

// 16 kHz mono samples from a recorded clip.
async function samples(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC({ sampleRate: 16000 });
  try {
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    if (buf.numberOfChannels === 1) return buf.getChannelData(0);
    const a = buf.getChannelData(0); const b = buf.getChannelData(1);
    return a.map((v, i) => (v + b[i]) / 2);
  } finally { ac.close?.(); }
}

const LANG = { en: 'english', hi: 'hindi', es: 'spanish', fr: 'french', de: 'german' };

export async function transcribeLocal(blob, { lang = 'en' } = {}) {
  const [p, audio] = await Promise.all([recognizer(), samples(blob)]);
  const out = await p(audio, { language: LANG[lang.slice(0, 2).toLowerCase()] || 'english', task: 'transcribe', chunk_length_s: 30 });
  return String(out?.text || '').replace(/\[(?:BLANK_AUDIO|Music|MUSIC|silence)\]/g, '').trim();
}

export function preloadHearing() { return recognizer(); }

// ---- Voice --------------------------------------------------------------------------------------
let tts = null;
async function synth() {
  if (tts) return tts;
  status.tts = 'loading';
  tts = (async () => {
    const { KokoroTTS } = await import(KOKORO);
    const m = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm', progress_callback: progress('Voice') });
    status.tts = 'ready'; status.progress = '';
    return m;
  })();
  tts.catch(() => { tts = null; status.tts = 'error'; });
  return tts;
}

export function preloadVoice() { return synth(); }

let playing = null;
export function stopLocal() {
  try { playing?.stop(); } catch { /* ignore */ }
  playing = null;
}

// Speaks `text` through `ctx` (an unlocked AudioContext); resolves when it has finished.
// Long replies are spoken sentence by sentence, so the first words come out quickly.
export async function speakLocal(text, voice = 'bm_george', ctx) {
  const model = await synth();
  stopLocal();
  const token = {};
  playing = { stop() { token.stopped = true; token.src?.stop(); } };
  const own = playing;
  const parts = String(text).match(/[^.!?]+[.!?]*\s*/g) || [text];
  let next = model.generate(parts[0], { voice });
  for (let i = 0; i < parts.length; i++) {
    const audio = await next;
    if (token.stopped) return;
    if (i + 1 < parts.length) next = model.generate(parts[i + 1], { voice });
    const buf = ctx.createBuffer(1, audio.audio.length, audio.sampling_rate);
    buf.copyToChannel(audio.audio, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    token.src = src;
    await new Promise((resolve) => { src.onended = resolve; src.start(); });
    if (token.stopped) return;
  }
  if (playing === own) playing = null;
}
