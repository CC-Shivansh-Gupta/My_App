// Jarvis: pick its brain (free on-device model, Ollama, or a free cloud tier), its ears and voice,
// hands-free mode, and see and edit what it remembers and has learned, and what it has cost.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as W from '../whisper.js';
import * as voice from '../voice.js';
import * as llm from '../jarvis/llm.js';
import * as mem from '../jarvis/memory.js';
import * as S from '../jarvis/speech.js';
import * as wake from '../jarvis/wake.js';
import * as panel from '../jarvis/panel.js';
import { h, icon, section, field, segmented, toast, empty } from '../ui.js';

let unwatch = null;
let gpu = null;
let downloaded = null;
let ollama = null;

export function onLeave() {
  unwatch?.();
  unwatch = null;
}

export function render(ctx) {
  if (!unwatch) {
    let timer = 0;
    unwatch = llm.onChange(() => { clearTimeout(timer); timer = setTimeout(() => { if (location.hash.startsWith('#/jarvis')) ctx.rerender(); }, 250); });
  }
  if (!gpu) { gpu = { pending: true }; llm.gpuInfo().then((g) => { gpu = g; ctx.rerender(); }); }
  if (downloaded === null) { downloaded = false; llm.isDownloaded().then((v) => { downloaded = v; if (v) ctx.rerender(); }); }
  const name = panel.name();
  const d = llm.describe();
  return h('div', { class: 'page narrow' },
    h('header', { class: 'page-head' }, h('h1', null, name),
      h('p', { class: 'muted' }, 'Your assistant. Everyday requests run on simple rules — instant and free. An AI model steps in only for the rest, and every phrase it works out is learned, so it needs the AI less over time.')),
    h('div', { class: 'card jv-hero' },
      h('div', null, h('p', { class: 'jv-hero-title' }, `${d.label}`), h('p', { class: 'muted small' }, d.detail)),
      h('button', { class: 'btn primary', onclick: () => panel.open({ go: (r) => { location.hash = `#/${r}`; } }) }, icon('mic', 18), `Talk to ${name}`)),
    brainCard(ctx), voiceCard(ctx), handsFreeCard(ctx), memoryCard(), skillsCard(), usageCard());
}

// ---- Brain ------------------------------------------------------------------------------------------
function brainCard(ctx) {
  const c = llm.cfg();
  const engine = c.engine;
  const body = [];
  body.push(field('Brain', segmented([['auto', 'Auto'], ['local', 'On-device'], ['ollama', 'Ollama'], ['cloud', 'Cloud'], ['off', 'Rules only']], engine,
    (v) => { llm.setCfg({ engine: v }); ctx.rerender(); }, { small: true }),
  'Auto uses the free options you have set up, private ones first: on-device → Ollama → cloud (within its daily cap). With none, the rules still handle everyday commands.'));
  if (engine === 'auto' || engine === 'local') body.push(localBox(ctx, c));
  if (engine === 'auto' || engine === 'ollama') body.push(ollamaBox(ctx, c));
  if (engine === 'auto' || engine === 'cloud') body.push(cloudBox(ctx, c));
  return section('Brain', h('span', { class: ['badge', llm.engines().length ? 'good' : ''] }, llm.engines().length ? 'AI ready' : 'Rules only'), h('div', { class: 'form' }, body));
}

