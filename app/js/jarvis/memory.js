// Jarvis's long-term memory, synced like everything else:
//   jarvisMemory: facts you tell it ("my wife's birthday is 12 March"), used as context and to
//                 answer "when is my wife's birthday?" without any AI.
//   jarvisSkills: phrases it knows how to handle — ones you teach ("when I say good night, stop
//                 tracking and brief me for tomorrow"), ones it learned from an AI answer you kept,
//                 and ones you corrected. A known phrase never needs the AI again.
//   jarvisUsage:  per-day counts of who handled each request (rules, skills, memory, on-device AI,
//                 Ollama, cloud AI), tokens used and undos, so you can see the cost and how it improves.

import * as store from '../store.js';
import { stem } from '../intents.js';

// ---- Words ------------------------------------------------------------------------------------
const STOP = new Set(('a an the and or but of to in on at for with from by about as is are was were be been am do does did '
  + 'i me my mine you your it its this that these those what whats when where which who whom whose why how '
  + 'please can could would will should tell know remember jarvis hey ok okay so just again also any some there '
  + 'have has had get got s d ll re ve m t').split(' '));

export function keywords(text) {
  return String(text || '').toLowerCase().replace(/[’']s\b/g, '').replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w)).map(stem);
}

// Share of `query`'s keywords found in `text` (0..1).
export function overlap(query, text) {
  const q = [...new Set(keywords(query))];
  if (!q.length) return 0;
  const t = new Set(keywords(text));
  return q.filter((w) => t.has(w)).length / q.length;
}

// "Hey Jarvis, remind me…" → "remind me…"; "Um, ok, good night!" → "good night"
export function normPhrase(text, name = 'jarvis') {
  const n = String(name || 'jarvis').toLowerCase().replace(/[^a-z0-9 ]/g, '');
  return String(text || '').toLowerCase()
    .replace(/[“”"’]/g, (c) => (c === '’' ? "'" : ''))
    .replace(new RegExp(`^(?:(?:hey|hi|ok|okay|yo|so|um+|uh+)[\\s,]+)*(?:${n}\\b[\\s,.!:-]*)?`), '')
    .replace(/[.!?,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- Facts --------------------------------------------------------------------------------------
export function facts() {
  return store.all('jarvisMemory').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

const tidyFact = (s) => {
  s = String(s || '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
};

// Adds a fact, or replaces one it clearly updates ("my gym is at 7" → "my gym is at 6").
export function remember(text, { source = 'you' } = {}) {
  const fact = tidyFact(text);
  if (fact.length < 3) return null;
  const same = facts().find((f) => f.text.toLowerCase() === fact.toLowerCase());
  if (same) return same;
  const k = keywords(fact);
  const update = facts().find((f) => {
    const fk = keywords(f.text);
    if (!fk.length || !k.length) return false;
    // Same subject: the facts share all but their last (value) words.
    const shared = k.filter((w) => fk.includes(w)).length;
    return shared >= Math.max(2, Math.min(k.length, fk.length) - 1) && shared / Math.max(k.length, fk.length) >= 0.6;
  });
  return store.put('jarvisMemory', { ...(update ? { id: update.id } : {}), text: fact, source });
}

export function forget(query) {
  let best = null; let score = 0;
  for (const f of facts()) {
    const s = overlap(query, f.text);
    if (s > score) { score = s; best = f; }
  }
  if (!best || score < 0.5) return null;
  store.remove('jarvisMemory', best.id);
  return best;
}

// The facts most related to `text` (then the newest), for the AI's context.
export function relevant(text, n = 8) {
  const list = facts();
  const scored = list.map((f, i) => ({ f, s: overlap(text, f.text) * 10 - i * 0.01 }));
  return scored.sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.f);
}

// A question answered straight from memory: "when is my wife's birthday?"
export function recall(question) {
  if (!/\?$|^(?:what|what's|whats|when|where|who|which|how|do you know|do you remember|tell me)\b/i.test(question.trim())) return null;
  const q = keywords(question);
  if (!q.length) return null;
  let best = null; let score = 0;
  for (const f of facts()) {
    const s = overlap(question, f.text);
    if (s > score) { score = s; best = f; }
  }
  return score >= (q.length === 1 ? 1 : 0.6) ? best : null;
}

// ---- Skills (phrases it knows) --------------------------------------------------------------------
export function skills() {
  return store.all('jarvisSkills').sort((a, b) => (b.lastUsed || b.createdAt || 0) - (a.lastUsed || a.createdAt || 0));
}

// `commands` are Daybook commands ("stop tracking", "brief me") or `say …` replies.
export function teach(phrase, commands, { source = 'taught', name } = {}) {
  const norm = normPhrase(phrase, name);
  const cmds = (Array.isArray(commands) ? commands : [commands]).map((c) => String(c || '').trim()).filter(Boolean).slice(0, 8);
  if (!norm || !cmds.length) return null;
  const prev = store.all('jarvisSkills').find((s) => s.norm === norm);
  // Something you taught or corrected outranks what it learned by itself.
  if (prev && prev.source !== 'learned' && source === 'learned') return prev;
  return store.put('jarvisSkills', { ...(prev ? { id: prev.id, uses: prev.uses } : { uses: 0 }), phrase: String(phrase).trim(), norm, commands: cmds, source });
}

export function unlearn(id) {
  return store.remove('jarvisSkills', id);
}

// Exact phrase first; otherwise the same words in any order (for taught phrases only).
export function findSkill(text, name) {
  const norm = normPhrase(text, name);
  if (!norm) return null;
  const list = store.all('jarvisSkills');
  const exact = list.find((s) => s.norm === norm);
  if (exact) return exact;
  const key = (s) => [...new Set(keywords(s))].sort().join(' ');
  const k = key(norm);
  if (!k) return null;
  return list.find((s) => s.source !== 'learned' && key(s.norm) === k) || null;
}

export function used(skill) {
  store.put('jarvisSkills', { ...skill, uses: (skill.uses || 0) + 1, lastUsed: Date.now() }, { silent: true });
}

// "when I say good night, stop tracking and brief me for tomorrow"
// "teach: movie night means add popcorn to my list; open watch list"
const VERB = /^(?:open|go to|show|start|stop|end|brief|schedule|remind|add|mark|log|track|spent|spend|note|set|what|what's|how|tell|say|i|finish|finished|screen time|check|tick|put|book|new|create|take|remember)\b/i;

export function splitCommands(text) {
  const parts = [];
  for (const chunk of String(text).split(/\s*(?:;|\bthen\b|\band then\b|\band also\b|,\s*and\b)\s*/i)) {
    // "…and <another command>" splits only when the second half starts like a command.
    const bits = chunk.split(/\s+and\s+/i);
    let cur = bits[0];
    for (const b of bits.slice(1)) {
      if (VERB.test(b)) { parts.push(cur); cur = b; } else cur += ` and ${b}`;
    }
    parts.push(cur);
  }
  return parts.map((p) => p.trim().replace(/^[,:-]\s*/, '').replace(/[.!]+$/, '')).filter(Boolean);
}

export function parseTeach(text) {
  const t = String(text).trim();
  const then = '\\s*(?:(?:you\\s+should|you|please|just|then)\\s+)?(?:(?:do|run)\\s+|(?:it|that)\\s+means\\s+|means\\s+)?(.+)$';
  const m = t.match(new RegExp(`^(?:from now on,?\\s+)?(?:when(?:ever)?|if)\\s+i\\s+say\\s+["“'](.+?)["”']\\s*[,:-]?${then}`, 'i'))
    || t.match(new RegExp(`^(?:from now on,?\\s+)?(?:when(?:ever)?|if)\\s+i\\s+say\\s+(.+?)\\s*(?:,|\\s-\\s|:)${then}`, 'i'))
    || t.match(/^(?:teach(?:\s+you)?|learn)\s*:?\s*["“']?(.+?)["”']?\s+(?:means|=|should)\s+(.+)$/i);
  if (!m) return null;
  const phrase = m[1].trim();
  const body = m[2].trim();
  if (!phrase || !body) return null;
  return { phrase, commands: splitCommands(body) };
}

// ---- Usage --------------------------------------------------------------------------------------
export const KINDS = ['rules', 'skill', 'memory', 'local', 'ollama', 'cloud'];

export function usage(date) {
  return store.get('jarvisUsage', date) || { id: date };
}

export function bump(date, patch) {
  const u = { ...usage(date) };
  for (const [k, v] of Object.entries(patch)) u[k] = (u[k] || 0) + v;
  store.put('jarvisUsage', u, { silent: true });
  return u;
}

export function totals(fromDate) {
  const out = { rules: 0, skill: 0, memory: 0, local: 0, ollama: 0, cloud: 0, tokens: 0, undone: 0, days: 0 };
  for (const u of store.all('jarvisUsage')) {
    if (fromDate && u.id < fromDate) continue;
    out.days++;
    for (const k of Object.keys(out)) if (k !== 'days') out[k] += u[k] || 0;
  }
  out.total = KINDS.reduce((s, k) => s + out[k], 0);
  out.free = out.rules + out.skill + out.memory;
  return out;
}
