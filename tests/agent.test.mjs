import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as store from '../app/js/store.js';
import * as A from '../app/js/agent.js';
import * as M from '../app/js/models.js';
import { generateVapidKeys, vapidAuth, encrypt } from '../agent/webpush.mjs';
import { run } from '../agent/run.mjs';

const DAY = '2026-09-26'; // a Saturday, 4 days before the month ends

function seed() {
  store.reset();
  store.put('tasks', { id: 'late', title: 'File taxes', due: '2026-09-20', done: false, priority: 2 });
  store.put('tasks', { id: 'later', title: 'Plan trip', due: '2026-10-10', done: false });
  store.put('todos', { id: 'old', title: 'Call bank', date: '2026-09-24', done: false });
  store.put('todos', { id: 'now', title: 'Groceries', date: DAY, done: false });
  store.put('habits', { id: 'med', name: 'Meditate', emoji: '🧘', createdAt: new Date(2026, 8, 1).getTime() });
  for (const d of ['2026-09-23', '2026-09-24', '2026-09-25']) M.setDone('med', d, true);
  store.put('goals', { id: 'g1', title: 'Read 2 books', horizon: 'month', period: '2026-09', status: 'active', mode: 'number', target: 2, current: 1 });
  store.setPref('budget', 1000);
  store.put('expenses', { amount: 950, note: 'rent share', category: 'Rent', date: '2026-09-10' });
}

test('morning brief: lines and suggestions come from the data', () => {
  seed();
  const b = A.morningBrief(DAY);
  const text = b.lines.join('\n');
  assert.match(text, /1 overdue task: File taxes/);
  assert.match(text, /1 to-do for today, 1 unfinished from earlier/);
  assert.match(text, /keep your streaks: 🧘Meditate 🔥3/);
  assert.match(text, /budget spent — \d+% ahead of pace/);
  assert.match(text, /1 monthly goal open with 4 days left/);
  assert.deepEqual(b.suggestions.map((s) => s.action.type).sort(), ['addTodo', 'moveTodos', 'planTask']);
});

test('suggestions wait for approval, are never repeated, and expire the next day', () => {
  seed();
  const r1 = A.runMorningBrief(DAY, 1);
  assert.equal(r1.stats.suggested, 3);
  assert.equal(A.pending().length, 3);
  assert.equal(store.get('tasks', 'late').planned, undefined, 'nothing changes before approval');
  assert.doesNotMatch(r1.notification.body, /File taxes|Call bank|Meditate/, 'notification carries counts, not titles');

  A.dismiss(A.pending().find((s) => s.action.type === 'addTodo'));
  const r2 = A.runMorningBrief(DAY, 2);
  assert.equal(r2.stats.suggested, 0, 'a second run the same day adds nothing');
  assert.equal(A.pending().length, 2);

  A.runMorningBrief('2026-09-27', 3);
  assert.ok(store.all('agentInbox').filter((s) => s.date === DAY).every((s) => s.status !== 'pending'));
  assert.equal(A.runs().length, 3);
  assert.equal(A.latestBrief('2026-09-27').job, 'morning-brief');
});

test('approving carries out exactly the suggested action', () => {
  seed();
  A.runMorningBrief(DAY, 1);
  for (const s of A.pending()) A.approve(s);
  assert.equal(store.get('tasks', 'late').planned, DAY);
  assert.equal(store.get('todos', 'old').date, DAY);
  assert.ok(M.todosOn(DAY).some((t) => t.title === 'Work on goal: Read 2 books'));
  assert.equal(A.pending().length, 0);
  assert.equal(A.decided().length, 3);
  // Unknown or malformed actions do nothing.
  assert.equal(A.apply({ type: 'deleteEverything' }), null);
  assert.equal(A.apply({ type: 'planTask', taskId: 'missing', date: DAY }), null);
});

test('"Just do it" autonomy acts without asking and logs what it did', () => {
  seed();
  A.setAutonomy('planTask', 'act');
  const r = A.runMorningBrief(DAY, 1);
  assert.equal(r.stats.done, 1);
  assert.equal(store.get('tasks', 'late').planned, DAY);
  assert.ok(!A.pending().some((s) => s.action.type === 'planTask'));
  assert.equal(A.runs()[0].did.length, 1);
  assert.match(A.runs()[0].did[0], /^Planned “File taxes” for /);
});

test('old log entries and decided suggestions are tidied after 30 days', () => {
  seed();
  A.runMorningBrief(DAY, 1);
  for (const s of A.pending()) A.dismiss(s);
  const later = Date.now() + 31 * 86400000;
  A.runMorningBrief('2026-10-30', later);
  assert.equal(A.runs().length, 1);
  assert.ok(store.all('agentInbox').every((s) => s.date === '2026-10-30'));
});

