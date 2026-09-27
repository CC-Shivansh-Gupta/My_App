// Email check for the Daybook agent: reads your inboxes (read-only — nothing is marked as read or
// changed), finds what needs your attention, and turns it into suggestions for the Agent inbox:
//   - calendar invites (.ics) → "Add event" — always, no AI needed;
//   - with AI switched on for email: meetings, interviews, exams and deadlines in ordinary emails
//     (including LinkedIn / X notification emails) → events and tasks, plus "worth a look" items
//     for the brief;
//   - without AI: subjects like "Interview on Friday at 3 pm" or "Assignment due 30 Sep".
// Plain IMAP over TLS with node:tls — no dependencies. Works with Gmail and Google Workspace
// (app password), Yahoo, Zoho, iCloud, Fastmail and most college mail servers.
//
// MAIL_ACCOUNTS (an Actions secret), one account per line:
//   you@gmail.com  abcd efgh ijkl mnop
//   imap.example.edu  you@example.edu  your-password
// The server is worked out from the address when you leave it out (Gmail, Outlook, Yahoo,
// iCloud, Zoho, or your domain's mail records for college and work addresses).

import tls from 'node:tls';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import * as D from '../app/js/dates.js';
import { parseSmart } from '../app/js/dates.js';
import { parseJson } from './ai.mjs';

// ---- Accounts --------------------------------------------------------------------------------------
const KNOWN = { 'gmail.com': 'imap.gmail.com', 'googlemail.com': 'imap.gmail.com', 'outlook.com': 'outlook.office365.com',
  'hotmail.com': 'outlook.office365.com', 'live.com': 'outlook.office365.com', 'yahoo.com': 'imap.mail.yahoo.com',
  'icloud.com': 'imap.mail.me.com', 'me.com': 'imap.mail.me.com', 'zoho.com': 'imap.zoho.com', 'fastmail.com': 'imap.fastmail.com' };

export function parseAccounts(text = '') {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const parts = l.split(/\s+/);
    const hostFirst = !parts[0].includes('@') && parts[1]?.includes('@');
    const host = hostFirst ? parts[0] : null;
    const user = hostFirst ? parts[1] : parts[0];
    const pass = parts.slice(hostFirst ? 2 : 1).join(' ');
    if (!user.includes('@') || !pass) continue;
    out.push({ host, user, pass });
  }
  return out;
}

// The IMAP server for an address: known providers, else the domain's MX records.
export async function imapHost(user, { resolveMx = dns.resolveMx } = {}) {
  const domain = user.split('@')[1].toLowerCase();
  if (KNOWN[domain]) return KNOWN[domain];
  try {
    const mx = (await resolveMx(domain)).map((r) => r.exchange.toLowerCase()).join(' ');
    if (/google(mail)?\.com/.test(mx)) return 'imap.gmail.com';
    if (/outlook\.com|office365|microsoft/.test(mx)) return 'outlook.office365.com';
    if (/zoho/.test(mx)) return 'imap.zoho.com';
    if (/yahoodns|yahoo/.test(mx)) return 'imap.mail.yahoo.com';
  } catch { /* fall through */ }
  return `imap.${domain}`;
}

