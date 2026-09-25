// Friends: leaderboard, shared feed, challenges and group setup.

import * as store from '../store.js';
import * as D from '../dates.js';
import * as S from '../social.js';
import * as X from '../gamify.js';
import { h, icon, section, empty, segmented, toast, sheet, closeSheet, field } from '../ui.js';
import { addReading } from '../models.js';
import { addWatch } from './watch.js';
import { addLearning } from './learnings.js';
import { TYPE_EMOJI } from '../share.js';

let tab = 'board';
let metric = 'xp';
let activeGid = null;
let rerender = () => {};
let loading = false;
let forceSetup = false; // show join/create even when already in a group

const REACTIONS = ['🔥', '❤️', '👏', '💪', '😂'];
const RULES = `{
  "rules": {
    "groups": {
      "$group": { ".read": true, ".write": true }
    }
  }
}`;

function currentGroup() {
  const gs = S.groups();
  return gs.find((g) => g.gid === activeGid) || gs[0] || null;
}

export async function refreshNow() {
  if (loading || !S.groups().length) return;
  loading = true;
  try { await S.publish(); await S.refreshAll(); } catch { /* offline */ }
  loading = false;
  rerender();
}

export function onLeave() { S.markSeen(); }

export function render(ctx) {
  rerender = ctx.rerender;
  const invite = S.parseInvite(location.hash);
  if (invite && !S.groups().some((g) => g.gid === invite.gid)) return h('div', { class: 'page narrow' }, header(), joinCard(invite));
  if (invite) history.replaceState(null, '', '#/friends');
  const g = currentGroup();
  if (!g || forceSetup) {
    return h('div', { class: 'page narrow' },
      header(g ? h('button', { class: 'btn ghost sm', onclick: () => { forceSetup = false; rerender(); } }, 'Back') : null), setupCards());
  }
  if (!S.groupData(g.gid) && !loading) refreshNow();
  const data = S.groupData(g.gid) || { members: {}, feed: {}, challenges: {} };
  const tabs = segmented([['board', 'Leaderboard'], ['feed', 'Feed'], ['challenges', 'Challenges'], ['group', 'Group']], tab, (v) => { tab = v; ctx.rerender(); }, { small: true });
  const gs = S.groups();
  return h('div', { class: 'page' },
    header(h('button', { class: 'btn ghost sm', onclick: refreshNow }, icon('sync', 16), loading ? 'Syncing…' : 'Refresh')),
    gs.length > 1 ? h('div', { class: 'chips' }, gs.map((x) => h('button', { class: ['chip', x.gid === g.gid && 'on'], onclick: () => { activeGid = x.gid; ctx.rerender(); } }, x.name))) : null,
    h('div', { class: 'tabs-scroll' }, tabs),
    tab === 'feed' ? feedTab(g, data) : tab === 'challenges' ? challengesTab(g, data) : tab === 'group' ? groupTab(g, data) : boardTab(g, data));
}

function header(extra) {
  return h('header', { class: 'page-head' }, h('h1', null, 'Friends'), extra || null);
}

// ---- Setup --------------------------------------------------------------------------------------------------------------
// autosave: save while typing (Group tab). Otherwise the form's button saves it —
// saving on blur would re-render mid-tap and swallow the button press.
function nameFields({ autosave = false } = {}) {
  const m = S.me();
  const name = h('input', { value: m.name, placeholder: 'Your name (what friends see)', 'data-key': 'me-name' });
  const emoji = h('input', { value: m.emoji, class: 'short', maxlength: 4, 'data-key': 'me-emoji' });
  if (autosave) {
    let timer = null;
    const save = () => { clearTimeout(timer); timer = setTimeout(() => { S.setMe({ name: name.value.trim() || m.name, emoji: emoji.value.trim() || '🙂' }); S.publish(true); }, 900); };
    name.addEventListener('input', save);
    emoji.addEventListener('input', save);
  }
  return { el: h('div', { class: 'row2 name-emoji' }, field('Your name', name), field('Avatar emoji', emoji)), name, emoji };
}

// The form can re-render while you type, so read the live fields by key.
const liveVal = (key, fallback) => document.querySelector(`[data-key="${key}"]`)?.value ?? fallback;