function localBox(ctx, c) {
  const L = llm.local;
  const model = llm.LOCAL_MODELS.find((m) => m.id === c.localModel) || llm.LOCAL_MODELS[1];
  const sel = h('select', null, llm.LOCAL_MODELS.map((m) => h('option', { value: m.id, selected: m.id === c.localModel }, `${m.label} · ~${m.gb} GB`)));
  sel.addEventListener('change', () => { llm.setCfg({ localModel: sel.value }); downloaded = null; ctx.rerender(); });
  const ready = llm.localReady() && L.model === c.localModel;
  const have = ready || downloaded || c.localDownloaded === c.localModel;
  const bar = L.state === 'loading' ? h('div', { class: 'jv-progress' }, h('div', { class: 'meter' }, h('span', { style: { width: `${Math.round(L.progress * 100)}%` } })), h('p', { class: 'small muted' }, L.text)) : null;
  return h('div', { class: 'jv-box' },
    h('p', { class: 'jv-box-title' }, '💻 On-device — free, private, works offline'),
    h('p', { class: 'small muted' }, 'An open-weights model (Qwen or Llama) runs right here on your GPU through WebLLM. It downloads once, then nothing you say leaves this device. Best on a laptop or a recent iPad; a phone can manage the tiny one.'),
    gpu?.pending ? h('p', { class: 'small muted' }, 'Checking your GPU…')
      : gpu && !gpu.ok ? h('p', { class: 'small error' }, gpu.why)
        : h('p', { class: 'small' }, `WebGPU ready${gpu?.f16 ? '' : ' (using the 32-bit build)'}.`),
    field('Model', sel),
    bar,
    L.state === 'error' ? h('p', { class: 'small error' }, L.error) : null,
    h('div', { class: 'btn-row' },
      ready ? h('span', { class: 'badge good' }, 'Loaded')
        : h('button', { class: 'btn primary sm', disabled: L.state === 'loading' || (gpu && gpu.ok === false), onclick: () => {
          llm.loadLocal(c.localModel).then(() => { downloaded = true; toast(`${llm.modelLabel(c.localModel)} is ready`); }).catch((e) => toast(`Couldn’t load: ${e.message}`));
        } }, icon('download', 16), have ? 'Load' : `Download (~${model.gb} GB)`),
      have ? h('button', { class: 'btn ghost sm', onclick: async () => {
        try { await llm.deleteLocal(c.localModel); downloaded = false; toast('Removed from this device'); } catch (e) { toast(e.message); }
        ctx.rerender();
      } }, 'Delete download') : null));
}

function ollamaBox(ctx, c) {
  const url = h('input', { value: c.ollamaUrl, placeholder: 'http://localhost:11434', autocomplete: 'off', spellcheck: 'false' });
  const model = h('input', { value: c.ollamaModel, placeholder: 'qwen3:4b', autocomplete: 'off', spellcheck: 'false' });
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return h('details', { class: 'jv-box', open: c.engine === 'ollama' || c.ollamaOn || undefined },
    h('summary', { class: 'jv-box-title' }, `🦙 Ollama on your computer — free, private${c.ollamaOn ? ' · on' : ''}`),
    h('p', { class: 'small muted' }, 'Run any open-weights model with Ollama on this laptop. Bigger models than the browser can hold, still at no cost.'),
    h('ol', { class: 'small steps' },
      h('li', null, 'Install Ollama from ollama.com, then pull a model: ', h('code', null, 'ollama pull qwen3:4b'), ' (or llama3.2:3b, gemma3:4b).'),
      h('li', null, 'Let this site talk to it — start it with ', h('code', null, `OLLAMA_ORIGINS=${origin} ollama serve`), ' (on a Mac app install: ', h('code', null, `launchctl setenv OLLAMA_ORIGINS "${origin}"`), ', then restart Ollama).'),
      h('li', null, 'Press Test. It works from this computer’s browser; other devices use the on-device or cloud brain.')),
    h('div', { class: 'row2' }, field('Address', url), field('Model', model)),
    ollama ? h('p', { class: ['small', ollama.ok ? '' : 'error'] }, ollama.ok ? `Connected. Models: ${ollama.models.join(', ') || 'none pulled yet'}` : `Not reachable${ollama.error ? ` (${ollama.error})` : ''}. Is Ollama running with OLLAMA_ORIGINS set?`) : null,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary sm', onclick: async () => {
        llm.setCfg({ ollamaUrl: url.value.trim().replace(/\/+$/, ''), ollamaModel: model.value.trim() || 'qwen3:4b' });
        ollama = await llm.checkOllama(url.value.trim());
        if (ollama.ok) llm.setCfg({ ollamaOn: true });
        ctx.rerender();
      } }, 'Save & test'),
      c.ollamaOn ? h('button', { class: 'btn ghost sm', onclick: () => { llm.setCfg({ ollamaOn: false }); ctx.rerender(); } }, 'Turn off') : null));
}