// ---- A tiny IMAP client ------------------------------------------------------------------------
// Handles tagged commands and literals ({n} followed by n bytes), which is all FETCH needs.
export function imapSession({ host, port = 993, timeout = 30000, connect = tls.connect }) {
  let buf = Buffer.alloc(0);
  let waiting = null;
  let greeting = null;
  const ready = new Promise((resolve, reject) => { greeting = { resolve, reject }; });
  let n = 0;
  const sock = connect({ host, port, servername: host });
  sock.setTimeout?.(timeout, () => sock.destroy(new Error(`${host}: timed out`)));
  sock.on('data', (d) => { buf = Buffer.concat([buf, d]); pump(); });
  const fail = (e) => { waiting?.reject(e); waiting = null; greeting?.reject(e); greeting = null; };
  sock.on('error', fail);
  sock.on('close', () => fail(new Error(`${host} closed the connection`)));

  // Parse as many complete responses as the buffer holds.
  let current = null; // { text, literals }
  const responses = [];
  function pump() {
    for (;;) {
      if (current?.need) {
        if (buf.length < current.need) return;
        current.literals.push(buf.subarray(0, current.need));
        buf = buf.subarray(current.need);
        current.need = 0;
      }
      const i = buf.indexOf('\r\n');
      if (i < 0) return;
      const line = buf.subarray(0, i).toString('latin1');
      buf = buf.subarray(i + 2);
      if (!current) current = { text: '', literals: [] };
      current.text += line;
      const lit = line.match(/\{(\d+)\}$/);
      if (lit) { current.need = Number(lit[1]); current.text += `\u0000${current.literals.length}\u0000`; continue; }
      const done = current;
      current = null;
      responses.push(done);
      if (waiting) {
        const m = done.text.match(new RegExp(`^${waiting.tag} (OK|NO|BAD)\\b(.*)$`, 'i'));
        if (m) {
          const w = waiting; waiting = null;
          const out = responses.splice(0);
          if (m[1].toUpperCase() === 'OK') w.resolve(out); else w.reject(new Error(`${host}: ${m[2].trim() || m[1]}`));
        }
      } else if (/^\* OK\b/i.test(done.text) && greeting) { const g = greeting; greeting = null; responses.splice(0); g.resolve(); }
      else if (/^\* (BYE|NO|BAD)\b/i.test(done.text) && greeting) { const g = greeting; greeting = null; g.reject(new Error(`${host}: ${done.text}`)); }
    }
  }


  function command(cmd) {
    const tag = `a${++n}`;
    return new Promise((resolve, reject) => {
      waiting = { tag, resolve, reject };
      sock.write(`${tag} ${cmd}\r\n`);
    });
  }

  return { ready, command, close: () => { try { sock.write(`a${++n} LOGOUT\r\n`); } catch { /* ignore */ } sock.end(); } };
}

