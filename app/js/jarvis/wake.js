// Hands-free: while Daybook is open, listen for “Jarvis …” (or your assistant's name) and act on
// what follows (“Jarvis, add milk to my list”), or open the conversation if you only said the name.
// Uses the browser's own continuous speech recognition, so it's free — Chrome and Edge (laptop
// and Android) support it; Safari's is unreliable, so there the mic button is the way in.

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

let rec = null;
let wanted = false;
let paused = false;
let opts = null;
let restartTimer = 0;
let failures = 0;

export const state = { on: false, error: '' };

export function supported() {
  return Boolean(SR);
}

export function wakeRegex(name = 'Jarvis') {
  const n = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim() || 'jarvis';
  // Recognizers often hear “Jarvis” as “Travis”, “jervis” or “java's”.
  const alts = n === 'jarvis' ? 'jarvis|jervis|travis|jarvus|java is|jarvas' : n;
  return new RegExp(`(?:^|\\b)(?:hey |ok |okay |hi )?(?:${alts})\\b[\\s,.!?:-]*(.*)$`, 'i');
}

// { name, lang, onWake(rest) }
export function start(o) {
  opts = o;
  wanted = true;
  state.error = '';
  if (!SR) { state.error = 'This browser has no continuous speech recognition (use Chrome or Edge).'; return false; }
  run();
  return true;
}

export function stop() {
  wanted = false;
  clearTimeout(restartTimer);
  try { rec?.abort(); } catch { /* ignore */ }
  rec = null;
  state.on = false;
}

// The conversation panel owns the mic while it's listening.
export function pause() {
  paused = true;
  clearTimeout(restartTimer);
  try { rec?.abort(); } catch { /* ignore */ }
  rec = null;
  state.on = false;
}

export function resume() {
  paused = false;
  if (wanted) schedule(400);
}

function schedule(ms) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(run, ms);
}

function run() {
  if (!wanted || paused || rec || document.visibilityState !== 'visible') return;
  const r = new SR();
  r.lang = opts.lang || 'en-US';
  r.continuous = true;
  r.interimResults = true;
  const re = wakeRegex(opts.name);
  let fired = false;
  let pending = '';
  let pendingTimer = 0;
  r.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const text = res[0].transcript.trim();
      const m = text.match(re);
      if (!m || fired) continue;
      if (res.isFinal) {
        fired = true;
        clearTimeout(pendingTimer);
        failures = 0;
        fire(m[1].trim());
      } else {
        // Heard the name: give the rest of the sentence a moment to arrive.
        pending = m[1].trim();
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => { if (!fired) { fired = true; fire(pending); } }, 2500);
      }
    }
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { state.error = 'Microphone permission is blocked.'; wanted = false; }
    else if (e.error !== 'no-speech' && e.error !== 'aborted') failures++;
  };
  r.onend = () => {
    if (rec === r) rec = null;
    state.on = false;
    if (wanted && !paused) schedule(failures > 5 ? 30000 : 300);
  };
  try { r.start(); rec = r; state.on = true; } catch { schedule(2000); }

  function fire(rest) {
    try { r.abort(); } catch { /* ignore */ }
    opts.onWake?.(rest);
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { if (wanted && !paused) schedule(300); } else { try { rec?.abort(); } catch { /* ignore */ } }
  });
}