function joinCard(invite) {
  const nf = nameFields();
  const btn = h('button', { class: 'btn primary big', onclick: async () => {
    const nm = liveVal('me-name', nf.name.value).trim();
    if (!nm) { toast('Add your name first'); return; }
    S.setMe({ name: nm, emoji: liveVal('me-emoji', nf.emoji.value).trim() || '🙂' });
    btn.disabled = true; btn.textContent = 'Joining…';
    try { const g = await S.joinGroup(invite); activeGid = g.gid; history.replaceState(null, '', '#/friends'); toast(`Joined ${g.name} 🎉`); } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Join'; }
    rerender();
  } }, `Join “${invite.name}”`);
  return section(`You’re invited to “${invite.name}”`, null,
    h('p', { class: 'small' }, 'See each other’s level, streaks and progress, compete in challenges and share books, shows and learnings. Only a summary is shared — never your money, notes or raw entries unless you share them yourself.'),
    nf.el, btn);
}

function setupCards() {
  const nf = nameFields();
  const inviteIn = h('input', { placeholder: 'Paste an invite link' });
  const db = h('input', { placeholder: 'https://your-project-default-rtdb.firebaseio.com', inputmode: 'url' });
  const gname = h('input', { placeholder: 'Group name — e.g. “Us two” or “Gym squad”' });
  const need = () => {
    const nm = liveVal('me-name', nf.name.value).trim();
    if (!nm) { toast('Add your name first'); return false; }
    S.setMe({ name: nm, emoji: liveVal('me-emoji', nf.emoji.value).trim() || '🙂' });
    return true;
  };
  return h('div', { class: 'stack' },
    section('You', null, nf.el),
    section('Join friends', null,
      h('p', { class: 'small muted' }, 'Got an invite link? Just open it — or paste it here.'),
      inviteIn,
      h('button', { class: 'btn primary', onclick: async () => {
        if (!need()) return;
        const inv = S.parseInvite(inviteIn.value);
        if (!inv) { toast('That isn’t a valid invite link'); return; }
        try { const g = await S.joinGroup(inv); activeGid = g.gid; forceSetup = false; toast(`Joined ${g.name} 🎉`); } catch (e) { toast(e.message); }
        rerender();
      } }, 'Join')),
    section('Start a group (one-time, free)', null,
      h('p', { class: 'small' }, 'Groups live in a free Firebase database that you own. Takes ~5 minutes, once. Your friends won’t need to do any of this.'),
      h('ol', { class: 'small steps' },
        h('li', null, 'Open ', h('a', { href: 'https://console.firebase.google.com/', target: '_blank', rel: 'noopener' }, 'console.firebase.google.com'), ' → “Create a project” (any name; you can turn Analytics off).'),
        h('li', null, 'In the left menu: Build → Realtime Database → Create database → pick a location → “Start in locked mode”.'),
        h('li', null, 'Open the Rules tab, replace everything with the rules below, press Publish.'),
        h('li', null, 'On the Data tab, copy the database URL at the top and paste it here.')),
      h('pre', { class: 'rules' }, RULES),
      h('button', { class: 'btn ghost sm', onclick: () => navigator.clipboard?.writeText(RULES).then(() => toast('Rules copied')) }, 'Copy rules'),
      field('Database URL', db), field('Group name', gname),
      h('button', { class: 'btn primary', onclick: async (e) => {
        if (!need()) return;
        e.target.disabled = true;
        try { const g = await S.createGroup(db.value, gname.value.trim()); activeGid = g.gid; forceSetup = false; tab = 'group'; toast('Group created — now send the invite link'); } catch (err) { toast(err.message); }
        e.target.disabled = false;
        rerender();
      } }, 'Create group'),
      h('p', { class: 'muted small' }, 'Anyone with your invite link can see and post in the group, so share it only with people you trust. The free plan is far more than a group of friends will ever use.')));
}

// ---- Leaderboard -------------------------------------------------------------------------------------------------------
function range(kind) {
  const t = D.today();
  return kind === 'month' ? [D.addDays(t, -29), t] : [D.addDays(t, -6), t];
}

