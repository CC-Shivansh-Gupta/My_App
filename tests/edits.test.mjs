import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../app/js/store.js';
import * as D from '../app/js/dates.js';
import { parseCommand } from '../app/js/intents.js';
import { execute } from '../app/js/voice.js';

const B = '2026-09-25'; // Friday
const pc = (s) => parseCommand(s, B);

test('parsing changes, deletes and knowledge-base captures', () => {
  assert.deepEqual(pc('move the dentist appointment to Friday at 4pm'), { type: 'move', target: 'Dentist', kind: 'event', to: '2026-10-02', time: '16:00', endTime: null, days: null });
  assert.deepEqual(pc('push call the bank to tomorrow'), { type: 'move', target: 'Call the bank', kind: null, to: '2026-09-26', time: null, endTime: null, days: null });
  assert.equal(pc('change the due date of task quarterly report to Monday').to, '2026-09-28');
  assert.equal(pc('move report by a week').days, 7);
  assert.equal(pc('postpone the report').days, 1);
  assert.deepEqual(pc('cancel standup tomorrow'), { type: 'delete', target: 'Standup', kind: null, on: '2026-09-26', all: false, orTodo: 'Cancel standup tomorrow' });
  assert.deepEqual(pc('remove milk from my list'), { type: 'delete', target: 'Milk', kind: 'todo', on: null, all: false });
  assert.equal(pc('delete all standup').all, true);
  assert.deepEqual(pc('make the report high priority'), { type: 'priority', target: 'Report', kind: null, priority: 3 });
  assert.deepEqual(pc('rename task report to Q3 report'), { type: 'rename', target: 'Report', kind: 'task', title: 'Q3 report' });
  assert.deepEqual(pc('add to my knowledge base: spaced repetition works best at growing intervals'), { type: 'knowledge', text: 'Spaced repetition works best at growing intervals' });
  assert.equal(pc('save compound interest notes to my second brain').type, 'knowledge');
  // Everyday phrases that must keep their old meaning.
  assert.equal(pc('take out the trash tomorrow').type, 'todo');
  assert.equal(pc('drop off the kids at school').type, 'todo');
  assert.equal(pc('remind me to move the car tomorrow').type, 'todo');
  assert.equal(pc('set a goal to read 24 books this year').type, 'goal');
  assert.equal(pc('mark exercise done').type, 'done');
  assert.equal(pc('push the code to production').type, 'todo');
});

test('moving an event, a to-do and a task (with undo)', async () => {
  store.reset();
  const t = D.today();
  const ev = store.put('events', { title: 'Dentist', date: t, time: '15:00', endTime: '16:00', repeat: 'none', allDay: false });
  const td = store.put('todos', { title: 'Call the bank', date: t, done: false });
  const tk = store.put('tasks', { title: 'Quarterly report', due: t, done: false, priority: 0 });

  const r1 = await execute('move the dentist to tomorrow at 5pm');
  assert.deepEqual([store.get('events', ev.id).date, store.get('events', ev.id).time, store.get('events', ev.id).endTime], [D.addDays(t, 1), '17:00', '18:00']);
  r1.undo();
  assert.deepEqual([store.get('events', ev.id).date, store.get('events', ev.id).time], [t, '15:00']);

  await execute('push call the bank to tomorrow');
  assert.equal(store.get('todos', td.id).date, D.addDays(t, 1));
  await execute('postpone the quarterly report');
  assert.equal(store.get('tasks', tk.id).due, D.addDays(t, 1));
  const miss = await execute('move the unicorn meeting to friday');
  assert.equal(miss.miss, true);
});

test('a repeating event: move or cancel one occurrence, or delete the series', async () => {
  store.reset();
  const t = D.today();
  const ev = store.put('events', { title: 'Standup', date: D.addDays(t, -7), time: '09:30', repeat: 'daily', allDay: false });
  await execute('move standup to 11am');
  assert.deepEqual(store.get('events', ev.id).skip, [t]);
  const one = store.all('events').find((e) => e.id !== ev.id);
  assert.deepEqual([one.date, one.time, one.repeat], [t, '11:00', 'none']);

  const c = await execute('cancel standup tomorrow');
  assert.deepEqual(store.get('events', ev.id).skip, [t, D.addDays(t, 1)]);
  c.undo();
  assert.deepEqual(store.get('events', ev.id).skip, [t]);

  const d = await execute('delete all standup');
  assert.equal(store.get('events', ev.id), null);
  d.undo();
  assert.ok(store.get('events', ev.id));
});

test('delete, rename and prioritise, all undoable', async () => {
  store.reset();
  const t = D.today();
  const td = store.put('todos', { title: 'Buy milk', date: t, done: false });
  const tk = store.put('tasks', { title: 'Report', due: null, done: false, priority: 0 });
  const del = await execute('remove milk from my list');
  assert.equal(store.get('todos', td.id), null);
  del.undo();
  assert.equal(store.get('todos', td.id).title, 'Buy milk');
  await execute('rename task report to Q3 report');
  assert.equal(store.get('tasks', tk.id).title, 'Q3 report');
  const p = await execute('make the Q3 report high priority');
  assert.equal(store.get('tasks', tk.id).priority, 3);
  p.undo();
  assert.equal(store.get('tasks', tk.id).priority, 0);
  // "cancel my gym membership" with nothing by that name is a to-do.
  const c = await execute('cancel my gym membership');
  assert.match(c.title, /To-do: Cancel my gym membership/);
});

test('knowledge base without a connected vault becomes a note on the map', async () => {
  store.reset();
  const r = await execute('add to my knowledge base: compounding needs time more than rate');
  assert.match(r.title, /knowledge map/);
  assert.equal(store.all('notes')[0].text, 'Compounding needs time more than rate');
});
