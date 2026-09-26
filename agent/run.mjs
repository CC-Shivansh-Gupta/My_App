#!/usr/bin/env node
// Runs Daybook agent jobs against your sync gist:
//   DAYBOOK_GIST_TOKEN=ghp_… node agent/run.mjs [auto|morning-brief|evening-checkin|weekly-review]
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

const BUILD = { 'morning-brief': A.morningBrief, 'evening-checkin': A.eveningCheckin, 'weekly-review': A.weeklyReview };
export const JOBS = Object.keys(BUILD);

// Which jobs "auto" runs at this local time.
export function plan(job, now = new Date()) {
  if (job !== 'auto') return [job];
  if (now.getHours() < 14) return ['morning-brief'];
  return now.getDay() === 0 ? ['evening-checkin', 'weekly-review'] : ['evening-checkin'];
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

export async function run({ token, gistId, job = 'auto', subject, ai = null, fetchImpl = fetch, now = Date.now(), date = D.today() }) {
  const jobs = plan(job, new Date(now));
  for (const j of jobs) if (!BUILD[j]) throw new Error(`Unknown job "${j}". Jobs: auto, ${JOBS.join(', ')}`);
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
  for (const j of jobs) {
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
  const ai = process.env.AI_API_KEY
    ? aiClient({ apiKey: process.env.AI_API_KEY, baseUrl: process.env.AI_BASE_URL || undefined, model: process.env.AI_MODEL || '' })
    : null;
  run({
    token, ai,
    job: process.argv[2] || 'auto',
    gistId: process.env.DAYBOOK_GIST_ID || undefined,
    subject: process.env.DAYBOOK_URL || 'https://cc-shivansh-gupta.github.io/My_App/',
  }).then((r) => {
    for (const j of r.jobs) {
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