function cloudBox(ctx, c) {
  const info = llm.cloudInfo(c);
  const key = h('input', { type: 'password', value: c.cloudKey, placeholder: info.sharedKey ? 'Using your Groq key from Voice settings' : 'API key', autocomplete: 'off', spellcheck: 'false' });
  const model = h('input', { value: c.cloudModel, placeholder: llm.CLOUDS[c.cloud]?.model || 'model id', autocomplete: 'off', spellcheck: 'false' });
  const base = c.cloud === 'custom' ? h('input', { value: c.cloudBase, placeholder: 'https://…/v1', autocomplete: 'off', spellcheck: 'false' }) : null;
  const cap = h('input', { type: 'number', inputmode: 'numeric', min: 0, class: 'short', value: c.dailyCloud });
  const left = llm.cloudLeft(c);
  return h('details', { class: 'jv-box', open: c.engine === 'cloud' || Boolean(info.key) || undefined },
    h('summary', { class: 'jv-box-title' }, `☁️ Free cloud tier — works on every device${info.key ? ' · on' : ''}`),
    h('p', { class: 'small muted' }, 'Groq serves open-weights models (Llama 3.3 70B, Qwen, gpt-oss) on a free tier with no card, and doesn’t keep what you send by default. What you say and a short summary of today’s data go to the provider for that request. The daily cap keeps you inside the free limits; when it’s used up, the other brains or the rules take over.'),
    field('Provider', segmented(Object.entries(llm.CLOUDS).map(([k, v]) => [k, v.label.split(' —')[0]]), c.cloud, (v) => { llm.setCfg({ cloud: v, cloudModel: '' }); ctx.rerender(); }, { small: true })),
    field('API key', key, info.keyUrl ? h('a', { href: info.keyUrl, target: '_blank', rel: 'noopener' }, 'Get a free key') : null),
    base ? field('Base URL', base) : null,
    h('div', { class: 'row2' }, field('Model', model), field('Daily cap', cap, `${left} left today`)),
    h('button', { class: 'btn primary sm', onclick: () => {
      llm.setCfg({ cloudKey: key.value.trim(), cloudModel: model.value.trim(), dailyCloud: Math.max(0, Number(cap.value) || 0), ...(base ? { cloudBase: base.value.trim() } : {}) });
      toast('Saved on this device');
      ctx.rerender();
    } }, 'Save'));
}

