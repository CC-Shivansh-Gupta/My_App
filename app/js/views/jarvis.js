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
import * as asks from '../jarvis/asks.js';
import * as A from '../jarvis/audio.js';
import * as P from '../jarvis/protocols.js';
import * as world from '../jarvis/world.js';
import * as home from '../jarvis/home.js';
import * as companion from '../jarvis/companion.js';
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
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn', href: '#/hud' }, icon('orbit', 18), 'HUD mode'),
        h('button', { class: 'btn primary', onclick: () => panel.open({ go: (r) => { location.hash = `#/${r}`; } }) }, icon('mic', 18), `Talk to ${name}`))),
    claudeCard(ctx), protocolsCard(ctx), brainCard(ctx), voiceCard(ctx), handsFreeCard(ctx), characterCard(ctx), senseCard(ctx), homeCard(ctx), companionCard(ctx),
    messagesCard(), memoryCard(), skillsCard(), usageCard());
}

// ---- Claude (through the agent, on your Claude plan) ------------------------------------------------------
function claudeCard(ctx) {
  const ready = asks.answered();
  const waiting = asks.pending();
  const done = asks.recent(3);
  const setUp = store.pref('claudeAgentSeen', false);
  const item = (a) => h('div', { class: 'jv-ask' },
    h('p', { class: 'small muted' }, `You: “${a.text}”`),
    h('p', null, a.say || 'No reply text.'),
    a.do?.length ? h('ul', { class: 'voice-lines' }, a.do.map((c) => h('li', null, c))) : null,
    h('div', { class: 'btn-row' },
      a.do?.length ? h('button', { class: 'btn primary sm', onclick: async () => { const r = await panel.applyAnswer(a); toast(r.title || 'Done'); ctx.rerender(); } }, 'Do it') : null,
      h('button', { class: 'btn ghost sm', onclick: () => { asks.close(a, a.do?.length ? 'dismissed' : 'done'); ctx.rerender(); } }, a.do?.length ? 'Dismiss' : 'Got it')));
  return section('Claude', h('span', { class: ['badge', ready.length ? 'good' : ''] }, ready.length ? `${ready.length} answered` : waiting.length ? `${waiting.length} waiting` : 'Your plan'),
    h('p', { class: 'small muted' }, 'For the big asks — “plan my week”, “sort my tasks into headings”, “what should I focus on this month?” — say “ask Claude …”. '
      + 'Your agent answers on its next run with Claude Code on your Claude plan, so it costs nothing extra. It isn’t instant (minutes to a few hours), and nothing changes until you tap “Do it”.'),
    ready.length ? h('div', { class: 'stack' }, ready.map(item)) : null,
    waiting.length ? h('ul', { class: 'small voice-lines' }, waiting.map((a) => h('li', null, `⏳ ${a.text}${a.error ? ` — last try: ${a.error}` : ''}`,
      ' ', h('button', { class: 'btn ghost sm', onclick: () => { asks.close(a, 'dismissed', 'Cancelled'); ctx.rerender(); } }, 'Cancel')))) : null,
    done.length && !ready.length ? h('p', { class: 'small muted' }, `Last: ${done.map((a) => `“${a.text}” — ${a.status === 'done' ? a.outcome || 'done' : 'dismissed'}`).join(' · ')}`) : null,
    setUp ? null : h('p', { class: 'small' }, 'One-time setup: see “Claude for the agent” in the ', h('a', { href: 'https://github.com/CC-Shivansh-Gupta/My_App#claude-for-the-agent-optional-uses-your-claude-plan', target: '_blank', rel: 'noopener' }, 'README'), '.'));
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
  const ollamaVision = h('input', { value: c.ollamaVision || '', placeholder: 'qwen2.5vl:3b', autocomplete: 'off', spellcheck: 'false' });
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return h('details', { class: 'jv-box', open: c.engine === 'ollama' || c.ollamaOn || undefined },
    h('summary', { class: 'jv-box-title' }, `🦙 Ollama on your computer — free, private${c.ollamaOn ? ' · on' : ''}`),
    h('p', { class: 'small muted' }, 'Run any open-weights model with Ollama on this laptop. Bigger models than the browser can hold, still at no cost.'),
    h('ol', { class: 'small steps' },
      h('li', null, 'Install Ollama from ollama.com, then pull a model: ', h('code', null, 'ollama pull qwen3:4b'), ' (or llama3.2:3b, gemma3:4b).'),
      h('li', null, 'Let this site talk to it — start it with ', h('code', null, `OLLAMA_ORIGINS=${origin} ollama serve`), ' (on a Mac app install: ', h('code', null, `launchctl setenv OLLAMA_ORIGINS "${origin}"`), ', then restart Ollama).'),
      h('li', null, 'Press Test. It works from this computer’s browser; other devices use the on-device or cloud brain.')),
    h('div', { class: 'row2' }, field('Address', url), field('Model', model)),
    field('Vision model (optional)', ollamaVision, 'For photos, e.g. qwen2.5vl:3b or gemma3:4b (pull it first).'),
    ollama ? h('p', { class: ['small', ollama.ok ? '' : 'error'] }, ollama.ok ? `Connected. Models: ${ollama.models.join(', ') || 'none pulled yet'}` : `Not reachable${ollama.error ? ` (${ollama.error})` : ''}. Is Ollama running with OLLAMA_ORIGINS set?`) : null,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary sm', onclick: async () => {
        llm.setCfg({ ollamaUrl: url.value.trim().replace(/\/+$/, ''), ollamaModel: model.value.trim() || 'qwen3:4b', ollamaVision: ollamaVision.value.trim() });
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
  const vision = h('input', { value: c.cloudVision || '', placeholder: llm.VISION[c.cloud] || 'a vision model id', autocomplete: 'off', spellcheck: 'false' });
  const left = llm.cloudLeft(c);
  return h('details', { class: 'jv-box', open: c.engine === 'cloud' || Boolean(info.key) || undefined },
    h('summary', { class: 'jv-box-title' }, `☁️ Free cloud tier — works on every device${info.key ? ' · on' : ''}`),
    h('p', { class: 'small muted' }, 'Groq serves open-weights models (Llama 3.3 70B, Qwen, gpt-oss) on a free tier with no card, and doesn’t keep what you send by default. What you say and a short summary of today’s data go to the provider for that request. The daily cap keeps you inside the free limits; when it’s used up, the other brains or the rules take over.'),
    field('Provider', segmented(Object.entries(llm.CLOUDS).map(([k, v]) => [k, v.label.split(' —')[0]]), c.cloud, (v) => { llm.setCfg({ cloud: v, cloudModel: '' }); ctx.rerender(); }, { small: true })),
    field('API key', key, info.keyUrl ? h('a', { href: info.keyUrl, target: '_blank', rel: 'noopener' }, 'Get a free key') : null),
    base ? field('Base URL', base) : null,
    h('div', { class: 'row2' }, field('Model', model), field('Daily cap', cap, `${left} left today`)),
    field('Vision model (photos)', vision, `For “show it a photo”. Default: ${llm.VISION[c.cloud] || 'none for this provider'}.`),
    h('button', { class: 'btn primary sm', onclick: () => {
      llm.setCfg({ cloudKey: key.value.trim(), cloudModel: model.value.trim(), cloudVision: vision.value.trim(), dailyCloud: Math.max(0, Number(cap.value) || 0), ...(base ? { cloudBase: base.value.trim() } : {}) });
      toast('Saved — your other signed-in devices get it on their next sync');
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
      field('Interrupt by talking', segmented([[true, 'On'], [false, 'Off']], A.prefs().bargeIn, (v) => { A.setPrefs({ bargeIn: v }); ctx.rerender(); }, { small: true }),
        'While it talks, just start speaking and it stops to listen. If it keeps cutting itself off (speakers loud, no headphones), switch this off.'),
      field('Sounds', segmented([[true, 'On'], [false, 'Off']], A.prefs().sounds, (v) => { A.setPrefs({ sounds: v }); if (v) A.chime('done'); ctx.rerender(); }, { small: true }),
        'Short cues: heard you, thinking, done, and a chime when it has something to tell you.'),
      wake.state.error ? h('p', { class: 'small error' }, wake.state.error) : null));
}

// ---- Character and speaking first ------------------------------------------------------------------------
function characterCard(ctx) {
  const style = store.pref('jarvisStyle', 'jarvis');
  const addr = store.pref('jarvisAddress', 'name');
  return section('Character', null,
    h('div', { class: 'form' },
      field('Personality', segmented([['jarvis', 'Classic Jarvis'], ['plain', 'Plain']], style, (v) => { store.setPref('jarvisStyle', v); ctx.rerender(); }, { small: true }),
        'Classic: calm, dry British wit, says so when you’re about to do something unwise. Plain: short and straight.'),
      field('It calls you', segmented([['name', 'Your name'], ['sir', 'Sir'], ['maam', 'Ma’am'], ['none', 'Nothing']], addr, (v) => { store.setPref('jarvisAddress', v); ctx.rerender(); }, { small: true })),
      field('Speaks first', segmented([['off', 'Never'], ['quiet', 'Banner'], ['voice', 'Out loud']], store.pref('proactive', 'quiet'), (v) => { store.setPref('proactive', v); ctx.rerender(); }, { small: true }),
        'While the app is open it watches for things worth saying: a meeting in 10 minutes, a streak about to break, the budget slipping, promises you made (“I’ll finish the report tonight”), rain on the way, Claude’s answers, and a “while you were away” after a few hours. In HUD mode it always speaks.')));
}

// ---- Protocols ------------------------------------------------------------------------------------------------
let editing = null; // protocol being edited (or {} for a new one)

function protocolsCard(ctx) {
  const list = P.list();
  const running = P.active();
  const missing = P.TEMPLATES.filter((t) => !list.some((p) => p.name.toLowerCase() === t.name.toLowerCase()));
  return section('Protocols', h('span', { class: 'count' }, list.length),
    h('p', { class: 'small muted' }, 'One phrase, a whole plan. “Engage focus protocol” can start tracking deep work, put a 50-minute countdown on the HUD and come back when it’s done. Steps can wait, set timers, check conditions and run at a set time.'),
    list.length ? h('ul', { class: 'list compact' }, list.map((p) => {
      const live = running.runs.some((r) => r.name === p.name) || running.timers.some((x) => x.run === p.name);
      return h('li', { class: 'row' },
        h('span', { class: 'row-emoji' }, '🛡️'),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, `${p.name} protocol${live ? ' · running' : ''}`),
          h('span', { class: 'row-sub' }, [p.phrases?.length ? `“${p.phrases.join('”, “')}”` : '', p.at ? `every ${daysLabel(p.days)} at ${D.fmtTime(p.at)}` : ''].filter(Boolean).join(' · ') || `Say “engage ${p.name.toLowerCase()} protocol”`)),
        h('div', { class: 'btn-row' },
          live ? h('button', { class: 'btn ghost sm', onclick: () => { P.cancel({ name: p.name }); ctx.rerender(); } }, 'Stop')
            : h('button', { class: 'btn ghost sm', onclick: () => panel.open({ go: (r) => { location.hash = `#/${r}`; }, text: `engage ${p.name} protocol`, listen: false }) }, 'Engage'),
          h('button', { class: 'btn ghost sm', onclick: () => { editing = p; ctx.rerender(); } }, 'Edit')));
    })) : empty('No protocols yet. Start from one below.'),
    missing.length ? h('div', { class: 'chips' }, h('span', { class: 'small muted' }, 'Add:'), missing.map((t) => h('button', { class: 'chip', onclick: () => { P.addTemplate(t.name); toast(`${t.name} protocol added`); } }, `+ ${t.name}`))) : null,
    editing ? protocolEditor(ctx) : h('button', { class: 'btn ghost sm', onclick: () => { editing = {}; ctx.rerender(); } }, icon('plus', 16), 'New protocol'));
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function daysLabel(days = []) {
  if (days.length === 7) return 'day';
  if (days.join() === '1,2,3,4,5') return 'weekday';
  if (days.join() === '0,6') return 'weekend day';
  return days.map((d) => DAYS[d]).join(', ');
}

function protocolEditor(ctx) {
  const p = editing;
  const name = h('input', { value: p.name || '', placeholder: 'Focus', 'data-key': 'pr-name' });
  const phrases = h('input', { value: (p.phrases || []).join(', '), placeholder: 'deep work time, focus mode', 'data-key': 'pr-phrases' });
  const steps = h('textarea', { rows: 8, 'data-key': 'pr-steps', placeholder: 'track deep work\ntimer 50 min Focus\nsay Focus protocol engaged.\nwait 50 min\nstop tracking\nif habits left: say Still to do: {habits}.' }, p.steps || '');
  steps.value = p.steps || '';
  const at = h('input', { type: 'time', value: p.at || '', class: 'short' });
  const days = new Set(p.days || [0, 1, 2, 3, 4, 5, 6]);
  const dayBtns = h('div', { class: 'chips' }, DAYS.map((d, i) => {
    const b = h('button', { type: 'button', class: ['chip', days.has(i) && 'on'], onclick: () => { if (days.has(i)) days.delete(i); else days.add(i); b.classList.toggle('on', days.has(i)); } }, d);
    return b;
  }));
  const bad = P.parseSteps(steps.value).length;
  return h('div', { class: 'jv-box form' },
    h('p', { class: 'jv-box-title' }, p.id ? `Edit ${p.name} protocol` : 'New protocol'),
    h('div', { class: 'row2' }, field('Name', name, 'Say “engage <name> protocol”.'), field('Also when I say', phrases, 'Comma-separated, optional.')),
    field('Steps, one per line', steps, 'Any Daybook command · say … · wait 20 min · timer 50 min Focus · notify … · hud / hud off · if habits left: … (also: todos left, tasks overdue, over budget, events left, weekday, weekend, before 18:00, after 18:00, tracking, raining, at gym, home). {name}, {habits}, {todos}, {next} fill in.'),
    h('div', { class: 'row2' }, field('Run by itself at (optional)', at, 'While the app is open on this device.'), field('On', dayBtns)),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary sm', onclick: () => {
        const saved = P.save({ id: p.id, name: name.value, phrases: phrases.value, steps: steps.value, at: at.value, days: [...days].sort() });
        if (!saved) { toast('Give it a name'); return; }
        editing = null; toast(`${saved.name} protocol saved${bad ? '' : ' (it has no steps yet)'}`); ctx.rerender();
      } }, 'Save'),
      h('button', { class: 'btn ghost sm', onclick: () => { editing = null; ctx.rerender(); } }, 'Cancel'),
      p.id ? h('button', { class: 'btn ghost sm danger', onclick: () => { P.remove(p.id); editing = null; ctx.rerender(); } }, 'Delete') : null));
}