// ---- Web Push ------------------------------------------------------------------------------------

function subscriber() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

// The browser's side of RFC 8291, to check what we send can be read.
function decrypt(body, { ecdh, auth }) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const keyid = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const shared = ecdh.computeSecret(keyid);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), keyid]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
  return plain.subarray(0, -1).toString();
}

test('push payloads decrypt on the device side', () => {
  const sub = subscriber();
  const body = encrypt(JSON.stringify({ title: 'Hi', body: 'ünïcode ✓' }), sub.keys);
  assert.equal(body.readUInt32BE(16), 4096);
  assert.deepEqual(JSON.parse(decrypt(body, sub)), { title: 'Hi', body: 'ünïcode ✓' });
});

test('VAPID header is a valid ES256 JWT for the push service origin', () => {
  const keys = generateVapidKeys();
  assert.equal(Buffer.from(keys.publicKey, 'base64url').length, 65);
  const hdr = vapidAuth('https://web.push.apple.com/abc123', keys, 'https://example.com/', 1_700_000_000_000);
  const [, jwt, k] = hdr.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [h, c, sig] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.exp, 1_700_000_000 + 3600);
  const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: keys.privateJwk.x, y: keys.privateJwk.y }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
});

// ---- A whole run against a fake GitHub -------------------------------------------------------------

test('run: reads the gist, writes the brief back, notifies devices, drops dead ones', async () => {
  seed();
  const live = subscriber();
  store.put('pushSubs', { id: 'sub-live', endpoint: 'https://push.example/live', keys: live.keys });
  store.put('pushSubs', { id: 'sub-dead', endpoint: 'https://push.example/dead', keys: subscriber().keys });
  let gist = { 'daybook-data.json': JSON.stringify({ data: structuredClone(store.snapshot()) }) };
  store.reset();

  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push([opts.method || 'GET', url]);
    const json = (x) => ({ ok: true, status: 200, json: async () => x });
    if (url.startsWith('https://api.github.com/gists?')) return json([{ id: 'g1', files: { 'daybook-data.json': {} } }]);
    if (url === 'https://api.github.com/gists/g1' && !opts.method) {
      return json({ files: Object.fromEntries(Object.entries(gist).map(([k, v]) => [k, { content: v }])) });
    }
    if (url === 'https://api.github.com/gists/g1' && opts.method === 'PATCH') {
      for (const [k, v] of Object.entries(JSON.parse(opts.body).files)) gist[k] = v.content;
      return json({});
    }
    if (url === 'https://push.example/live') {
      calls.push(['PUSHED', JSON.parse(decrypt(opts.body, live))]);
      assert.equal(opts.headers['Content-Encoding'], 'aes128gcm');
      return { ok: true, status: 201 };
    }
    if (url === 'https://push.example/dead') return { ok: false, status: 410 };
    throw new Error(`unexpected ${url}`);
  };

  // First run makes the push keys; devices subscribed with them before the second run.
  const first = await run({ token: 't', fetchImpl, date: DAY });
  assert.equal(first.suggested, 3);
  const key = JSON.parse(gist['daybook-agent.json']).vapid.publicKey;
  const saved = JSON.parse(gist['daybook-data.json']).data;
  assert.equal(saved.prefs.agentPush.value.publicKey, key);
  assert.equal(Object.values(saved.agentInbox).filter((s) => s.status === 'pending').length, 3);
  assert.equal(first.dropped, 2, 'subscriptions made with another key are dropped');

  saved.pushSubs = {
    'sub-live': { id: 'sub-live', endpoint: 'https://push.example/live', keys: live.keys, publicKey: key, updatedAt: Date.now() + 10 },
    'sub-dead': { id: 'sub-dead', endpoint: 'https://push.example/dead', keys: subscriber().keys, publicKey: key, updatedAt: Date.now() + 10 },
  };
  gist['daybook-data.json'] = JSON.stringify({ data: saved });
  const agentFileBefore = gist['daybook-agent.json'];

  calls.length = 0;
  const second = await run({ token: 't', fetchImpl, date: DAY });
  assert.deepEqual([second.sent, second.dropped, second.suggested, second.waiting], [1, 1, 0, 3]);
  const pushed = calls.find(([m]) => m === 'PUSHED')[1];
  assert.equal(pushed.url, '#/agent');
  assert.match(pushed.body, /3 suggestions to approve/);
  const after = JSON.parse(gist['daybook-data.json']).data;
  assert.ok(after.pushSubs['sub-dead'].deleted);
  assert.ok(!after.pushSubs['sub-live'].deleted);
  assert.equal(gist['daybook-agent.json'], agentFileBefore, 'keys are made once and kept');
});
