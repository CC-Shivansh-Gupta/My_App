#!/usr/bin/env node
// Runs one Daybook agent job against your sync gist:
//   DAYBOOK_GIST_TOKEN=ghp_… node agent/run.mjs morning-brief
// It's meant for a scheduled GitHub Action in a PRIVATE repo (see "Agent setup" in README.md).
// It never prints your data, only counts, so the Actions log stays safe to read.

import { pathToFileURL } from 'node:url';
import * as store from '../app/js/store.js';
import * as D from '../app/js/dates.js';
import { runMorningBrief } from '../app/js/agent.js';
import { client } from './gist.mjs';
import { generateVapidKeys, sendPush } from './webpush.mjs';

export const JOBS = ['morning-brief'];

export async function run({ token, gistId, job = 'morning-brief', subject, fetchImpl = fetch, now = Date.now(), date = D.today() }) {
  if (!JOBS.includes(job)) throw new Error(`Unknown job "${job}". Jobs: ${JOBS.join(', ')}`);
  const gh = client(token, fetchImpl);
  const id = gistId || await gh.find();
  const { data, agent } = await gh.read(id);
  store.reset(data);

  // Push keys are made on the first run and kept in the gist. The app reads the
  // public half from your preferences to subscribe each device.
  let agentState = agent;
  let agentChanged = false;
  if (!agentState.vapid) {
    agentState = { ...agentState, vapid: generateVapidKeys() };
    agentChanged = true;
  }
  const publicKey = agentState.vapid.publicKey;
  if (store.pref('agentPush', null)?.publicKey !== publicKey) store.setPref('agentPush', { publicKey });

  const { stats, notification } = runMorningBrief(date, now);

  // Pull again just before writing, so anything a device synced during the run is kept.
  const save = async () => {
    const fresh = await gh.read(id);
    store.merge(fresh.data);
    await gh.write(id, { data: store.snapshot(), agent: agentChanged ? agentState : null });
    agentChanged = false;
  };
  await save();

  let sent = 0; let dropped = 0; let failed = 0;
  for (const sub of store.all('pushSubs')) {
    if (sub.publicKey !== publicKey) { store.remove('pushSubs', sub.id); dropped++; continue; }
    try {
      const r = await sendPush(sub, notification, agentState.vapid, { subject, fetchImpl });
      if (r.ok) sent++;
      else if (r.gone) { store.remove('pushSubs', sub.id); dropped++; }
      else failed++;
    } catch {
      failed++;
    }
  }
  if (dropped) await save();

  return { ...stats, sent, dropped, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.DAYBOOK_GIST_TOKEN;
  if (!token) {
    console.error('DAYBOOK_GIST_TOKEN is not set. Add your Daybook sync token as an Actions secret with that name.');
    process.exit(1);
  }
  const job = process.argv[2] || 'morning-brief';
  run({
    token, job,
    gistId: process.env.DAYBOOK_GIST_ID || undefined,
    subject: process.env.DAYBOOK_URL || 'https://cc-shivansh-gupta.github.io/My_App/',
  }).then((r) => {
    console.log(`${job} done for ${D.today()}: ${r.suggested} new suggestions, ${r.done} done automatically, ${r.waiting} waiting for you; `
      + `notified ${r.sent} device(s)${r.dropped ? `, removed ${r.dropped} stale` : ''}${r.failed ? `, ${r.failed} failed` : ''}.`);
    if (r.failed && !r.sent) process.exitCode = 1;
  }).catch((e) => {
    console.error(`Agent failed: ${e.message}`);
    process.exit(1);
  });
}
