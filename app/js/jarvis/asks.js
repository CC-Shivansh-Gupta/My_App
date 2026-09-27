// "Ask Claude …": requests queued for the agent, which answers them with Claude Code on your own
// Claude plan (see agent/claude.mjs). They travel in the synced data like everything else:
//   pending  → the agent answers → answered { say, do[] } → you tap "Do it" (or Dismiss) → done.
// Nothing runs by itself: an answer's commands only run on the device where you approve them.

import * as store from '../store.js';

const COL = 'jarvisAsks';

export function add(text) {
  return store.put(COL, { text: String(text).trim().slice(0, 2000), status: 'pending', at: Date.now() });
}

const byTime = (a, b) => (a.at || a.createdAt) - (b.at || b.createdAt);
export const pending = () => store.all(COL).filter((a) => a.status === 'pending').sort(byTime);
export const answered = () => store.all(COL).filter((a) => a.status === 'answered').sort(byTime);
export const recent = (n = 5) => store.all(COL).filter((a) => a.status === 'done' || a.status === 'dismissed').sort((a, b) => byTime(b, a)).slice(0, n);

export function answer(a, { say = '', commands = [], model = '', error = '' } = {}) {
  return store.put(COL, { ...a, status: error ? 'pending' : 'answered', say: String(say).slice(0, 1500), do: commands.slice(0, 8), model, error, answeredAt: Date.now() });
}

export function close(a, status = 'done', outcome = '') {
  return store.put(COL, { ...a, status, outcome: String(outcome).slice(0, 300), closedAt: Date.now() });
}

// Old closed ones go after two weeks so the list stays small.
export function prune(now = Date.now()) {
  for (const a of store.all(COL)) if ((a.status === 'done' || a.status === 'dismissed') && now - (a.closedAt || 0) > 14 * 86400000) store.remove(COL, a.id);
}
