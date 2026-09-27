// Personality. The AI gets a character brief (dry, understated British wit, loyal, briefly
// candid when you're doing something unwise). The free rules path, which answers most requests,
// gets the same voice: a varied acknowledgement instead of the same "Added…" every time, and
// now and then a remark drawn from your data (over budget, a streak milestone, working at 1 am).
// Only the spoken line changes; the card underneath still says exactly what happened.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as M from '../models.js';

// 'jarvis' (default) | 'plain'
export const style = () => store.pref('jarvisStyle', 'jarvis');

// How it addresses you: your name, 'sir', 'ma'am', or nothing.
export function address() {
  const a = store.pref('jarvisAddress', 'name');
  if (a === 'sir') return 'sir';
  if (a === 'maam') return 'ma’am';
  if (a === 'none') return '';
  return store.pref('userName', '');
}

export function prompt() {
  if (style() === 'plain') return 'Be brief, warm and direct.';
  const a = address();
  return 'Your character: modelled on J.A.R.V.I.S. from the Iron Man films. Calm, precise, quietly witty in a dry British way, '
    + 'loyal, and never servile or gushing. Understatement over exclamation marks. When they are about to do something unwise '
    + '(skipping sleep, blowing the budget, breaking a streak) say so once, lightly, then help anyway. '
    + `${a ? `Address them as "${a}" now and then, not in every reply. ` : ''}Keep replies short; wit is a garnish, not the meal.`;
}

// ---- Lines for the rules path -------------------------------------------------------------------------------
const ACK = ['Done.', 'Right away.', 'Consider it done.', 'Very good.', 'Noted.', 'Of course.', 'Taken care of.'];
const ACK_YOU = (a) => [`Done, ${a}.`, `Right away, ${a}.`, `Very good, ${a}.`, `As you wish, ${a}.`];
const MISS = ['I’m afraid I didn’t catch that.', 'Could you say that another way?', 'That one eluded me, I’m afraid.'];
const ACTION_KINDS = /^(?:todo|task|event|expense|habit|done|note|learning|goal|reading|watch|track|log|screen|move|delete|rename|priority|convert|vice|slip|knowledge|workout)/;

// A small seeded choice, so tests can pin it.
let rand = Math.random;
export function setRandom(fn) { rand = fn; }
const pick = (xs) => xs[Math.floor(rand() * xs.length) % xs.length];

// res → res with a more characterful `say`. info: { text }.
export function flavor(res, { text = '', now = new Date() } = {}) {
  if (!res || style() === 'plain' || res.chat || res.via === 'protocol') return res;
  const a = address();
  let say = res.say || '';
  // "I didn't catch that." and friends.
  if (res.miss && /^(?:i didn’t catch that|what should i add|i couldn’t find)/i.test(say) && rand() < 0.6) {
    say = /^i couldn’t find/i.test(say) ? `${say} ${pick(['Perhaps it goes by another name?', 'I’ve looked everywhere I’m allowed to.'])}` : pick(MISS);
  } else if (!res.miss && !res.answer && res.undo && !['skill', 'memory'].includes(res.via) && isAction(res) && !/^(?:done|right away|noted|very good|got it|sorry)/i.test(say)) {
    // An acknowledgement in front of what was done, varied, sometimes with how it addresses you.
    const lead = a && rand() < 0.3 ? pick(ACK_YOU(a)) : pick(ACK);
    say = `${lead} ${say}`;
  }
  const quip = remark(res, { text, now });
  if (quip) say = `${say} ${quip}`;
  return { ...res, say: say.trim() };
}

function isAction(res) {
  return Boolean(res.col || res.rec || ACTION_KINDS.test(String(res.title || '').toLowerCase()) || res.undo);
}

// ---- Remarks from your data --------------------------------------------------------------------------------
const REMARKED = 'daybook.persona.remarked';
function once(key) {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(REMARKED)) || {}; } catch { /* default */ }
  if (s[key]) return false;
  s[key] = Date.now();
  try { localStorage.setItem(REMARKED, JSON.stringify(s)); } catch { /* ignore */ }
  return true;
}

export function remark(res, { text = '', now = new Date() } = {}) {
  const t = D.toStr(now);
  const hr = now.getHours();
  const title = String(res.title || '');
  // Spending: over budget for the month.
  if (/spent|expense|💸|₹|\$|€|£/i.test(title) && res.undo) {
    const budget = Number(store.pref('budget', 0));
    if (budget) {
      const spent = M.sum(M.expensesBetween(`${t.slice(0, 8)}01`, t));
      if (spent > budget && once(`over:${t.slice(0, 7)}`)) return 'That puts us over budget for the month. Shall I alert the finance department?';
      if (spent > budget * 0.9 && once(`near:${t.slice(0, 7)}`)) return 'For the record, that’s ninety percent of the month’s budget.';
    }
  }
  // Habit streak milestones.
  if (res.col === 'habitLogs' || /habit|✅|done/i.test(title)) {
    for (const hb of M.habits()) {
      if (!M.isDone(hb.id, t)) continue;
      const n = M.streak(hb, t);
      if ([7, 14, 21, 30, 50, 75, 100, 150, 200, 365].includes(n) && new RegExp(escape(hb.name), 'i').test(`${title} ${text}`) && once(`streak:${hb.id}:${n}`)) {
        return pick([`That’s ${n} days of ${hb.name.toLowerCase()} in a row. Structural integrity improving.`, `${n} days straight. I’m almost impressed.`, `${n}-day streak. Do keep it up.`]);
      }
    }
  }
  // Working very late.
  if (hr >= 1 && hr < 5 && res.undo && once(`late:${t}`)) return pick(['It is past one in the morning, if anyone’s counting. I am.', 'May I point out that most people are asleep?']);
  // A workout.
  if (/workout|💪|🏋/i.test(title) && res.undo && rand() < 0.4) return pick(['Try not to pull anything.', 'I’ll have the medical bay standing by.']);
  return '';
}

function escape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
