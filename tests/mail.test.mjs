import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as store from '../app/js/store.js';
import * as A from '../app/js/agent.js';
import { parseAccounts, imapHost, imapSession, fetchRecent, parseMessage, parseIcs, ruleItems, aiItems, mailScan, worthReading } from '../agent/mail.mjs';
import { run, plan } from '../agent/run.mjs';

const DAY = '2026-09-26'; // Saturday
process.env.TZ = 'Asia/Kolkata'; // calendar invites are in UTC; these tests expect India time

const mime = (headers, body) => Buffer.from(`${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${body}`, 'utf8');

const INVITE = mime({
  'Message-ID': '<inv1@college.edu>', From: '"Prof. Rao" <rao@college.edu>', Subject: 'Invitation: Project review',
  'Content-Type': 'multipart/mixed; boundary="b1"',
}, ['--b1', 'Content-Type: text/plain; charset=utf-8', '', 'Please join the review.', '--b1',
  'Content-Type: text/calendar; method=REQUEST', 'Content-Transfer-Encoding: base64', '',
  Buffer.from('BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nSUMMARY:Project review\r\nDTSTART:20260929T093000Z\r\nDTEND:20260929T103000Z\r\nLOCATION:Room 204\r\nEND:VEVENT\r\nEND:VCALENDAR').toString('base64'),
  '--b1--'].join('\r\n'));

const INTERVIEW = mime({ 'Message-ID': '<x2@corp.com>', From: 'Talent <jobs@corp.com>', Subject: '=?utf-8?B?SW50ZXJ2aWV3IG9uIE1vbmRheSBhdCAzIHBt?=',
  'Content-Type': 'text/plain; charset=utf-8', 'Content-Transfer-Encoding': 'quoted-printable' }, 'Hi, we=E2=80=99d like to meet you.=\r\nSee you then.');
const OTP = mime({ 'Message-ID': '<otp@bank.com>', From: 'Bank <no-reply@bank.com>', Subject: 'Your OTP is 482913' }, 'Use it within 10 minutes.');
const PROMO = mime({ 'Message-ID': '<p@shop.com>', From: 'Shop <deals@shop.com>', Subject: 'Sale: 50% off, offer ends Monday', 'List-Unsubscribe': '<mailto:x>' }, 'Buy now');
const HTML = mime({ 'Message-ID': '<h@x.com>', From: 'A <a@x.com>', Subject: 'Hello', 'Content-Type': 'text/html' }, '<p>Hi&nbsp;there</p><style>p{}</style><br>Bye');

test('accounts and servers', async () => {
  assert.deepEqual(parseAccounts('# mine\nme@gmail.com abcd efgh ijkl mnop\nimap.college.edu me@college.edu p@ss w0rd\nnonsense'), [
    { host: null, user: 'me@gmail.com', pass: 'abcd efgh ijkl mnop' },
    { host: 'imap.college.edu', user: 'me@college.edu', pass: 'p@ss w0rd' },
  ]);
  assert.equal(await imapHost('me@gmail.com'), 'imap.gmail.com');
  assert.equal(await imapHost('me@iitx.ac.in', { resolveMx: async () => [{ exchange: 'aspmx.l.google.com' }] }), 'imap.gmail.com');
  assert.equal(await imapHost('me@uni.edu', { resolveMx: async () => [{ exchange: 'uni-edu.mail.protection.outlook.com' }] }), 'outlook.office365.com');
  assert.equal(await imapHost('me@small.edu', { resolveMx: async () => { throw new Error('nx'); } }), 'imap.small.edu');
});

test('reading messages: multipart, encodings, invites, html', () => {
  const inv = parseMessage(INVITE);
  assert.equal(inv.fromName, 'Prof. Rao');
  assert.equal(inv.text, 'Please join the review.');
  assert.deepEqual(parseIcs(inv.ics, 'Asia/Kolkata'), { title: 'Project review', date: '2026-09-29', time: '15:00', endTime: '16:00', location: 'Room 204' });
  const iv = parseMessage(INTERVIEW);
  assert.equal(iv.subject, 'Interview on Monday at 3 pm');
  assert.equal(iv.text, 'Hi, we’d like to meet you.See you then.');
  assert.equal(parseMessage(PROMO).bulk, true);
  assert.equal(parseMessage(HTML).text, 'Hi there\n\nBye');
  assert.equal(worthReading(parseMessage(OTP)), false);
  assert.equal(parseIcs('BEGIN:VCALENDAR\nMETHOD:CANCEL\nDTSTART:20260929T093000Z\nEND:VCALENDAR'), null);
});

