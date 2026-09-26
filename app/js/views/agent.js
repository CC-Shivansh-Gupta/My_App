// Agent: the morning brief, suggestions waiting for your OK, what the agent may
// do on its own, notifications for this device, and a log of every run.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as A from '../agent.js';
import { h, icon, section, empty, segmented, toast } from '../ui.js';

const SUB_KEY = 'daybook.pushSub';
const WORKFLOW_URL = 'https://github.com/CC-Shivansh-Gupta/second-brain/actions/workflows/daybook-agent.yml';
const SECRETS_URL = 'https://github.com/CC-Shivansh-Gupta/second-brain/settings/secrets/actions/new';

export function render(ctx) {
  const ran = A.runs(1).length > 0;
  return h('div', { class: 'page narrow' },
    h('header', { class: 'page-head' }, h('h1', null, 'Agent'),
      h('p', { class: 'muted' }, 'A morning brief and suggestions from the agent in your second-brain repo. Nothing changes until you approve it.')),
    ran ? null : setupCard(),
    briefCard(), inboxCard(), notifyCard(ctx), autonomyCard(), logCard());
}

// ---- Today card ----------------------------------------------------------------------------------
export function todayCard() {
  const brief = A.latestBrief(D.today());
  const list = A.pending();
  if (!brief && !list.length) return null;
  return section('Agent', h('a', { class: 'btn ghost sm', href: '#/agent' }, list.length ? `${list.length} to review` : 'Open'),
    brief ? h('ul', { class: 'brief-lines' }, brief.brief.map((l) => h('li', null, l))) : null,
    list.length ? h('ul', { class: 'list compact' }, list.slice(0, 3).map(suggestionRow)) : null);
}

export function pendingCount() {
  return A.pending().length;
}

function suggestionRow(s) {
  return h('li', { class: 'row agent-sugg' },
    h('span', { class: 'row-emoji' }, A.ACTIONS[s.action?.type]?.emoji || '🤖'),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, s.title), s.why ? h('span', { class: 'row-sub' }, s.why) : null),
    h('button', { class: 'icon-btn sm', 'aria-label': 'Dismiss', 'data-tip': 'Dismiss', onclick: () => { A.dismiss(s); toast('Dismissed'); } }, icon('close', 18)),
    h('button', { class: 'icon-btn sm good', 'aria-label': 'Approve', 'data-tip': 'Approve', onclick: () => {
      const did = A.approve(s);
      toast(did || 'Nothing left to do there');
    } }, icon('check', 18)));
}

// ---- Page cards ---------------------------------------------------------------------------------
function briefCard() {
  const brief = A.latestBrief(D.today());
  return section('This morning', brief ? h('span', { class: 'count' }, new Date(brief.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : null,
    brief ? h('ul', { class: 'brief-lines' }, brief.brief.map((l) => h('li', null, l)))
      : empty('No brief yet today. The agent runs every morning at about 7.'));
}

function inboxCard() {
  const list = A.pending();
  return section('Waiting for you', list.length > 1
    ? h('button', { class: 'btn ghost sm', onclick: () => {
        const done = list.map(A.approve).filter(Boolean).length;
        toast(`Approved ${list.length}${done < list.length ? ` (${list.length - done} had nothing left to do)` : ''}`);
      } }, 'Approve all') : null,
    list.length ? h('ul', { class: 'list' }, list.map(suggestionRow)) : empty('Nothing to approve.'));
}

function autonomyCard() {
  return section('What it may do on its own', null,
    h('p', { class: 'small muted' }, 'Start with “Ask me first”. Once its suggestions are reliably right, let it just do that kind of thing; it will still log what it did.'),
    h('div', { class: 'form' }, Object.entries(A.ACTIONS).map(([type, a]) => h('div', { class: 'field' },
      h('span', { class: 'field-label' }, `${a.emoji} ${a.label}`),
      segmented([['ask', 'Ask me first'], ['act', 'Just do it']], A.autonomy(type), (v) => A.setAutonomy(type, v), { small: true })))));
}

function logCard() {
  const list = A.runs(15);
  const decisions = A.decided(8);
  return section('Activity', null,
    list.length ? h('ul', { class: 'list compact' }, list.map((r) => h('li', { class: 'row agent-run' },
      h('span', { class: 'row-emoji' }, '🤖'),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, `Morning brief · ${D.fmtDate(r.date)}`),
        h('span', { class: 'row-sub' }, r.summary),
        ...(r.did || []).map((d) => h('span', { class: 'row-sub' }, `✓ ${d}`))),
      h('span', { class: 'row-sub' }, new Date(r.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })))))
      : empty('No runs yet.'),
    decisions.length ? h('div', { class: 'sub-block' }, h('p', { class: 'sub-head' }, 'Recent decisions'),
      h('ul', { class: 'list compact' }, decisions.map((s) => h('li', { class: 'row' },
        h('span', { class: 'row-emoji' }, { approved: '✅', dismissed: '✖️', auto: '🤖' }[s.status] || '•'),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, s.title),
          h('span', { class: 'row-sub' }, `${{ approved: 'Approved', dismissed: 'Dismissed', auto: 'Done automatically' }[s.status] || s.status} · ${D.fmtDate(D.toStr(new Date(s.decidedAt)))}`)))))) : null);
}

