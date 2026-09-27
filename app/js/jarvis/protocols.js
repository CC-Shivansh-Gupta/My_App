// Protocols: one phrase, a whole plan. "Engage focus protocol" can start tracking deep work, put
// a 50-minute countdown on the HUD, go quiet, and come back when it's done to stop the clock and
// tell you what's left. Like "when I say X, do Y", but with waits, timers, conditions and a schedule.
//
// A protocol (synced, collection jarvisProtocols):
//   { name: 'Focus', phrases: ['deep work time'], steps: '<one step per line>', at: '09:00' | '', days: [1,2,3,4,5] }
// Steps, one per line:
//   <any Daybook command>        track deep work · move everything left today to tasks · lights off
//   say <text>                   {name}, {habits}, {todos}, {next} are filled in
//   wait <n> min|hours|sec       the rest runs later (while the app is open on this device)
//   timer <n> min [label]        a countdown on the HUD; Jarvis tells you when it ends
//   notify <text>                a system notification (for when the app is in the background)
//   hud | hud off                open or leave HUD mode
//   if <condition>: <step>       habits left · todos left · tasks overdue · over budget · events left ·
//                                weekday · weekend · before 18:00 · after 18:00 · tracking · raining · at <place> ·
//                                home (Home Assistant is connected)
//   # a comment
// Runs in progress and timers belong to this device (localStorage), so a protocol started on your
// phone doesn't also resume on your laptop.

import * as store from '../store.js';
import * as D from '../dates.js';

const COL = 'jarvisProtocols';
const RUNS = 'daybook.protocols.runs';
const FIRED = 'daybook.protocols.fired';

export const TEMPLATES = [
  { name: 'Focus', phrases: ['focus mode', 'deep work time'], steps: [
    'track deep work', 'timer 50 min Focus', 'hud',
    'say Focus protocol engaged. Fifty minutes on the clock, {name}. I’ll keep the rest of the world at bay.',
    'wait 50 min', 'stop tracking', 'say Time. That’s fifty minutes of deep work. Take ten; you’ve earned it.',
    'if habits left: say When you’re back: {habits} still to tick today.'].join('\n') },
  { name: 'Good night', phrases: ['good night', 'goodnight', 'going to bed'], steps: [
    'stop tracking', 'if todos left: move everything left today to tasks', 'if home: lights off', 'hud off',
    'say Shutting down for the night. {next}', 'if habits left: say You missed {habits} today. Tomorrow, then.', 'say Sleep well, {name}.'].join('\n') },
  { name: 'Morning', phrases: ['good morning', 'morning briefing'], steps: [
    'say Good morning, {name}.', 'brief me', 'if raining: say Take an umbrella, it’s wet out there.'].join('\n'), at: '', days: [1, 2, 3, 4, 5] },
  { name: 'Clean slate', phrases: ['clean slate', 'reset my day'], steps: [
    'move everything left today to tasks', 'say Today’s list is clear. Everything unfinished is in Tasks, where it can’t glare at you.'].join('\n') },
  { name: 'House party', phrases: ['party mode', 'party time'], steps: [
    'if home: scene party', 'say House party protocol engaged. Try not to break anything expensive.', 'notify House party protocol engaged 🎉'].join('\n') },
];

// ---- The protocols themselves ----------------------------------------------------------------------
export function list() {
  return store.all(COL).sort((a, b) => a.name.localeCompare(b.name));
}

export function save(p) {
  const name = String(p.name || '').trim().replace(/\s+protocol$/i, '');
  if (!name) return null;
  const phrases = (Array.isArray(p.phrases) ? p.phrases : String(p.phrases || '').split(/[,\n]/)).map((x) => x.trim()).filter(Boolean);
  return store.put(COL, { ...(p.id ? { id: p.id } : {}), name, phrases, steps: String(p.steps || '').trim(), at: p.at || '', days: p.days || [0, 1, 2, 3, 4, 5, 6] });
}

export function remove(id) { return store.remove(COL, id); }

export function addTemplate(name) {
  const t = TEMPLATES.find((x) => x.name === name);
  if (!t || list().some((p) => p.name.toLowerCase() === t.name.toLowerCase())) return null;
  return save(t);
}

// ---- Steps -------------------------------------------------------------------------------------------------
const UNIT = { s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000, m: 60000, min: 60000, mins: 60000, minute: 60000, minutes: 60000, h: 3600000, hr: 3600000, hrs: 3600000, hour: 3600000, hours: 3600000 };
const DUR = /^(\d+(?:\.\d+)?)\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)\b\s*(.*)$/i;