function boardTab(g, data) {
  const members = data.members || {};
  const myId = S.me().id;
  const [from, to] = range('week');
  const metrics = [['xp', 'XP · 7 days'], ['level', 'Level'], ['streak', 'Streak'], ['workouts', 'Workouts'], ['habits', 'Habits'], ['learnings', 'Learnings'], ['todos', 'To-dos'], ['screen', 'Screen time']];
  const rows = S.standings(members, metric, from, to);
  const fmt = (v) => (metric === 'level' ? `${v.toLocaleString()} XP` : metric === 'streak' ? `🔥 ${v} days` : S.METRICS[metric].fmt(v));
  const medal = (r) => ['🥇', '🥈', '🥉'][r - 1] || `#${r}`;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('div', { class: 'stack' },
    h('div', { class: 'chips' }, metrics.map(([k, l]) => h('button', { class: ['chip', metric === k && 'on'], onclick: () => { metric = k; rerender(); } }, l))),
    rows.length ? h('section', { class: 'card board' }, rows.map((r) => {
      const m = r.member;
      const stale = Date.now() - (m.updatedAt || 0) > 2 * 86400000;
      return h('button', { class: ['board-row', m.id === myId && 'me'], onclick: () => memberSheet(g, m) },
        h('span', { class: 'board-rank' }, medal(r.rank)),
        h('span', { class: 'board-avatar' }, m.emoji || '🙂'),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, `${m.name}${m.id === myId ? ' (you)' : ''}`),
          h('span', { class: 'row-sub' }, `Lv ${m.level} · ${m.rank}${m.today?.habitsTotal ? ` · habits ${m.today.habitsDone}/${m.today.habitsTotal} today` : ''}${stale ? ' · not seen lately' : ''}`),
          metric !== 'screen' ? h('span', { class: 'progress' }, h('span', { style: { width: `${(r.value / max) * 100}%` } })) : null),
        h('span', { class: 'board-val' }, fmt(r.value)));
    })) : section('', null, empty(metric === 'screen' ? 'Nobody is sharing screen time yet (turn it on under Group → What you share).' : 'No one here yet — send your invite link from the Group tab.')),
    h('p', { class: 'muted small' }, metric === 'screen' ? 'Lowest average wins.' : 'XP counts penalties too — a bad week costs you places. Tap a friend to compare.'));
}

function memberSheet(g, m) {
  const mine = S.buildProfile();
  const isMe = m.id === mine.id;
  const attrs = Object.entries(X.ATTRS);
  const maxA = Math.max(1, ...attrs.map(([k]) => Math.max(m.attrs?.[k] || 0, mine.attrs?.[k] || 0)));
  const badgeDefs = Object.fromEntries(X.achievements().map((a) => [a.id, a]));
  sheet(`${m.emoji || '🙂'} ${m.name}`, h('div', { class: 'summary' },
    h('div', { class: 'stat-row' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, `Lv ${m.level}`), h('span', { class: 'stat-label' }, m.rank)),
      h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, `🔥 ${m.streak}`), h('span', { class: 'stat-label' }, 'Streak')),
      h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, `+${(m.weekGain || 0).toLocaleString()}`), h('span', { class: 'stat-label' }, `XP this week (${m.weekLoss || 0} lost)`))),
    h('p', { class: 'sub-head' }, isMe ? 'Attributes' : `Attributes — ${m.name} vs you`),
    h('div', { class: 'compare' }, attrs.map(([k, a]) => h('div', { class: 'compare-row two-col' },
      h('span', null, `${a.emoji} ${a.name}`),
      h('span', { class: 'cmp-val' }, (m.attrs?.[k] || 0).toLocaleString()),
      h('span', { class: 'cmp-bars' }, h('i', { class: 'act', style: { width: `${((m.attrs?.[k] || 0) / maxA) * 100}%` } }), isMe ? null : h('i', { class: 'ideal', style: { width: `${((mine.attrs?.[k] || 0) / maxA) * 100}%` } }))))),
    isMe ? null : h('p', { class: 'legend' }, h('span', null, h('i', { class: 'swatch act-sw' }), m.name), h('span', null, h('i', { class: 'swatch ideal-sw' }), 'You')),
    (m.reading || []).length ? h('p', { class: 'small' }, h('b', null, '📖 Reading: '), m.reading.join(', ')) : null,
    (m.watching || []).length ? h('p', { class: 'small' }, h('b', null, '🍿 Watching: '), m.watching.join(', ')) : null,
    (m.badges || []).length ? h('div', null, h('p', { class: 'sub-head' }, `${m.badges.length} badges`), h('div', { class: 'chips' }, m.badges.map((b) => badgeDefs[b] ? h('span', { class: 'pchip', 'data-tip': badgeDefs[b].desc }, `${badgeDefs[b].emoji} ${badgeDefs[b].name}`) : null))) : null,
    h('p', { class: 'muted small' }, `Last update ${new Date(m.updatedAt || 0).toLocaleString()}`)), {
    actions: isMe ? [h('button', { class: 'btn primary', onclick: closeSheet }, 'Close')] : [
      h('button', { class: 'btn ghost', onclick: async () => { closeSheet(); await S.post(g, { type: 'cheer', title: `cheered ${m.name}`, to: m.id, body: '👏 Keep it up!' }).catch((e) => toast(e.message)); toast(`Cheered ${m.name} 👏`); rerender(); } }, '👏 Cheer'),
      h('button', { class: 'btn primary', onclick: () => { closeSheet(); newChallenge(g, m); } }, '⚔️ Challenge'),
    ],
  });
}

