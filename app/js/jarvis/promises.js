// Commitments: when you tell Jarvis "I'll finish the report tonight", it puts it on your list
// and remembers you said it. If the time passes and it isn't done, it brings it up
// ("You said you'd finish the report last night. Shall I move it to today?"); if you did it,
// it notices that too. Synced (collection jarvisPromises), so any device can follow up.

import * as store from '../store.js';
import * as D from '../dates.js';
import { parseSmart } from '../dates.js';
import { tidyTitle, bestMatch } from '../intents.js';

const COL = 'jarvisPromises';

// "I'll …" / "I will …" / "I'm going to …" / "I promise to …", with a when ("tonight", "by Friday").
const LEAD = /^(?:i(?:'ll| will| shall| am going to|'m going to|'m gonna| promise(?: to| i'll)?| swear i'll| need to| have to| must))\s+(.+)$/i;
const WHEN = /\b(?:today|tonight|tomorrow|this (?:morning|afternoon|evening|week|weekend)|by (?:tonight|tomorrow|(?:mon|tues|wednes|thurs|fri|satur|sun)day|the end of (?:the )?(?:day|week)|\d{1,2}(?::\d{2})?\s*(?:am|pm)?|end of (?:day|week))|(?:on|before|next) (?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:before|at) \d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i;

export function detect(text, today = D.today()) {
  const t = String(text || '').trim().replace(/[’]/g, "'").replace(/[.!]+$/, '');
  const m = t.match(LEAD);
  if (!m || !WHEN.test(m[1])) return null;
  const body = m[1];
  const when = body.match(WHEN)[0];
  const what = tidyTitle(body.replace(WHEN, '').replace(/\s+(?:by|before|on|at)\s*$/i, '').replace(/\s{2,}/g, ' ').trim());
  if (!what || what.split(/\s+/).length > 12 || /^(?:be|go to (?:bed|sleep)|see|think|try|let you know)\b/i.test(what)) return null;
  const p = parseSmart(`x ${when.replace(/^by\s+/i, '')}`, today);
  let date = p.date || today;
  if (/end of (?:the )?week|this weekend/i.test(when)) date = D.addDays(today, (7 - D.weekday(today)) % 7);
  const time = p.time || (/tonight|evening/i.test(when) ? '23:00' : /morning/i.test(when) ? '12:00' : /afternoon/i.test(when) ? '18:00' : '23:59');
  return { what, when, date, time };
}

export function add(p, text = '') {
  return store.put(COL, { what: p.what, when: p.when, date: p.date, time: p.time, text: String(text).slice(0, 200), status: 'open' });
}
export const open = () => store.all(COL).filter((p) => p.status === 'open');
export function close(p, status) { return store.put(COL, { ...p, status, closedAt: Date.now() }); }

export function dueLabel(p, today = D.today()) {
  if (p.date === today) return /tonight/i.test(p.when) ? 'tonight' : 'today';
  if (p.date === D.addDays(today, 1)) return 'tomorrow';
  if (p.date === D.addDays(today, -1)) return /tonight/i.test(p.when) ? 'last night' : 'yesterday';
  return `by ${D.fmtDate(p.date)}`;
}

// Is the thing done? Looks for a finished to-do or task with a close enough title.
export function kept(p) {
  const items = [...store.all('todos'), ...store.all('tasks')];
  const match = bestMatch(p.what, items, (x) => x.title, 0.6);
  return match ? Boolean(match.done) : null;
}

// For the proactive watcher: promises that are due, as notices.
export function review(now = new Date()) {
  const today = D.toStr(now);
  const minute = now.getHours() * 60 + now.getMinutes();
  const out = [];
  for (const p of open()) {
    const [hh, mm] = (p.time || '23:59').split(':').map(Number);
    const dueNow = p.date < today || (p.date === today && minute >= hh * 60 + mm);
    const k = kept(p);
    if (k === true) {
      close(p, 'kept');
      out.push({ key: `promise-kept:${p.id}`, priority: 20, say: `You said you’d ${lower(p.what)}, and you did. Noted.`, title: `📌 Kept: ${p.what}` });
      continue;
    }
    if (!dueNow) continue;
    if (p.date < D.addDays(today, -7)) { close(p, 'lapsed'); continue; }
    out.push({
      key: `promise:${p.id}`, priority: 75, promise: p,
      say: `You said you’d ${lower(p.what)} ${dueLabel(p, today)}. Shall I move it to today?`,
      title: `📌 ${p.what}`,
      action: { label: 'Move to today', cmd: `move ${p.what} to today`, then: () => close(p, 'moved') },
      dismiss: () => close(p, 'let go'),
    });
  }
  return out;
}

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// As a Jarvis plugin: "I'll finish the report tonight" → a to-do for then, plus the promise.
export const plugin = {
  name: 'promises', via: 'rules',
  match: (t) => detect(t),
  async run(p, text, api) {
    const r = (await api?.run?.(`remind me to ${lower(p.what)} ${p.when}`)) || { say: 'Noted.', title: p.what };
    if (r.miss) return r;
    const rec = add(p, text);
    const label = dueLabel(p);
    const undo = r.undo;
    return { ...r, say: `Noted. I’ll hold you to that: ${lower(p.what)}, ${label}.`, promise: { what: p.what, dueLabel: label },
      undo: () => { undo?.(); store.remove(COL, rec.id); } };
  },
};