// ---- Senses: weather and places --------------------------------------------------------------------------------
function senseCard(ctx) {
  const c = world.cfg();
  const city = h('input', { value: c.auto ? '' : c.label, placeholder: 'or a city, e.g. Bengaluru', class: 'short' });
  const places = world.places();
  const w = world.cached();
  return section('Weather & places', h('span', { class: ['badge', c.on ? 'good' : ''] }, c.on ? 'On' : 'Off'),
    h('p', { class: 'small muted' }, 'Free weather from Open-Meteo (no key, no account): “what’s the weather”, “do I need an umbrella”, rain warnings, and the HUD. Name places (“remember this place as the gym”) and it notices when you arrive. Location is only read while the app is open.'),
    w ? h('p', { class: 'small' }, `${w.emoji} ${world.describe(w, { place: c.auto ? '' : c.label })}`) : null,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn primary sm', onclick: async () => {
        try { world.setCfg({ auto: true, on: true }); await world.locate(); await world.weather({ force: true }); toast('Weather on, using your location'); } catch (e) { toast(e.message || 'Location blocked'); }
        ctx.rerender();
      } }, '📍 Use my location'),
      city, h('button', { class: 'btn ghost sm', onclick: async () => {
        if (!city.value.trim()) return;
        try { const g = await world.geocode(city.value.trim()); world.setCfg({ auto: false, on: true, lat: g.lat, lon: g.lon, label: g.label, cache: null }); await world.weather({ force: true }); toast(`Weather for ${g.label}`); } catch (e) { toast(e.message); }
        ctx.rerender();
      } }, 'Set city'),
      c.on ? h('button', { class: 'btn ghost sm', onclick: () => { world.setCfg({ on: false, cache: null }); ctx.rerender(); } }, 'Turn off') : null),
    places.length ? h('ul', { class: 'list compact' }, places.map((pl) => h('li', { class: 'row' }, h('span', { class: 'row-emoji' }, '📍'),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, pl.name), h('span', { class: 'row-sub' }, `${pl.lat}, ${pl.lon} · within ${pl.r || 150} m`)),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Forget', onclick: () => world.forgetPlace(pl.name) }, icon('trash', 18))))) : null);
}

