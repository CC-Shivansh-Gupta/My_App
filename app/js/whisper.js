// Optional cloud speech for the voice assistant, through any OpenAI-compatible API:
//   - listening: record a clip with the mic and have Whisper transcribe it. Far better
//     with accents and long sentences than the browser's recognizer, and it works in
//     the iPad/iPhone home-screen app, where the built-in one usually doesn't.
//   - replies: OpenAI's natural text-to-speech voices.
// Groq's free tier covers transcription (free key at console.groq.com, no card).
// The key lives only on this device (localStorage), never in the synced data.

const CFG_KEY = 'daybook.voice.v1';

export const PROVIDERS = {
  groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1', stt: 'whisper-large-v3-turbo', keyUrl: 'https://console.groq.com/keys' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', stt: 'gpt-4o-mini-transcribe', tts: 'gpt-4o-mini-tts', keyUrl: 'https://platform.openai.com/api-keys' },
};

export const CLOUD_VOICES = ['marin', 'cedar', 'coral', 'nova', 'sage', 'ash'];

// { engine: 'browser' | 'whisper', provider: 'groq' | 'openai', key, reply: '' | 'device:<name>' | 'cloud:<voice>' }
export function cfg() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
}

export function setCfg(patch) {
  const next = { ...cfg(), ...patch };
  try { localStorage.setItem(CFG_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

function provider() {
  return PROVIDERS[cfg().provider] || PROVIDERS.groq;
}

export function canRecord() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
}

export function listeningOn() {
  const c = cfg();
  return c.engine === 'whisper' && Boolean(c.key) && canRecord();
}

export function cloudVoice() {
  const c = cfg();
  return c.key && provider().tts && (c.reply || '').startsWith('cloud:') ? c.reply.slice(6) : null;
}

// ---- Shared audio context ----------------------------------------------------------------------
// iOS only lets a page make sound (and measure the mic) from a context created or resumed during
// a tap, so the voice sheet calls this from its click handlers.
let ctx = null;
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx || ctx.state === 'closed') ctx = new AC();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

// ---- Listening ---------------------------------------------------------------------------------
const NOTHING = 'I didn’t hear anything. Tap the mic and try again.';

// Same callbacks as voice.listen(). Returns a handle with stop() (finish and transcribe) and
// abort() (throw the clip away). Stops by itself after a pause in speech.
export function record({ onFinal, onError, onEnd, onStatus, hint = '', lang = 'en' } = {}) {
  const ac = unlockAudio();
  let stream = null; let rec = null; let raf = 0; let timer = 0;
  let cancelled = false; let heard = false; let ended = false;
  const chunks = [];
  const end = () => { if (!ended) { ended = true; onEnd?.(); } };
  const cleanup = () => {
    cancelAnimationFrame(raf); clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
  };
  const handle = {
    stop() { if (rec?.state === 'recording') rec.stop(); else if (!rec) { cancelled = true; cleanup(); end(); } },
    abort() { cancelled = true; if (rec?.state === 'recording') rec.stop(); else { cleanup(); end(); } },
  };

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      onError?.(/NotAllowed|Security/.test(e.name) ? 'not-allowed' : 'No microphone found.');
      end();
      return;
    }
    if (cancelled) { cleanup(); end(); return; }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = async () => {
      cleanup();
      if (cancelled) { end(); return; }
      if (!heard || !chunks.length) { onError?.(NOTHING); end(); return; }
      onStatus?.('Transcribing…');
      try {
        const text = await transcribe(new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }), { hint, lang });
        if (!cancelled) { if (text) onFinal?.(text); else onError?.(NOTHING); }
      } catch (e) {
        if (!cancelled) onError?.(e.message);
      }
      end();
    };
    rec.start(250);
    onStatus?.('Listening…');
    watchSilence(ac, stream, handle, () => { heard = true; });
  })();

  function watchSilence(ac, stream, handle, onSpeech) {
    const started = Date.now();
    timer = setTimeout(() => handle.stop(), 30000);
    if (!ac || ac.state !== 'running') { onSpeech(); return; } // can't measure: stop on tap or after 30s
    const an = ac.createAnalyser();
    an.fftSize = 1024;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    let floor = 0; let frames = 0; let lastLoud = 0;
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const now = Date.now();
      if (frames++ < 8) floor = Math.max(floor, rms); // the first ~130ms: background noise
      else if (rms > Math.max(0.015, floor * 2.5)) { if (!lastLoud) onSpeech(); lastLoud = now; }
      if (lastLoud && now - lastLoud > 1500) return handle.stop(); // paused after speaking
      if (!lastLoud && now - started > 8000) return handle.stop(); // never started speaking
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  return handle;
}

export async function transcribe(blob, { hint = '', lang = 'en' } = {}) {
  const p = provider();
  const ext = /mp4|m4a|aac/.test(blob.type) ? 'mp4' : /ogg/.test(blob.type) ? 'ogg' : /wav/.test(blob.type) ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', blob, `speech.${ext}`);
  form.append('model', p.stt);
  form.append('language', lang.slice(0, 2).toLowerCase());
  form.append('response_format', 'json');
  if (hint) form.append('prompt', hint.slice(0, 600));
  let res;
  try {
    res = await fetch(`${p.base}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${cfg().key}` }, body: form });
  } catch {
    throw new Error('Couldn’t reach the transcription service. Check your connection.');
  }
  if (res.status === 401) throw new Error(`${p.label} rejected the API key. Check it in Settings → Voice assistant.`);
  if (res.status === 429) throw new Error(`${p.label} rate limit reached. Try again in a minute.`);
  if (!res.ok) throw new Error(`Transcription failed (${res.status}).`);
  return String((await res.json()).text || '').trim();
}

// ---- Speaking ----------------------------------------------------------------------------------
let playing = null;

export function stopSpeaking() {
  try { playing?.stop(); } catch { /* ignore */ }
  playing = null;
}

// Speaks with a cloud voice. Rejects on any failure so the caller can fall back to the device.
export async function speakCloud(text, voice = cloudVoice()) {
  const p = provider();
  const ac = unlockAudio();
  if (!ac || !voice || !p.tts) throw new Error('unavailable');
  stopSpeaking();
  const res = await fetch(`${p.base}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg().key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: p.tts, voice, input: text, response_format: 'mp3',
      instructions: 'You are a friendly personal assistant. Speak warmly and naturally, at a relaxed, conversational pace.' }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}`);
  const audio = await ac.decodeAudioData(await res.arrayBuffer());
  const src = ac.createBufferSource();
  src.buffer = audio;
  src.connect(ac.destination);
  src.start();
  playing = src;
  src.onended = () => { if (playing === src) playing = null; };
}
