import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../app/js/store.js';
import * as mem from '../app/js/jarvis/memory.js';
import { createJarvis, rulesConfident, parseReply, buildMessages, safeToLearn } from '../app/js/jarvis/core.js';
import { snapshot, related } from '../app/js/jarvis/context.js';
import { wakeRegex } from '../app/js/jarvis/wake.js';
import { parseCommand } from '../app/js/intents.js';
import * as D from '../app/js/dates.js';
import * as asks from '../app/js/jarvis/asks.js';

// A stand-in for voice.execute: records what ran and can be undone.
function fakeApp() {
  const ran = [];
  const undone = [];
  const execute = (cmd) => {
    const it = parseCommand(cmd);
    ran.push(cmd);
    if (it.type === 'query') return { say: `Answer to ${cmd}`, title: 'Answer', answer: true };
    if (it.type === 'done') return { say: `I couldn’t find ${it.target}.`, title: 'No match', miss: true };
    return { say: `Did: ${cmd}.`, title: `${it.type}: ${cmd}`, undo: () => undone.push(cmd) };
  };
  return { ran, undone, execute };
}

function fakeLLM(replies) {
  const calls = [];
  return {
    calls,
    engines: () => ['local'],
    chat: async (engine, messages) => {
      calls.push(messages);
      const r = typeof replies === 'function' ? replies(messages.at(-1).content) : replies.shift();
      if (r instanceof Error) throw r;
      return { text: typeof r === 'string' ? r : JSON.stringify(r), tokens: 100, model: 'Test 1B' };
    },
  };
}

const NOW = () => new Date(2026, 8, 26, 10, 0);

test('the rules handle clear commands; the AI gets chat, advice and messy requests', () => {
  for (const s of ['buy milk', 'remind me to call mom tomorrow', 'spent 250 on lunch', 'what’s on tomorrow', 'schedule dentist friday at 3pm',
    'add task write the report', 'add task plan the trip', 'reschedule standup to 10am', 'move the dentist to friday at 4', 'cancel standup tomorrow', 'add to my second brain: ideas compound', 'I meditated', 'open calendar', 'call the bank', 'how much did I spend this month']) {
    assert.equal(rulesConfident(s), true, s);
  }
  for (const s of ['I’m feeling really tired today', 'what is the capital of France?', 'plan my evening', 'should I go to the gym today?',
    'help me prioritize my tasks', 'my knee hurts after running so maybe skip legs', 'why am I always over budget', 'tell me a joke']) {
    assert.equal(rulesConfident(s), false, s);
  }
});

test('AI replies are read tolerantly', () => {
  assert.deepEqual(parseReply('```json\n{"say":"Done","do":["buy milk"],"remember":[],"ask":""}\n```'), { say: 'Done', do: ['buy milk'], remember: [], ask: '' });
  assert.deepEqual(parseReply('<think>hmm</think>{"say":"Hi","do":"open news"}'), { say: 'Hi', do: ['open news'], remember: [], ask: '' });
  assert.equal(parseReply('Paris is the capital of France.').say, 'Paris is the capital of France.');
  assert.equal(parseReply(''), null);
  assert.equal(parseReply('{"say": "x", "do": [1,2,3,4,5,6,7,8]}').do.length, 6);
});

test('only replay-safe AI answers are learned', () => {
  assert.equal(safeToLearn('need oat milk', ['remind me to buy oat milk']), true);
  assert.equal(safeToLearn('lunch was pricey', ['spent 450 on lunch']), false); // made-up amount
  assert.equal(safeToLearn('dentist', ['schedule dentist on 2026-10-01 at 3pm']), false);
  assert.equal(safeToLearn('what do I have', ['what’s on today']), false); // answers change, so don't cache
});

