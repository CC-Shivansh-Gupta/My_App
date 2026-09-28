// Where Jarvis's AI runs. All three are free:
//   local  — an open-weights model (Qwen, Llama…) running in this browser on the GPU through
//            WebLLM. Downloaded once (0.5–2.5 GB), then private, offline and unlimited.
//   ollama — any open-weights model served by Ollama on your laptop (http://localhost:11434).
//   cloud  — any OpenAI-compatible API. The default is Groq's free tier, which serves open-weights
//            models (Llama, Qwen, gpt-oss) fast; a daily cap keeps you inside the free limits.
// Settings live in localStorage. The cloud provider, key and cap travel with sync, encrypted
// (keys.js), so you set them once; engine and on-device model choices stay per device.

import * as mem from './memory.js';
import * as D from '../dates.js';
import { sse, deltaText } from './stream.js';

const CFG_KEY = 'daybook.jarvis.v1';
const WEBLLM = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm';

// Open-weights models WebLLM can run in the browser. `gb` is roughly the one-time download.
export const LOCAL_MODELS = [
  { id: 'Qwen3-0.6B-q4f16_1-MLC', label: 'Qwen3 0.6B — tiny, for phones', gb: 0.5 },
  { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 1.7B — balanced (recommended)', gb: 1.1 },
  { id: 'Qwen3.5-2B-q4f16_1-MLC', label: 'Qwen3.5 2B — newer, a bit smarter', gb: 1.4 },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B — good all-rounder', gb: 1.8 },
  { id: 'Qwen3-4B-q4f16_1-MLC', label: 'Qwen3 4B — smartest, needs a good GPU', gb: 2.3 },
];
export const DEFAULT_LOCAL = 'Qwen3-1.7B-q4f16_1-MLC';

export const CLOUDS = {
  groq: { label: 'Groq — free, open models', base: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', model: 'llama-3.3-70b-versatile' },
  openrouter: { label: 'OpenRouter — free models', base: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  gemini: { label: 'Google Gemini — free tier', base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey', model: 'gemini-2.5-flash-lite' },
  custom: { label: 'Other (OpenAI-compatible)', base: '', keyUrl: '', model: '' },
};

// engine: 'auto' | 'local' | 'ollama' | 'cloud' | 'off'
export function cfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { /* default */ }
  return { engine: 'auto', localModel: DEFAULT_LOCAL, ollamaUrl: 'http://localhost:11434', ollamaModel: 'qwen3:4b',
    cloud: 'groq', cloudKey: '', cloudModel: '', cloudBase: '', dailyCloud: 150, wake: false, conversation: true, ...c };
}

export function setCfg(patch) {
  const next = { ...cfg(), ...patch };
  try { localStorage.setItem(CFG_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  changed();
  return next;
}

const watchers = new Set();
export function onChange(fn) { watchers.add(fn); return () => watchers.delete(fn); }
function changed() { for (const fn of watchers) { try { fn(); } catch { /* ignore */ } } }

// The Groq key saved for Whisper works here too.
function cloudKey(c = cfg()) {
  if (c.cloudKey) return c.cloudKey;
  if (c.cloud !== 'groq') return '';
  try { const v = JSON.parse(localStorage.getItem('daybook.voice.v1')) || {}; return v.provider === 'groq' || !v.provider ? v.key || '' : ''; } catch { return ''; }
}

export function cloudInfo(c = cfg()) {
  const p = CLOUDS[c.cloud] || CLOUDS.groq;
  return { ...p, base: (c.cloudBase || p.base).replace(/\/+$/, ''), model: c.cloudModel || p.model, key: cloudKey(c), sharedKey: !c.cloudKey && Boolean(cloudKey(c)) };
}

export function cloudLeft(c = cfg()) {
  return Math.max(0, (Number(c.dailyCloud) || 0) - (mem.usage(D.today()).cloud || 0));
}

// ---- On-device (WebLLM) -----------------------------------------------------------------------
export const local = { state: 'idle', progress: 0, text: '', model: null, error: '' };
let engine = null;
let loading = null;
let lib = null;

async function webllm() {
  lib = lib || await import(WEBLLM);
  return lib;
}

export async function gpuInfo() {
  if (typeof navigator === 'undefined' || !navigator.gpu) return { ok: false, why: 'This browser has no WebGPU. Use Chrome or Edge (desktop or Android), or Safari on iOS/iPadOS 26+ / macOS 26+.' };
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return { ok: false, why: 'WebGPU is there, but no GPU adapter was found.' };
    return { ok: true, f16: a.features.has('shader-f16') };
  } catch (e) { return { ok: false, why: e.message }; }
}

// GPUs without 16-bit float shaders need the q4f32 build of the same model.
async function resolveModel(id) {
  const g = await gpuInfo();
  if (!g.ok) throw new Error(g.why);
  return g.f16 ? id : id.replace('q4f16_1', 'q4f32_1');
}

export async function isDownloaded(id = cfg().localModel) {
  try {
    const w = await webllm();
    return await w.hasModelInCache(await resolveModel(id));
  } catch { return false; }
}

export function localReady() {
  return Boolean(engine) && local.state === 'ready';
}

// Downloads (first time) or loads from cache, reporting progress.
export function loadLocal(id = cfg().localModel) {
  if (engine && local.model === id) return Promise.resolve(engine);
  if (loading) return loading;
  local.state = 'loading'; local.progress = 0; local.text = 'Starting…'; local.error = '';
  changed();
  loading = (async () => {
    try {
      const w = await webllm();
      const real = await resolveModel(id);
      if (engine) { try { await engine.unload(); } catch { /* ignore */ } engine = null; }
      const worker = new Worker(new URL('./webllm-worker.js', import.meta.url), { type: 'module' });
      engine = await w.CreateWebWorkerMLCEngine(worker, real, {
        initProgressCallback: (p) => { local.progress = p.progress || 0; local.text = p.text || ''; changed(); },
      });
      local.state = 'ready'; local.model = id; local.text = '';
      setCfg({ localDownloaded: id });
      return engine;
    } catch (e) {
      engine = null;
      local.state = 'error'; local.error = e.message || String(e);
      throw e;
    } finally {
      loading = null;
      changed();
    }
  })();
  return loading;
}

export async function deleteLocal(id = cfg().localModel) {
  const w = await webllm();
  if (engine && local.model === id) { try { await engine.unload(); } catch { /* ignore */ } engine = null; local.state = 'idle'; local.model = null; }
  await w.deleteModelAllInfoInCache(await resolveModel(id));
  if (cfg().localDownloaded === id) setCfg({ localDownloaded: '' });
  changed();
}

// ---- Ollama ------------------------------------------------------------------------------------
let ollamaSeen = { at: 0, ok: false };

export async function checkOllama(url = cfg().ollamaUrl) {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout?.(2500) });
    const ok = res.ok;
    const models = ok ? ((await res.json()).models || []).map((m) => m.name) : [];
    ollamaSeen = { at: Date.now(), ok };
    return { ok, models };
  } catch (e) {
    ollamaSeen = { at: Date.now(), ok: false };
    return { ok: false, models: [], error: e.message };
  }
}

// ---- Choosing an engine ------------------------------------------------------------------------
// Engines to try for one request, in order. Free and private first; the cloud only within its daily cap.
export function engines() {
  const c = cfg();
  const cloud = cloudInfo(c);
  const canCloud = Boolean(cloud.key && cloud.base && cloud.model) && cloudLeft(c) > 0;
  const canLocal = localReady() || (c.localDownloaded === c.localModel && local.state !== 'error');
  // Ollama only when you switched it on (it lives on one machine), and not while it's known to be down.
  const canOllama = c.ollamaOn && Boolean(c.ollamaUrl) && (ollamaSeen.ok || Date.now() - ollamaSeen.at > 120000);
  switch (c.engine) {
    case 'off': return [];
    case 'local': return canLocal ? ['local'] : [];
    case 'ollama': return c.ollamaUrl ? ['ollama'] : [];
    case 'cloud': return canCloud ? ['cloud'] : [];
    default: return [canLocal && 'local', canOllama && 'ollama', canCloud && 'cloud'].filter(Boolean);
  }
}

export function describe() {
  const c = cfg();
  const list = engines();
  if (c.engine === 'off') return { label: 'Rules only', detail: 'AI is off' };
  if (!list.length) return { label: 'Rules only', detail: 'No AI set up yet' };
  const e = list[0];
  if (e === 'local') return { label: 'On-device AI', detail: modelLabel(c.localModel) };
  if (e === 'ollama') return { label: 'Ollama', detail: c.ollamaModel };
  return { label: CLOUDS[c.cloud]?.label.split(' —')[0] || 'Cloud AI', detail: `${cloudInfo(c).model} · ${cloudLeft(c)} left today` };
}

export function modelLabel(id) {
  return LOCAL_MODELS.find((m) => m.id === id)?.label.split(' —')[0] || id;
}

// ---- Chat --------------------------------------------------------------------------------------
const estimate = (msgs, out) => Math.round((msgs.reduce((n, m) => n + m.content.length, 0) + out.length) / 4);

// Reads a streamed (Server-Sent Events) chat completion, calling onDelta(textSoFar) as it grows.
export async function readStream(res, onDelta) {
  // Some servers ignore "stream": true and answer in one piece.
  if (!/event-stream/i.test(res.headers?.get?.('content-type') || 'text/event-stream')) {
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content || '';
    if (text) onDelta(text);
    return { text, usage: j.usage || null };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let text = ''; let usage = null;
  const parser = sse((j) => {
    const d = deltaText(j);
    if (j.usage) usage = j.usage;
    if (d) { text += d; onDelta(text); }
  });
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(dec.decode(value, { stream: true }));
  }
  parser.end();
  return { text, usage };
}

// Returns { text, tokens, model }. With `onDelta`, the reply is streamed: onDelta(textSoFar) is
// called as it arrives, so the first sentence can be spoken before the rest is written.
export async function chat(which, messages, { maxTokens = 350, onDelta = null } = {}) {
  const c = cfg();
  if (which === 'local') {
    const e = await loadLocal(c.localModel);
    const qwen = /qwen3/i.test(c.localModel);
    const req = {
      messages, temperature: 0.3, max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      ...(qwen ? { extra_body: { enable_thinking: false } } : {}),
    };
    if (onDelta) {
      try {
        let text = ''; let usage = null;
        for await (const ch of await e.chat.completions.create({ ...req, stream: true, stream_options: { include_usage: true } })) {
          const d = deltaText(ch);
          if (ch.usage) usage = ch.usage;
          if (d) { text += d; onDelta(text); }
        }
        return { text, tokens: usage?.total_tokens || estimate(messages, text), model: modelLabel(c.localModel) };
      } catch (err) { console.warn('Streaming failed, asking again without it', err); }
    }
    const r = await e.chat.completions.create(req);
    const text = r.choices?.[0]?.message?.content || '';
    return { text, tokens: r.usage?.total_tokens || estimate(messages, text), model: modelLabel(c.localModel) };
  }
  if (which === 'ollama') {
    const url = c.ollamaUrl.replace(/\/+$/, '');
    // Qwen3 models think out loud unless told not to — slow and pointless for this.
    const msgs = /qwen3/i.test(c.ollamaModel) ? messages.map((m, i) => (i === messages.length - 1 ? { ...m, content: `${m.content} /no_think` } : m)) : messages;
    const body = { model: c.ollamaModel, messages: msgs, temperature: 0.3, max_tokens: maxTokens, response_format: { type: 'json_object' } };
    const call = (b) => fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    let res;
    try {
      res = await call(onDelta ? { ...body, stream: true } : body);
      if (onDelta && res.status === 400) { onDelta = null; res = await call(body); }
    } catch {
      ollamaSeen = { at: Date.now(), ok: false };
      throw new Error('Couldn’t reach Ollama. Is it running, with OLLAMA_ORIGINS set?');
    }
    ollamaSeen = { at: Date.now(), ok: true };
    if (!res.ok) throw new Error(`Ollama ${res.status}${res.status === 404 ? ` — run “ollama pull ${c.ollamaModel}”` : ''}`);
    if (onDelta && res.body) {
      const { text, usage } = await readStream(res, onDelta);
      return { text, tokens: usage?.total_tokens || estimate(messages, text), model: c.ollamaModel };
    }
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content || '';
    return { text, tokens: j.usage?.total_tokens || estimate(messages, text), model: c.ollamaModel };
  }
  if (which === 'cloud') {
    const p = cloudInfo(c);
    if (!p.key) throw new Error('No API key');
    if (cloudLeft(c) <= 0) throw new Error('Daily cloud limit reached');
    const body = { model: p.model, messages, temperature: 0.3, max_tokens: maxTokens, response_format: { type: 'json_object' } };
    const call = (b) => fetch(`${p.base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    let res;
    if (onDelta) {
      // Several providers don't stream in JSON mode; the prompt asks for JSON anyway.
      const { response_format: _, ...plain } = body;
      res = await call({ ...plain, stream: true });
      if (res.status === 400) onDelta = null;
    }
    if (!onDelta) {
      res = await call(body);
      if (res.status === 400) { delete body.response_format; res = await call(body); } // some providers don't do JSON mode
    }
    if (res.status === 401 || res.status === 403) throw new Error('The API key was rejected');
    if (res.status === 429) throw new Error('Free-tier rate limit reached — try again in a minute');
    if (!res.ok) throw new Error(`AI ${res.status}`);
    if (onDelta && res.body) {
      const { text, usage } = await readStream(res, onDelta);
      return { text, tokens: usage?.total_tokens || estimate(messages, text), model: p.model };
    }
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content || '';
    return { text, tokens: j.usage?.total_tokens || estimate(messages, text), model: p.model };
  }
  throw new Error(`Unknown engine ${which}`);
}

// ---- Seeing -------------------------------------------------------------------------------------
// Vision models per cloud (free tiers), overridable with cloudVision; Ollama needs one pulled
// (qwen2.5vl:3b, gemma3:4b, llava…) and set as ollamaVision.
export const VISION = { groq: 'meta-llama/llama-4-scout-17b-16e-instruct', gemini: 'gemini-2.5-flash', openrouter: 'google/gemma-3-27b-it:free', custom: '' };

export function visionEngines(c = cfg()) {
  const cloud = cloudInfo(c);
  const cloudModel = c.cloudVision || VISION[c.cloud] || '';
  const out = [];
  if (c.engine !== 'off' && c.ollamaOn && c.ollamaVision) out.push({ engine: 'ollama', model: c.ollamaVision });
  if (c.engine !== 'off' && cloud.key && cloudModel && cloudLeft(c) > 0) out.push({ engine: 'cloud', model: cloudModel });
  return out;
}

// messages: OpenAI-style, with an image_url part. Returns { text, tokens, model, engine }.
export async function vision(messages) {
  const c = cfg();
  const list = visionEngines(c);
  if (!list.length) throw new Error('no vision model set up (a free Groq, Gemini or OpenRouter key works)');
  let last = null;
  for (const { engine: which, model } of list) {
    try {
      const base = which === 'ollama' ? `${c.ollamaUrl.replace(/\/+$/, '')}/v1` : cloudInfo(c).base;
      const headers = { 'Content-Type': 'application/json', ...(which === 'cloud' ? { Authorization: `Bearer ${cloudInfo(c).key}` } : {}) };
      const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 400 }) });
      if (res.status === 401 || res.status === 403) throw new Error('the API key was rejected');
      if (res.status === 404 || res.status === 400) throw new Error(`${model} can’t take photos here (${res.status}); set another vision model`);
      if (res.status === 429) throw new Error('free-tier rate limit reached, try again in a minute');
      if (!res.ok) throw new Error(`vision ${res.status}`);
      const j = await res.json();
      const text = j.choices?.[0]?.message?.content || '';
      return { text, tokens: j.usage?.total_tokens || 800, model, engine: which };
    } catch (e) { last = e; }
  }
  throw last;
}

// Warm the on-device model in the background once it has been downloaded, so the first
// question doesn't wait for it.
export function warm() {
  const c = cfg();
  if (['auto', 'local'].includes(c.engine) && c.localDownloaded === c.localModel && !engine && !loading) {
    loadLocal(c.localModel).catch(() => {});
  }
  if ((c.engine === 'ollama' || (c.engine === 'auto' && c.ollamaOn)) && c.ollamaUrl && Date.now() - ollamaSeen.at > 300000) checkOllama().catch(() => {});
}
