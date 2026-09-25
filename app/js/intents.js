// Turns a spoken (or typed) sentence into an intent the app can act on.
// Pure and rule-based — runs on the device, costs nothing, works offline.
//
//   "remind me to call the bank tomorrow"      → todo
//   "add task finish the report by friday"     → task
//   "schedule dentist tomorrow at 3 p.m."      → event
//   "spent 250 on lunch"                       → expense
//   "note: ideas for the trip ..."             → note
//   "add the book Deep Work by Cal Newport"    → reading
//   "I meditated" / "mark exercise as done"    → done (habit / to-do / task)
//   "what's on tomorrow" / "how much did I spend this month" → query
//   "open calendar"                            → navigate

import { parseSmart, today as todayStr } from './dates.js';

const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE = { hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000, million: 1000000 };

// "two hundred and fifty" → "250", "a thousand" → "1000", "5k" → "5000"
export function wordsToDigits(text) {
  const tokens = text.split(/(\s+)/);
  const out = [];
  let run = null; // { total, current, parts }
  const flush = () => {
    if (!run) return;
    const value = run.total + run.current;
    // keep trailing whitespace tokens that were swallowed
    out.push(String(value));
    if (run.trail) out.push(run.trail);
    run = null;
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^\s+$/.test(tok)) { if (run) run.trail = tok; else out.push(tok); continue; }
    const w = tok.toLowerCase().replace(/[,.]$/, '');
    const next = (tokens[i + 2] || '').toLowerCase();
    const isNum = w in SMALL || w in SCALE || (w === 'a' && next in SCALE) || (w === 'and' && run && (next in SMALL));
    if (!isNum) { flush(); out.push(tok); continue; }
    if (!run) run = { total: 0, current: 0, trail: '' };
    run.trail = '';
    if (w === 'a') run.current = 1;
    else if (w === 'and') { /* "two hundred and fifty" */ }
    else if (w in SMALL) run.current += SMALL[w];
    else if (w === 'hundred') run.current = (run.current || 1) * 100;
    else { run.total += (run.current || 1) * SCALE[w]; run.current = 0; }
  }
  flush();
  return out.join('').replace(/\b(\d+(?:\.\d+)?)\s?k\b/gi, (_, n) => String(Math.round(Number(n) * 1000)));
}