test('memory: remember, update, recall, forget', () => {
  store.reset();
  mem.remember('my wife’s birthday is 12 March');
  mem.remember('I go to the gym at 7 am');
  assert.equal(mem.facts().length, 2);
  mem.remember('I go to the gym at 6 am'); // same subject → replaced
  assert.equal(mem.facts().length, 2);
  assert.ok(mem.facts().some((f) => /6 am/.test(f.text)) && !mem.facts().some((f) => /7 am/.test(f.text)));
  assert.match(mem.recall('when is my wife’s birthday?').text, /12 March/);
  assert.equal(mem.recall('what is the weather?'), null);
  assert.equal(mem.relevant('birthday present ideas', 1)[0].text, 'My wife’s birthday is 12 March');
  assert.match(mem.forget('wife birthday').text, /12 March/);
  assert.equal(mem.facts().length, 1);
});

test('teaching phrases', () => {
  assert.deepEqual(mem.parseTeach('When I say good night, stop tracking and brief me for tomorrow'), { phrase: 'good night', commands: ['stop tracking', 'brief me for tomorrow'] });
  assert.deepEqual(mem.parseTeach('whenever I say "movie night" add popcorn and chips to my list then open watch list'), { phrase: 'movie night', commands: ['add popcorn and chips to my list', 'open watch list'] });
  assert.deepEqual(mem.parseTeach('teach: gym time means start push workout'), { phrase: 'gym time', commands: ['start push workout'] });
  assert.equal(mem.parseTeach('remind me to buy milk'), null);
  store.reset();
  mem.teach('Good night!', ['stop tracking']);
  assert.ok(mem.findSkill('hey jarvis, good night'));
  assert.ok(mem.findSkill('night good'));
  assert.equal(mem.findSkill('good morning'), null);
});

test('rules first: no AI call for a clear command', async () => {
  store.reset();
  const app = fakeApp();
  const llm = fakeLLM([]);
  const J = createJarvis({ execute: app.execute, llm, now: NOW });
  const r = await J.handle('Jarvis, remind me to call the bank tomorrow');
  assert.equal(r.via, 'rules');
  assert.deepEqual(app.ran, ['remind me to call the bank tomorrow']);
  assert.equal(llm.calls.length, 0);
  assert.equal(mem.usage(D.toStr(NOW())).rules, 1);
});

test('the AI handles a messy request, and the phrase is learned for next time', async () => {
  store.reset();
  const app = fakeApp();
  const llm = fakeLLM([{ say: 'On it — oat milk and eggs.', do: ['remind me to buy oat milk', 'remind me to buy eggs'], remember: [], ask: '' }]);
  const J = createJarvis({ execute: app.execute, llm, now: NOW, snapshot: () => 'Calendar today: nothing.' });
  const r = await J.handle('ugh we are out of oat milk and eggs again');
  assert.equal(r.via, 'local');
  assert.equal(r.say, 'On it — oat milk and eggs.');
  assert.deepEqual(app.ran, ['remind me to buy oat milk', 'remind me to buy eggs']);
  assert.equal(r.learned.source, 'learned');
  assert.match(llm.calls[0][0].content, /Calendar today: nothing/);

  const again = await J.handle('Ugh, we are out of oat milk and eggs again!');
  assert.equal(again.via, 'skill');
  assert.equal(llm.calls.length, 1); // no second AI call
  assert.equal(mem.usage(D.toStr(NOW())).skill, 1);
});

test('undo forgets a wrong guess, and what you meant is learned instead', async () => {
  store.reset();
  const app = fakeApp();
  const llm = fakeLLM([{ say: 'Added.', do: ['add task sort out the car'] }]);
  const J = createJarvis({ execute: app.execute, llm, now: NOW });
  const first = await J.handle('honestly the car has been making weird noises for days');
  assert.ok(first.learned);
  const u = await J.handle('undo');
  assert.equal(u.title, 'Undone');
  assert.deepEqual(app.undone, ['add task sort out the car']);
  assert.equal(mem.skills().length, 0);
  const fix = await J.handle('schedule car service saturday at 10am');
  assert.equal(fix.via, 'rules');
  assert.equal(fix.learned.source, 'corrected');
  const later = await J.handle('honestly the car has been making weird noises for days');
  assert.equal(later.via, 'skill');
  assert.equal(app.ran.at(-1), 'schedule car service saturday at 10am');
});

