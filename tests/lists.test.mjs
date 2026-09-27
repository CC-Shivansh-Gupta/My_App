import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../app/js/store.js';
import * as D from '../app/js/dates.js';
import * as M from '../app/js/models.js';
import * as V from '../app/js/vices.js';
import { parseCommand, habitDays, isSoftTodo } from '../app/js/intents.js';
import { execute } from '../app/js/voice.js';

const B = '2026-09-25'; // Friday
const pc = (s) => parseCommand(s, B);
const ALL = [0, 1, 2, 3, 4, 5, 6];

test('habits to build, by voice', () => {
  assert.deepEqual(pc('add a habit to meditate'), { type: 'habit', name: 'Meditate', days: ALL });
  assert.deepEqual(pc('new habit read 20 pages on weekdays'), { type: 'habit', name: 'Read 20 pages', days: [1, 2, 3, 4, 5] });
  assert.deepEqual(pc('add habit gym on mon, wed and fri'), { type: 'habit', name: 'Gym', days: [1, 3, 5] });
  assert.deepEqual(pc('I want to build a habit of journaling every day'), { type: 'habit', name: 'Journaling', days: ALL });
  assert.deepEqual(pc('make reading a daily habit'), { type: 'habit', name: 'Reading', days: ALL });
  assert.deepEqual(pc('track drinking 2L water as a habit'), { type: 'habit', name: 'Drinking 2L water', days: ALL });
  assert.deepEqual(habitDays('long walk on weekends'), { name: 'Long walk', days: [0, 6] });
  assert.deepEqual(habitDays('swim every tuesday and thursday'), { name: 'Swim', days: [2, 4] });
  // Still what they were.
  assert.equal(pc('what are my habits').type, 'query');
  assert.equal(pc('I meditated').type, 'done');
});

test('habits to break, by voice', () => {
  assert.deepEqual(pc('I want to quit smoking'), { type: 'vice', name: 'Smoking' });
  assert.deepEqual(pc('help me stop doomscrolling'), { type: 'vice', name: 'Doomscrolling' });
  assert.deepEqual(pc('add bad habit junk food'), { type: 'vice', name: 'Junk food' });
  assert.deepEqual(pc('break the habit of snoozing'), { type: 'vice', name: 'Snoozing' });
  assert.equal(pc('stop tracking').type, 'track');
  assert.equal(pc('I need to stop by the bank').type, 'todo');
  assert.equal(pc('quit my job').type, 'todo');
  assert.equal(pc('I slipped on smoking').type, 'slip');
});

test('the general task list, and moving between it and today', () => {
  assert.deepEqual(pc('add buy shoes to my general tasks'), { type: 'task', title: 'Buy shoes', due: null, priority: 0, tag: null });
  assert.equal(pc('put fix the bike in my backlog').type, 'convert');
  assert.equal(pc('add call mom to my work tasks').headingHint, 'work');
  assert.deepEqual(pc('move buy shoes to tasks'), { type: 'convert', to: 'task', target: 'Buy shoes', all: false });
  assert.deepEqual(pc('shift buy shoes from today to general tasks'), { type: 'convert', to: 'task', target: 'Buy shoes', all: false });
  assert.deepEqual(pc('move everything left today to tasks'), { type: 'convert', to: 'task', target: '', all: true });
  assert.deepEqual(pc('make call the plumber a task'), { type: 'convert', to: 'task', target: 'Call the plumber', all: false });
  assert.equal(pc('move taxes to tasks under the Money heading').heading, 'Money');
  assert.deepEqual(pc("move report to today's list"), { type: 'convert', to: 'todo', target: 'Report', all: false, date: B });
  assert.equal(pc("move report to tomorrow's list").date, '2026-09-26');
  // Unchanged meanings.
  assert.equal(pc('move the dentist to tomorrow').type, 'move');
  assert.equal(pc('add pick up laundry to my to do list').type, 'todo');
  assert.equal(pc('add learn rust to my tasks').type, 'task');
  assert.equal(pc('push the code to production').type, 'todo');
  assert.deepEqual(pc('find report'), { type: 'query', what: 'find', text: 'report' });
});

test('soft to-dos: no day and no “remind me”', () => {
  assert.equal(isSoftTodo('buy milk'), true);
  assert.equal(isSoftTodo('fix the bike'), true);
  assert.equal(isSoftTodo('remind me to buy milk'), false);
  assert.equal(isSoftTodo('buy milk today'), false);
  assert.equal(isSoftTodo('call mom tomorrow'), false);
});

test('adding habits and habits to break', () => {
  store.reset();
  const r = execute('add a habit to read 20 pages on weekdays');
  const hb = M.habits()[0];
  assert.equal(hb.name, 'Read 20 pages');
  assert.equal(hb.emoji, '📖');
  assert.deepEqual(hb.days, [1, 2, 3, 4, 5]);
  assert.match(r.say, /weekdays/);
  assert.match(execute('new habit read 20 pages').say, /already track/);
  r.undo();
  assert.equal(M.habits().length, 0);

  const v = execute('I want to quit smoking');
  assert.equal(V.vices()[0].name, 'Smoking');
  assert.equal(V.vices()[0].emoji, '🚬');
  assert.equal(V.vices()[0].penalty, 25);
  v.undo();
  assert.equal(V.vices().length, 0);
});

test('a to-do moves to tasks and back onto today, with undo', () => {
  store.reset();
  const t = D.today();
  const work = M.addHeading('Work');
  store.put('todos', { title: 'Buy shoes', date: t, done: false });
  store.put('todos', { title: 'Email Sam', date: t, done: false });

  const r = execute('move buy shoes to work tasks');
  assert.equal(M.todosOn(t).length, 1);
  const task = M.openTasks()[0];
  assert.equal(task.title, 'Buy shoes');
  assert.equal(task.heading, work.id);
  assert.equal(task.due, null);
  r.undo();
  assert.equal(M.todosOn(t).length, 2);
  assert.equal(M.openTasks().length, 0);

  execute('move everything left today to tasks');
  assert.equal(M.todosOn(t).length, 0);
  assert.equal(M.openTasks().length, 2);

  const back = execute("move email sam to today's list");
  assert.equal(M.openTasks().find((x) => x.title === 'Email Sam').planned, t);
  assert.match(back.say, /today/);

  // Not on any list yet: “move X to tasks” just adds the task.
  execute('put renew passport in my backlog');
  assert.ok(M.openTasks().some((x) => x.title === 'Renew passport'));
});

test('a to-do reply offers “Move to Tasks”; the setting sends undated ones to Tasks', () => {
  store.reset();
  const t = D.today();
  const r = execute('buy milk');
  assert.equal(r.alt.label, 'Move to Tasks');
  r.alt.run();
  assert.equal(M.todosOn(t).length, 0);
  assert.equal(M.openTasks()[0].title, 'Buy milk');

  store.reset();
  store.setPref('undatedGoesTo', 'task');
  const s = execute('fix the bike');
  assert.equal(M.openTasks()[0].title, 'Fix the bike');
  assert.equal(s.alt.label, 'Today’s to-do instead');
  execute('remind me to call mom');
  assert.equal(M.todosOn(t)[0].title, 'Call mom');
});

test('find shows which list something is on', () => {
  store.reset();
  M.addTask({ title: 'Quarterly report' });
  M.addHabit({ name: 'Read 20 pages' });
  const r = execute('find report');
  assert.ok(r.lines.some((l) => l.startsWith('Task: Quarterly report')));
  assert.equal(execute('find unicorns').miss, true);
});