// ---- Ears and voice ----------------------------------------------------------------------------------
function voiceCard(ctx) {
  const vc = W.cfg();
  const hearing = vc.engine === 'local' ? 'local' : vc.engine === 'whisper' ? 'whisper' : 'browser';
  const reply = h('select', null,
    h('option', { value: '', selected: !(vc.reply || '').startsWith('local:') }, 'Device / Settings choice'),
    h('optgroup', { label: 'Open-weights voice (Kokoro, on-device, free)' },
      S.KOKORO_VOICES.map(([id, label]) => h('option', { value: `local:${id}`, selected: vc.reply === `local:${id}` }, label))));
  reply.addEventListener('change', () => {
    W.setCfg({ reply: reply.value });
    if (reply.value) toast('Downloading the voice (~90 MB, once)…');
    voice.speak(`Hello${panel.userName() ? `, ${panel.userName()}` : ''}. This is how I sound.`, { force: true });
  });
  return section('Ears & voice', h('a', { class: 'btn ghost sm', href: '#/settings' }, 'More in Settings'),
    h('div', { class: 'form' },
      field('Listening', segmented([['browser', 'Built-in'], ['local', 'On-device Whisper'], ['whisper', 'Cloud Whisper']], hearing, (v) => {
        W.setCfg({ engine: v });
        if (v === 'local') { toast('Downloading Whisper (~80 MB, once)…'); S.preloadHearing().then(() => toast('On-device Whisper is ready')).catch((e) => toast(`Whisper failed: ${e.message}`)); }
        if (v === 'whisper' && !vc.key) toast('Add a free Groq key in Settings → Voice assistant');
        ctx.rerender();
      }, { small: true }), 'Built-in is the browser’s own recognizer. On-device Whisper is an open-weights model running here — free, private, and it works in the iPad/iPhone home-screen app. Cloud Whisper uses your Groq key.'),
      field('Voice', reply, 'Kokoro is an open-weights voice that runs on this device. George or Lewis for the classic Jarvis.'),
      h('button', { class: 'btn ghost sm', onclick: () => voice.speak(`At your service${panel.userName() ? `, ${panel.userName()}` : ''}.`, { force: true }) }, 'Test voice'),
      S.status.progress ? h('p', { class: 'small muted' }, S.status.progress) : null));
}

function handsFreeCard(ctx) {
  const c = llm.cfg();
  const name = h('input', { value: panel.name(), maxlength: 20, class: 'short' });
  name.addEventListener('change', () => { store.setPref('jarvisName', name.value.trim() || 'Jarvis'); if (c.wake) panel.startWake((r) => { location.hash = `#/${r}`; }); });
  const you = h('input', { value: panel.userName(), maxlength: 24, class: 'short', placeholder: 'your name' });
  you.addEventListener('change', () => store.setPref('userName', you.value.trim()));
  return section('Hands-free', null,
    h('div', { class: 'form' },
      h('div', { class: 'row2' }, field('Assistant’s name', name), field('What it calls you', you)),
      field('Keep the conversation going', segmented([[true, 'On'], [false, 'Off']], c.conversation, (v) => { llm.setCfg({ conversation: v }); }, { small: true }),
        'After answering something you said, it listens again. Say “thanks” or stay quiet to stop.'),
      field(`Wake word (“${panel.name()}, …”)`, segmented([[false, 'Off'], [true, 'On']], c.wake, (v) => { llm.setCfg({ wake: v }); ctx.rerender(); }, { small: true }),
        wake.supported()
          ? 'While Daybook is open on this device, say its name to talk — no tap needed. Uses the browser’s free recognizer, so the mic stays on while the app is open. Best in Chrome or Edge.'
          : 'This browser can’t listen continuously. Use Chrome or Edge on a laptop or Android for the wake word.'),
      wake.state.error ? h('p', { class: 'small error' }, wake.state.error) : null));
}

