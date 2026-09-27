#!/usr/bin/env node
// Runs Daybook agent jobs against your sync gist:
//   DAYBOOK_GIST_TOKEN=ghp_… node agent/run.mjs [auto|morning-brief|evening-checkin|weekly-review|mail-scan|ask-claude]
// With CLAUDE_CODE_OAUTH_TOKEN set, every run also answers Jarvis's "ask Claude" requests (agent/claude.mjs).
// "auto" is the manager: mornings run the brief; evenings run the check-in,
// plus the weekly review on Sundays. It's meant for a scheduled GitHub Action
// in a PRIVATE repo (see "Agent setup" in README.md).
// It never prints your data, only counts, so the Actions log stays safe to read.

import { pathToFileURL } from 'node:url';
import * as store from '../app/js/store.js';
import * as D from '../app/js/dates.js';
import * as A from '../app/js/agent.js';
import { client } from './gist.mjs';
import { generateVapidKeys, sendPush } from './webpush.mjs';
import { aiClient, summarize, findTasks } from './ai.mjs';
import { mailScan, parseAccounts } from './mail.mjs';
import { claudeClient } from './claude.mjs';
import * as asks from '../app/js/jarvis/asks.js';
import { buildMessages, parseReply } from '../app/js/jarvis/core.js';
import { snapshot } from '../app/js/jarvis/context.js';

const BUILD = { 'morning-brief': A.morningBrief, 'evening-checkin': A.eveningCheckin, 'weekly-review': A.weeklyReview };
export const JOBS = [...Object.keys(BUILD), 'mail-scan', 'ask-claude'];

// Which jobs "auto" runs at this local time. With email set up, it's checked first, so the
// brief and check-in include what just arrived.
export function plan(job, now = new Date(), { mail = false } = {}) {
  if (job !== 'auto') return [job];
  const first = mail ? ['mail-scan'] : [];
  if (now.getHours() < 14) return [...first, 'morning-brief'];
  return now.getDay() === 0 ? [...first, 'evening-checkin', 'weekly-review'] : [...first, 'evening-checkin'];
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

// The optional AI part of a job. Returns `extra` for A.record(). Never throws.
async function aiStep(ai, job, result, state, now) {
  const want = A.aiSettings();
  if (job === 'evening-checkin' || (!want.summary && !(want.notes && job === 'morning-brief'))) return { ai: { status: 'off' } };
  if (!ai) return { ai: { status: 'no key' } };
  const extra = { ai: { status: 'ok' }, suggestions: [] };
  try {
    if (want.summary) extra.summary = await summarize(ai, { title: A.JOBS[job].title, date: result.date, lines: result.lines });
    if (want.notes && job === 'morning-brief') {
      const since = state.notesScannedAt || now - 3 * 86400000;
      const notes = store.all('notes').filter((n) => n.updatedAt > since && (n.text || '').trim())
        .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 15)
        .map((n) => ({ id: n.id, text: n.text.slice(0, 1000) }));
      const tasks = await findTasks(ai, notes, result.date);
      for (const t of tasks) {
        const note = store.get('notes', t.noteId);
        const first = (note?.text || '').split('\n')[0].trim();
        extra.suggestions.push({
          id: `note:${t.noteId}:${slug(t.title)}`, title: `Add task: ${t.title}${t.due ? ` (due ${D.fmtDate(t.due)})` : ''}`,
          why: `Found by AI in your note “${first.length > 50 ? `${first.slice(0, 50)}…` : first}”`,
          action: { type: 'addTask', title: t.title, due: t.due },
        });
      }
      state.notesScannedAt = now;
      extra.ai.notes = notes.length;
    }
    extra.ai.model = ai.model();
  } catch (e) {
    extra.ai = { status: 'error', error: e.message.slice(0, 80) };
  }
  return extra;
}

