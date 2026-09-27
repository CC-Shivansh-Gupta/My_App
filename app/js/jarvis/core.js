// Jarvis's brain: decides who handles each request, cheapest first.
//
//   1. Things it already knows, for free: undo / "no, I meant…", teaching ("when I say X, do Y"),
//      memory ("remember…", "forget…", "when is my wife's birthday?") and learned phrases.
//   2. Daybook's rule-based parser (intents.js) — instant, offline, free — when it clearly understood.
//   3. An AI model only for the rest: chat, questions about your data, advice, and messy requests.
//      It answers in JSON and acts by writing ordinary Daybook commands, which run through the
//      same rules, so a small open-weights model is enough. A request the AI resolved is saved as a
//      learned phrase, and anything you undo or correct is remembered, so the AI is needed less
//      and less over time.
//
// No DOM here: the app injects `execute` (voice.js) and `llm` (llm.js), and tests inject fakes.

import * as D from '../dates.js';
import { parseSmart } from '../dates.js';
import { parseCommand, tidyTitle } from '../intents.js';
import * as mem from './memory.js';

// ---- When the rules are enough -----------------------------------------------------------------
const TODO_LEAD = /^(?:remind me|remember to|don'?t forget|i need to|i have to|i must|i should|i gotta|i got to|add\b|to-?do|put\b|buy\b|get\b|call\b|email\b|text\b|pay\b|book\b|pick up\b|order\b|clean\b|fix\b|finish\b|send\b|check\b|renew\b|cancel\b|return\b|water\b|wash\b|write\b|read\b|make\b)/i;
const CHATTY = /^(?:i'?m|i am|i feel|i felt|i think|i wonder|i was wondering|my\b|it'?s|it is|let'?s|we\b|you\b|are you|do you|can you|could you|would you|will you|should i|shall|why\b|who\b|explain|help\b|plan\b|suggest|recommend|give me|tell me|what if|hello|hi\b|hey\b|good (?:morning|afternoon|evening)|how are|thank)/i;
const ADVICE = /\b(?:plan|organi[sz]e|prioriti[sz]e|suggest|recommend|advice|advise|help me|explain|why|ideas?|motivat|should i|what should|how (?:can|do|should) i|compare|vs\.?|versus|reschedule|move .* to|free (?:time|slot)|busiest|average|trend|last \d+|improve)\b/i;
const QUESTION = /\?\s*$|^(?:what|what's|whats|when|where|who|which|why|how|is|are|am|do|does|did|can|could|would|will|should|have|has)\b/i;

const words = (s) => s.trim().split(/\s+/).length;

// Did the rules clearly understand `text`? (`parsed` is parseCommand's result.)
export function rulesConfident(text, parsed = parseCommand(text)) {
  const t = text.trim().replace(/[’‘]/g, "'");
  if (parsed.type === 'empty') return true;
  const explicit = /^(?:add|remind|schedule|note|new task|task|set|log|spent|paid|mark|track|start|open|finished|til)\b/i.test(t);
  if (['move', 'delete', 'rename', 'priority', 'knowledge'].includes(parsed.type)) return true;
  if (ADVICE.test(t) && !explicit && parsed.type !== 'navigate') return false;
  if (parsed.type === 'query') return true;
  // A question the rules couldn't place fell through to "add a to-do called <question>".
  if (QUESTION.test(t) && ['todo', 'task', 'note', 'done', 'event'].includes(parsed.type) && !/^(?:remind|add|schedule|note|mark|i\s)/i.test(t)) return false;
  if (parsed.type === 'todo') {
    if (TODO_LEAD.test(t)) return true;
    if (CHATTY.test(t)) return false;
    return words(t) <= 6; // "buy milk", "call mom tomorrow"
  }
  if (parsed.type === 'done' && !parsed.strict && CHATTY.test(t)) return false;
  return true;
}

// ---- Talking to the AI --------------------------------------------------------------------------
const COMMANDS = `- to-do: "remind me to <thing> <when>"
- task: "add task <thing> [by <day>] [high priority] [under <heading> heading]"
- event: "schedule <title> <day> at <time> [to <time>]"
- expense: "spent <amount> on <thing> [yesterday]"
- note: "note: <text>"; learning: "TIL <text>"
- habit done: "mark <habit> done"; broke a habit: "slipped on <habit>"
- goal: "set a monthly|yearly|life goal to <goal>"
- reading: "add the book <title> by <author>", "finished reading <title>"
- watch list: "add <title> to my watch list", "I watched <title>"
- gym: "start <template> workout", "log my weight <number>"
- time: "track <activity>", "stop tracking", "I was <activity> from <time> to <time>"
- screen time: "screen time <device> <duration>"
- look up: "what's on <day>", "how much did I spend this month", "brief me", "what are my habits"
- change things: "move <item> to <day> [at <time>]", "postpone <item>", "delete <item>", "cancel <event> <day>", "rename <item> to <new name>", "make <task> high priority"
- knowledge map / second brain: "add to my knowledge base: <idea, fact or note worth keeping>"
- open a page: "open <today|calendar|tasks|habits|goals|gym|routine|money|notes|knowledge map|reading|news|settings>"`;

export function systemPrompt({ name = 'Jarvis', user = '', date, time }) {
  return `You are ${name}, ${user ? `${user}'s` : 'the user\'s'} personal assistant inside Daybook, their life tracker app. `
    + `Now: ${D.DAY_NAMES[D.weekday(date)]} ${date}, ${time}.
You act by writing Daybook commands: short plain-English sentences the app already understands.
${COMMANDS}
Reply with JSON only, exactly this shape:
{"say":"<what you say out loud: 1-3 short, natural sentences>","do":["<command>"],"remember":["<lasting fact about them>"],"ask":"<one question, only if you truly need more information, else empty>"}
Rules:
- Put commands in "do" only when they asked you to add, log, change or look something up. Several requests → several commands.
- Keep their date words as they said them (today, tomorrow, Friday, next week); never invent dates, amounts or names.
- For questions about their day, answer in "say" from the facts below; if the answer isn't there, use a look-up command.
- For general questions, chat or advice, just answer in "say" (brief, warm, a little witty, never a lecture) with "do": [].
- "remember" is only for stable facts or preferences they tell you about themselves (people, dates, likes, routines).`;
}

export function buildMessages({ text, name, user, date, time, snapshot = '', facts = [], examples = [], related = [], history = [] }) {
  const ctx = [
    facts.length ? `What you remember about them:\n${facts.map((f) => `- ${f}`).join('\n')}` : '',
    snapshot ? `Their Daybook right now:\n${snapshot}` : '',
    related.length ? `From their notes:\n${related.map((r) => `- ${r}`).join('\n')}` : '',
    examples.length ? `How they like things done (their phrase → commands):\n${examples.map((e) => `- "${e.phrase}" → ${JSON.stringify(e.commands)}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  const msgs = [{ role: 'system', content: `${systemPrompt({ name, user, date, time })}${ctx ? `\n\n${ctx}` : ''}` }];
  for (const turn of history.slice(-6)) msgs.push({ role: turn.role, content: turn.content });
  msgs.push({ role: 'user', content: text });
  return msgs;
}

// Tolerant JSON reading: small models wrap it in prose or code fences, or skip it altogether.
export function parseReply(raw) {
  const text = String(raw || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim();
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  let j = null;
  if (s >= 0 && e > s) { try { j = JSON.parse(text.slice(s, e + 1)); } catch { j = null; } }
  if (!j || typeof j !== 'object') {
    const plain = text.replace(/```[a-z]*|```/g, '').trim();
    return plain && !/^[{[]/.test(plain) ? { say: plain.slice(0, 600), do: [], remember: [], ask: '' } : null;
  }
  const arr = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : []).map((x) => String(x).trim()).filter(Boolean);
  return {
    say: String(j.say || j.reply || j.answer || '').trim().slice(0, 600),
    do: arr(j.do || j.commands || j.actions).slice(0, 6),
    remember: arr(j.remember).slice(0, 3),
    ask: String(j.ask || '').trim(),
  };
}

// Only replay an AI answer later if nothing in it came from the moment (numbers it made up,
// absolute dates, names that weren't said).
export function safeToLearn(text, commands) {
  if (!commands.length) return false;
  const said = new Set(mem.keywords(text));
  const nums = (s) => s.match(/\d+(?:[.:]\d+)?/g) || [];
  const saidNums = new Set(nums(text.toLowerCase()));
  return commands.every((c) => nums(c).every((n) => saidNums.has(n))
    && !/\b\d{4}-\d{2}-\d{2}\b/.test(c)
    && !/^(?:what|how|brief|open)\b/i.test(c)
    && mem.keywords(c).filter((w) => w.length > 3 && !said.has(w)).length <= 3);
}

// ---- Meta commands (never need AI) ------------------------------------------------------------
const UNDO = /^(?:undo|undo that|take that back|scratch that|cancel that|revert that|delete that)$/i;
// Bare "no" / "that's wrong", or "no, I meant …" (a sentence merely starting with "no" isn't a correction).
const WRONG = /^(?:no|nope|wrong|not that|that'?s (?:wrong|not (?:it|right|what i (?:meant|said))))(?:[,.!]?\s*(?:i (?:meant|said|wanted)(?: to)?|make it|actually)\b[\s,:]*(.*))?$/i;
const REMEMBER = /^(?:please\s+)?(?:remember|keep in mind|don'?t forget|note that i|fyi)\s+(?!to\b)(?:that\s+)?(.+)$/i;
const FORGET = /^(?:please\s+)?forget\s+(?:that\s+|about\s+|what i said about\s+)?(.+)$/i;
const WHAT_YOU_KNOW = /^(?:what do you (?:know|remember)(?: about me)?|what have you (?:learned|learnt)(?: about me)?|what do you know about me)$/i;
const CALL_ME = /^(?:call me|my name is|i'?m called)\s+([\p{L}][\p{L}'-]{0,20})$/iu;
const BYE = /^(?:(?:ok(?:ay)?\s+)?(?:thanks|thank you|thx|cheers)(?:\s+\w+)?|that'?s all|that is all|nothing|never ?mind|stop|stop listening|be quiet|quiet|shut up|bye|goodbye|see you|go to sleep|dismissed)$/i;
const HELLO = /^(?:hi|hello|hey|yo|good (?:morning|afternoon|evening)|are you there|you there|wake up)$/i;

const tidy = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ---- The orchestrator ---------------------------------------------------------------------------
// deps: { execute(cmd) → result, llm?: { engines() → ['local'|'cloud'…], chat(engine, messages, opts) → {text, tokens, model} },
//         snapshot?() → string, related?(text) → string[], now?() → Date, name?() → string, user?() → string }
export function createJarvis(deps) {
  const history = []; // [{role, content}] for the AI's short-term memory of this conversation
  let last = null;    // the last result that changed something (for "undo" / "no, I meant")
  let fixing = null;  // { text } after an undo: the next request teaches what was meant

  const name = () => deps.name?.() || 'Jarvis';
  const today = () => D.toStr(deps.now?.() || new Date());
  const count = (via, extra = {}) => mem.bump(today(), { [via]: 1, ...extra });

  function remember(role, content) {
    history.push({ role, content: String(content).slice(0, 500) });
    while (history.length > 8) history.shift();
  }

  async function runCommand(cmd) {
    const say = cmd.match(/^say\s+[:"“]?(.+?)["”]?$/i);
    if (say) return { say: say[1], title: say[1], spoken: true };
    try { return (await deps.execute(cmd)) || { say: 'Done.', title: 'Done' }; } catch (e) { return { say: 'That one failed.', title: `Couldn’t do “${cmd}”: ${e.message}`, miss: true }; }
  }

  // Runs several commands and folds their results into one.
  async function runAll(commands, { lead = '' } = {}) {
    const results = [];
    for (const c of commands) results.push(await runCommand(c));
    const undos = results.map((r) => r.undo).filter(Boolean);
    const one = results.length === 1 ? results[0] : null;
    const answers = results.filter((r) => r.answer || r.miss || r.spoken).map((r) => r.say);
    const say = [lead, ...(lead ? answers : results.map((r) => r.say))].filter(Boolean).join(' ');
    return {
      ...(one || {}),
      say: say || one?.say || 'Done.',
      title: one ? one.title : lead || `${results.length} things done`,
      lines: one ? one.lines : results.flatMap((r) => (r.lines?.length && results.length < 3 ? [r.title, ...r.lines] : [r.title])).filter(Boolean),
      undo: undos.length ? () => { for (const u of undos.reverse()) u(); } : null,
      go: results.map((r) => r.go).filter(Boolean).pop() || null,
      miss: results.some((r) => r.miss),
      commands,
    };
  }

  async function askAI(text) {
    const engines = deps.llm?.engines?.() || [];
    if (!engines.length) return null;
    const now = deps.now?.() || new Date();
    const facts = mem.relevant(text, 8).map((f) => f.text);
    const examples = mem.skills().filter((s) => s.source !== 'learned').slice(0, 6);
    const msgs = buildMessages({
      text, name: name(), user: deps.user?.() || '', date: today(), time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      snapshot: deps.snapshot?.() || '', facts, examples, related: deps.related?.(text) || [], history,
    });
    let lastError = null;
    for (const engine of engines) {
      try {
        const res = await deps.llm.chat(engine, msgs, { maxTokens: 350 });
        const reply = parseReply(res.text);
        mem.bump(today(), { [engine]: 1, tokens: res.tokens || 0 });
        if (reply) return { ...reply, engine, model: res.model, tokens: res.tokens || 0 };
      } catch (e) { lastError = e; }
    }
    if (lastError) throw lastError;
    return null;
  }

  function finish(res, text, via) {
    res.via = res.via || via;
    res.text = text;
    if (res.undo) last = { res, text, at: Date.now() };
    remember('user', text);
    remember('assistant', JSON.stringify({ say: res.say, do: res.commands || [] }));
    return res;
  }

  async function handle(input) {
    const who = name().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const text = mem.normPhrase(input, name()) ? String(input).trim().replace(new RegExp(`^(?:(?:hey|ok|okay|hi)[\\s,]+)?${who}\\b[\\s,.!:-]*`, 'i'), '').trim() : '';
    if (!text) return { say: 'Yes?', title: 'I’m listening', ask: true, via: 'rules' };
    const t = text.replace(/[.!]+$/, '');

    // Undo / correction.
    if (UNDO.test(t)) return undo();
    const wrong = last && Date.now() - last.at < 5 * 60000 && t.match(WRONG);
    if (wrong) {
      const lastText = last.text;
      const u = undo({ quiet: true });
      if (!(wrong[1] || '').trim()) { fixing = { text: lastText }; return { ...u, say: 'Sorry about that — undone. What did you mean?', title: 'Undone. What did you mean?', ask: true }; }
      fixing = { text: lastText };
      return handle(wrong[1]);
    }

    // Teaching.
    const teach = mem.parseTeach(t);
    if (teach) {
      const s = mem.teach(teach.phrase, teach.commands, { name: name() });
      count('skill');
      return finish({ say: `Got it. When you say “${teach.phrase}”, I’ll ${teach.commands.length > 1 ? `do ${teach.commands.length} things` : `run “${teach.commands[0]}”`}.`,
        title: `Learned: “${teach.phrase}”`, lines: teach.commands.map((c) => `→ ${c}`), undo: () => mem.unlearn(s.id), learned: s }, text, 'skill');
    }

    // Memory.
    let m = t.match(CALL_ME);
    if (m) {
      const n = tidy(m[1]);
      const f = mem.remember(`Their name is ${n}`);
      deps.setUser?.(n);
      count('memory');
      return finish({ say: `Nice to meet you properly, ${n}.`, title: `I’ll call you ${n}`, undo: f ? () => mem.forget(f.text) : null }, text, 'memory');
    }
    m = t.match(REMEMBER);
    if (m) {
      const f = mem.remember(m[1]);
      count('memory');
      if (!f) return { say: 'What should I remember?', title: 'What should I remember?', ask: true, via: 'memory' };
      return finish({ say: 'I’ll remember that.', title: '🧠 Remembered', sub: f.text, undo: () => mem.forget(f.text) }, text, 'memory');
    }
    m = t.match(FORGET);
    if (m) {
      const f = mem.forget(m[1]);
      count('memory');
      return finish(f ? { say: 'Forgotten.', title: '🧠 Forgotten', sub: f.text, undo: () => mem.remember(f.text) }
        : { say: `I don’t have anything about ${m[1]}.`, title: `Nothing about “${m[1]}”` }, text, 'memory');
    }
    if (WHAT_YOU_KNOW.test(t)) {
      const fs = mem.facts();
      count('memory');
      return finish(fs.length
        ? { say: `I know ${fs.length} ${fs.length === 1 ? 'thing' : 'things'} about you. ${fs.slice(0, 3).map((f) => f.text).join('. ')}.`, title: '🧠 What I remember', lines: fs.slice(0, 12).map((f) => f.text), go: null }
        : { say: 'Nothing yet. Tell me things like “remember that my gym is at 7”.', title: 'Nothing remembered yet' }, text, 'memory');
    }

    // Phrases it knows (taught, corrected or learned).
    const skill = mem.findSkill(t, name());
    if (skill) {
      mem.used(skill);
      count('skill');
      const res = await runAll(skill.commands);
      res.skill = skill;
      return finish(res, text, 'skill');
    }

    if (BYE.test(t)) { count('rules'); return { say: pick(['Anytime.', 'Happy to help.', 'At your service.']), title: '👋', end: true, via: 'rules' }; }
    if (HELLO.test(t)) {
      count('rules');
      const u = deps.user?.();
      return { say: `${greeting(deps.now?.() || new Date())}${u ? `, ${u}` : ''}. What can I do for you?`, title: 'Hello', ask: true, via: 'rules' };
    }

    // A question memory can answer.
    const fact = mem.recall(t);
    const parsed = parseCommand(t, today());
    const confident = rulesConfident(t, parsed);
    if (fact && (!confident || parsed.type !== 'query')) {
      count('memory');
      return finish({ say: `${fact.text}.`, title: '🧠 From memory', sub: fact.text }, text, 'memory');
    }

    const learnFix = (res, commands) => {
      if (!fixing) return res;
      const from = fixing.text;
      fixing = null;
      if (!res.miss && commands.length) {
        res.learned = mem.teach(from, commands, { source: 'corrected', name: name() });
        res.sub = [res.sub, `Next time “${from}” does this.`].filter(Boolean).join(' · ');
      }
      return res;
    };

    // The rules, when they clearly understood.
    if (confident) {
      const res = await runAll([t]);
      if (!res.miss || !(deps.llm?.engines?.() || []).length) {
        count('rules');
        return finish(learnFix(res, [t]), text, 'rules');
      }
    }

    // The AI.
    // Without an AI, a question the rules couldn't place shouldn't turn into a to-do.
    const unanswerable = !confident && QUESTION.test(t.replace(/[’‘]/g, "'")) && parsed.type === 'todo';
    const noBrain = (why) => ({ say: `I can only answer that with an AI brain${why ? ` — ${why}` : ''}. You can set one up for free on the Jarvis page.`,
      title: 'That needs an AI brain', sub: why || 'Jarvis page → Brain: on-device, Ollama or a free cloud key', miss: true,
      alt: { label: 'Add as a to-do', run: () => runAll([t]) } });
    let reply = null;
    try { reply = await askAI(t); } catch (e) {
      if (!confident) {
        count('rules');
        if (unanswerable) return finish(noBrain(`it’s unavailable right now (${e.message})`), text, 'rules');
        const res = await runAll([t]);
        res.sub = [res.sub, `AI unavailable (${e.message}), so I used the basic rules.`].filter(Boolean).join(' · ');
        return finish(res, text, 'rules');
      }
    }
    if (!reply) {
      count('rules');
      if (unanswerable) return finish(noBrain(), text, 'rules');
      return finish(learnFix(await runAll([t]), [t]), text, 'rules');
    }
    for (const f of reply.remember) mem.remember(f, { source: 'ai' });
    let res;
    if (reply.do.length) {
      res = await runAll(reply.do, { lead: reply.say });
      if (!res.miss && !fixing && safeToLearn(t, reply.do)) res.learned = mem.teach(t, reply.do, { source: 'learned', name: name() });
      learnFix(res, reply.do);
    } else {
      fixing = null;
      res = { say: reply.say || 'Hmm, I’m not sure.', title: reply.say || 'Hmm, I’m not sure.', chat: true };
    }
    if (reply.ask) { res.say = [res.say, reply.ask].filter((x) => x && !res.say.includes(reply.ask)).join(' '); res.ask = true; }
    if (reply.remember.length) res.remembered = reply.remember;
    res.engine = reply.engine;
    res.model = reply.model;
    res.tokens = reply.tokens;
    return finish(res, text, reply.engine);
  }

  // A message you shared or pasted (WhatsApp, SMS, an email…): pull out what it asks of you.
  async function handleShared(input) {
    const msg = String(input || '').trim().slice(0, 2500);
    if (!msg) return { say: 'That was empty.', title: 'Nothing to read', via: 'rules' };
    const label = `Shared: ${msg.split('\n')[0].slice(0, 60)}${msg.length > 60 ? '…' : ''}`;
    if ((deps.llm?.engines?.() || []).length) {
      try {
        const reply = await askAI(`Here's a message I received (maybe from WhatsApp or a group chat):\n---\n${msg}\n---\n`
          + 'Add what it asks of me, using commands: events it invites me to (with their day and time), tasks and to-dos with deadlines. '
          + 'If there is nothing to do, say so in a few words and summarise it in one sentence.');
        if (reply) {
          const res = reply.do.length ? await runAll(reply.do, { lead: reply.say }) : { say: reply.say || 'Nothing to do there.', title: reply.say || 'Nothing to do there.', chat: true };
          Object.assign(res, { engine: reply.engine, model: reply.model, tokens: reply.tokens });
          return finish(res, label, reply.engine);
        }
      } catch { /* fall back to the rules */ }
    }
    // No AI: keep it as a note, and offer the one obvious thing the rules can see.
    count('rules');
    const flat = msg.replace(/[,;!?()“”"]+/g, ' ').replace(/\s+/g, ' ').slice(0, 300);
    const p = parseSmart(flat, today());
    const note = await runCommand(`note: ${msg}`);
    const res = { say: 'Saved it as a note.', title: '📥 Saved as a note', sub: msg.slice(0, 140), undo: note.undo };
    if (p.date || p.time) {
      const when = [p.date ? D.fmtDate(p.date) : '', p.time ? D.fmtTime(p.time) : ''].filter(Boolean).join(' ');
      const first = msg.split(/[,.!?\n]/)[0];
      const title = tidyTitle(parseSmart(first, today()).title).slice(0, 60) || 'Event';
      res.say = `Saved it as a note. It mentions ${when} — want it on your calendar?`;
      res.alt = { keep: true, label: `Add to calendar: ${when}`, run: () => runAll([`schedule ${title} on ${p.date || today()}${p.time ? ` at ${p.time}` : ''}`]) };
    }
    return finish(res, label, 'rules');
  }

  function undo({ quiet = false } = {}) {
    if (!last) return { say: 'There’s nothing to undo.', title: 'Nothing to undo', via: 'rules' };
    const { res, text } = last;
    last = null;
    try { res.undo?.(); } catch { /* already gone */ }
    if (res.learned && res.learned.source === 'learned') mem.unlearn(res.learned.id);
    mem.bump(today(), { undone: 1 });
    if (!quiet) fixing = { text };
    return { say: quiet ? 'Undone.' : 'Undone. If I got it wrong, tell me what you meant and I’ll remember.', title: 'Undone', sub: `“${text}”`, via: 'rules' };
  }

  // The panel's Undo button: same as saying "undo" for the latest result, plain undo otherwise.
  function undoResult(res) {
    if (last && last.res === res) return undo();
    res.undo?.();
    return { say: 'Undone.', title: 'Undone', via: 'rules' };
  }

  return { handle, handleShared, undo, undoResult, history, get fixing() { return fixing; } };
}

function pick(xs) { return xs[Math.floor(Math.random() * xs.length)]; }
function greeting(d) {
  const h = d.getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