test('without AI: obvious dates in event-like subjects', () => {
  assert.deepEqual(ruleItems(parseMessage(INTERVIEW), DAY), [{ type: 'event', title: 'Interview', date: '2026-09-28', time: '15:00', endTime: null }]);
  assert.deepEqual(ruleItems({ subject: 'Assignment 3 due 30 Sep', bulk: false }, DAY), [{ type: 'task', title: 'Assignment 3 due', date: '2026-09-30' }]);
  assert.deepEqual(ruleItems(parseMessage(PROMO), DAY), []);
  assert.deepEqual(ruleItems({ subject: 'Lunch?', bulk: false }, DAY), []);
});

test('with AI: items are validated', async () => {
  const mails = [parseMessage(INTERVIEW), parseMessage(HTML)];
  const ai = { chat: async (msgs) => {
    assert.match(msgs[1].content, /Interview on Monday/);
    return JSON.stringify({ items: [
      { email: 1, type: 'event', title: 'Interview with Corp', date: '2026-09-28', time: '15:00', why: 'Recruiter invite' },
      { email: 2, type: 'fyi', title: 'A said hello', why: 'friend' },
      { email: 9, type: 'task', title: 'Ghost', date: null },
      { email: 1, type: 'event', title: 'Old thing', date: '2026-01-01' },
      { email: 1, type: 'spam', title: 'Nope' },
    ] });
  } };
  const items = await aiItems(ai, mails, DAY);
  assert.deepEqual(items.map((i) => [i.n, i.type, i.title]), [[1, 'event', 'Interview with Corp'], [2, 'fyi', 'A said hello']]);
});

test('the scan: invites always, OTPs never, each email once', async () => {
  store.reset();
  const state = {};
  let calls = 0;
  const fetchImpl = async (acc, { since }) => {
    calls++;
    assert.equal(acc.host, 'imap.gmail.com');
    assert.ok(since > 0);
    return [INVITE, INTERVIEW, OTP, PROMO].map((raw, i) => ({ uid: i + 1, raw, received: Date.now() }));
  };
  const seenByAI = [];
  const ai = { chat: async (msgs) => { seenByAI.push(msgs[1].content); return '{"items":[]}'; } };
  const r = await mailScan({ accounts: [{ user: 'me@gmail.com', pass: 'x' }], state, ai, useAI: true, date: DAY, fetchImpl });
  assert.equal(r.suggestions.length, 1);
  assert.equal(r.suggestions[0].action.type, 'addEvent');
  assert.equal(r.suggestions[0].action.time, '15:00');
  assert.match(r.suggestions[0].why, /Calendar invite: Prof\. Rao/);
  assert.ok(!seenByAI.join('').includes('482913'), 'OTP emails never go to the AI');
  assert.ok(!seenByAI.join('').includes('50% off'), 'obvious promotions are skipped');
  const again = await mailScan({ accounts: [{ user: 'me@gmail.com', pass: 'x' }], state, date: DAY, fetchImpl });
  assert.equal(again.suggestions.length, 0);
  assert.equal(calls, 2);
  assert.equal(again.stats.scanned, 0);
});

test('a refused sign-in is reported without the password', async () => {
  const state = {};
  const r = await mailScan({ accounts: [{ user: 'me@college.edu', host: 'imap.college.edu', pass: 'hunter2' }], state, date: DAY,
    fetchImpl: async () => { throw new Error('a1 NO [AUTHENTICATIONFAILED] Invalid credentials hunter2'); } });
  assert.match(r.lines.join('\n'), /Couldn’t check college\.edu: sign-in refused — check the app password/);
  assert.ok(!JSON.stringify(r).includes('hunter2'));
  assert.equal(state.mail.lastScan, 0, 'retries the same window next time');
});