// ---- Home Assistant -------------------------------------------------------------------------------------------------
let homeTest = null;
function homeCard(ctx) {
  const c = home.cfg();
  const url = h('input', { value: c.url, placeholder: 'https://yourhome.ui.nabu.casa', autocomplete: 'off', spellcheck: 'false' });
  const token = h('input', { type: 'password', value: c.token, placeholder: 'Long-lived access token', autocomplete: 'off' });
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return section('Your home', h('span', { class: ['badge', home.connected() ? 'good' : ''] }, home.connected() ? 'Home Assistant' : 'Not connected'),
    h('p', { class: 'small muted' }, 'Control lights, switches, thermostats, scenes, locks and blinds through Home Assistant: “lights to 30%”, “turn off the kitchen lights”, “set the thermostat to 22”, “scene movie night”, “is the garage open?”. Protocols can use them too: Good night turns the lights off when your home is connected.'),
    h('details', { class: 'jv-box', open: !home.connected() || undefined },
      h('summary', { class: 'jv-box-title' }, 'Set up'),
      h('ol', { class: 'small steps' },
        h('li', null, 'Home Assistant must be reachable over HTTPS (Nabu Casa, or your own proxy). A page served over HTTPS can’t call http://homeassistant.local.'),
        h('li', null, 'Allow this site in configuration.yaml: ', h('code', null, `http:\n  cors_allowed_origins:\n    - ${origin}`), ', then restart Home Assistant.'),
        h('li', null, 'Profile → Security → Long-lived access tokens → Create token. Paste it below. It travels with sync, encrypted.')),
      h('div', { class: 'row2' }, field('Address', url), field('Token', token)),
      homeTest ? h('p', { class: ['small', homeTest.error ? 'error' : ''] }, homeTest.error || `Connected: ${homeTest.total} entities (${homeTest.lights} lights, ${homeTest.switches} switches, ${homeTest.climate} thermostats, ${homeTest.scenes} scenes, ${homeTest.locks} locks).`) : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary sm', onclick: async () => {
          home.setCfg({ url: url.value.trim().replace(/\/+$/, ''), token: token.value.trim() });
          try { homeTest = await home.test(); } catch (e) { homeTest = { error: e.message }; }
          ctx.rerender();
        } }, 'Save & test'),
        home.connected() ? h('button', { class: 'btn ghost sm', onclick: () => { home.setCfg({ url: '', token: '' }); homeTest = null; ctx.rerender(); } }, 'Disconnect') : null)));
}