export function parseStep(line) {
  const l = String(line).trim();
  if (!l || l.startsWith('#')) return null;
  let m = l.match(/^if\s+(.+?)\s*[:,]\s*(.+)$/i);
  if (m) { const then = parseStep(m[2]); return then ? { kind: 'if', cond: m[1].trim().toLowerCase(), then } : null; }
  m = l.match(/^say\s+[:"“]?(.+?)["”]?$/i);
  if (m) return { kind: 'say', text: m[1] };
  m = l.match(/^notify\s+(.+)$/i);
  if (m) return { kind: 'notify', text: m[1] };
  m = l.match(/^(wait|pause|sleep)\s+(?:for\s+)?(.+)$/i);
  if (m) { const d = m[2].match(DUR); if (d) return { kind: 'wait', ms: Math.round(Number(d[1]) * UNIT[d[2].toLowerCase()]) }; }
  m = l.match(/^(?:timer|countdown)\s+(?:for\s+)?(.+)$/i);
  if (m) { const d = m[1].match(DUR); if (d) return { kind: 'timer', ms: Math.round(Number(d[1]) * UNIT[d[2].toLowerCase()]), label: d[3].trim() || 'Timer' }; }
  if (/^hud(?:\s+(?:on|mode))?$/i.test(l)) return { kind: 'hud', on: true };
  if (/^(?:hud\s+off|exit hud|leave hud)$/i.test(l)) return { kind: 'hud', on: false };
  return { kind: 'do', cmd: l };
}

export function parseSteps(text) {
  return String(text || '').split('\n').map(parseStep).filter(Boolean);
}

// env: { status, weather, place, now } — status is jarvis/status.js's summary.
export function check(cond, env) {
  const c = cond.replace(/^(?:there are |i have |any )/, '').trim();
  const s = env.status || {};
  const now = env.now || new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  const hm = (x) => { const [a, b] = x.split(':').map(Number); return a * 60 + (b || 0); };
  let m;
  if ((m = c.match(/^not\s+(.+)$/))) return !check(m[1], env);
  if (/^habits? (?:left|not done|to do)$/.test(c)) return (s.habits?.total || 0) > (s.habits?.done || 0);
  if (/^(?:todos?|to-dos?) (?:left|open|not done)$/.test(c)) return (s.todos?.total || 0) > (s.todos?.done || 0);
  if (/^(?:tasks? )?overdue(?: tasks?)?$|^tasks? overdue$/.test(c)) return (s.tasks?.overdue || 0) > 0;
  if (/^over budget$/.test(c)) return Boolean(s.money?.over);
  if (/^(?:events? (?:left|later|today)|meetings? (?:left|later))$/.test(c)) return (s.events?.upcoming?.length || 0) > 0;
  if (c === 'weekday') return now.getDay() >= 1 && now.getDay() <= 5;
  if (c === 'weekend') return now.getDay() === 0 || now.getDay() === 6;
  if ((m = c.match(/^before (\d{1,2}(?::\d{2})?)$/))) return minute < hm(m[1]);
  if ((m = c.match(/^after (\d{1,2}(?::\d{2})?)$/))) return minute >= hm(m[1]);
  if (c === 'tracking') return Boolean(s.routine?.tracking);
  if (/^(?:home|smart home|home assistant)$/.test(c)) return Boolean(env.home);
  if (/^(?:raining|rain|wet)$/.test(c)) return Boolean(env.weather && (env.weather.code >= 51 || (env.weather.rainNext?.prob || 0) >= 50));
  if ((m = c.match(/^at (?:the |my )?(.+)$/))) return Boolean(env.place && env.place.name.toLowerCase() === m[1].toLowerCase());
  return false;
}