test('“no, I meant …” corrects the last action in one go', async () => {
  store.reset();
  const app = fakeApp();
  const J = createJarvis({ execute: app.execute, now: NOW });
  await J.handle('call mom at 6'); // rules read this as an event
  const r = await J.handle('no, I meant remind me to call mom');
  assert.equal(app.undone.length, 1);
  assert.equal(r.learned.source, 'corrected');
  assert.deepEqual(mem.findSkill('call mom at 6').commands, ['remind me to call mom']);
  // A sentence that merely starts with "no" is not a correction.
  const n = await J.handle('no sugar in my coffee from now on');
  assert.equal(app.undone.length, 1);
  assert.notEqual(n.title, 'Undone');
});

test('memory and teaching through conversation, without any AI', async () => {
  store.reset();
  const app = fakeApp();
  const llm = fakeLLM([]);
  const J = createJarvis({ execute: app.execute, llm, now: NOW });
  assert.equal((await J.handle('remember that my sister Priya lives in Pune')).via, 'memory');
  const a = await J.handle('where does Priya live?');
  assert.equal(a.via, 'memory');
  assert.match(a.say, /Pune/);
  const t = await J.handle('when I say good night, stop tracking and brief me for tomorrow');
  assert.equal(t.via, 'skill');
  const g = await J.handle('good night');
  assert.deepEqual(app.ran, ['stop tracking', 'brief me for tomorrow']);
  assert.equal(g.via, 'skill');
  assert.equal(llm.calls.length, 0);
  const n = await J.handle('call me Tony');
  assert.match(n.say, /Tony/);
});

test('the AI answers questions, remembers facts and asks back', async () => {
  store.reset();
  const app = fakeApp();
  const llm = fakeLLM([{ say: 'Take a short walk first — you have nothing until 3.', do: [], remember: ['Prefers walks to clear their head'], ask: '' },
    { say: 'Sure.', do: [], ask: 'What time should I set it for?' }]);
  const J = createJarvis({ execute: app.execute, llm, now: NOW });
  const r = await J.handle('I’m feeling lazy, what should I do first?');
  assert.equal(r.chat, true);
  assert.equal(app.ran.length, 0);
  assert.deepEqual(mem.facts().map((f) => f.text), ['Prefers walks to clear their head']);
  const q = await J.handle('can you set something up for my mum’s call');
  assert.equal(q.ask, true);
  assert.match(q.say, /What time/);
  // The conversation so far is passed back to the model.
  assert.ok(llm.calls[1].some((m) => m.role === 'assistant'));
});

test('falls back to the next engine, then to the rules, when the AI fails', async () => {
  store.reset();
  const app = fakeApp();
  let n = 0;
  const llm = {
    engines: () => ['local', 'cloud'],
    chat: async (engine) => { n++; if (engine === 'local') throw new Error('GPU lost'); return { text: '{"say":"Hi from the cloud","do":[]}', tokens: 50, model: 'x' }; },
  };
  const J = createJarvis({ execute: app.execute, llm, now: NOW });
  const r = await J.handle('tell me something nice');
  assert.equal(r.via, 'cloud');
  assert.equal(n, 2);
  const broken = createJarvis({ execute: app.execute, llm: { engines: () => ['cloud'], chat: async () => { throw new Error('offline'); } }, now: NOW });
  const f = await broken.handle('I’m out of coffee');
  assert.equal(f.via, 'rules');
  assert.match(f.sub, /AI unavailable/);
});

test('no AI at all: behaves like the old voice assistant', async () => {
  store.reset();
  const app = fakeApp();
  const J = createJarvis({ execute: app.execute, now: NOW });
  const r = await J.handle('plan my evening');
  assert.equal(r.via, 'rules');
  assert.deepEqual(app.ran, ['plan my evening']);
  // …except that a question isn't turned into a to-do unless you ask for that.
  const q = await J.handle('what is the meaning of life?');
  assert.match(q.say, /AI brain/);
  assert.equal(app.ran.length, 1);
  // …it offers to ask Claude (through the agent) instead.
  const queued = q.alt.run();
  assert.equal(queued.title, '✳️ Queued for Claude');
  assert.deepEqual(asks.pending().map((a) => a.text), ['what is the meaning of life?']);
  assert.equal(app.ran.length, 1);
});