// ---- Laptop companion ----------------------------------------------------------------------------------------------
let offCompanion = null;
function companionCard(ctx) {
  if (!offCompanion) offCompanion = companion.onChange(() => { if (location.hash.startsWith('#/jarvis')) ctx.rerender(); });
  const c = companion.cfg();
  const st = companion.state;
  const label = { off: 'Off', connecting: 'Connecting…', connected: 'Connected', waiting: 'Waiting for it' }[st.status] || st.status;
  return section('Laptop companion', h('span', { class: ['badge', st.status === 'connected' ? 'good' : ''] }, label),
    h('p', { class: 'small muted' }, 'The browser can only listen while Daybook is open. The companion is a small program for your computer that listens for “Hey Jarvis” all the time — with the tab in the background or the screen off — using free open-weights models (openWakeWord, Whisper, Piper) on the computer itself. It sends what you said to this tab and speaks the answer. Nothing leaves your computer.'),
    h('ol', { class: 'small steps' },
      h('li', null, 'Install Python 3.10+, then: ', h('code', null, 'pip install -r companion/requirements.txt'), ' (from this repo).'),
      h('li', null, 'Run ', h('code', null, 'python companion/jarvis_companion.py'), '. For a British voice add ', h('code', null, '--piper-voice en_GB-alan-medium.onnx'), ' (download from the Piper voices page).'),
      h('li', null, 'Switch it on here, on this computer. Chrome may ask to allow access to local devices: allow it.')),
    h('div', { class: 'form' },
      field('Companion on this device', segmented([[false, 'Off'], [true, 'On']], c.on, (v) => { companion.setCfg({ on: v }); ctx.rerender(); }, { small: true })),
      st.error && st.status !== 'connected' && c.on ? h('p', { class: 'small muted' }, st.error) : null),
    h('p', { class: 'small muted' }, 'On iPhone: make a Shortcut “Jarvis” → Dictate Text → Open URL ', h('code', null, `${typeof location !== 'undefined' ? location.origin + location.pathname : ''}?ask=`), ' + the dictated text. Then “Hey Siri, Jarvis”.'));
}

// ---- Messages (WhatsApp and others) ------------------------------------------------------------------
function messagesCard() {
  const base = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '';
  return section('WhatsApp & other messages', null,
    h('p', { class: 'small muted' }, 'WhatsApp doesn’t let any app read your chats, and tools that get around that can get your number banned. Instead, send it the messages that matter: it adds the events, tasks and deadlines they mention, or keeps them as a note.'),
    h('ul', { class: 'small steps' },
      h('li', null, h('b', null, 'Android: '), 'install Daybook (Chrome → ⋮ → Install app). In WhatsApp, long-press a message → Share → Daybook.'),
      h('li', null, h('b', null, 'iPhone / iPad: '), 'make a Shortcut once: Shortcuts → + → “Receive Text from Share Sheet” → “URL Encode” the Shortcut Input → “Open URLs” with ', h('code', null, `${base}?text=`), ' followed by the encoded text. Name it “Send to Jarvis”; it then appears when you share a message.'),
      h('li', null, h('b', null, 'Anywhere: '), 'copy the message and paste it into Jarvis. Several lines or a long paste is read as a message, not a command.')),
    h('p', { class: 'small muted' }, 'Email works the same way automatically: see Email on the ', h('a', { href: '#/agent' }, 'Agent page'), '.'));
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