export function fill(text, env) {
  const s = env.status || {};
  const next = s.events?.next;
  return text
    .replace(/\{name\}/g, env.user || '')
    .replace(/\{habits\}/g, listSay(s.habits?.left || []) || 'nothing')
    .replace(/\{todos\}/g, listSay(s.todos?.left || []) || 'nothing')
    .replace(/\{next\}/g, next ? `Next up: ${next.title} at ${D.fmtTime(next.time)}.` : '')
    .replace(/,\s*([.!?])/g, '$1').replace(/\s+([.,!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

function listSay(xs) {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

// ---- Voice ---------------------------------------------------------------------------------------------------
const ENGAGE = /^(?:(?:initiate|engage|activate|run|start|begin|execute|launch|enable|commence)\s+(?:the\s+)?)?(.+?)\s+protocol$/i;
const CANCEL = /^(?:cancel|abort|stop|end|disengage|deactivate|disable)\s+(?:the\s+)?(.+?)\s+protocol$/i;
const STAND_DOWN = /^(?:stand down|abort all protocols|cancel all protocols|stop all protocols)$/i;
const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function matchVoice(text, protocols = list()) {
  const t = norm(text);
  if (STAND_DOWN.test(t)) return { cancel: true, all: true };
  let m = t.match(CANCEL);
  if (m) { const p = find(m[1], protocols); return p ? { cancel: true, protocol: p } : null; }
  m = t.match(ENGAGE);
  if (m) {
    const p = find(m[1], protocols);
    if (p) return { protocol: p };
    const tpl = find(m[1], TEMPLATES); // one of the built-ins you haven't added yet: add it and go
    if (tpl) return { template: tpl };
    return /^(?:initiate|engage|activate|run|start|begin|execute|launch|enable|commence)\s/.test(t) ? { unknown: m[1].replace(/^the /, '') } : null;
  }
  const p = protocols.find((x) => (x.phrases || []).some((ph) => norm(ph) === t));
  return p ? { protocol: p } : null;
}

function find(name, protocols) {
  const n = norm(name).replace(/^the /, '');
  return protocols.find((p) => norm(p.name) === n) || protocols.find((p) => norm(p.name).startsWith(n) || n.startsWith(norm(p.name))) || null;
}

// ---- Running ---------------------------------------------------------------------------------------------------
// deps (set by init): { run(cmd) → result, announce(res), ui(route), notify(text), env() → { status, weather, place, user, now } }
let deps = null;
export function init(d) { deps = d; }

const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const readJson = (k, d) => { try { return JSON.parse(ls()?.getItem(k)) ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { ls()?.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

// { runs: [{ id, pid, name, steps: [...], i, resumeAt }], timers: [{ id, label, startedAt, endsAt, run }] }
export function active() { return readJson(RUNS, { runs: [], timers: [] }); }
function setActive(a) { writeJson(RUNS, a); changed(); }

const watchers = new Set();
export function onChange(fn) { watchers.add(fn); return () => watchers.delete(fn); }
function changed() { for (const fn of watchers) { try { fn(); } catch { /* ignore */ } } }

export function timers(now = Date.now()) { return active().timers.filter((x) => x.endsAt > now); }

// Starts a protocol. Resolves to one combined result for the part that ran now.
export async function engage(p, { now = Date.now() } = {}) {
  const steps = parseSteps(p.steps);
  const run = { id: `${p.id || p.name}-${now}`, pid: p.id, name: p.name, steps, i: 0, resumeAt: 0 };
  const res = await advance(run, now);
  return {
    ...res,
    say: res.say || `${p.name} protocol engaged.`,
    title: `🛡️ ${p.name} protocol engaged`,
    via: 'protocol',
  };
}

// Runs steps until the end or a wait. Returns { say, lines, undo }.
async function advance(run, now = Date.now()) {
  const says = []; const lines = []; const undos = [];
  const env = deps?.env?.() || {};
  while (run.i < run.steps.length) {
    let step = run.steps[run.i++];
    if (step.kind === 'if') {
      if (!check(step.cond, env)) { lines.push(`— skipped (${step.cond})`); continue; }
      step = step.then;
    }
    if (step.kind === 'wait') {
      run.resumeAt = now + step.ms;
      const a = active();
      a.runs = a.runs.filter((r) => r.id !== run.id).concat(run);
      setActive(a);
      lines.push(`⏳ then in ${fmtDur(step.ms)}…`);
      return { say: says.join(' '), lines, undo: undos.length ? () => undos.reverse().forEach((u) => u()) : null, waiting: true };
    }
    if (step.kind === 'say') { says.push(fill(step.text, env)); continue; }
    if (step.kind === 'notify') { deps?.notify?.(fill(step.text, env)); lines.push(`🔔 ${fill(step.text, env)}`); continue; }
    if (step.kind === 'hud') { deps?.ui?.(step.on ? 'hud' : 'today'); lines.push(step.on ? '🖥️ HUD on' : '🖥️ HUD off'); continue; }
    if (step.kind === 'timer') {
      const a = active();
      a.timers = a.timers.filter((x) => x.endsAt > now).concat({ id: `${run.id}-t${run.i}`, label: step.label, startedAt: now, endsAt: now + step.ms, run: run.name });
      setActive(a);
      lines.push(`⏱️ ${step.label}: ${fmtDur(step.ms)}`);
      continue;
    }
    // A Daybook command (or a plugin's: lights, weather…).
    let r = null;
    try { r = await deps?.run?.(step.cmd); } catch (e) { r = { title: `Couldn’t: ${step.cmd} (${e.message})`, miss: true }; }
    if (r?.undo) undos.push(r.undo);
    lines.push(`${r?.miss ? '✗' : '✓'} ${r?.title || step.cmd}`);
    if (r?.answer && r.say) says.push(r.say); // a look-up ("brief me") is worth hearing
  }
  const a = active();
  a.runs = a.runs.filter((r) => r.id !== run.id);
  setActive(a);
  return { say: says.join(' '), lines, undo: undos.length ? () => undos.reverse().forEach((u) => u()) : null, waiting: false };
}

export function cancel({ name = null, all = false } = {}) {
  const a = active();
  const hit = (x) => all || (name && (x.name || x.run || '').toLowerCase() === name.toLowerCase());
  const n = a.runs.filter(hit).length + a.timers.filter(hit).length;
  a.runs = a.runs.filter((x) => !hit(x));
  a.timers = a.timers.filter((x) => !hit(x));
  setActive(a);
  return n;
}

// Call every ~15 s while the app is open: resumes waits, ends timers, fires scheduled protocols.
export async function tick(now = Date.now()) {
  const a = active();
  const due = a.runs.filter((r) => r.resumeAt && r.resumeAt <= now);
  const ended = a.timers.filter((x) => x.endsAt <= now);
  if (ended.length) {
    a.timers = a.timers.filter((x) => x.endsAt > now);
    setActive(a);
    for (const x of ended) if (!due.some((r) => r.name === x.run)) deps?.announce?.({ say: `${x.label} timer complete.`, title: `⏱️ ${x.label} — done` });
  }
  for (const r of due) {
    r.resumeAt = 0;
    const res = await advance(r, now);
    if (res.say || res.lines.length) deps?.announce?.({ say: res.say || `${r.name} protocol complete.`, title: `🛡️ ${r.name} protocol`, lines: res.lines, via: 'protocol' });
  }
  // Scheduled ones: at their time (or up to 10 minutes late, if the app was just opened).
  const d = new Date(now);
  const today = D.toStr(d);
  const minute = d.getHours() * 60 + d.getMinutes();
  const fired = readJson(FIRED, {});
  for (const p of list()) {
    if (!p.at || !(p.days || []).includes(d.getDay())) continue;
    const [hh, mm] = p.at.split(':').map(Number);
    const at = hh * 60 + (mm || 0);
    if (minute < at || minute - at > 10 || fired[p.id] === today) continue;
    fired[p.id] = today;
    writeJson(FIRED, fired);
    const res = await engage(p, { now });
    deps?.announce?.(res);
  }
}

export function fmtDur(ms) {
  const m = Math.round(ms / 60000);
  if (ms < 60000) return `${Math.round(ms / 1000)} s`;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

// ---- As a Jarvis plugin -------------------------------------------------------------------------------------------
export const plugin = {
  name: 'protocols', via: 'protocol',
  match: (t) => matchVoice(t),
  async run(m) {
    if (m.cancel) {
      const n = cancel(m.all ? { all: true } : { name: m.protocol.name });
      return m.all
        ? { say: n ? 'Standing down. All protocols cancelled.' : 'Nothing running, but consider me stood down.', title: '🛡️ Stand down', via: 'protocol' }
        : { say: n ? `${m.protocol.name} protocol cancelled.` : `${m.protocol.name} protocol isn’t running.`, title: `🛡️ ${m.protocol.name}: cancelled`, via: 'protocol' };
    }
    if (m.unknown) return { say: `I don’t know a ${m.unknown} protocol yet. You can write one on the Jarvis page.`, title: `🛡️ No “${m.unknown}” protocol`, miss: true, go: null, via: 'protocol' };
    const p = m.template ? save(m.template) : m.protocol;
    const res = await engage(p);
    if (m.template) res.sub = `Added the ${p.name} protocol from the built-ins. Edit it on the Jarvis page.`;
    return res;
  },
  help: '- protocols (the user\'s own routines): "engage <name> protocol", "cancel <name> protocol", "stand down"',
};
