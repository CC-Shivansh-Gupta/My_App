// Where Jarvis's AI runs. All three are free:
//   local  — an open-weights model (Qwen, Llama…) running in this browser on the GPU through
//            WebLLM. Downloaded once (0.5–2.5 GB), then private, offline and unlimited.
//   ollama — any open-weights model served by Ollama on your laptop (http://localhost:11434).
//   cloud  — any OpenAI-compatible API. The default is Groq's free tier, which serves open-weights
//            models (Llama, Qwen, gpt-oss) fast; a daily cap keeps you inside the free limits.
// Settings live on this device only (localStorage) — keys are never synced.

import * as mem from './memory.js';
import * as D from '../dates.js';

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

// Returns { text, tokens, model }.
export async function chat(which, messages, { maxTokens = 350 } = {}) {
  const c = cfg();
  if (which === 'local') {
    const e = await loadLocal(c.localModel);
    const qwen = /qwen3/i.test(c.localModel);
    const r = await e.chat.completions.create({
      messages, temperature: 0.3, max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      ...(qwen ? { extra_body: { enable_thinking: false } } : {}),
    });
    const text = r.choices?.[0]?.message?.content || '';
    return { text, tokens: r.usage?.total_tokens || estimate(messages, text), model: modelLabel(c.localModel) };
  }
  if (which === 'ollama') {
    const url = c.ollamaUrl.replace(/\/+$/, '');
    // Qwen3 models think out loud unless told not to — slow and pointless for this.
    const msgs = /qwen3/i.test(c.ollamaModel) ? messages.map((m, i) => (i === messages.length - 1 ? { ...m, content: `${m.content} /no_think` } : m)) : messages;
    let res;
    try {
      res = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: c.ollamaModel, messages: msgs, temperature: 0.3, max_tokens: maxTokens, response_format: { type: 'json_object' } }),
      });
    } catch {
      ollamaSeen = { at: Date.now(), ok: false };
      throw new Error('Couldn’t reach Ollama. Is it running, with OLLAMA_ORIGINS set?');
    }
    ollamaSeen = { at: Date.now(), ok: true };
    if (!res.ok) throw new Error(`Ollama ${res.status}${res.status === 404 ? ` — run “ollama pull ${c.ollamaModel}”` : ''}`);
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
    let res = await call(body);
    if (res.status === 400) { delete body.response_format; res = await call(body); } // some providers don't do JSON mode
    if (res.status === 401 || res.status === 403) throw new Error('The API key was rejected');
    if (res.status === 429) throw new Error('Free-tier rate limit reached — try again in a minute');
    if (!res.ok) throw new Error(`AI ${res.status}`);
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content || '';
    return { text, tokens: j.usage?.total_tokens || estimate(messages, text), model: p.model };
  }
  throw new Error(`Unknown engine ${which}`);
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