const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const IMAP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Recent messages from one account's inbox, newest first: [{ uid, raw: Buffer, received }].
export async function fetchRecent(account, { since, max = 30, session = imapSession } = {}) {
  const s = session({ host: account.host });
  try {
    await s.ready;
    const pass = account.host === 'imap.gmail.com' ? account.pass.replace(/\s+/g, '') : account.pass;
    const caps = (await s.command(`LOGIN ${q(account.user)} ${q(pass)}`)).map((r) => r.text).join(' ');
    await s.command('EXAMINE INBOX'); // read-only: nothing gets marked as read
    const d = new Date(since);
    const imapDate = `${d.getDate()}-${IMAP_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
    const gmail = /X-GM-EXT-1/i.test(caps) || account.host === 'imap.gmail.com';
    const search = gmail ? `UID SEARCH X-GM-RAW ${q(`after:${Math.floor(d.getTime() / 1000)} -category:promotions -in:chats`)}` : `UID SEARCH SINCE ${imapDate}`;
    const found = (await s.command(search)).map((r) => r.text).find((t) => /^\* SEARCH/i.test(t)) || '';
    const uids = found.replace(/^\* SEARCH/i, '').trim().split(/\s+/).filter(Boolean).map(Number).sort((a, b) => b - a).slice(0, max);
    if (!uids.length) return [];
    const rows = await s.command(`UID FETCH ${uids.join(',')} (UID INTERNALDATE BODY.PEEK[]<0.30000>)`);
    const out = [];
    for (const r of rows) {
      if (!/^\* \d+ FETCH/i.test(r.text) || !r.literals.length) continue;
      const uid = Number(r.text.match(/UID (\d+)/i)?.[1]);
      const received = Date.parse(r.text.match(/INTERNALDATE "([^"]+)"/i)?.[1] || '') || Date.now();
      if (received < since) continue;
      out.push({ uid, raw: r.literals[r.literals.length - 1], received });
    }
    return out.sort((a, b) => b.received - a.received);
  } finally {
    s.close();
  }
}

// ---- Reading a message ----------------------------------------------------------------------------
// Headers sent as raw UTF-8 (not =?utf-8?…?=) arrive here as Latin-1; put them back.
const fixUtf8 = (s) => (/[\u00c2-\u00f4][\u0080-\u00bf]/.test(s) ? Buffer.from(s, 'latin1').toString('utf8') : s);

function decodeWords(s) {
  return fixUtf8(String(s || '')).replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_, cs, enc, txt) => {
    const bytes = enc.toLowerCase() === 'b' ? Buffer.from(txt, 'base64') : qp(txt.replace(/_/g, ' '));
    return decodeCharset(bytes, cs);
  }).replace(/\?=\s+=\?/g, '');
}

function qp(s) {
  const out = [];
  const t = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9a-f]{2}$/i.test(t.slice(i + 1, i + 3))) { out.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; } else out.push(t.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

function decodeCharset(bytes, charset = 'utf-8') {
  try { return new TextDecoder(charset.trim().toLowerCase().replace(/^(ascii|us-ascii)$/, 'utf-8'), { fatal: false }).decode(bytes); } catch { return Buffer.from(bytes).toString('utf8'); }
}

function splitHead(raw) {
  const s = raw.toString('latin1');
  const i = s.search(/\r?\n\r?\n/);
  const head = i < 0 ? s : s.slice(0, i);
  const body = i < 0 ? '' : s.slice(i).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) headers[m[1].toLowerCase()] = headers[m[1].toLowerCase()] ? `${headers[m[1].toLowerCase()]}, ${m[2]}` : m[2];
  }
  return { headers, body };
}

const param = (h, name) => (h || '').match(new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, 'i'))?.[1];

// { text, html, ics } from a (possibly multipart) body, decoded.
function parts(headers, body, out = { text: '', html: '', ics: '' }, depth = 0) {
  const type = (headers['content-type'] || 'text/plain').toLowerCase();
  if (type.startsWith('multipart/') && depth < 5) {
    const boundary = param(headers['content-type'], 'boundary');
    if (!boundary) return out;
    for (const chunk of body.split(`--${boundary}`).slice(1)) {
      if (chunk.startsWith('--')) break;
      const p = splitHead(Buffer.from(chunk.replace(/^\r?\n/, ''), 'latin1'));
      parts(p.headers, p.body, out, depth + 1);
    }
    return out;
  }
  const enc = (headers['content-transfer-encoding'] || '').toLowerCase();
  const bytes = enc === 'base64' ? Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64') : enc === 'quoted-printable' ? qp(body) : Buffer.from(body, 'latin1');
  const text = decodeCharset(bytes, param(headers['content-type'], 'charset') || 'utf-8');
  if (type.startsWith('text/calendar') || /\.ics"?$/i.test(param(headers['content-disposition'], 'filename') || '')) out.ics ||= text;
  else if (type.startsWith('text/plain') && !/attachment/i.test(headers['content-disposition'] || '')) out.text ||= text;
  else if (type.startsWith('text/html')) out.html ||= text;
  return out;
}

export function htmlToText(html) {
  return html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

export function parseMessage(raw) {
  const { headers, body } = splitHead(Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8'));
  const p = parts(headers, body);
  const text = (p.text || htmlToText(p.html)).replace(/\r/g, '').replace(/[ \t]+/g, ' ').split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const from = decodeWords(headers.from || '');
  return {
    id: (headers['message-id'] || '').trim() || `${headers.date}|${headers.subject}`,
    from, fromName: from.replace(/<[^>]*>/, '').replace(/"/g, '').trim() || from, fromAddr: (from.match(/<([^>]+)>/)?.[1] || from).toLowerCase(),
    subject: decodeWords(headers.subject || '').replace(/\s+/g, ' ').trim(),
    bulk: Boolean(headers['list-unsubscribe'] || /bulk|list|junk/i.test(headers.precedence || '')),
    text: text.slice(0, 4000),
    ics: p.ics,
  };
}

// ---- Calendar invites --------------------------------------------------------------------------------
export function parseIcs(ics, tz = process.env.TZ) {
  const lines = String(ics).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  if (lines.some((l) => /^METHOD:CANCEL/i.test(l))) return null;
  const get = (k) => lines.find((l) => l.toUpperCase().startsWith(`${k}:`) || l.toUpperCase().startsWith(`${k};`));
  const val = (l) => (l ? l.slice(l.indexOf(':') + 1).replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim() : '');
  const when = (l) => {
    const v = val(l);
    const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if (!m) return null;
    if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null };
    if (/Z$/.test(v)) {
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
      const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
      const g = (t) => f.find((x) => x.type === t).value;
      return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
    }
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
  };
  const start = when(get('DTSTART'));
  if (!start) return null;
  const end = when(get('DTEND'));
  return { title: val(get('SUMMARY')) || 'Meeting', ...start, endTime: end && end.date === start.date ? end.time : null, location: val(get('LOCATION')) };
}

// ---- Finding what matters ----------------------------------------------------------------------------
const SENSITIVE = /\b(otp|one[- ]time (?:pass(?:word|code)|code)|verification code|security code|passcode|password reset|reset your password|login code|2fa|two[- ]factor)\b/i;
const NOISE = /\b(receipt|invoice|order (?:confirmed|shipped|delivered)|your order|payment (?:received|successful)|statement is ready|newsletter|digest|unsubscribe|sale|% off|offer ends|promo|webinar replay)\b/i;
const EVENTY = /\b(interview|meeting|call|exam|quiz|test|viva|presentation|seminar|workshop|lecture|class|lab|appointment|session|orientation|hackathon|deadline|due|submission|submit|assignment|registration closes|last date|rescheduled|postponed)\b/i;

export function worthReading(m) {
  return !SENSITIVE.test(`${m.subject} ${m.text.slice(0, 600)}`);
}

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

function suggestion(m, item, account) {
  const src = `${clip(m.fromName, 40)} · “${clip(m.subject || '(no subject)', 60)}”`;
  const id = `mail:${hash(m.id)}:${slug(item.title)}`;
  if (item.type === 'event') {
    return { id, title: `Add to calendar: ${item.title} — ${D.fmtDate(item.date)}${item.time ? ` ${D.fmtTime(item.time)}` : ''}`,
      why: `${item.via === 'invite' ? 'Calendar invite' : 'From email'}: ${src}${account ? ` (${account})` : ''}`, expires: item.date,
      action: { type: 'addEvent', title: item.title, date: item.date, time: item.time || null, endTime: item.endTime || null, notes: item.location || '' } };
  }
  return { id, title: `Add task: ${item.title}${item.date ? ` (due ${D.fmtDate(item.date)})` : ''}`, why: `From email: ${src}${account ? ` (${account})` : ''}`,
    expires: item.date || null, action: { type: 'addTask', title: item.title, due: item.date || null } };
}

// Without AI: an obvious date (and maybe time) in the subject of a non-bulk, event-like email.
export function ruleItems(m, today) {
  if (m.bulk || NOISE.test(m.subject) || !EVENTY.test(m.subject)) return [];
  const p = parseSmart(m.subject, today);
  if (!p.date || p.date < today) return [];
  const title = p.title.replace(/^(?:re|fwd?|reminder|invitation|invite|updated invitation)\s*:\s*/i, '').replace(/[\s:|-]+$/, '').trim();
  if (title.length < 3) return [];
  const due = /\b(deadline|due|submission|submit|assignment|last date|registration closes)\b/i.test(m.subject);
  return [due ? { type: 'task', title, date: p.date } : { type: 'event', title, date: p.date, time: p.time, endTime: p.endTime }];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}$/;

// With AI: one call for a batch of emails. Returns [{ n, type, title, date, time, endTime, why }].
export async function aiItems(ai, mails, today) {
  if (!mails.length) return [];
  const weekday = D.DAY_NAMES[D.weekday(today)];
  const text = await ai.chat([
    { role: 'system', content: 'You triage a student\'s recent emails (college and personal, including LinkedIn/X/WhatsApp notification emails) for their personal planner. '
      + 'Reply with JSON only: {"items":[{"email":<number>,"type":"event"|"task"|"fyi","title":"<short, specific>","date":"YYYY-MM-DD" or null,"time":"HH:MM" or null,"endTime":"HH:MM" or null,"why":"<under 12 words>"}]}. '
      + 'event = something they should attend at a date (and time if given): classes moved, exams, interviews, meetings, calls, events they registered for. '
      + 'task = something they must do, with its deadline if one is given: submissions, forms, replies owed, payments due. '
      + 'fyi = worth their attention but no action: a real person reaching out (recruiter, professor, friend), an important announcement, an opportunity that fits a student. '
      + 'Ignore marketing, newsletters, receipts, routine notifications and anything already past. Never invent dates or times. '
      + `Today is ${weekday} ${today}; turn relative dates into YYYY-MM-DD. At most 8 items; if nothing matters, reply {"items":[]}.` },
    { role: 'user', content: mails.map((m, i) => `Email ${i + 1}\nFrom: ${m.fromName} <${m.fromAddr}>\nSubject: ${m.subject}\n${m.bulk ? '(sent to a mailing list)\n' : ''}${m.text.slice(0, 700)}`).join('\n\n---\n\n') },
  ], { maxTokens: 1400 });
  const json = parseJson(text);
  if (!json || !Array.isArray(json.items)) throw new Error('AI reply was not the expected JSON');
  const out = [];
  for (const it of json.items.slice(0, 8)) {
    const n = Number(it?.email);
    const title = String(it?.title || '').replace(/\s+/g, ' ').trim();
    if (!mails[n - 1] || title.length < 3 || title.length > 120 || !['event', 'task', 'fyi'].includes(it.type)) continue;
    const date = DAY.test(it.date || '') ? it.date : null;
    if (it.type === 'event' && (!date || date < today)) continue;
    out.push({ n, type: it.type, title, date, time: HM.test(it.time || '') ? it.time : null, endTime: HM.test(it.endTime || '') ? it.endTime : null, why: String(it.why || '').slice(0, 100) });
  }
  return out;
}

// ---- The job -----------------------------------------------------------------------------------------
// Returns a result for A.record(), and updates `state.mail` ({ lastScan, seen }).
export async function mailScan({ accounts, state, ai = null, useAI = false, date = D.today(), now = Date.now(), fetchImpl = fetchRecent, hostOf = imapHost }) {
  const mailState = { lastScan: 0, seen: [], ...(state.mail || {}) };
  const since = Math.max(mailState.lastScan - 3600000, now - 3 * 86400000); // an hour of overlap, at most 3 days back
  const seen = new Set(mailState.seen);
  const suggestions = [];
  const fyi = [];
  const errors = [];
  let scanned = 0;
  let aiStatus = useAI ? (ai ? 'ok' : 'no key') : 'off';

  for (const acc of accounts) {
    const label = acc.user.split('@')[1];
    let msgs;
    try {
      msgs = await fetchImpl({ ...acc, host: acc.host || await hostOf(acc.user) }, { since });
    } catch (e) {
      const refused = /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication failed|BasicAuthBlocked/i.test(e.message);
      const outlook = /office365|outlook/.test(acc.host || '') || /outlook|office365/i.test(e.message);
      errors.push(`${label}: ${refused ? (outlook ? 'sign-in refused (Microsoft 365 blocks passwords — forward this mail to Gmail instead)' : 'sign-in refused — check the app password') : e.message.split(acc.pass).join('…').slice(0, 80)}`);
      continue;
    }
    const fresh = msgs.map((x) => ({ ...parseMessage(x.raw), received: x.received })).filter((m) => !seen.has(hash(m.id)));
    scanned += fresh.length;
    for (const m of fresh) {
      seen.add(hash(m.id));
      const inv = m.ics ? parseIcs(m.ics) : null;
      if (inv && inv.date >= date) suggestions.push(suggestion(m, { type: 'event', via: 'invite', ...inv }, label));
    }
    const rest = fresh.filter((m) => !m.ics && worthReading(m));
    if (useAI && ai) {
      const batch = rest.filter((m) => !NOISE.test(m.subject)).slice(0, 20);
      try {
        for (const it of await aiItems(ai, batch, date)) {
          const m = batch[it.n - 1];
          if (it.type === 'fyi') fyi.push(`${clip(m.fromName, 30)}: ${clip(it.title, 80)}${it.why ? ` — ${it.why}` : ''}`);
          else suggestions.push(suggestion(m, it, label));
        }
      } catch (e) {
        aiStatus = 'error';
        for (const m of rest) for (const it of ruleItems(m, date)) suggestions.push(suggestion(m, it, label));
        errors.push(`AI: ${e.message.slice(0, 60)}`);
      }
    } else {
      for (const m of rest) for (const it of ruleItems(m, date)) suggestions.push(suggestion(m, it, label));
    }
  }

  state.mail = { lastScan: errors.length === accounts.length && accounts.length ? mailState.lastScan : now, seen: [...seen].slice(-400) };
  const lines = [];
  if (suggestions.length) lines.push(`📬 ${suggestions.length} from email to add — see “Waiting for you”`);
  for (const f of fyi.slice(0, 6)) lines.push(`👀 ${f}`);
  for (const e of errors) lines.push(`⚠️ Couldn’t check ${e}`);
  if (!lines.length) lines.push(`📬 Checked ${scanned} new ${scanned === 1 ? 'email' : 'emails'}: nothing needs you.`);
  const counts = [suggestions.length ? `${suggestions.length} from email` : null, fyi.length ? `${fyi.length} worth a look` : null].filter(Boolean);
  return {
    job: 'mail-scan', date, lines, counts, suggestions, expires: D.addDays(date, 3),
    notification: { title: 'Email', url: '#/agent', tag: 'daybook-mail', quietIfEmpty: true },
    stats: { scanned, accounts: accounts.length, errors: errors.length, ai: aiStatus },
  };
}
