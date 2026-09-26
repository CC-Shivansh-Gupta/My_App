import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as store from '../app/js/store.js';
import * as A from '../app/js/agent.js';
import * as M from '../app/js/models.js';
import { generateVapidKeys, vapidAuth, encrypt } from '../agent/webpush.mjs';
import { run, plan } from '../agent/run.mjs';
import { aiClient, findTasks, parseJson } from '../agent/ai.mjs';

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
  const first = await run({ token: 't', fetchImpl, date: DAY, job: 'morning-brief' });
  assert.equal(first.jobs[0].suggested, 3);
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
  const second = await run({ token: 't', fetchImpl, date: DAY, job: 'morning-brief' });
  assert.deepEqual([second.sent, second.dropped, second.jobs[0].suggested, second.jobs[0].waiting], [1, 1, 0, 3]);
  const pushed = calls.find(([m]) => m === 'PUSHED')[1];
  assert.equal(pushed.url, '#/agent');
  assert.match(pushed.body, /3 suggestions to approve/);
  const after = JSON.parse(gist['daybook-data.json']).data;
  assert.ok(after.pushSubs['sub-dead'].deleted);
  assert.ok(!after.pushSubs['sub-live'].deleted);
  assert.equal(gist['daybook-agent.json'], agentFileBefore, 'keys are made once and kept');
});

// ---- Evening check-in and weekly review ----------------------------------------------------------

test('evening check-in: asks only about what is missing, and stays quiet when all is logged', () => {
  seed();
  store.put('screentime', { id: 'st1', date: '2026-09-25', device: 'phone', minutes: 200 });
  store.put('expenses', { amount: 50, note: 'tea', category: 'Food', date: '2026-09-25' });
  const e = A.eveningCheckin(DAY);
  assert.deepEqual(e.counts, ['Log today’s spending?', 'Screen time?', '1 habit unticked', '1 to-do left']);
  assert.equal(e.suggestions[0].action.date, '2026-09-27');
  const r = A.record(e, { now: 1 });
  assert.equal(r.notification.url, '#/today');
  assert.doesNotMatch(r.notification.body, /Groceries|Meditate/);

  A.approve(A.pending().find((x) => x.job === 'evening-checkin'));
  assert.equal(store.get('todos', 'now').date, '2026-09-27');
  store.put('expenses', { amount: 20, note: 'bus', category: 'Transport', date: DAY });
  store.put('screentime', { id: 'st2', date: DAY, device: 'phone', minutes: 100 });
  M.setDone('med', DAY, true);
  const quiet = A.record(A.eveningCheckin(DAY), { now: 2 });
  assert.equal(quiet.notification, null);
  assert.equal(A.runs()[0].summary.startsWith('All logged'), true);
});

test('weekly review: numbers for the week and suggestions for next week that last till Tuesday', () => {
  seed();
  const old = Date.now() - 20 * 86400000;
  store.put('tasks', { id: 'big', title: 'Write resume', priority: 3, done: false, createdAt: old });
  store.put('workouts', { id: 'w1', date: '2026-09-22', startedAt: 1, endedAt: 2, exercises: [] });
  store.put('workouts', { id: 'w0', date: '2026-09-15', startedAt: 1, endedAt: 2, exercises: [] });
  store.put('goals', { id: 'g2', title: 'Run 50 km', horizon: 'month', period: '2026-09', status: 'active', mode: 'number', target: 50, current: 5 });
  const SUN = '2026-09-27';
  const w = A.weeklyReview(SUN);
  const text = w.lines.join('\n');
  assert.match(text, /XP this week/);
  assert.match(text, /✅ Habits \d+%/);
  assert.match(text, /🏋️ 1 workout \(last week 1\)/);
  assert.match(text, /budget used this month/);
  assert.ok(w.suggestions.length <= 3);
  const plan = w.suggestions.find((s) => s.action.type === 'planTask');
  assert.equal(plan.action.date, '2026-09-28', 'planned for Monday');
  assert.ok(w.suggestions.some((s) => s.action.type === 'addTask' && /Run 50 km/.test(s.action.title)));

  A.record(w, { now: 1 });
  A.record(A.morningBrief('2026-09-28'), { now: 2 });
  assert.ok(A.pending().some((s) => s.job === 'weekly-review'), 'still waiting on Monday');
  A.record(A.morningBrief('2026-09-30'), { now: 3 });
  assert.ok(!A.pending().some((s) => s.job === 'weekly-review'), 'expired by Wednesday');
  assert.equal(A.latestRun('weekly-review').date, SUN);
});