// ---- Feed ---------------------------------------------------------------------------------------------------------------
const TYPE_VERB = { book: 'recommends a book', paper: 'shared a paper', article: 'shared an article', watch: 'recommends', learning: 'learned something', note: 'shared a note', goal: 'set a goal', goalDone: 'achieved a goal', workout: 'finished a workout', levelup: 'levelled up', badge: 'unlocked a badge', challenge: 'started a challenge' };

function feedTab(g, data) {
  const myId = S.me().id;
  const members = data.members || {};
  const posts = Object.entries(data.feed || {}).sort((a, b) => b[0].localeCompare(a[0]));
  const text = h('textarea', { class: 'note-compose', rows: 2, placeholder: 'Share something with the group…', 'data-key': 'feed-text' });
  const send = async () => {
    if (!text.value.trim()) return;
    const body = text.value.trim(); text.value = '';
    try { await S.post(g, { type: 'text', body }); } catch (e) { toast(e.message); }
    rerender();
  };
  return h('div', { class: 'stack' },
    h('section', { class: 'card' }, text, h('div', { class: 'compose-actions' }, h('span', { class: 'muted small' }, 'Tip: use the share buttons on books, shows, learnings, notes, goals and workouts.'), h('button', { class: 'btn primary sm', onclick: send }, 'Post'))),
    posts.length ? posts.map(([key, p]) => {
      const to = p.to ? members[p.to]?.name || 'someone' : null;
      const reacts = p.reactions || {};
      const counts = {};
      for (const e of Object.values(reacts)) counts[e] = (counts[e] || 0) + 1;
      return h('article', { class: ['card', 'post', `pt-${p.type}`] },
        h('div', { class: 'post-head' },
          h('span', { class: 'board-avatar sm' }, p.emoji || '🙂'),
          h('span', { class: 'row-main' },
            h('span', null, h('b', null, p.name), ` ${p.type === 'cheer' ? `cheered ${to}` : TYPE_VERB[p.type] || ''}`),
            h('span', { class: 'row-sub' }, timeAgo(p.ts))),
          p.by === myId ? h('button', { class: 'icon-btn sm', 'aria-label': 'Delete post', onclick: async () => { await S.deletePost(g, key).catch((e) => toast(e.message)); rerender(); } }, icon('trash', 16)) : null),
        p.title ? h('p', { class: 'post-title' }, `${TYPE_EMOJI[p.type] || ''} ${p.title}${p.author ? ` — ${p.author}` : ''}`) : null,
        p.body ? h('p', { class: 'post-body' }, p.body) : null,
        p.url ? h('a', { class: 'small', href: p.url, target: '_blank', rel: 'noopener' }, p.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)) : null,
        h('div', { class: 'post-actions' },
          REACTIONS.map((e) => h('button', { class: ['react', reacts[myId] === e && 'on'], onclick: async () => { await S.react(g, key, e).catch((err) => toast(err.message)); await S.refresh(g).catch(() => {}); rerender(); } }, e, counts[e] ? h('small', null, counts[e]) : null)),
          p.by !== myId ? importButton(p) : null));
    }) : section('', null, empty('Nothing here yet. Post something, or share a book, show or learning.')));
}