// A fake IMAP server speaking just enough of the protocol.
function fakeServer(messages) {
  const log = [];
  const connect = () => {
    const sock = new EventEmitter();
    const send = (s) => setImmediate(() => sock.emit('data', Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1')));
    sock.write = (line) => {
      log.push(line.trim());
      const [tag, ...rest] = line.trim().split(' ');
      const cmd = rest.join(' ');
      if (/^LOGIN/.test(cmd)) send(`${tag} OK [CAPABILITY IMAP4rev1 X-GM-EXT-1] Logged in\r\n`);
      else if (/^EXAMINE/.test(cmd)) send(`* 3 EXISTS\r\n${tag} OK [READ-ONLY] Selected\r\n`);
      else if (/^UID SEARCH/.test(cmd)) send(`* SEARCH ${messages.map((_, i) => i + 1).join(' ')}\r\n${tag} OK done\r\n`);
      else if (/^UID FETCH/.test(cmd)) {
        const chunks = messages.map((m, i) => Buffer.concat([Buffer.from(`* ${i + 1} FETCH (UID ${i + 1} INTERNALDATE "26-Sep-2026 09:00:00 +0000" BODY[]<0> {${m.length}}\r\n`, 'latin1'), m, Buffer.from(')\r\n')]));
        const all = Buffer.concat([...chunks, Buffer.from(`${tag} OK fetched\r\n`)]);
        // Deliver in awkward pieces, splitting literals.
        for (let i = 0; i < all.length; i += 37) send(all.subarray(i, i + 37));
      } else if (/^LOGOUT/.test(cmd)) send('* BYE\r\n');
    };
    sock.end = () => {};
    sock.setTimeout = () => {};
    send('* OK fake ready\r\n');
    return sock;
  };
  return { connect, log };
}

test('IMAP: read-only fetch with literals split across packets', async () => {
  const srv = fakeServer([INVITE, INTERVIEW]);
  const got = await fetchRecent({ host: 'imap.gmail.com', user: 'me@gmail.com', pass: 'ab cd' }, {
    since: Date.parse('2026-09-25T00:00:00Z'), session: (o) => imapSession({ ...o, connect: srv.connect }),
  });
  assert.equal(got.length, 2);
  assert.equal(parseMessage(got.find((g) => g.uid === 2).raw).subject, 'Interview on Monday at 3 pm');
  assert.ok(srv.log.some((l) => l.startsWith('a2 EXAMINE INBOX')), 'the inbox is opened read-only');
  assert.ok(srv.log.some((l) => /X-GM-RAW/.test(l)));
  assert.ok(srv.log.some((l) => /LOGIN "me@gmail.com" "abcd"/.test(l)), 'Gmail app passwords work with or without spaces');
});

test('the agent: email first, then the brief; suggestions wait for approval', async () => {
  assert.deepEqual(plan('auto', new Date(2026, 8, 26, 7), { mail: true }), ['mail-scan', 'morning-brief']);
  assert.deepEqual(plan('auto', new Date(2026, 8, 26, 7)), ['morning-brief']);
  store.reset();
  store.put('habits', { id: 'h', name: 'Read' });
  const gist = { 'daybook-data.json': JSON.stringify({ data: structuredClone(store.snapshot()) }) };
  store.reset();
  const fetchImpl = async (url, opts = {}) => {
    const json = (x) => ({ ok: true, status: 200, json: async () => x });
    if (url.startsWith('https://api.github.com/gists?')) return json([{ id: 'g1', files: { 'daybook-data.json': {} } }]);
    if (url === 'https://api.github.com/gists/g1' && !opts.method) return json({ files: Object.fromEntries(Object.entries(gist).map(([k, v]) => [k, { content: v }])) });
    if (opts.method === 'PATCH') { for (const [k, v] of Object.entries(JSON.parse(opts.body).files)) gist[k] = v.content; return json({}); }
    throw new Error(`unexpected ${url}`);
  };
  const r = await run({ token: 't', fetchImpl, date: DAY, job: 'mail-scan', mail: [{ user: 'me@gmail.com', pass: 'x' }],
    mailFetch: async () => [{ uid: 1, raw: INVITE, received: Date.now() }] });
  assert.deepEqual([r.jobs[0].job, r.jobs[0].suggested, r.jobs[0].scanned], ['mail-scan', 1, 1]);
  const saved = JSON.parse(gist['daybook-data.json']).data;
  const sug = Object.values(saved.agentInbox)[0];
  assert.equal(sug.status, 'pending');
  assert.equal(sug.expires, '2026-09-29');
  store.reset(saved);
  assert.match(A.approve(sug), /Added “Project review” to your calendar/);
  assert.equal(store.all('events')[0].time, '15:00');
  assert.equal(A.approve(sug), null, 'approving twice does nothing');
  assert.ok(JSON.parse(gist['daybook-agent.json']).mail.seen.length === 1);
});
