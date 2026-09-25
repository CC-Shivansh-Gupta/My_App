// Voice assistant: listen (browser speech recognition), understand (intents.js),
// act on the data, and answer out loud (speech synthesis). All free and on-device
// apart from the browser's own speech service.

import * as store from './store.js';
import * as D from './dates.js';
import * as M from './models.js';
import { parseCommand, bestMatch } from './intents.js';
import { h, icon, sheet, closeSheet, isSheetOpen, toast, money } from './ui.js';
import { topNews } from './views/news.js';
import { addGoal } from './views/goals.js';
import * as G from './gym/model.js';
import { addLearning } from './views/learnings.js';
import { addWatch } from './views/watch.js';
import * as R from './views/routine.js';
import * as SCR from './views/screen.js';
import * as X from './gamify.js';
import * as V from './vices.js';

const tidy = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export function supported() {
  return Boolean(SR);
}

export function lang() {
  return store.pref('voiceLang', (typeof navigator !== 'undefined' && navigator.language) || 'en-US');
}

// ---- Speaking ------------------------------------------------------------------------------
export function speak(text) {
  if (!store.pref('voiceReplies', true) || !('speechSynthesis' in window) || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang();
    const voice = speechSynthesis.getVoices().find((v) => v.lang === u.lang) || speechSynthesis.getVoices().find((v) => v.lang?.startsWith(u.lang.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

// Money for the ear: "₹1,200" → "1,200 rupees"
function sayMoney(n) {
  const cur = store.pref('currency', '₹');
  const word = { '₹': 'rupees', $: 'dollars', '€': 'euros', '£': 'pounds', '¥': 'yen' }[cur];
  const num = Math.round(n).toLocaleString();
  return word ? `${num} ${word}` : `${cur}${num}`;
}

function sayTime(e) {
  if (e.allDay || !e.time) return 'all day';
  return `at ${D.fmtTime(e.time)}`;
}

function listSay(items, max = 5) {
  const xs = items.slice(0, max);
  const more = items.length > max ? `, and ${items.length - max} more` : '';
  if (xs.length <= 1) return xs.join('') + more;
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}${more}`;
}

// ---- Listening -------------------------------------------------------------------------------
let active = null;

export function stopListening() {
  try { active?.abort(); } catch { /* ignore */ }
  active = null;
}

// Start recognition. Calls onInterim(text) while speaking, then onFinal(text) or onError(msg).
export function listen({ onInterim, onFinal, onError, onEnd } = {}) {
  if (!SR) { onError?.('unsupported'); return null; }
  stopListening();
  try { speechSynthesis?.cancel(); } catch { /* ignore */ }
  const rec = new SR();
  rec.lang = lang();
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  let interim = '';
  let done = false;
  rec.onresult = (e) => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onInterim?.((finalText + ' ' + interim).trim());
  };
  rec.onerror = (e) => {
    done = true;
    const msg = {
      'not-allowed': 'Microphone access is blocked. Allow it for this site in your browser settings.',
      'service-not-allowed': 'unsupported',
      'no-speech': 'I didn’t hear anything. Tap the mic and try again.',
      'audio-capture': 'No microphone found.',
      network: 'Speech recognition needs an internet connection.',
      aborted: null,
    }[e.error];
    if (msg !== null) onError?.(msg || `Speech error: ${e.error}`);
  };
  rec.onend = () => {
    if (active === rec) active = null;
    if (!done) {
      const text = (finalText || interim).trim();
      if (text) onFinal?.(text);
      else onError?.('I didn’t hear anything. Tap the mic and try again.');
    }
    onEnd?.();
  };
  try { rec.start(); } catch (e) { onError?.(e.message); return null; }
  active = rec;
  return rec;
}

// Mic button that dictates into a text field (appends text).
export function dictateButton(field, { onDone } = {}) {
  const btn = h('button', { type: 'button', class: 'icon-btn mic-btn', 'aria-label': 'Dictate', 'data-tip': 'Dictate' }, icon('mic', 20));
  btn.addEventListener('click', () => {
    if (btn.classList.contains('listening')) { stopListening(); return; }
    if (!SR) { field.focus(); toast('Use the 🎤 key on your keyboard to dictate here.'); return; }
    const before = field.value;
    const sep = before && !/\s$/.test(before) ? (field.tagName === 'TEXTAREA' ? '\n' : ' ') : '';
    btn.classList.add('listening');
    listen({
      onInterim: (t) => { field.value = before + sep + t; },
      onFinal: (t) => { field.value = before + sep + t; field.dispatchEvent(new Event('input', { bubbles: true })); onDone?.(); },
      onError: (m) => { field.value = before; if (m && m !== 'unsupported') toast(m); else if (m) toast('Use the 🎤 key on your keyboard to dictate here.'); },
      onEnd: () => btn.classList.remove('listening'),
    });
  });
  return btn;
}

// ---- Acting on a command -----------------------------------------------------------------------
// Returns { say, title, lines?, undo?, go?, edit? }
export function execute(text) {
  const t = D.today();
  const it = parseCommand(text, t);
  switch (it.type) {
    case 'empty':
      return { say: 'I didn’t catch that.', title: 'Say something like “add milk to my list”.' };

    case 'navigate':
      return { say: `Opening ${it.route}.`, title: `Opening ${it.route}`, go: it.route };

    case 'todo': {
      if (!it.title) return { say: 'What should I add?', title: 'What should I add?' };
      const r = M.addTodo(it.title, it.date);
      const when = it.date === t ? 'today' : D.fmtDate(it.date).toLowerCase();
      return { say: `Added “${r.title}” to your to-dos for ${when}.`, title: `To-do: ${r.title}`, sub: D.fmtDate(it.date), undo: () => store.remove('todos', r.id), col: 'todos', rec: r };
    }

    case 'task': {
      if (!it.title) return { say: 'What’s the task?', title: 'What’s the task?' };
      let heading = null;
      if (it.heading) heading = bestMatch(it.heading, M.taskHeadings(), (g) => g.name, 0.5) || M.addHeading(tidy(it.heading));
      const r = M.addTask({ title: it.title, date: it.due, priority: it.priority, tag: it.tag, heading: heading?.id });
      const bits = [heading ? `under ${heading.name}` : '', it.due ? `due ${D.fmtDate(it.due)}` : '', it.priority === 3 ? 'high priority' : ''].filter(Boolean).join(', ');
      return { say: `Added task “${r.title}”${bits ? `, ${bits}` : ''}.`, title: `Task: ${r.title}`, sub: bits, undo: () => store.remove('tasks', r.id), col: 'tasks', rec: r };
    }

    case 'event': {
      const r = store.put('events', { title: it.title, date: it.date, time: it.time, endTime: it.endTime, allDay: !it.time, repeat: 'none', notes: '' });
      const when = `${D.fmtDate(it.date)}${it.time ? ` at ${D.fmtTime(it.time)}` : ''}`;
      return { say: `Scheduled ${r.title}, ${when}.`, title: `Event: ${r.title}`, sub: when, undo: () => store.remove('events', r.id), col: 'events', rec: r };
    }

    case 'expense': {
      if (!it.amount) return { say: 'How much was it?', title: 'Say the amount, like “spent 250 on lunch”.' };
      const r = M.addExpense({ amount: it.amount, note: it.note, category: it.category, date: it.date });
      return {
        say: `Logged ${sayMoney(r.amount)}${r.note ? ` for ${r.note}` : ''}, under ${r.category}.`,
        title: `${money(r.amount)} · ${M.categoryEmoji(r.category)} ${r.category}`, sub: [r.note, D.fmtDate(r.date)].filter(Boolean).join(' · '),
        undo: () => store.remove('expenses', r.id), col: 'expenses', rec: r,
      };
    }

    case 'note': {
      if (!it.text) return { say: 'What should the note say?', title: 'Say “note” followed by what to write.' };
      const r = store.put('notes', { text: it.text, pinned: false });
      return { say: 'Saved your note.', title: 'Note saved', sub: it.text, undo: () => store.remove('notes', r.id), col: 'notes', rec: r };
    }

    case 'reading': {
      const existing = bestMatch(it.title, store.all('reading'), (r) => r.title, 0.8);
      if (existing && it.status === 'reading') {
        store.put('reading', { ...existing, status: 'reading', startedAt: existing.startedAt || t });
        return { say: `Moved ${existing.title} to reading now.`, title: `Reading: ${existing.title}` };
      }
      const r = M.addReading({ title: it.title, author: it.author, type: it.kind === 'paper' ? 'paper' : it.kind === 'article' ? 'article' : 'book', status: it.status });
      return { say: `Added ${r.title}${r.author ? ` by ${r.author}` : ''} to your reading list.`, title: `Reading list: ${r.title}`, sub: r.author, undo: () => store.remove('reading', r.id), col: 'reading', rec: r };
    }

    case 'finishReading': {
      const r = bestMatch(it.target, store.all('reading').filter((x) => x.status !== 'done'), (x) => x.title, 0.5);
      if (!r) return { say: `I couldn’t find ${it.target} on your reading list.`, title: `Not on your list: ${it.target}` };
      store.put('reading', { ...r, status: 'done', progress: 100, finishedAt: t });
      return { say: `Nice! Marked ${r.title} as finished.`, title: `Finished: ${r.title} 🎉`, undo: () => store.put('reading', r) };
    }

    case 'slip': {
      const v = bestMatch(it.target, V.vices(), (x) => x.name, 0.4);
      if (!v) return { say: `I couldn’t find a habit to break called ${it.target}. Add it under Habits → Habits to break.`, title: `No match for “${it.target}”`, go: null };
      const r = V.logSlip(v, it.date);
      const mult = X.SEVERITY[store.pref('penaltyLevel', 'normal')] ?? 1;
      return { say: `Logged a slip on ${v.name}. That's minus ${Math.round((v.penalty || 10) * mult)} XP. Tomorrow's a new streak.`, title: `${v.emoji || '🚫'} Slip: ${v.name}`, sub: `−${Math.round((v.penalty || 10) * mult)} XP`, undo: () => store.remove('slips', r.id) };
    }

    case 'done': {
      // "I ate junk food" / "I smoked" → a habit you're breaking, if it matches one.
      if (!it.strict) {
        const vice = bestMatch(it.target, V.vices(), (x) => x.name, 0.5);
        if (vice) {
          const r = V.logSlip(vice, it.date);
          const mult = X.SEVERITY[store.pref('penaltyLevel', 'normal')] ?? 1;
          return { say: `Logged a slip on ${vice.name}, minus ${Math.round((vice.penalty || 10) * mult)} XP.`, title: `${vice.emoji || '🚫'} Slip: ${vice.name}`, sub: `−${Math.round((vice.penalty || 10) * mult)} XP`, undo: () => store.remove('slips', r.id) };
        }
      }
      const habits = M.habits();
      const hb = bestMatch(it.target, habits, (x) => x.name, it.strict ? 0.5 : 0.5);
      if (hb) {
        const was = M.isDone(hb.id, it.date);
        M.setDone(hb.id, it.date, true);
        const st = M.streak(hb, it.date);
        return { say: `Ticked off ${hb.name}${it.date !== t ? ' for yesterday' : ''}.${st > 1 ? ` That’s a ${st} day streak!` : ''}`,
          title: `${hb.emoji || '✅'} ${hb.name}`, sub: st > 1 ? `🔥 ${st}-day streak` : 'Done for today', undo: () => M.setDone(hb.id, it.date, was) };
      }
      const todo = bestMatch(it.target, M.todosOn(t).filter((x) => !x.done).concat(M.unfinishedBefore(t)), (x) => x.title, 0.5);
      if (todo) { M.toggleTodo(todo, true); return { say: `Checked off ${todo.title}.`, title: `Done: ${todo.title}`, undo: () => M.toggleTodo(todo, false) }; }
      const task = bestMatch(it.target, M.openTasks(), (x) => x.title, 0.5);
      if (task) { M.toggleTask(task, true); return { say: `Completed the task ${task.title}.`, title: `Done: ${task.title}`, undo: () => M.toggleTask(task, false) }; }
      if (!it.strict) {
        // Not a habit or to-do: most likely something to remember.
        return { say: `I couldn’t find a habit or to-do called ${it.target}.`, title: `No match for “${it.target}”`, sub: 'Say “add habit …” in the Habits tab, or rephrase.' };
      }
      return { say: `I couldn’t find ${it.target}.`, title: `No match for “${it.target}”` };
    }

    case 'goal': {
      if (!it.title) return { say: 'What’s the goal?', title: 'What’s the goal?' };
      const period = it.horizon === 'life' ? null : it.horizon === 'month'
        ? (it.next ? D.addMonths(t.slice(0, 8) + '01', 1) : t).slice(0, 7)
        : String(Number(t.slice(0, 4)) + (it.next ? 1 : 0));
      const r = addGoal({ title: it.title, horizon: it.horizon, period });
      const when = it.horizon === 'life' ? 'your life goals' : it.horizon === 'month' ? (it.next ? 'next month' : 'this month') : (it.next ? 'next year' : 'this year');
      return { say: `Added the goal “${r.title}” for ${when}.${r.mode === 'number' ? ` I’ll track it to ${r.target}${r.unit ? ` ${r.unit}` : ''}.` : ''}`,
        title: `Goal: ${r.title}`, sub: when.charAt(0).toUpperCase() + when.slice(1), undo: () => store.remove('goals', r.id) };
    }

    case 'startWorkout': {
      const active = G.activeWorkout();
      if (active) return { say: 'You already have a workout going. Opening it.', title: `Workout in progress: ${active.name}`, go: 'gym' };
      const tpl = it.name ? bestMatch(it.name, G.templates(), (x) => x.name, 0.5) : null;
      const w = G.startWorkout(tpl);
      return { say: tpl ? `Starting ${tpl.name}. Have a good one!` : `Started an empty workout${it.name ? `. I couldn’t find a template called ${it.name}` : ''}.`,
        title: `Workout started: ${w.name}`, go: 'gym' };
    }

    case 'bodyweight': {
      const prev = G.bodyWeights().pop();
      G.logBodyWeight(it.value);
      const diff = prev ? Math.round((it.value - prev.value) * 10) / 10 : 0;
      return { say: `Logged ${it.value} ${G.unit()}.${prev && diff ? ` That’s ${Math.abs(diff)} ${diff > 0 ? 'up' : 'down'} from last time.` : ''}`, title: `Body weight: ${it.value} ${G.unit()}` };
    }

    case 'learning': {
      const r = addLearning({ text: it.text, type: it.kind });
      return { say: 'Saved to your learnings. I’ll bring it back for review tomorrow.', title: `💡 ${r.text}`, sub: 'Learning saved · +10 XP', undo: () => store.remove('learnings', r.id) };
    }

    case 'watch': {
      const r = addWatch({ title: it.title, type: it.kind || undefined });
      return { say: `Added ${r.title} to your watch list.`, title: `Watch list: ${r.title}`, sub: [r.type, r.platform].filter(Boolean).join(' · '), undo: () => store.remove('watch', r.id) };
    }

    case 'watched': {
      const w = bestMatch(it.target, store.all('watch').filter((x) => x.status !== 'done'), (x) => x.title, 0.5);
      if (w) { store.put('watch', { ...w, status: 'done', finishedAt: t }); return { say: `Marked ${w.title} as watched. How was it? You can rate it in the watch list.`, title: `Watched: ${w.title} 🍿`, undo: () => store.put('watch', w) }; }
      const r = addWatch({ title: it.target, status: 'done' });
      return { say: `Logged ${r.title} as watched.`, title: `Watched: ${r.title} 🍿`, undo: () => store.remove('watch', r.id) };
    }

    case 'track': {
      const before = R.running();
      const r = R.track(it.title);
      if (!it.title) return before ? { say: `Stopped tracking ${before.title}.`, title: `Stopped: ${before.title}` } : { say: 'Nothing was being tracked.', title: 'Nothing running' };
      return { say: `Tracking ${r.title}${before ? `. Stopped ${before.title}` : ''}.`, title: `⏱️ Tracking: ${r.title}`, sub: `since ${D.fmtTime(r.start)}`, undo: () => { store.remove('timelog', r.id); if (before) store.put('timelog', before); } };
    }

    case 'timelog': {
      const r = R.logEntry({ date: it.date, start: it.start, end: it.end, title: it.title });
      return { say: `Logged ${r.title} from ${D.fmtTime(r.start)} to ${D.fmtTime(r.end)}.`, title: `⏱️ ${r.title}`, sub: `${D.fmtDate(r.date)} · ${D.fmtTime(r.start)} – ${D.fmtTime(r.end)}`, undo: () => store.remove('timelog', r.id) };
    }

    case 'screen': {
      const devs = SCR.devices();
      const alias = (d) => (/(phone|iphone|android|mobile|pixel|galaxy)/.test(d) ? 'phone' : /(ipad|tablet|tab)/.test(d) ? 'ipad' : /(laptop|computer|mac|pc|desktop|macbook|windows)/.test(d) ? 'laptop' : d);
      const dev = it.device ? devs.find((x) => alias(x.toLowerCase()) === alias(it.device)) || bestMatch(it.device, devs, (x) => x, 0.5) : null;
      const minutes = SCR.parseDuration(it.duration.replace(/\s+and\s+/g, ' '));
      if (!dev) return { say: `Which device? Say something like: screen time ${devs[0].toLowerCase()} 3 hours.`, title: 'Which device?', sub: devs.join(' · ') };
      if (!minutes) return { say: 'How long was it?', title: 'Say a duration, like “3 hours 20 minutes”.' };
      const prev = SCR.entry(t, dev);
      SCR.setEntry(t, dev, minutes);
      const total = SCR.totalOn(t);
      return { say: `Logged ${SCR.fmtMin(minutes).replace('h', ' hours').replace('m', ' minutes')} on your ${dev}. ${total > SCR.limit() ? 'You’re over your daily limit.' : `Total today is ${SCR.fmtMin(total).replace('h', ' hours').replace('m', ' minutes')}.`}`,
        title: `📱 ${dev}: ${SCR.fmtMin(minutes)}`, sub: `Total today ${SCR.fmtMin(total)} · limit ${SCR.fmtMin(SCR.limit())}`, undo: () => SCR.setEntry(t, dev, prev ? prev.minutes : null) };
    }

    case 'query':
      return answer(it, t);

    default:
      return { say: 'Sorry, I didn’t understand that.', title: 'Sorry, I didn’t get that.' };
  }
}

function answer(q, t) {
  if (q.what === 'agenda' || q.what === 'brief') {
    const d = q.date || t;
    const dayWord = d === t ? 'today' : d === D.addDays(t, 1) ? 'tomorrow' : `on ${D.fmtDate(d, { relative: false })}`;
    const evs = M.eventsOn(d);
    const todos = M.todosOn(d).filter((x) => !x.done);
    const tasks = M.tasksForDay(d);
    const lines = [...evs.map((e) => `📅 ${M.eventTimeLabel(e)} — ${e.title}`), ...todos.map((x) => `☐ ${x.title}`), ...tasks.map((x) => `◻︎ ${x.title}${x.due && x.due < d ? ' (overdue)' : ''}`)];
    let say = evs.length ? `You have ${evs.length} ${evs.length === 1 ? 'event' : 'events'} ${dayWord}: ${listSay(evs.map((e) => `${e.title} ${sayTime(e)}`))}.` : `Nothing on your calendar ${dayWord}.`;
    if (todos.length) say += ` ${todos.length} ${todos.length === 1 ? 'to-do' : 'to-dos'}: ${listSay(todos.map((x) => x.title), 4)}.`;
    if (tasks.length) say += ` ${tasks.length === 1 ? 'One task is' : `${tasks.length} tasks are`} due.`;
    if (q.what === 'brief' && d === t) {
      const left = M.habits().filter((hb) => M.scheduledOn(hb, t) && !M.isDone(hb.id, t));
      if (left.length) say += ` Habits still to do: ${listSay(left.map((x) => x.name), 4)}.`;
      const spent = M.sum(M.expensesBetween(t, t));
      if (spent) say += ` You've spent ${sayMoney(spent)} today.`;
    }
    return { say, title: `${d === t ? 'Today' : D.fmtDate(d)}`, lines: lines.length ? lines : ['Nothing planned.'], go: null };
  }
  if (q.what === 'todos' || q.what === 'tasks') {
    const d = q.date || t;
    const list = q.what === 'tasks' ? M.openTasks().sort(M.taskSort) : M.todosOn(d).filter((x) => !x.done).concat(d === t ? M.tasksForDay(d) : []);
    if (!list.length) return { say: q.what === 'tasks' ? 'You have no open tasks.' : 'Your list is clear.', title: 'All clear ✨' };
    return { say: `You have ${list.length} ${q.what === 'tasks' ? 'open tasks' : 'things to do'}: ${listSay(list.map((x) => x.title))}.`,
      title: q.what === 'tasks' ? 'Open tasks' : 'To do', lines: list.slice(0, 10).map((x) => `☐ ${x.title}`) };
  }
  if (q.what === 'spend') {
    const [from, to, label] = range(q.period, t);
    let list = M.expensesBetween(from, to);
    if (q.category) {
      const cat = M.normalizeCategory(q.category);
      const byCat = list.filter((e) => e.category.toLowerCase() === cat.toLowerCase());
      list = byCat.length ? byCat : list.filter((e) => (e.note || '').toLowerCase().includes(q.category));
    }
    const total = M.sum(list);
    const byCat = {};
    for (const e of list) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    let say = `You've spent ${sayMoney(total)}${q.category ? ` on ${q.category}` : ''} ${label}.`;
    if (!q.category && top.length > 1) say += ` Most of it on ${top[0][0]}, ${sayMoney(top[0][1])}.`;
    const budget = Number(store.pref('budget', 0));
    if (budget && q.period === 'month' && !q.category) say += total > budget ? ` That's ${sayMoney(total - budget)} over budget.` : ` ${sayMoney(budget - total)} left in your budget.`;
    return { say, title: `${money(total)} ${label}`, lines: top.slice(0, 6).map(([c, v]) => `${M.categoryEmoji(c)} ${c} — ${money(v)}`) };
  }
  if (q.what === 'habits') {
    const list = M.habits().filter((hb) => M.scheduledOn(hb, t));
    if (!list.length) return { say: 'You have no habits set up yet.', title: 'No habits yet' };
    const done = list.filter((hb) => M.isDone(hb.id, t));
    const left = list.filter((hb) => !M.isDone(hb.id, t));
    const say = left.length ? `${done.length} of ${list.length} done. Still to do: ${listSay(left.map((x) => x.name))}.` : `All ${list.length} habits done today. Great job!`;
    return { say, title: `Habits · ${done.length}/${list.length}`, lines: list.map((hb) => `${M.isDone(hb.id, t) ? '✅' : '⬜️'} ${hb.name}`) };
  }
  if (q.what === 'routine') {
    const { now, next } = R.nowAndNext();
    const cur = R.running();
    if (!R.blocks().length) return { say: 'You haven’t planned a routine yet. Open Routine to design your ideal day.', title: 'No routine yet', go: 'routine' };
    const say = `${now ? `Right now your routine says: ${now.block.title}, until ${D.fmtTime(now.block.end)}.` : 'You have free time right now.'}${next ? ` Next up at ${D.fmtTime(next.block.start)}: ${next.block.title}.` : ''}${cur ? ` You're tracking ${cur.title}.` : ''}`;
    return { say, title: now ? `Now: ${now.block.title}` : 'Free time', sub: next ? `Next: ${D.fmtTime(next.block.start)} · ${next.block.title}` : '' };
  }
  if (q.what === 'stats') {
    const s = X.summary();
    const qs = X.quests();
    const left = qs.filter((x) => !x.done);
    return { say: `You're level ${s.level.level}, ${s.level.rank}, with ${s.total.toLocaleString()} XP. ${s.level.need - s.level.into} XP to the next level.${left.length ? ` Today's quests left: ${listSay(left.map((x) => x.title))}.` : ' All quests done today!'}`,
      title: `Level ${s.level.level} · ${s.level.rank}`, sub: `${s.total.toLocaleString()} XP · 🔥 ${s.streak}-day streak`, lines: qs.map((x) => `${x.done ? '✅' : x.emoji} ${x.title} (+${x.xp} XP)`) };
  }
  if (q.what === 'screen') {
    const tot = SCR.totalOn(t);
    const y = SCR.totalOn(D.addDays(t, -1));
    if (tot === null && y === null) return { say: 'No screen time logged yet. Say for example: screen time phone 3 hours.', title: 'No screen time logged', go: 'screen' };
    const which = tot !== null ? tot : y;
    return { say: `${tot !== null ? 'Today' : 'Yesterday'} you logged ${SCR.fmtMin(which).replace('h', ' hours').replace('m', ' minutes')} of screen time across your devices.`, title: `📱 ${SCR.fmtMin(which)} ${tot !== null ? 'today' : 'yesterday'}` };
  }
  if (q.what === 'watch') {
    const list = store.all('watch').filter((w) => w.status !== 'done').sort((a, b) => (a.status === 'watching' ? -1 : 1) - (b.status === 'watching' ? -1 : 1));
    if (!list.length) return { say: 'Your watch list is empty.', title: 'Watch list is empty' };
    return { say: `How about ${listSay(list.slice(0, 3).map((w) => w.title), 3)}?`, title: 'From your watch list', lines: list.slice(0, 6).map((w) => `${w.status === 'watching' ? '▶️' : '•'} ${w.title}${w.platform ? ` (${w.platform})` : ''}`) };
  }
  if (q.what === 'goals') {
    const list = store.all('goals').filter((g) => g.status === 'active' && (g.horizon === 'life' || g.period === t.slice(0, 7) || g.period === t.slice(0, 4)));
    if (!list.length) return { say: 'You have no active goals yet.', title: 'No goals yet', go: 'goals' };
    const month = list.filter((g) => g.horizon === 'month');
    return { say: `${month.length ? `This month: ${listSay(month.map((g) => g.title))}.` : ''} You have ${list.length} active goals in total.`,
      title: 'Your goals', lines: list.slice(0, 8).map((g) => `${g.horizon === 'month' ? '🗓' : g.horizon === 'year' ? '📆' : '🌟'} ${g.title}`) };
  }
  if (q.what === 'reading') {
    const list = store.all('reading').filter((r) => r.status === 'reading');
    if (!list.length) return { say: 'You are not reading anything right now.', title: 'Nothing in progress' };
    return { say: `You're reading ${listSay(list.map((r) => `${r.title}, ${r.progress || 0} percent`))}.`, title: 'Reading now', lines: list.map((r) => `${M.readingIcon(r.type)} ${r.title} — ${r.progress || 0}%`) };
  }
  if (q.what === 'news') {
    const items = (topNews(20) || []).filter((i) => !q.category || i.category === q.category).slice(0, 3);
    if (!items.length) return { say: 'Nothing new matching your interests right now.', title: 'No new matches', go: 'news' };
    return { say: `Here are the top ${items.length}: ${items.map((i, n) => `${n + 1}. ${i.title}`).join('. ')}.`, title: 'Top picks for you', lines: items.map((i) => `• ${i.title}`), go: null, news: true };
  }
  return { say: 'Sorry, I can’t answer that yet.', title: 'Sorry, I can’t answer that yet.' };
}

function range(p, t) {
  const d = D.parse(t);
  const weekStart = store.pref('weekStart', 1);
  const ws = D.addDays(t, -((d.getDay() - weekStart + 7) % 7));
  switch (p) {
    case 'today': return [t, t, 'today'];
    case 'yesterday': { const y = D.addDays(t, -1); return [y, y, 'yesterday']; }
    case 'week': return [ws, t, 'this week'];
    case 'lastWeek': return [D.addDays(ws, -7), D.addDays(ws, -1), 'last week'];
    case 'lastMonth': { const s = D.addMonths(t.slice(0, 8) + '01', -1); return [s, D.addDays(t.slice(0, 8) + '01', -1), 'last month']; }
    case 'year': return [t.slice(0, 4) + '-01-01', t, 'this year'];
    default: return [t.slice(0, 8) + '01', t, 'this month'];
  }
}

// ---- The voice sheet ---------------------------------------------------------------------------
const EXAMPLES = ['Remind me to call the bank tomorrow', 'Spent 250 on lunch', 'Schedule dentist Friday at 3 pm', 'I meditated',
  'TIL compound interest beats timing the market', 'I was in meetings from 2 to 4', 'Add Dune to my watch list', 'Screen time phone 3 hours',
  'What should I be doing now?', 'What level am I?', 'Brief me'];

export function openVoice({ autoStart = true, go } = {}) {
  let listening = false;
  const status = h('p', { class: 'voice-status' });
  const transcript = h('p', { class: 'voice-transcript' });
  const result = h('div', { class: 'voice-result' });
  const mic = h('button', { class: 'voice-mic', 'aria-label': 'Start listening' }, icon('mic', 34));
  const typed = h('input', { class: 'voice-typed', placeholder: 'Or type a command…', autocomplete: 'off', enterkeyhint: 'go', 'data-key': 'voice-typed' });
  const examples = h('div', { class: 'voice-examples' },
    h('p', { class: 'sub-head' }, 'Try saying'),
    h('div', { class: 'chips' }, EXAMPLES.map((ex) => h('button', { class: 'chip', onclick: () => run(ex) }, `“${ex}”`))));

  const setListening = (on) => {
    listening = on;
    mic.classList.toggle('on', on);
    mic.setAttribute('aria-label', on ? 'Stop listening' : 'Start listening');
    if (on) { status.textContent = 'Listening…'; transcript.textContent = ''; }
  };

  const run = (text) => {
    if (listening) { stopListening(); setListening(false); }
    transcript.textContent = `“${text}”`;
    examples.style.display = 'none';
    let res;
    try { res = execute(text); } catch (e) { console.error(e); res = { say: 'Something went wrong.', title: `Error: ${e.message}` }; }
    status.textContent = '';
    showResult(res);
    speak(res.say);
    if (res.go) setTimeout(() => { closeSheet(); go?.(res.go); }, 700);
  };

  const showResult = (res) => {
    const actions = [];
    if (res.undo) {
      actions.push(h('button', { class: 'btn ghost sm', onclick: () => { res.undo(); result.replaceChildren(h('p', { class: 'muted' }, 'Undone.')); speak('Undone.'); } }, 'Undo'));
    }
    if (res.news) actions.push(h('button', { class: 'btn ghost sm', onclick: () => { closeSheet(); go?.('news'); } }, 'Open News'));
    actions.push(h('button', { class: 'btn primary sm', onclick: start }, icon('mic', 16), 'Again'));
    result.replaceChildren(
      h('div', { class: 'voice-card' },
        h('p', { class: 'voice-title' }, res.title),
        res.sub ? h('p', { class: 'muted small' }, res.sub) : null,
        res.lines ? h('ul', { class: 'voice-lines' }, res.lines.map((l) => h('li', null, l))) : null,
        h('div', { class: 'btn-row' }, actions)));
  };

  const start = () => {
    if (listening) { stopListening(); return; }
    result.replaceChildren();
    if (!SR) {
      status.textContent = 'Voice input isn’t available in this browser. Type below, or tap the 🎤 on your keyboard to dictate.';
      typed.focus();
      return;
    }
    setListening(true);
    listen({
      onInterim: (tx) => { transcript.textContent = tx; },
      onFinal: (tx) => { setListening(false); run(tx); },
      onError: (m) => {
        setListening(false);
        status.textContent = m === 'unsupported'
          ? 'Voice input isn’t available here (on iPad/iPhone try it in Safari). You can type below or use the keyboard’s 🎤.'
          : m;
      },
      onEnd: () => { if (listening) setListening(false); },
    });
  };

  mic.addEventListener('click', start);
  typed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && typed.value.trim()) { e.preventDefault(); const v = typed.value.trim(); typed.value = ''; run(v); }
  });

  const panel = sheet('Voice', h('div', { class: 'voice' }, mic, status, transcript, result, typed, examples));
  panel.classList.add('voice-sheet');
  const obs = new MutationObserver(() => { if (!document.body.contains(panel)) { stopListening(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
  if (autoStart && SR) start();
  else if (!SR) status.textContent = 'Type a command below, or tap the 🎤 on your keyboard to dictate.';
}

export function isOpen() {
  return isSheetOpen() && Boolean(document.querySelector('.voice-sheet'));
}