// "Ask Claude …" requests from Jarvis: answer each with the best AI there is (Claude Code on your
// plan when it's set up). The commands in an answer wait in the app until you approve them.
export async function answerAsks(ai, { date, now }) {
  const list = asks.pending().slice(0, 5);
  let answered = 0; let errors = 0;
  const d = new Date(now);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  for (const a of list) {
    try {
      const msgs = buildMessages({ text: `${a.text}\n\n(Queued request: you won't see results, so include every command needed in "do". Take time to think it through.)`,
        name: 'Claude', user: store.pref('userName', ''), date, time, snapshot: snapshot(date, d) });
      const reply = parseReply(await ai.chat(msgs, { maxTokens: 1500 }));
      if (!reply) throw new Error('unreadable answer');
      asks.answer(a, { say: [reply.say, reply.ask].filter(Boolean).join(' '), commands: reply.do, model: ai.model() });
      answered++;
    } catch (e) {
      asks.answer(a, { error: String(e.message || e).slice(0, 80) });
      errors++;
    }
  }
  asks.prune(now);
  return { answered, errors, waiting: asks.pending().length };
}

export async function run({ token, gistId, job = 'auto', subject, ai = null, claude = null, fetchImpl = fetch, now = Date.now(), date = D.today(), mail = [], mailFetch }) {
  const jobs = plan(job, new Date(now), { mail: mail.length > 0 });
  for (const j of jobs) if (!JOBS.includes(j)) throw new Error(`Unknown job "${j}". Jobs: auto, ${JOBS.join(', ')}`);
  // Nothing to check: don't touch the gist at all.
  // (With Claude set up, the run still goes on to answer any “ask Claude” requests.)
  if (jobs.length === 1 && jobs[0] === 'mail-scan' && !mail.length && !claude) {
    return { jobs: [{ job: 'mail-scan', suggested: 0, done: 0, waiting: 0, notified: false, ai: 'off', skipped: 'no MAIL_ACCOUNTS secret' }], sent: 0, dropped: 0, failed: 0 };
  }
  const gh = client(token, fetchImpl);
  const id = gistId || await gh.find();
  const { data, agent } = await gh.read(id);
  store.reset(data);

  // Push keys are made on the first run and kept in the gist. The app reads the
  // public half from your preferences to subscribe each device.
  const state = { ...agent };
  if (!state.vapid) state.vapid = generateVapidKeys();
  const publicKey = state.vapid.publicKey;
  if (store.pref('agentPush', null)?.publicKey !== publicKey) store.setPref('agentPush', { publicKey });

  const results = [];
  if (claude) store.setPref('claudeAgentSeen', true);
  const asker = claude || ai;
  if (asker && asks.pending().length) {
    const r = await answerAsks(asker, { date, now });
    results.push({ job: 'ask-claude', suggested: 0, done: 0, waiting: r.waiting, answered: r.answered, errors: r.errors, ai: asker.kind === 'claude' ? 'claude' : 'ok',
      notification: r.answered ? { title: 'Claude answered', body: `${r.answered} ${r.answered === 1 ? 'request' : 'requests'} ready to review`, url: '#/jarvis', tag: 'daybook-claude' } : null });
  }
  for (const j of jobs) {
    if (j === 'ask-claude') continue; // answered above, whenever any are waiting
    if (j === 'mail-scan') {
      if (!mail.length) { results.push({ job: j, suggested: 0, done: 0, waiting: A.pending().length, notification: null, ai: 'off', skipped: 'no MAIL_ACCOUNTS secret' }); continue; }
      const built = await mailScan({ accounts: mail, state, ai, useAI: A.aiSettings().mail, date, now, ...(mailFetch ? { fetchImpl: mailFetch } : {}) });
      const { stats, notification } = A.record(built, { now, extra: { ai: { status: built.stats.ai } } });
      results.push({ job: j, ...stats, notification, ai: built.stats.ai, scanned: built.stats.scanned, accounts: built.stats.accounts, errors: built.stats.errors });
      continue;
    }
    const built = BUILD[j](date);
    const extra = await aiStep(ai, j, built, state, now);
    const { stats, notification } = A.record(built, { now, extra });
    results.push({ job: j, ...stats, notification, ai: extra.ai.status });
  }

  // Pull again just before writing, so anything a device synced during the run is kept.
  let agentFile = JSON.stringify(agent);
  const save = async () => {
    const fresh = await gh.read(id);
    store.merge(fresh.data);
    const changed = JSON.stringify(state) !== agentFile;
    await gh.write(id, { data: store.snapshot(), agent: changed ? state : null });
    agentFile = JSON.stringify(state);
  };
  await save();

  let sent = 0; let dropped = 0; let failed = 0;
  const notes = results.map((r) => r.notification).filter(Boolean);
  for (const sub of store.all('pushSubs')) {
    if (sub.publicKey !== publicKey) { store.remove('pushSubs', sub.id); dropped++; continue; }
    for (const n of notes) {
      try {
        const r = await sendPush(sub, n, state.vapid, { subject, fetchImpl });
        if (r.ok) sent++;
        else if (r.gone) { store.remove('pushSubs', sub.id); dropped++; break; }
        else failed++;
      } catch {
        failed++;
      }
    }
  }
  if (dropped) await save();

  return { jobs: results.map(({ notification, ...r }) => ({ ...r, notified: Boolean(notification) })), sent, dropped, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.DAYBOOK_GIST_TOKEN;
  if (!token) {
    console.error('DAYBOOK_GIST_TOKEN is not set. Add your Daybook sync token as an Actions secret with that name.');
    process.exit(1);
  }
  const claude = process.env.CLAUDE_CODE_OAUTH_TOKEN
    ? claudeClient({ token: process.env.CLAUDE_CODE_OAUTH_TOKEN, model: process.env.CLAUDE_MODEL || '', bin: process.env.CLAUDE_BIN || '' })
    : null;
  // The other AI steps (summaries, notes, email) use the free API key if there is one, else Claude.
  const ai = process.env.AI_API_KEY
    ? aiClient({ apiKey: process.env.AI_API_KEY, baseUrl: process.env.AI_BASE_URL || undefined, model: process.env.AI_MODEL || '' })
    : claude;
  run({
    token, ai, claude,
    job: process.argv[2] || 'auto',
    mail: parseAccounts(process.env.MAIL_ACCOUNTS || ''),
    gistId: process.env.DAYBOOK_GIST_ID || undefined,
    subject: process.env.DAYBOOK_URL || 'https://cc-shivansh-gupta.github.io/My_App/',
  }).then((r) => {
    for (const j of r.jobs) {
      if (j.job === 'ask-claude') {
        console.log(`ask-claude: ${j.answered} answered${j.errors ? `, ${j.errors} failed (retried next run)` : ''}, ${j.waiting} waiting; AI: ${j.ai}.`);
        continue;
      }
      if (j.job === 'mail-scan') {
        console.log(j.skipped ? `mail-scan: skipped (${j.skipped}).` : `mail-scan: ${j.scanned} new emails in ${j.accounts} account(s)${j.errors ? `, ${j.errors} problem(s) (details on the Agent page)` : ''}; ${j.suggested} new suggestions, ${j.done} done automatically; AI: ${j.ai}.`);
        continue;
      }
      console.log(`${j.job} for ${D.today()}: ${j.suggested} new suggestions, ${j.done} done automatically, ${j.waiting} waiting for you; `
        + `${j.notified ? 'notification sent' : 'nothing to notify'}; AI: ${j.ai}.`);
    }
    console.log(`Push: ${r.sent} delivered${r.dropped ? `, ${r.dropped} stale device(s) removed` : ''}${r.failed ? `, ${r.failed} failed` : ''}.`);
    if (r.failed && !r.sent) process.exitCode = 1;
  }).catch((e) => {
    console.error(`Agent failed: ${e.message}`);
    process.exit(1);
  });
}
