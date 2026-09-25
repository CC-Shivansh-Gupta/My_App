import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand as p, wordsToDigits, bestMatch } from '../app/js/intents.js';

const B = '2026-09-25'; // Friday
const pc = (s) => p(s, B);

test('numbers spoken as words', () => {
  assert.equal(wordsToDigits('spent two hundred and fifty on lunch'), 'spent 250 on lunch');
  assert.equal(wordsToDigits('paid a thousand for rent'), 'paid 1000 for rent');
  assert.equal(wordsToDigits('twenty five'), '25');
  assert.equal(wordsToDigits('5k on flights'), '5000 on flights');
  assert.equal(wordsToDigits('read one book'), 'read 1 book');
});

test('to-dos', () => {
  assert.deepEqual(pc('Remind me to call the bank tomorrow'), { type: 'todo', title: 'Call the bank', date: '2026-09-26' });
  assert.deepEqual(pc('buy milk'), { type: 'todo', title: 'Buy milk', date: B });
  assert.deepEqual(pc('add pick up laundry to my to do list'), { type: 'todo', title: 'Pick up laundry', date: B });
  assert.deepEqual(pc('I need to renew my passport on Monday'), { type: 'todo', title: 'Renew my passport', date: '2026-09-28' });
  assert.deepEqual(pc('Hey, can you remind me to water the plants please'), { type: 'todo', title: 'Water the plants', date: B });
});

test('tasks', () => {
  assert.deepEqual(pc('add task finish the quarterly report by friday'), { type: 'task', title: 'Finish the quarterly report', due: '2026-10-02', priority: 0, tag: null });
  assert.deepEqual(pc('new task file taxes, it\'s urgent'), { type: 'task', title: 'File taxes', due: null, priority: 3, tag: null });
  assert.equal(pc('add learn rust to my tasks').title, 'Learn rust');
});

test('events', () => {
  assert.deepEqual(pc('schedule dentist tomorrow at 3 p.m.'), { type: 'event', title: 'Dentist', date: '2026-09-26', time: '15:00', endTime: null });
  assert.deepEqual(pc('meeting with Priya on Monday at 10:30 a.m.'), { type: 'event', title: 'Meeting with Priya', date: '2026-09-28', time: '10:30', endTime: null });
  assert.deepEqual(pc('Add yoga class Saturday 7 to 8 am to my calendar'), { type: 'event', title: 'Yoga class', date: '2026-09-26', time: '07:00', endTime: '08:00' });
  assert.equal(pc('coffee with Sam at 4pm').type, 'event');
});

test('expenses', () => {
  assert.deepEqual(pc('spent 250 on lunch'), { type: 'expense', amount: 250, note: 'lunch', date: B, category: null });
  assert.deepEqual(pc('I paid 1,200 rupees for groceries yesterday'), { type: 'expense', amount: 1200, note: 'groceries', date: '2026-09-24', category: null });
  assert.deepEqual(pc('spent two hundred and fifty on an uber'), { type: 'expense', amount: 250, note: 'uber', date: B, category: null });
  assert.deepEqual(pc('bought coffee for 120'), { type: 'expense', amount: 120, note: 'coffee', date: B, category: null });
  assert.equal(pc('₹499 netflix').amount, 499);
  assert.equal(pc('250 lunch').type, 'expense');
});

test('notes', () => {
  assert.deepEqual(pc('take a note the wifi password is sunflower'), { type: 'note', text: 'The wifi password is sunflower' });
  assert.deepEqual(pc('Note: ideas for the Goa trip, scuba diving and a spice farm'), { type: 'note', text: 'Ideas for the Goa trip, scuba diving and a spice farm' });
  assert.equal(pc('remember that Sam owes me 500').type, 'note');
});

test('reading', () => {
  assert.deepEqual(pc('add the book Deep Work by Cal Newport'), { type: 'reading', title: 'Deep Work', author: 'Cal Newport', kind: 'book', status: 'toread' });
  assert.equal(pc('add Sapiens to my reading list').title, 'Sapiens');
  assert.deepEqual(pc('I finished reading atomic habits'), { type: 'finishReading', target: 'Atomic habits' });
  assert.equal(pc("I'm reading The Hobbit").status, 'reading');
});

test('done', () => {
  assert.deepEqual(pc('mark exercise as done'), { type: 'done', target: 'exercise', date: B, strict: true });
  assert.deepEqual(pc('I meditated'), { type: 'done', target: 'meditated', date: B, strict: false });
  assert.equal(pc('I read 20 pages yesterday').date, '2026-09-24');
  assert.equal(pc('check off buy groceries').target, 'buy groceries');
});

test('questions', () => {
  assert.deepEqual(pc("what's on my calendar tomorrow"), { type: 'query', what: 'agenda', date: '2026-09-26' });
  assert.deepEqual(pc('what do I have today'), { type: 'query', what: 'agenda', date: B });
  assert.deepEqual(pc('how much did I spend this month'), { type: 'query', what: 'spend', period: 'month', category: null });
  assert.deepEqual(pc('how much have I spent on food this week'), { type: 'query', what: 'spend', period: 'week', category: 'food' });
  assert.equal(pc('what are my to dos').what, 'todos');
  assert.equal(pc('which habits are left').what, 'habits');
  assert.equal(pc('any new papers?').what, 'news');
  assert.equal(pc('brief me').what, 'brief');
  assert.equal(pc('how does my day look').what, 'brief');
});