function importButton(p) {
  const add = (fn, msg) => h('button', { class: 'btn ghost xs', onclick: () => { fn(); toast(msg); } }, '+ Add to mine');
  if (['book', 'paper', 'article'].includes(p.type)) return add(() => addReading({ title: p.title, author: p.author || '', url: p.url || '', type: p.kind === 'paper' ? 'paper' : p.kind === 'article' ? 'article' : 'book' }), 'Added to your reading list');
  if (p.type === 'watch') return add(() => store.put('watch', { ...addWatch({ title: p.title, type: p.kind || undefined }), platform: p.platform || '', recommendedBy: p.name }), 'Added to your watch list');
  if (p.type === 'learning') return add(() => addLearning({ text: p.title, source: p.name, topics: p.topics || [] }), 'Saved to your learnings');
  if (p.type === 'note') return add(() => store.put('notes', { text: `${p.title}\n${p.body || ''}`.trim(), pinned: false }), 'Saved to your notes');
  return null;
}

function timeAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr}h ago`;
  return D.fmtDate(D.toStr(new Date(ts)));
}

// ---- Challenges ----------------------------------------------------------------------------------------------------------
function challengesTab(g, data) {
  const t = D.today();
  const list = Object.values(data.challenges || {}).sort((a, b) => b.start.localeCompare(a.start));
  const active = list.filter((c) => c.end >= t);
  const past = list.filter((c) => c.end < t);
  return h('div', { class: 'stack' },
    h('button', { class: 'btn primary', onclick: () => newChallenge(g) }, icon('plus', 16), 'New challenge'),
    active.length ? active.map((c) => challengeCard(g, data, c)) : section('', null, empty('No active challenges. Start one — e.g. “Most workouts this week” or “Lowest screen time”.')),
    past.length ? h('p', { class: 'sub-head' }, 'Finished') : null,
    past.slice(0, 10).map((c) => challengeCard(g, data, c)));
}

function challengeCard(g, data, c) {
  const t = D.today();
  const done = c.end < t;
  const rows = c.final || S.standings(data.members, c.metric, c.start, c.end < t ? c.end : t).filter((r) => !c.participants || c.participants.includes(r.member.id));
  if (done && !c.final && rows.length) {
    // Freeze the result once it's over (history only keeps 35 days per member).
    S.saveChallenge(g, { ...c, final: rows.map((r) => ({ rank: r.rank, value: r.value, member: { id: r.member.id, name: r.member.name, emoji: r.member.emoji } })) }).catch(() => {});
  }
  const m = S.METRICS[c.metric];
  const left = D.diffDays(t, c.end);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h('section', { class: ['card', 'challenge', done && 'over'] },
    h('div', { class: 'card-head' }, h('h3', null, `${m.emoji} ${c.title}`),
      h('span', { class: 'count' }, done ? `Won by ${rows[0]?.member.name || '—'} 🏆` : left === 0 ? 'Ends today' : `${left} day${left === 1 ? '' : 's'} left`)),
    h('p', { class: 'muted small' }, `${D.fmtDate(c.start, { relative: false })} → ${D.fmtDate(c.end, { relative: false })} · ${m.better === 'low' ? 'lowest' : 'most'} ${m.label.toLowerCase()} wins`),
    rows.map((r) => h('div', { class: 'ch-row' },
      h('span', { class: 'board-rank' }, ['🥇', '🥈', '🥉'][r.rank - 1] || `#${r.rank}`),
      h('span', null, `${r.member.emoji || '🙂'} ${r.member.name}`),
      m.better === 'high' ? h('span', { class: 'progress' }, h('span', { style: { width: `${(r.value / max) * 100}%` } })) : h('span'),
      h('span', { class: 'board-val' }, m.fmt(Math.round(r.value * 10) / 10)))),
    c.createdBy === S.me().id ? h('button', { class: 'btn ghost xs', onclick: async () => { await S.deleteChallenge(g, c.id).catch((e) => toast(e.message)); await S.refresh(g).catch(() => {}); rerender(); } }, 'Delete') : null);
}