test('prompt carries memory, notes and taught examples', () => {
  const msgs = buildMessages({ text: 'hi', name: 'Friday', user: 'Tony', date: '2026-09-26', time: '10:00', snapshot: 'Money: spent ₹0 today.',
    facts: ['Allergic to peanuts'], related: ['Note: gate code 4512'], examples: [{ phrase: 'gym time', commands: ['start push workout'] }] });
  const sys = msgs[0].content;
  assert.match(sys, /You are Friday, Tony's personal assistant/);
  assert.match(sys, /Saturday 2026-09-26/);
  assert.match(sys, /Allergic to peanuts/);
  assert.match(sys, /gate code 4512/);
  assert.match(sys, /"gym time" → \["start push workout"\]/);
  assert.equal(msgs.at(-1).content, 'hi');
});

test('the data snapshot is short and covers the day', () => {
  store.reset();
  const t = D.today();
  store.put('events', { title: 'Standup', date: t, time: '09:30', repeat: 'none' });
  store.put('todos', { title: 'Buy milk', date: t, done: false });
  store.put('tasks', { title: 'File taxes', due: D.addDays(t, -2), done: false, priority: 3 });
  store.put('habits', { name: 'Meditate', createdAt: Date.now() - 86400000 * 5 });
  store.put('expenses', { amount: 250, note: 'lunch', category: 'Food', date: t });
  store.put('notes', { text: 'Wifi password for the cabin is pinecone42' });
  const s = snapshot(t, new Date());
  assert.match(s, /Standup/);
  assert.match(s, /Buy milk/);
  assert.match(s, /Overdue: File taxes/);
  assert.match(s, /Meditate not done/);
  assert.match(s, /250 today/);
  assert.ok(s.length < 1500);
  assert.match(related('what is the cabin wifi password')[0], /pinecone42/);
});

test('wake word', () => {
  assert.equal('hey jarvis add milk to my list'.match(wakeRegex())[1], 'add milk to my list');
  assert.equal('Travis, what’s on today'.match(wakeRegex())[1], 'what’s on today');
  assert.equal('Friday open calendar'.match(wakeRegex('Friday'))[1], 'open calendar');
  assert.equal('I like jars'.match(wakeRegex()), null);
});

test('usage totals show how much was free', () => {
  store.reset();
  mem.bump('2026-09-25', { rules: 3, tokens: 0 });
  mem.bump('2026-09-26', { skill: 1, local: 1, tokens: 400 });
  const t = mem.totals('2026-09-01');
  assert.equal(t.total, 5);
  assert.equal(t.free, 4);
  assert.equal(t.tokens, 400);
});

test('a shared WhatsApp message: the AI adds what it asks; without AI it becomes a note with an offer', async () => {
  store.reset();
  const app = fakeApp();
  const llm = fakeLLM((prompt) => {
    assert.match(prompt, /Dinner at mine Friday 8pm/);
    return { say: 'Added dinner on Friday at 8.', do: ['schedule dinner at Riya’s friday at 8pm'] };
  });
  const J = createJarvis({ execute: app.execute, llm, now: NOW });
  const r = await J.handleShared('Riya: Dinner at mine Friday 8pm? Bring dessert 🍰');
  assert.equal(r.via, 'local');
  assert.deepEqual(app.ran, ['schedule dinner at Riya’s friday at 8pm']);
  assert.equal(mem.skills().length, 0, 'shared messages are never learned as phrases');

  const plain = fakeApp();
  const noAI = createJarvis({ execute: plain.execute, now: NOW });
  const n = await noAI.handleShared('Team sync moved to Monday 4 pm, same link');
  assert.equal(plain.ran[0], 'note: Team sync moved to Monday 4 pm, same link');
  assert.match(n.say, /want it on your calendar/);
  assert.equal(n.alt.keep, true);
  await n.alt.run();
  assert.match(plain.ran[1], /^schedule Team sync moved on \d{4}-\d{2}-\d{2} at 16:00$/);
});

test('the agent loop: a miss goes back to the AI, which fixes it', async () => {
  store.reset();
  const app = fakeApp();
  const llm = fakeLLM([
    { say: 'Ticking it off.', do: ['mark meditation done'] },                     // "done" misses in fakeApp
    { say: 'You had no meditation habit, so I made one.', do: ['add habit meditate'] },
  ]);
  const J = createJarvis({ execute: app.execute, llm, now: NOW });
  const r = await J.handle('ugh finally got my meditation in for the day');
  assert.deepEqual(app.ran, ['mark meditation done', 'add habit meditate']);
  assert.equal(llm.calls.length, 2);
  assert.match(llm.calls[1].at(-1).content, /^Results:\n✗ mark meditation done/);
  assert.equal(r.miss, false);
  assert.equal(r.steps, 2);
  assert.equal(r.learned, undefined); // multi-step answers depend on the moment: not replayed
});

test('the agent loop: it looks something up, then answers from it', async () => {
  store.reset();
  const app = fakeApp();
  const llm = fakeLLM([
    { say: 'Let me check.', do: ["what's on tomorrow"] },
    { say: 'Tomorrow is clear, so the gym at 7 works.', do: [] },
  ]);
  const J = createJarvis({ execute: app.execute, llm, now: NOW });
  const r = await J.handle('should I plan the gym tomorrow morning or is my day packed');
  assert.equal(r.say, 'Tomorrow is clear, so the gym at 7 works.');
  assert.match(llm.calls[1].at(-1).content, /Answer to what's on tomorrow/);
  // A plain success needs no second call.
  const one = fakeLLM([{ say: 'Added.', do: ['remind me to buy eggs'] }]);
  await createJarvis({ execute: fakeApp().execute, llm: one, now: NOW }).handle('we are totally out of eggs again ugh');
  assert.equal(one.calls.length, 1);
});

test('the loop stops after MAX_STEPS calls', async () => {
  store.reset();
  const llm = fakeLLM(() => ({ say: 'Trying.', do: [`mark thing ${Math.random()} done`] }));
  await createJarvis({ execute: fakeApp().execute, llm, now: NOW }).handle('tick off the thing i did earlier somehow');
  assert.equal(llm.calls.length, 3);
});

test('“ask Claude …” queues for the agent; an approved answer runs its commands', async () => {
  store.reset();
  const app = fakeApp();
  const llm = fakeLLM([]);
  const J = createJarvis({ execute: app.execute, llm, now: NOW, snapshot: () => 'Open tasks: 12' });
  const q = await J.handle('ask Claude to sort my tasks into headings');
  assert.equal(q.via, 'claude');
  assert.equal(llm.calls.length, 0);
  const [a] = asks.pending();
  assert.equal(a.text, 'sort my tasks into headings');
  assert.equal(app.ran.length, 0);

  asks.answer(a, { say: 'Grouped them.', commands: ['add task plan trip under Travel heading'], model: 'Claude' });
  assert.equal(asks.answered().length, 1);
  const res = await J.applyAnswer(asks.answered()[0]);
  assert.deepEqual(app.ran, ['add task plan trip under Travel heading']);
  assert.equal(res.via, 'claude');
  assert.equal(asks.answered().length, 0);
  assert.equal(store.all('jarvisAsks')[0].status, 'done');
});

test('new commands count as clearly understood', () => {
  for (const s of ['move buy shoes to tasks', 'add a habit to meditate', 'I want to quit smoking', 'find report', 'add buy shoes to my general tasks']) {
    assert.equal(rulesConfident(s), true, s);
  }
});

test('ways to ask Claude', async () => {
  store.reset();
  const J = createJarvis({ execute: fakeApp().execute, now: NOW });
  for (const s of ['Claude, plan my week', 'ask Claude to review my month', 'have Claude sort my tasks', 'send this to Claude: what should I focus on']) {
    assert.equal((await J.handle(s)).via, 'claude', s);
  }
  assert.deepEqual(asks.pending().map((a) => a.text), ['plan my week', 'review my month', 'sort my tasks', 'what should I focus on']);
});
