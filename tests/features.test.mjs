import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../app/js/store.js';
import { levelFor, summary, quests, achievements } from '../app/js/gamify.js';
import { parseDuration, fmtMin } from '../app/js/views/screen.js';
import { segmentsOn, parseLog, guessCategory } from '../app/js/views/routine.js';
import { parseGoalText } from '../app/js/views/goals.js';
import * as D from '../app/js/dates.js';

test('level curve', () => {
  assert.equal(levelFor(0).level, 1);
  assert.equal(levelFor(49).level, 1);
  assert.equal(levelFor(50).level, 2);
  assert.equal(levelFor(4050).level, 10);
  assert.equal(levelFor(800).rank, 'Apprentice');
});

test('XP is derived from data', () => {
  store.reset();
  const t = D.today();
  store.put('todos', { title: 'x', date: t, done: true, doneAt: Date.now() });
  store.put('reading', { title: 'Book', type: 'book', status: 'done', finishedAt: t });
  const s = summary();
  assert.equal(s.total, 55);
  assert.equal(s.attrs.dis, 5);
  assert.equal(s.attrs.int, 50);
  assert.equal(s.streak, 1);
  assert.equal(quests().length, 3);
  assert.ok(achievements(s).find((a) => a.id === 'book1').done);
});

test('screen time durations', () => {
  assert.equal(parseDuration('3h 20m'), 200);
  assert.equal(parseDuration('3:20'), 200);
  assert.equal(parseDuration('3.5'), 210);
  assert.equal(parseDuration('200'), 200);
  assert.equal(parseDuration('3 hours 20 minutes'), 200);
  assert.equal(parseDuration('45m'), 45);
  assert.equal(parseDuration('abc'), null);
  assert.equal(fmtMin(200), '3h 20m');
});

test('routine blocks across midnight', () => {
  store.reset();
  store.put('routine', { title: 'Sleep', start: '22:30', end: '06:30', days: [0, 1, 2, 3, 4, 5, 6], category: 'sleep' });
  store.put('routine', { title: 'Work', start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5], category: 'work' });
  const fri = '2026-09-25';
  const segs = segmentsOn(fri).map((s) => [s.block.title, s.from, s.to]);
  assert.deepEqual(segs, [['Sleep', 0, 390], ['Work', 540, 1020], ['Sleep', 1350, 1440]]);
  assert.equal(segmentsOn('2026-09-26').filter((s) => s.block.title === 'Work').length, 0);
});

test('day tracker parsing', () => {
  assert.deepEqual(parseLog('9-11am deep work', '2026-09-25'), { running: false, date: '2026-09-25', start: '09:00', end: '11:00', title: 'deep work', category: 'work' });
  assert.equal(parseLog('reading').running, true);
  assert.equal(guessCategory('lunch with Sam'), 'meals');
  assert.equal(guessCategory('gym'), 'exercise');
});

test('goal text', () => {
  assert.deepEqual(parseGoalText('Save 20,000'), { title: 'Save 20,000', mode: 'number', target: 20000, current: 0, unit: '' });
  assert.equal(parseGoalText('Read 24 books').unit, 'books');
  assert.equal(parseGoalText('Learn to swim').mode, 'check');
});