// ---- Memory and skills ---------------------------------------------------------------------------------
function memoryCard() {
  const list = mem.facts();
  const input = h('input', { class: 'qa-input', placeholder: 'e.g. My sister Priya’s birthday is 4 June', 'data-key': 'jv-fact' });
  const add = () => { if (input.value.trim()) { mem.remember(input.value); input.value = ''; } };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return section('Memory', h('span', { class: 'count' }, list.length),
    h('p', { class: 'small muted' }, 'Things it knows about you. Say “remember that …” or “forget …”. The most relevant ones are shared with the AI when it needs them; questions like “when is Priya’s birthday?” are answered straight from here.'),
    list.length ? h('ul', { class: 'list compact' }, list.map((f) => h('li', { class: 'row' },
      h('span', { class: 'row-emoji' }, f.source === 'ai' ? '✨' : '🧠'),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, f.text), h('span', { class: 'row-sub' }, `${f.source === 'ai' ? 'Picked up in conversation' : 'You told me'} · ${D.fmtDate(D.toStr(new Date(f.createdAt)))}`)),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Forget', 'data-tip': 'Forget', onclick: () => store.remove('jarvisMemory', f.id) }, icon('trash', 18))))) : empty('Nothing yet.'),
    h('div', { class: 'qa-row' }, input, h('button', { class: 'btn ghost sm', onclick: add }, 'Remember')));
}

const SOURCE = { taught: ['🎓', 'You taught it'], corrected: ['✏️', 'You corrected it'], learned: ['🧩', 'Learned from the AI'] };

function skillsCard() {
  const list = mem.skills();
  const phrase = h('input', { placeholder: 'When I say… (e.g. good night)', 'data-key': 'jv-phrase' });
  const cmds = h('input', { placeholder: 'do… (e.g. stop tracking; brief me for tomorrow)', 'data-key': 'jv-cmds' });
  const add = () => {
    if (!phrase.value.trim() || !cmds.value.trim()) return;
    mem.teach(phrase.value, mem.splitCommands(cmds.value), { name: panel.name() });
    phrase.value = ''; cmds.value = '';
    toast('Learned');
  };
  cmds.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  return section('What it has learned', h('span', { class: 'count' }, list.length),
    h('p', { class: 'small muted' }, 'Phrases it now handles instantly without AI: ones you taught (“when I say movie night, add popcorn to my list and open watch list”), ones you corrected (“no, I meant …”), and ones the AI worked out that you kept.'),
    list.length ? h('ul', { class: 'list compact' }, list.slice(0, 50).map((s) => {
      const [emoji, label] = SOURCE[s.source] || SOURCE.learned;
      return h('li', { class: 'row' },
        h('span', { class: 'row-emoji' }, emoji),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, `“${s.phrase}”`),
          h('span', { class: 'row-sub' }, `→ ${s.commands.join(' · ')}`), h('span', { class: 'row-sub' }, `${label}${s.uses ? ` · used ${s.uses}×` : ''}`)),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Forget', 'data-tip': 'Forget this phrase', onclick: () => mem.unlearn(s.id) }, icon('trash', 18)));
    })) : empty('Nothing yet. It learns as you talk to it.'),
    h('div', { class: 'form' }, h('div', { class: 'row2' }, phrase, cmds), h('button', { class: 'btn ghost sm', onclick: add }, 'Teach')));
}

// ---- Cost ----------------------------------------------------------------------------------------------
function usageCard() {
  const since = D.addDays(D.today(), -29);
  const t = mem.totals(since);
  const today = mem.usage(D.today());
  if (!t.total) return section('Usage', null, empty('No requests yet. Everything handled by rules, memory or learned phrases costs nothing; the AI is only used when those can’t help.'));
  const pct = (n) => `${Math.round((n / t.total) * 100)}%`;
  const rows = [['⚡ Rules', t.rules], ['🧩 Learned phrases', t.skill], ['🧠 Memory', t.memory], ['💻 On-device AI', t.local], ['🦙 Ollama', t.ollama], ['☁️ Cloud AI', t.cloud]].filter(([, n]) => n);
  return section('Usage · last 30 days', h('span', { class: 'count' }, `${t.total} requests`),
    h('p', { class: 'small' }, `${pct(t.free)} handled without any AI. ${t.tokens ? `${t.tokens.toLocaleString()} AI tokens used.` : ''} ${t.undone ? `${t.undone} undone — each correction teaches it.` : ''}`),
    h('ul', { class: 'list compact' }, rows.map(([label, n]) => h('li', { class: 'row' },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, label)),
      h('span', { class: 'jv-bar-meter' }, h('i', { style: { width: pct(n) } })),
      h('span', { class: 'count' }, `${n} · ${pct(n)}`)))),
    h('p', { class: 'small muted' }, `Today: ${today.cloud || 0} of ${llm.cfg().dailyCloud} cloud calls. Cost so far: free — on-device and Ollama are always free, and the cloud stays within the provider’s free tier.`));
}