function newChallenge(g, opponent = null) {
  const title = h('input', { placeholder: 'e.g. Workout war, No-phone week' });
  let met = 'workouts'; let days = 7;
  const metRow = h('div'); const dayRow = h('div');
  const draw = () => {
    metRow.replaceChildren(h('div', { class: 'chips' }, Object.entries(S.METRICS).map(([k, v]) => h('button', { type: 'button', class: ['chip', met === k && 'on'], onclick: () => { met = k; draw(); } }, `${v.emoji} ${v.label}`))));
    dayRow.replaceChildren(segmented([[3, '3 days'], [7, '1 week'], [14, '2 weeks'], [30, '30 days']], days, (v) => { days = v; draw(); }, { small: true }));
  };
  draw();
  sheet(opponent ? `Challenge ${opponent.name}` : 'New challenge', h('div', { class: 'form' },
    field('Name', title), field('Who wins', metRow), field('Length (starts today)', dayRow),
    h('p', { class: 'muted small' }, opponent ? `Just you vs ${opponent.name}.` : 'Everyone in the group takes part.')), {
    actions: [h('button', { class: 'btn primary', onclick: async () => {
      const t = D.today();
      const m = S.METRICS[met];
      const ch = { title: title.value.trim() || `${m.label} ${days === 7 ? 'week' : `${days}-day`} challenge`, metric: met, start: t, end: D.addDays(t, days - 1), createdBy: S.me().id };
      if (opponent) ch.participants = [S.me().id, opponent.id];
      closeSheet();
      try {
        await S.saveChallenge(g, ch);
        await S.post(g, { type: 'challenge', title: ch.title, body: `${m.emoji} ${m.better === 'low' ? 'Lowest' : 'Most'} ${m.label.toLowerCase()} · ${days} days${opponent ? ` · vs ${opponent.name}` : ''}` });
        await S.refresh(g);
        tab = 'challenges';
      } catch (e) { toast(e.message); }
      rerender();
    } }, 'Start challenge')],
  });
}

// ---- Group settings -------------------------------------------------------------------------------------------------------
function groupTab(g, data) {
  const link = S.inviteLink(g);
  const share = S.shareSettings();
  const nf = nameFields({ autosave: true });
  const toggle = (k, label) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: share[k], onchange: (e) => { store.setPref('shareSettings', { ...share, [k]: e.target.checked }); S.publish(true); } }), h('span', null, label));
  const members = Object.values(data.members || {});
  return h('div', { class: 'stack' },
    section(`Invite to “${g.name}”`, null,
      h('p', { class: 'small' }, 'Send this link to your girlfriend or friends. They open it, add their name, and they’re in — no sign-up.'),
      h('input', { value: link, readonly: true, onclick: (e) => e.target.select() }),
      h('div', { class: 'btn-row' },
        navigator.share ? h('button', { class: 'btn primary', onclick: () => navigator.share({ title: 'Join me on Daybook', text: `Join “${g.name}” on Daybook — let’s compete!`, url: link }).catch(() => {}) }, 'Share invite') : null,
        h('button', { class: 'btn ghost', onclick: () => navigator.clipboard?.writeText(link).then(() => toast('Invite link copied')) }, 'Copy link'))),
    section(`Members · ${members.length}`, null, h('ul', { class: 'list compact' }, members.map((m) => h('li', { class: 'row', onclick: () => memberSheet(g, m) },
      h('span', { class: 'board-avatar sm' }, m.emoji), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, m.name), h('span', { class: 'row-sub' }, `Lv ${m.level} · updated ${timeAgo(m.updatedAt || 0)}`)))))),
    section('You', null, nf.el),
    section('What you share', null,
      h('p', { class: 'small muted' }, 'Always shared: name, level, XP, streaks, badges, to-do and routine counts. Never shared: money, notes, tasks, events — unless you post them.'),
      h('div', { class: 'form' },
        toggle('habits', 'Habit counts'), toggle('gym', 'Workout counts'), toggle('learnings', 'Learning counts'),
        toggle('reading', 'What I’m reading'), toggle('watch', 'What I’m watching'), toggle('screen', 'Screen time totals'),
        toggle('autoPost', 'Auto-post milestones (level ups, badges, workouts, finished books, achieved goals)'))),
    h('button', { class: 'btn danger ghost', onclick: async () => {
      if (!confirm(`Leave “${g.name}”?`)) return;
      await S.leaveGroup(g); activeGid = null; toast('Left the group'); rerender();
    } }, 'Leave group'),
    h('button', { class: 'btn ghost', onclick: () => { forceSetup = true; rerender(); } }, 'Join or create another group'));
}