function setupCard() {
  return section('Set up the agent (once, free)', h('span', { class: 'badge' }, 'Not running yet'),
    h('p', { class: 'small' }, 'The agent runs in your private second-brain repo on GitHub Actions, so it costs nothing and your data never touches a public repo.'),
    h('ol', { class: 'small steps' },
      h('li', null, 'Turn on sync on this device first (Settings → Sync).'),
      h('li', null, h('a', { href: SECRETS_URL, target: '_blank', rel: 'noopener' }, 'Add a repository secret'), ' in second-brain named ', h('code', null, 'DAYBOOK_GIST_TOKEN'), ' and paste the same token you use for sync.'),
      h('li', null, h('a', { href: WORKFLOW_URL, target: '_blank', rel: 'noopener' }, 'Open the Daybook agent workflow'), ' and press “Run workflow” once. After that it runs by itself every morning.'),
      h('li', null, 'Come back here and turn on notifications for each device you want the brief on.')));
}

// ---- Notifications -------------------------------------------------------------------------------
function b64uToBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function hashId(str) {
  let x = 2166136261;
  for (const c of str) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
  return `sub-${(x >>> 0).toString(36)}`;
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  return 'Laptop';
}

function localSubId() {
  try { return localStorage.getItem(SUB_KEY); } catch { return null; }
}

function setLocalSubId(id) {
  try { if (id) localStorage.setItem(SUB_KEY, id); else localStorage.removeItem(SUB_KEY); } catch { /* ignore */ }
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function enablePush(ctx) {
  const key = store.pref('agentPush', null)?.publicKey;
  if (!key) { toast('Run the agent once first, then sync, so this device gets its key'); return; }
  if (!pushSupported()) {
    toast(/iPad|iPhone|Macintosh/.test(navigator.userAgent) ? 'Add Daybook to your Home Screen first, then open it from there' : 'This browser can’t receive notifications');
    return;
  }
  if (await Notification.requestPermission() !== 'granted') { toast('Notifications are blocked for Daybook in this browser'); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe(); // it may belong to an older key
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
    const j = sub.toJSON();
    const id = hashId(j.endpoint);
    const old = localSubId();
    if (old && old !== id) store.remove('pushSubs', old);
    store.put('pushSubs', { id, endpoint: j.endpoint, keys: j.keys, publicKey: key, device: deviceName() });
    setLocalSubId(id);
    toast('Notifications on for this device');
  } catch (e) {
    toast(`Couldn’t turn on notifications: ${e.message}`);
  }
  ctx.rerender();
}

async function disablePush(ctx) {
  try {
    const reg = await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
  } catch { /* ignore */ }
  const id = localSubId();
  if (id) store.remove('pushSubs', id);
  setLocalSubId(null);
  toast('Notifications off for this device');
  ctx.rerender();
}

async function testNotification() {
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('Daybook', { body: 'Notifications work on this device.', icon: 'icons/icon-192.png', tag: 'daybook-test' });
  } catch (e) {
    toast(`Couldn’t show a notification: ${e.message}`);
  }
}

function notifyCard(ctx) {
  const id = localSubId();
  const on = Boolean(id && store.get('pushSubs', id)) && pushSupported() && Notification.permission === 'granted';
  const others = store.all('pushSubs').filter((s) => s.id !== id);
  return section('Notifications', h('span', { class: ['badge', on && 'good'] }, on ? 'On for this device' : 'Off for this device'),
    h('p', { class: 'small muted' }, 'The brief arrives as a notification with counts only (no titles), so nothing private shows on your lock screen. On iPhone and iPad, open Daybook from the Home Screen icon first (iOS 16.4 or later).'),
    others.length ? h('p', { class: 'small' }, `Also on: ${others.map((s) => s.device || 'another device').join(', ')}`) : null,
    h('div', { class: 'btn-row' },
      on ? h('button', { class: 'btn ghost', onclick: testNotification }, 'Test') : null,
      on ? h('button', { class: 'btn ghost', onclick: () => disablePush(ctx) }, 'Turn off')
        : h('button', { class: 'btn primary', onclick: () => enablePush(ctx) }, 'Turn on for this device')));
}
