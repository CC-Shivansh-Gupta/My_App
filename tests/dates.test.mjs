import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSmart, parseExpense, occursOn, addMonths, monthMatrix } from '../app/js/dates.js';

const BASE = '2026-09-25'; // a Friday

test('parses relative days and times', () => {
  assert.deepEqual(pick(parseSmart('Dentist tomorrow 3pm', BASE)), { title: 'Dentist', date: '2026-09-26', time: '15:00', endTime: null });
  assert.deepEqual(pick(parseSmart('Call mom at 6:30pm today', BASE)), { title: 'Call mom', date: BASE, time: '18:30', endTime: null });
  assert.deepEqual(pick(parseSmart('Standup mon 9-9:30am', BASE)), { title: 'Standup', date: '2026-09-28', time: '09:00', endTime: '09:30' });
  assert.equal(parseSmart('Review fri', BASE).date, '2026-10-02'); // same weekday → next week
  assert.equal(parseSmart('Gym in 3 days', BASE).date, '2026-09-28');
  assert.equal(parseSmart('Lunch at 1', BASE).time, '13:00');
  assert.equal(parseSmart('Meet 14:15', BASE).time, '14:15');
});

test('parses month-day dates, rolling into next year when past', () => {
  assert.equal(parseSmart('Report sep 30', BASE).date, '2026-09-30');
  assert.equal(parseSmart('Taxes 15 jan', BASE).date, '2027-01-15');
  assert.equal(parseSmart('Trip 2026-12-20', BASE).date, '2026-12-20');
  assert.equal(parseSmart('Read chapter may', BASE).date, null); // "may" alone is not a date
});

test('parses priority and tag', () => {
  const p = parseSmart('Pay rent fri !high #home', BASE);
  assert.equal(p.title, 'Pay rent');
  assert.equal(p.priority, 3);
  assert.equal(p.tag, 'home');
});

test('leaves plain text alone', () => {
  const p = parseSmart('Buy 2 notebooks', BASE);
  assert.equal(p.title, 'Buy 2 notebooks');
  assert.equal(p.date, null);
  assert.equal(p.time, null);
});

test('parses expenses', () => {
  assert.deepEqual(parseExpense('250 lunch', BASE), { amount: 250, note: 'lunch', date: BASE, category: null });
  assert.deepEqual(parseExpense('coffee 4.50', BASE), { amount: 4.5, note: 'coffee', date: BASE, category: null });
  assert.deepEqual(parseExpense('₹1,200 groceries yesterday #food', BASE), { amount: 1200, note: 'groceries', date: '2026-09-24', category: 'food' });
  assert.equal(parseExpense('lunch', BASE).amount, null);
});

test('repeating events', () => {
  const weekly = { date: '2026-09-01', repeat: 'weekly' };
  assert.ok(occursOn(weekly, '2026-09-08'));
  assert.ok(!occursOn(weekly, '2026-09-09'));
  assert.ok(!occursOn(weekly, '2026-08-25'));
  assert.ok(occursOn({ date: '2026-01-31', repeat: 'monthly' }, '2026-03-31'));
  assert.ok(!occursOn({ date: '2026-09-01', repeat: 'daily', until: '2026-09-05' }, '2026-09-06'));
  assert.ok(!occursOn({ date: '2026-09-01', repeat: 'daily', skip: ['2026-09-03'] }, '2026-09-03'));
  assert.ok(occursOn({ date: '2026-09-21', repeat: 'weekdays' }, '2026-09-25'));
  assert.ok(!occursOn({ date: '2026-09-21', repeat: 'weekdays' }, '2026-09-26'));
});

test('date math', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  const m = monthMatrix('2026-09-15', 1);
  assert.equal(m[0][0], '2026-08-31'); // Monday before Sep 1
  assert.equal(m.length, 6);
});

function pick(p) {
  return { title: p.title, date: p.date, time: p.time, endTime: p.endTime };
}
