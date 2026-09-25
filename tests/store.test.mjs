import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../app/js/store.js';

test('put / remove / merge keeps newest edit per item', () => {
  store.reset();
  const a = store.put('tasks', { title: 'A' });
  const b = store.put('tasks', { title: 'B' });
  store.remove('tasks', b.id);
  assert.deepEqual(store.all('tasks').map((t) => t.title), ['A']);

  // Remote device edited A later and added C; it still has B (older than our delete).
  const remote = {
    tasks: {
      [a.id]: { ...a, title: 'A edited', updatedAt: a.updatedAt + 1000 },
      [b.id]: { ...b },
      c1: { id: 'c1', title: 'C', updatedAt: 5 },
    },
  };
  const res = store.merge(remote);
  assert.equal(res.localChanged, true);
  assert.equal(res.remoteStale, true); // remote doesn't know B was deleted
  assert.deepEqual(store.all('tasks').map((t) => t.title).sort(), ['A edited', 'C']);

  // Merging the same thing again is a no-op.
  const again = store.merge(JSON.parse(JSON.stringify(store.snapshot())));
  assert.deepEqual(again, { localChanged: false, remoteStale: false });
});

test('prefs merge per key', () => {
  store.reset();
  store.setPref('currency', '$');
  assert.equal(store.pref('currency', '₹'), '$');
  assert.equal(store.pref('missing', 7), 7);
});

test('old tombstones are purged', () => {
  store.reset();
  const x = store.put('todos', { title: 'x' });
  store.remove('todos', x.id);
  store.merge({}, { now: Date.now() + 200 * 86400000 });
  assert.equal(store.snapshot().todos[x.id], undefined);
});