test('addTask: adds once, keeps the due date, ignores junk', () => {
  store.reset();
  assert.match(A.apply({ type: 'addTask', title: '  Call   the bank ', due: '2026-10-02' }), /Added task “Call the bank” \(due/);
  assert.equal(A.apply({ type: 'addTask', title: 'call the bank' }), null, 'no duplicate open task');
  assert.equal(A.apply({ type: 'addTask', title: '' }), null);
  const t = M.openTasks()[0];
  assert.deepEqual([t.title, t.due], ['Call the bank', '2026-10-02']);
});

test('manager: auto runs the brief in the morning, the check-in at night, the review on Sunday night', () => {
  assert.deepEqual(plan('auto', new Date(2026, 8, 26, 7)), ['morning-brief']);
  assert.deepEqual(plan('auto', new Date(2026, 8, 26, 21)), ['evening-checkin']);
  assert.deepEqual(plan('auto', new Date(2026, 8, 27, 21)), ['evening-checkin', 'weekly-review']);
  assert.deepEqual(plan('weekly-review', new Date(2026, 8, 26, 7)), ['weekly-review']);
});

// ---- AI (with a fake OpenAI-compatible provider) ---------------------------------------------------

function fakeProvider(reply, { models = ['whisper-large-v3', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'], status = 200 } = {}) {
  const seen = [];
  const fetchImpl = async (url, opts = {}) => {
    seen.push([url, opts.body ? JSON.parse(opts.body) : null]);
    if (url.endsWith('/models')) return { ok: true, status: 200, json: async () => ({ data: models.map((id) => ({ id })) }) };
    if (status !== 200) return { ok: false, status, headers: { get: () => '0' } };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: typeof reply === 'function' ? reply(seen.at(-1)[1]) : reply } }] }) };
  };
  return { seen, ai: aiClient({ apiKey: 'k', baseUrl: 'https://ai.example/v1/', fetchImpl, wait: async () => {} }) };
}

test('AI client picks a chat model and reads JSON out of chatty replies', async () => {
  const { ai, seen } = fakeProvider('Sure! {"tasks":[{"note":1,"title":"Call the bank","due":"2026-10-02"},{"note":9,"title":"ghost"},{"note":1,"title":"x"}]} Hope that helps.');
  const tasks = await findTasks(ai, [{ id: 'n1', text: 'call the bank friday' }], DAY);
  assert.deepEqual(tasks, [{ noteId: 'n1', title: 'Call the bank', due: '2026-10-02' }]);
  assert.equal(ai.model(), 'llama-3.3-70b-versatile');
  assert.equal(seen[1][0], 'https://ai.example/v1/chat/completions');
  assert.match(seen[1][1].messages[0].content, /Today is Saturday 2026-09-26/);
  assert.equal(parseJson('no json here'), null);
});

async function aiRun(ai, { summary = true, notes = true } = {}) {
  seed();
  store.put('notes', { id: 'n1', text: 'Errands\nneed to call the bank on friday' });
  A.setAI('summary', summary);
  A.setAI('notes', notes);
  let gist = { 'daybook-data.json': JSON.stringify({ data: structuredClone(store.snapshot()) }) };
  store.reset();
  const fetchImpl = async (url, opts = {}) => {
    const json = (x) => ({ ok: true, status: 200, json: async () => x });
    if (url.startsWith('https://api.github.com/gists?')) return json([{ id: 'g1', files: { 'daybook-data.json': {} } }]);
    if (!opts.method) return json({ files: Object.fromEntries(Object.entries(gist).map(([k, v]) => [k, { content: v }])) });
    for (const [k, v] of Object.entries(JSON.parse(opts.body).files)) gist[k] = v.content;
    return json({});
  };
  const r = await run({ token: 't', fetchImpl, date: DAY, job: 'morning-brief', ai });
  return { r, data: JSON.parse(gist['daybook-data.json']).data, agent: JSON.parse(gist['daybook-agent.json']) };
}

test('run with AI: adds a summary and note tasks as suggestions, and remembers what it read', async () => {
  const { ai, seen } = fakeProvider((body) => (/find to-dos/.test(body.messages[0].content)
    ? '{"tasks":[{"note":1,"title":"Call the bank","due":"2026-10-02"}]}'
    : 'Two tasks are overdue, so start with taxes.'));
  const { r, data, agent } = await aiRun(ai);
  assert.equal(r.jobs[0].ai, 'ok');
  assert.equal(r.jobs[0].suggested, 4);
  const log = Object.values(data.agentLog)[0];
  assert.equal(log.aiSummary, 'Two tasks are overdue, so start with taxes.');
  const sug = Object.values(data.agentInbox).find((s) => s.action.type === 'addTask');
  assert.match(sug.why, /Found by AI in your note “Errands”/);
  assert.ok(agent.notesScannedAt > 0);
  const sent = seen.filter(([u]) => u.endsWith('/chat/completions')).map(([, b]) => b.messages[1].content).join('\n');
  assert.match(sent, /call the bank/, 'notes go to the provider only because "Find tasks" is on');
});

test('run with AI: settings off means nothing is sent; failures never block the brief', async () => {
  const off = fakeProvider('unused');
  const a = await aiRun(off.ai, { summary: false, notes: false });
  assert.equal(a.r.jobs[0].ai, 'off');
  assert.equal(off.seen.length, 0);

  const broken = fakeProvider('x', { status: 503 });
  const b = await aiRun(broken.ai);
  assert.equal(b.r.jobs[0].ai, 'error');
  assert.equal(b.r.jobs[0].suggested, 3, 'the rule-based suggestions still arrive');
  assert.equal(b.agent.notesScannedAt, undefined, 'notes are read again next time');

  const none = await aiRun(null);
  assert.equal(none.r.jobs[0].ai, 'no key');
});