function clean(text) {
  return wordsToDigits(text)
    .replace(/[“”"]/g, '')
    .replace(/\b([ap])\.\s?m\.?(?=\s|$)/gi, '$1m')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '');
}

const FILLER_START = /^(?:(?:hey|hi|ok|okay|so|um+|uh+|please|daybook|can you|could you|would you|will you|i want you to|go ahead and)[\s,]+)+/i;
const FILLER_END = /[\s,]+(?:please|thanks|thank you)$/i;

export function tidyTitle(s) {
  s = s.replace(/^\s*(?:to|a|an|the|that|about|:|,|-)\s+/i, '')
    .replace(/\s+(?:at|on|by|due|for|in|from|and|to)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,:;-]\s*/, '')
    .replace(/[\s,;:-]+$/, '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const ROUTE_WORDS = { today: 'today', home: 'today', calendar: 'calendar', schedule: 'calendar', agenda: 'calendar', task: 'tasks',
  tasks: 'tasks', habit: 'habits', habits: 'habits', money: 'money', expense: 'money', expenses: 'money', spending: 'money',
  budget: 'money', reading: 'reading', 'reading list': 'reading', books: 'reading', news: 'news', note: 'notes', notes: 'notes', settings: 'settings' };

const CURRENCY = /(?:₹|\$|€|£|rs\.?|inr|rupees?|bucks|dollars?|euros?|pounds?)/i;
const AMOUNT = new RegExp(`(?:${CURRENCY.source}\\s?)?(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)(?:\\s?${CURRENCY.source})?`, 'i');

function period(t) {
  if (/\btoday\b/.test(t)) return 'today';
  if (/\byesterday\b/.test(t)) return 'yesterday';
  if (/\blast week\b/.test(t)) return 'lastWeek';
  if (/\b(this )?week\b/.test(t)) return 'week';
  if (/\blast month\b/.test(t)) return 'lastMonth';
  if (/\b(this )?year\b/.test(t)) return 'year';
  return 'month';
}

export function parseCommand(input, base = todayStr()) {
  const raw = clean(input).replace(FILLER_START, '').replace(FILLER_END, '').trim();
  const t = raw.toLowerCase();
  if (!t) return { type: 'empty' };

  // ---- navigation ----
  let m = t.match(/^(?:open|go to|show(?: me)?|switch to|take me to|jump to)\s+(?:the\s+|my\s+)*(today|home|calendar|schedule|agenda|tasks?|habits?|money|expenses?|spending|budget|reading(?: list)?|books|news|notes?|settings)(?:\s+(?:page|tab|screen|section))?$/);
  if (m) return { type: 'navigate', route: ROUTE_WORDS[m[1]] };

  // ---- questions ----
  const question = /^(?:what|what's|whats|how|how's|which|any|anything|do i|did i|have i|is there|are there|tell me|read|list|give me|brief me|show me|summari[sz]e)\b/.test(t) || /\?$/.test(input.trim());
  if (question) {
    if (/\bscreen ?time\b/.test(t)) return { type: 'query', what: 'screen' };
    if (/\b(should i be doing|supposed to be doing|doing now|my routine|routine|time ?table)\b/.test(t)) return { type: 'query', what: 'routine' };
    if (/\b(my level|what level|level am i|xp|experience points|my stats|my points|quests?)\b/.test(t)) return { type: 'query', what: 'stats' };
    if (/\b(what should i watch|watch ?list|to watch)\b/.test(t)) return { type: 'query', what: 'watch' };
    if (/\bhow much\b|\bspen[dt]\b|\bspending\b|\bexpenses?\b/.test(t) && !/\bschedule\b/.test(t)) {
      const cat = t.match(/\b(?:on|for)\s+([a-z]+)(?:\s+(?:today|yesterday|this|last)\b.*)?$/);
      return { type: 'query', what: 'spend', period: period(t), category: cat && !['this', 'last', 'the'].includes(cat[1]) ? cat[1] : null };
    }
    if (/\bhabits?\b/.test(t)) return { type: 'query', what: 'habits' };
    if (/\bgoals?\b/.test(t)) return { type: 'query', what: 'goals' };
    if (/\b(news|headlines|papers|jobs|job openings)\b/.test(t)) {
      const cat = /\bpapers?\b/.test(t) ? 'papers' : /\bjobs?\b/.test(t) ? 'jobs' : null;
      return { type: 'query', what: 'news', category: cat };
    }
    if (/\b(reading|books?)\b/.test(t)) return { type: 'query', what: 'reading' };
    if (/\b(brief|briefing|summary|summari[sz]e|my day|day look)\b/.test(t)) return { type: 'query', what: 'brief', date: parseSmart(raw, base).date || base };
    if (/\b(to[- ]?dos?|todo list|tasks?|left|pending|due)\b/.test(t)) {
      return { type: 'query', what: /\btasks?\b/.test(t) && !/\btoday\b/.test(t) ? 'tasks' : 'todos', date: parseSmart(raw, base).date || base };
    }
    if (/\b(schedule|calendar|agenda|plans?|planned|events?|meetings?|on|have|busy|free)\b/.test(t)) {
      return { type: 'query', what: 'agenda', date: parseSmart(raw, base).date || base };
    }
  }

  // ---- learnings ----
  m = raw.match(/^(?:til|today i learned|today i learnt|i learned|i learnt|i just learned|i've learned|i have learned|learned|lesson learned|life lesson|lesson|new learning|learning)\b[\s:,-]*(?:that\s+)?(.+)$/i);
  if (m && m[1].trim()) {
    const kind = /^(?:lesson|life lesson|lesson learned)/i.test(raw) ? 'lesson' : 'insight';
    return { type: 'learning', text: m[1].trim().charAt(0).toUpperCase() + m[1].trim().slice(1), kind };
  }

  // ---- screen time ----
  m = t.match(/^(?:log\s+|add\s+|record\s+)?(?:my\s+|the\s+)?screen ?time\s+(?:on\s+|for\s+)?(?:my\s+|the\s+)?([a-z]+)?\s*(?:was|is|:|of)?\s*(\d.*)$/);
  if (m) return { type: 'screen', device: m[1] || null, duration: m[2].trim() };

  // ---- day tracker ----
  if (/^(?:stop|end|pause)\s+(?:the\s+)?(?:tracking|timer|tracker)$/.test(t)) return { type: 'track', title: null };
  m = raw.match(/^(?:start tracking|track|tracking|now doing|i'?m now|i am now|now)\s+(?:doing\s+|working on\s+)?(.+)$/i)
    || raw.match(/^(?:i'?m|i am)\s+(?:now\s+)?(?:doing|working on|starting)\s+(.+)$/i);
  if (m) return { type: 'track', title: tidyTitle(m[1]) };
  const tl1 = raw.match(/^(?:log|track|i was|i've been|i have been|i did|i spent time|spent time)\s+(.+?)\s+from\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|till|until|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(today|yesterday))?$/i)
  m = tl1 || raw.match(/^(?:from\s+)?(?=\d)()(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|till|until|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+i\s+(?:was\s+)?(.+?)(?:\s+(today|yesterday))?$/i);
  if (m) {
    const title = tl1 ? m[1] : m[8];
    const dayWord = ((tl1 ? m[8] : m[9]) || '').toLowerCase();
    let sh = Number(m[2]); let eh = Number(m[5]);
    // "from 2 to 4 pm": the end's am/pm applies to the start too when the range doesn't wrap.
    const sap = (m[4] || (sh <= eh ? m[7] : '') || '').toLowerCase(); const eap = (m[7] || '').toLowerCase();
    if (sap === 'pm' && sh < 12) sh += 12; else if (sap === 'am' && sh === 12) sh = 0; else if (!sap && sh < 7) sh += 12;
    if (eap === 'pm' && eh < 12) eh += 12; else if (eap === 'am' && eh === 12) eh = 0;
    else if (!eap && eh <= sh && eh + 12 <= 24) eh += 12;
    const pad = (n) => String(n).padStart(2, '0');
    const day = dayWord === 'yesterday' ? parseSmart('yesterday', base).date : base;
    return { type: 'timelog', title: tidyTitle(title.replace(/^(?:doing|working on|at)\s+/i, '')), date: day,
      start: `${pad(sh % 24)}:${m[3] || '00'}`, end: `${pad(Math.min(eh, 23))}:${eh >= 24 ? '59' : m[6] || '00'}` };
  }

  // ---- gym ----
  m = t.match(/^(?:let'?s\s+)?(?:start|begin|log)\s+(?:a\s+|an\s+|my\s+|the\s+)?(?:(.+?)\s+)?(?:workout|routine|session|day|training)$/);
  if (m && !/\b(reading|timer)\b/.test(t)) return { type: 'startWorkout', name: m[1] && !/^(new|empty|gym)$/.test(m[1]) ? m[1] : null };
  if (/^(?:finish|end|stop|complete)\s+(?:the\s+|my\s+)?workout$/.test(t)) return { type: 'navigate', route: 'gym' };
  m = t.match(/^(?:log|record|add)?\s*(?:my\s+)?(?:body\s*)?weight(?:\s+is|\s+as|\s+of)?\s+(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilos?|lbs?|pounds)?(?:\s+today)?$/)
    || t.match(/^i\s+weigh(?:ed)?\s+(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilos?|lbs?|pounds)?(?:\s+today)?$/);
  if (m) return { type: 'bodyweight', value: Number(m[1]) };

  // ---- goals ----
  m = raw.match(/^(?:(?:add|set|create|new|make)\s+)?(?:a\s+|my\s+)?(monthly|yearly|annual|life|lifetime|bucket list|long[- ]term)?\s*goal(?:\s+for\s+(this|next)\s+(month|year))?(?:\s+(?:is|:))?[\s:,-]*(?:to\s+)?(.+)$/i)
    || raw.match(/^(?:my\s+)?(monthly|yearly|annual|life|lifetime|bucket list)\s+goal\s+(?:is\s+)?(?:to\s+)?()()(.+)$/i);
  if (m && m[4]) {
    let body = m[4];
    let hz = /^(monthly)$/i.test(m[1] || '') ? 'month' : /^(yearly|annual)$/i.test(m[1] || '') ? 'year' : /^(life|lifetime|bucket list|long[- ]term)$/i.test(m[1] || '') ? 'life' : null;
    let next = Boolean(m[2] && m[2].toLowerCase() === 'next');
    if (m[3]) hz = m[3].toLowerCase();
    body = body.replace(/\s+(?:by the end of |before the end of |for )?(this|next)\s+(month|year)$/i, (_, w, u) => { hz = hz || u.toLowerCase(); next = next || w.toLowerCase() === 'next'; return ''; })
      .replace(/\s+(?:in (?:my|this) life(?:time)?|before i die|someday|one day|in life)$/i, () => { hz = 'life'; return ''; });
    return { type: 'goal', title: tidyTitle(body), horizon: hz || 'month', next };
  }

  // ---- notes ----
  m = raw.match(/^(?:take (?:a )?note|make (?:a )?note|new note|add (?:a )?note|note to self|note(?: down)?(?: that)?|jot(?: down)?(?: that)?|write(?: down)?(?: that)?|remember that)\b[\s:,-]*(.*)$/i);
  if (m) return { type: 'note', text: m[1].trim() ? m[1].trim().charAt(0).toUpperCase() + m[1].trim().slice(1) : '' };

  // ---- reading ----
  m = raw.match(/^(?:i\s+)?(finished|completed|done)\s+reading\s+(.+)$/i);
  if (m) return { type: 'finishReading', target: tidyTitle(m[2]) };
  m = raw.match(/^(?:i\s+)?(?:started|start|begin|began|am|i'm|im)\s+reading\s+(.+)$/i);
  if (m) return { type: 'reading', ...splitBy(m[1]), status: 'reading' };
  m = raw.match(/^(?:add\s+)?(?:the\s+|a\s+)?(book|paper|article)\s+(?:called\s+)?(.+?)(?:\s+to (?:my )?reading list)?$/i)
    || raw.match(/^(?:add\s+)?()(.+?)\s+to (?:my )?(?:reading|read) list$/i)
    || raw.match(/^(?:i want to read|want to read|read later)()\s+(.+)$/i);
  if (m) return { type: 'reading', ...splitBy(m[2]), kind: (m[1] || 'book').toLowerCase(), status: 'toread' };

  // ---- watch list ----
  m = raw.match(/^i\s+(?:just\s+)?(?:watched|finished watching|saw)\s+(.+)$/i);
  if (m) return { type: 'watched', target: tidyTitle(m[1].replace(/\s+(?:today|yesterday|last night)$/i, '')) };
  m = raw.match(/^(?:add\s+)?(?:the\s+|a\s+)?(movie|film|show|series|tv show|documentary|anime)\s+(?:called\s+)?(.+?)(?:\s+to (?:my )?watch ?list)?$/i)
    || raw.match(/^(?:add\s+)?()(.+?)\s+to (?:my )?watch ?list$/i)
    || raw.match(/^(?:i want to watch|want to watch|watch later|remind me to watch)()\s+(.+)$/i);
  if (m) {
    const k = (m[1] || '').toLowerCase();
    const kind = /show|series|tv/.test(k) ? 'show' : /documentary/.test(k) ? 'documentary' : /anime/.test(k) ? 'anime' : k ? 'movie' : null;
    return { type: 'watch', title: m[2].trim(), kind };
  }

  // ---- expenses ----
  const hasAmount = AMOUNT.test(raw);
  const spendVerb = /^(?:i\s+)?(?:just\s+)?(spent|spend|paid|pay|bought|expense|add (?:an )?expense|log(?: an expense)?|gave|lost)\b/i.test(raw);
  if (hasAmount && (spendVerb || new RegExp(`${CURRENCY.source}`, 'i').test(raw) && !/\b(at|pm|am)\b/i.test(t))) {
    const smart = parseSmart(raw, base);
    let text = ` ${smart.title} `;
    const am = text.match(AMOUNT);
    const amount = am ? Number(am[1].replace(/,/g, '')) : null;
    if (am) text = text.slice(0, am.index) + ' ' + text.slice(am.index + am[0].length);
    const note = text.replace(/^\s*(?:i\s+)?(?:just\s+)?(?:spent|spend|paid|pay|bought|expense|add (?:an )?expense|log(?: an expense)?|gave|lost)\b/i, ' ')
      .replace(new RegExp(`\\b${CURRENCY.source}\\b`, 'gi'), ' ')
      .replace(/^\s*(?:(?:on|for|at|to|a|an|the)\s+)+/i, ' ')
      .replace(/\s+(?:on|for|at)\s+/i, ' ')
      .replace(/\s+/g, ' ').trim();
    return { type: 'expense', amount, note: note.replace(/^(?:on|for)\s+/i, ''), date: smart.date || base, category: smart.tag };
  }

  // ---- slips on habits you're breaking ----
  m = raw.match(/^(?:i\s+)?(?:slipped|relapsed|gave in|caved|messed up|failed)(?:\s+(?:on|with|to|again))*\s+(?:my\s+)?(.+?)(?:\s+(today|yesterday))?$/i);
  if (m) return { type: 'slip', target: m[1], date: m[2] && m[2].toLowerCase() === 'yesterday' ? parseSmart('yesterday', base).date : base };

  // ---- mark done ----
  m = raw.match(/^(?:mark|check off|check|tick off|tick|complete|finish|finished|completed|done with|i did|i've done|i have done|i finished|i completed|i'm done with|im done with)\s+(?:my\s+|the\s+)?(.+?)(?:\s+as)?(?:\s+(?:done|complete|completed|finished))?(?:\s+(today|yesterday))?$/i);
  if (m && !/^(?:reading)\b/i.test(m[1])) return { type: 'done', target: m[1], date: m[2] && m[2].toLowerCase() === 'yesterday' ? parseSmart('yesterday', base).date : base, strict: true };
  m = !/^i\s+(?:need|have|must|should|want|gotta|got|will|would|could|might|am|plan|hope)\b/i.test(raw) && raw.match(/^i\s+(?:just\s+|already\s+)?((?:\w+ed|read|ran|went|did|drank|slept|wrote|ate|woke|swam|rode|meditated)\b.*?)(?:\s+(today|yesterday))?$/i);
  if (m) return { type: 'done', target: m[1], date: m[2] && m[2].toLowerCase() === 'yesterday' ? parseSmart('yesterday', base).date : base, strict: false };

  // ---- events ----
  const eventLead = /^(?:add(?=.*\b(?:to|on|in)\s+(?:my\s+|the\s+)?calendar$)|schedule|add (?:an? )?(?:event|meeting|appointment)|add a call|set up (?:an? )?(?:meeting|call)|book (?:an? )?|put|create (?:an? )?(?:event|meeting))\b/i;
  const toCalendar = /\s+(?:to|on|in)\s+(?:my\s+|the\s+)?calendar$/i;
  const smart = parseSmart(raw.replace(eventLead, ' ').replace(toCalendar, ''), base);
  const eventy = /\b(meeting|appointment|call with|interview|flight|dinner with|lunch with|coffee with|class|lecture|party|birthday|wedding|doctor|dentist)\b/i.test(raw);
  if (eventLead.test(raw) || toCalendar.test(raw) || (smart.time && eventy)) {
    const title = tidyTitle(smart.title.replace(/^(?:an? )?(?:event|meeting|appointment)\s+(?:called|for|about|with)?\s*/i, (s) => (/with/i.test(s) ? 'Meeting with ' : '')));
    return { type: 'event', title: title || 'Event', date: smart.date || base, time: smart.time, endTime: smart.endTime };
  }

  // ---- tasks ----
  const taskLead = /^(?:add (?:a |an |new )?task|new task|create (?:a )?task|task|add(?=.*\s(?:to|in|on)\s+(?:my\s+|the\s+)?tasks?(?: list)?$)|add(?=.*\s(?:under|in|to|into)\s+(?:the\s+|my\s+)?\S.*\s(?:heading|section|group)$))\b[\s:,-]*/i;
  const toTasks = /\s+(?:to|in|on)\s+(?:my\s+|the\s+)?tasks?(?: list)?$/i;
  if (taskLead.test(raw) || toTasks.test(raw)) {
    let body = raw.replace(taskLead, ' ').replace(toTasks, '');
    let priority = 0;
    let heading = null;
    body = body.replace(/\s+(?:under|in|to|into)\s+(?:the\s+|my\s+)?(.+?)\s+(?:heading|section|group|list)$/i, (_, n) => { heading = n.trim(); return ''; });
    body = body.replace(/(?:,?\s*\b(?:it'?s|it is)\s+)?\b(?:(?:high|top) priority|urgent|important|asap)\b/i, () => { priority = 3; return ' '; })
      .replace(/\b(?:medium|normal) priority\b/i, () => { priority = 2; return ' '; })
      .replace(/\blow priority\b/i, () => { priority = 1; return ' '; });
    const p = parseSmart(body, base);
    const out = { type: 'task', title: tidyTitle(p.title.replace(/\s+(?:by|due)\s*$/i, '')), due: p.date, priority: p.priority || priority, tag: p.tag };
    if (heading) out.heading = heading;
    return out;
  }

  // ---- to-dos (default) ----
  const todoLead = /^(?:remind me to|remind me|remember to|don't forget to|dont forget to|i need to|i have to|i must|i should|i gotta|i got to|add (?:a )?to-?do|to-?do|add)\b[\s:,-]*/i;
  const toList = /\s+(?:to|on|in)\s+(?:my\s+|the\s+)?(?:to-?do(?: list)?|to do(?: list)?|list|today(?:'s list)?)$/i;
  if (hasAmount && !todoLead.test(raw) && /^\d/.test(raw)) {
    // "250 lunch" typed quickly
    const am = raw.match(AMOUNT);
    const note = raw.replace(am[0], ' ').replace(/\s+/g, ' ').trim();
    if (note) return { type: 'expense', amount: Number(am[1].replace(/,/g, '')), note, date: base, category: null };
  }
  const p = parseSmart(raw.replace(todoLead, ' ').replace(toList, ''), base);
  if (p.time && !todoLead.test(raw)) {
    return { type: 'event', title: tidyTitle(p.title) || 'Event', date: p.date || base, time: p.time, endTime: p.endTime };
  }
  return { type: 'todo', title: tidyTitle(p.title), date: p.date || base };
}

function splitBy(text) {
  const m = text.match(/^(.*?)\s+by\s+(.+)$/i);
  return m ? { title: tidyTitle(m[1]), author: m[2].trim() } : { title: tidyTitle(text), author: '' };
}

// ---- fuzzy matching (for "I meditated" → habit "Meditate") ----------------------------------
const STOP = new Set(['my', 'the', 'a', 'an', 'to', 'for', 'of', 'i', 'did', 'done', 'today', 'with', 'and', 'on', 'in', 'at', 'went', 'just', 'some']);

export function stem(w) {
  w = w.toLowerCase().replace(/[^a-z0-9]/g, '');
  const irregular = { ran: 'run', went: 'go', gym: 'exercis', workout: 'exercis', worked: 'exercis', drank: 'drink', drinking: 'drink', slept: 'sleep', wrote: 'writ',
    ate: 'eat', swam: 'swim', rode: 'ride', woke: 'wake', smoked: 'smok', smoking: 'smok', cigarette: 'smok', cigarettes: 'smok', smoke: 'smok',
    doomscrolled: 'doomscroll', doomscrolling: 'doomscroll', scrolled: 'doomscroll', snoozed: 'snooz', snoozing: 'snooz', beer: 'drink', beers: 'drink', alcohol: 'drink',
    burger: 'junk', pizza: 'junk', fries: 'junk', chips: 'junk', junk: 'junk' };
  if (irregular[w]) return irregular[w];
  for (const suf of ['ations', 'ation', 'ing', 'ed', 'es', 'e', 's']) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

function words(s) {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(stem);
}

// Returns 0..1: how well `phrase` matches `name`.
export function similarity(phrase, name) {
  const a = words(phrase); const b = words(name);
  if (!a.length || !b.length) return 0;
  const bs = new Set(b);
  const hits = a.filter((w) => bs.has(w) || [...bs].some((x) => x.length > 3 && w.length > 3 && (x.startsWith(w) || w.startsWith(x)))).length;
  return hits / Math.max(b.length, Math.min(a.length, b.length + 1));
}

export function bestMatch(phrase, items, getName, min = 0.5) {
  let best = null; let score = 0;
  for (const it of items) {
    const s = similarity(phrase, getName(it));
    if (s > score) { score = s; best = it; }
  }
  return score >= min ? best : null;
}