test('navigation', () => {
  assert.deepEqual(pc('open calendar'), { type: 'navigate', route: 'calendar' });
  assert.deepEqual(pc('show me my notes'), { type: 'navigate', route: 'notes' });
  assert.deepEqual(pc('go to the expenses page'), { type: 'navigate', route: 'money' });
});

test('fuzzy habit matching', () => {
  const habits = [{ name: 'Meditate' }, { name: 'Read 20 pages' }, { name: 'Exercise' }, { name: 'Drink 2L water' }];
  const n = (x) => x.name;
  assert.equal(bestMatch('meditated', habits, n)?.name, 'Meditate');
  assert.equal(bestMatch('read 20 pages', habits, n)?.name, 'Read 20 pages');
  assert.equal(bestMatch('went to the gym', habits, n)?.name, 'Exercise');
  assert.equal(bestMatch('drank water', habits, n)?.name, 'Drink 2L water');
  assert.equal(bestMatch('called mom', habits, n), null);
});

test('gym and goals', () => {
  assert.deepEqual(pc('start push workout'), { type: 'startWorkout', name: 'push' });
  assert.deepEqual(pc('start a workout'), { type: 'startWorkout', name: null });
  assert.deepEqual(pc("let's start leg day"), { type: 'startWorkout', name: 'leg' });
  assert.deepEqual(pc('log my weight 72.5 kg'), { type: 'bodyweight', value: 72.5 });
  assert.deepEqual(pc('I weigh 160 pounds'), { type: 'bodyweight', value: 160 });
  assert.deepEqual(pc('set a goal to read 24 books this year'), { type: 'goal', title: 'Read 24 books', horizon: 'year', next: false });
  assert.deepEqual(pc('life goal: visit Japan'), { type: 'goal', title: 'Visit Japan', horizon: 'life', next: false });
  assert.deepEqual(pc('monthly goal save 20000'), { type: 'goal', title: 'Save 20000', horizon: 'month', next: false });
  assert.deepEqual(pc('goal for next month run 50 km'), { type: 'goal', title: 'Run 50 km', horizon: 'month', next: true });
  assert.equal(pc('my yearly goal is to learn Spanish').horizon, 'year');
});

test('task headings', () => {
  assert.deepEqual(pc('add task book flights under trip heading'), { type: 'task', title: 'Book flights', due: null, priority: 0, tag: null, heading: 'trip' });
  assert.equal(pc('add call plumber under the home section').heading, 'home');
  assert.equal(pc('what are my goals').what, 'goals');
});

test('learnings, watch list, day tracker, screen time', () => {
  assert.deepEqual(pc('TIL compound interest beats timing the market'), { type: 'learning', text: 'Compound interest beats timing the market', kind: 'insight' });
  assert.equal(pc('lesson: never skip the warm up').kind, 'lesson');
  assert.deepEqual(pc('I learned that sleep improves memory'), { type: 'learning', text: 'Sleep improves memory', kind: 'insight' });
  assert.deepEqual(pc('add Dune to my watch list'), { type: 'watch', title: 'Dune', kind: null });
  assert.deepEqual(pc('add the show Severance'), { type: 'watch', title: 'Severance', kind: 'show' });
  assert.deepEqual(pc('I watched Oppenheimer last night'), { type: 'watched', target: 'Oppenheimer' });
  assert.deepEqual(pc('I was in meetings from 2 to 4'), { type: 'timelog', title: 'In meetings', date: B, start: '14:00', end: '16:00' });
  assert.deepEqual(pc('log deep work from 9 to 11:30'), { type: 'timelog', title: 'Deep work', date: B, start: '09:00', end: '11:30' });
  assert.deepEqual(pc('I was at the gym from 6 to 7 am yesterday'), { type: 'timelog', title: 'Gym', date: '2026-09-24', start: '06:00', end: '07:00' });
  assert.deepEqual(pc("I'm now doing deep work"), { type: 'track', title: 'Deep work' });
  assert.deepEqual(pc('start tracking reading'), { type: 'track', title: 'Reading' });
  assert.deepEqual(pc('stop tracking'), { type: 'track', title: null });
  assert.deepEqual(pc('screen time phone 3 hours 20 minutes'), { type: 'screen', device: 'phone', duration: '3 hours 20 minutes' });
  assert.equal(pc('what should I be doing now').what, 'routine');
  assert.equal(pc('what level am I').what, 'stats');
  assert.equal(pc("what's my screen time today").what, 'screen');
});

test('slips', () => {
  assert.deepEqual(pc('I slipped on junk food'), { type: 'slip', target: 'junk food', date: B });
  assert.equal(pc('relapsed smoking yesterday').date, '2026-09-24');
  assert.equal(pc('I smoked a cigarette').type, 'done'); // matched to a habit-to-break at run time
});
