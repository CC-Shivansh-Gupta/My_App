// Stats: your life as an RPG character — level, attributes, daily quests,
// streaks and achievements, all earned from what you already do in the app.

import * as D from '../dates.js';
import * as X from '../gamify.js';
import * as store from '../store.js';
import { h, section, segmented, field } from '../ui.js';
import * as C from '../charts.js';

let tab = 'overview';

export function render(ctx) {
  const s = X.summary();
  const lv = s.level;
  const quests = X.quests();
  const questXP = quests.filter((q) => q.done).reduce((a, q) => a + q.xp, 0);
  const achievements = X.achievements(s);
  const unlocked = achievements.filter((a) => a.done).length;

  return h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('h1', null, 'Stats'),
      segmented([['overview', 'Character'], ['achievements', `Badges ${unlocked}/${achievements.length}`], ['xp', 'XP log']], tab, (v) => { tab = v; ctx.rerender(); }, { small: true })),
    h('section', { class: 'card char-card' },
      h('div', { class: 'char-top' },
        h('div', { class: 'avatar', 'aria-hidden': 'true' }, avatarFor(lv.level)),
        h('div', { class: 'char-info' },
          h('p', { class: 'eyebrow' }, lv.rank),
          h('h2', null, `Level ${lv.level}`),
          h('div', { class: 'xp-bar', 'data-tip': `${lv.into.toLocaleString()} / ${lv.need.toLocaleString()} XP to level ${lv.level + 1}` }, h('span', { style: { width: `${lv.frac * 100}%` } })),
          h('p', { class: 'muted small' }, `${(lv.need - lv.into).toLocaleString()} XP to level ${lv.level + 1} · ${s.total.toLocaleString()} XP total`))),
      h('div', { class: 'stat-row' },
        stat(`+${s.today + questXP}`, 'XP today'),
        stat(`🔥 ${s.streak}`, 'Day streak'),
        stat(`${s.bestStreak}`, 'Best streak'),
        stat(`${unlocked}`, 'Badges')),
      h('p', { class: 'week-net small' }, h('span', { class: 'gain' }, `+${s.weekGain.toLocaleString()} earned`), ' · ',
        h('span', { class: 'loss' }, `${s.weekLoss.toLocaleString()} lost`), ' this week')),
    tab === 'achievements' ? badges(achievements) : tab === 'xp' ? xpLog(s) : overview(s, quests));
}

function avatarFor(level) {
  return ['🐣', '🧒', '🧑', '🧑‍🎓', '🧙', '🦸', '🐉', '👑'][Math.min(7, Math.floor((level - 1) / 5))];
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
}

function overview(s, quests) {
  return h('div', { class: 'grid-2' },
    h('div', { class: 'stack' },
      section('Daily quests', h('span', { class: 'count' }, `${quests.filter((q) => q.done).length}/${quests.length}`),
        h('ul', { class: 'quest-list' }, quests.map((q) => h('li', { class: ['quest', q.done && 'done'] },
          h('span', { class: 'quest-emoji' }, q.done ? '✅' : q.emoji),
          h('span', { class: 'row-main' }, h('span', null, q.title),
            q.progress[1] > 1 ? h('span', { class: 'progress' }, h('span', { style: { width: `${(q.progress[0] / q.progress[1]) * 100}%` } })) : null),
          h('span', { class: 'quest-xp' }, `+${q.xp} XP`)))),
        h('p', { class: 'muted small' }, 'New quests every day. Quest XP counts for today’s total.')),
      section('XP earned · last 30 days', null, C.columns(last30(s), { fmt: (v) => `${v}`, height: 110, labelEvery: 5 })),
      section('Penalties', null,
        h('p', { class: 'small muted' }, 'Missed habits, overdue tasks, undone to-dos, days over your screen limit, months over budget and slips on habits you’re breaking all cost XP.'),
        field('Severity', segmented([['off', 'Off'], ['gentle', 'Gentle'], ['normal', 'Normal'], ['hardcore', 'Hardcore']], store.pref('penaltyLevel', 'normal'), (v) => store.setPref('penaltyLevel', v), { small: true })))),
    section('Attributes', null,
      h('div', { class: 'attrs' }, Object.entries(X.ATTRS).map(([k, a]) => {
        const al = X.attrLevel(s.attrs[k]);
        return h('div', { class: 'attr', 'data-tip': `${a.hint} · ${al.toNext} XP to level ${al.level + 1}` },
          h('span', { class: 'attr-emoji' }, a.emoji),
          h('span', { class: 'attr-main' },
            h('span', { class: 'attr-name' }, a.name, h('b', null, ` Lv ${al.level}`)),
            h('span', { class: 'xp-bar thin' }, h('span', { style: { width: `${al.frac * 100}%` } })),
            h('span', { class: 'muted small' }, a.hint)),
          h('span', { class: 'attr-xp' }, `${s.attrs[k].toLocaleString()} XP`));
      })),
      h('p', { class: 'muted small' }, 'Every to-do, habit, workout, book, learning, expense and goal earns XP — including everything you logged before this tab existed.')));
}

function last30(s) {
  const t = D.today();
  return Array.from({ length: 30 }, (_, i) => {
    const d = D.addDays(t, i - 29);
    const g = s.gains[d] || 0; const l = s.losses[d] || 0;
    return { label: D.parse(d).getDate(), value: g, highlight: d === t, tip: `${D.fmtDate(d, { relative: false })}: +${g} XP${l ? `, ${l} lost (net ${g + l})` : ''}` };
  });
}

function badges(list) {
  return h('div', { class: 'badge-grid' }, list.map((a) => h('div', { class: ['card', 'badge-card', a.done && 'unlocked'], 'data-tip': a.done ? 'Unlocked!' : `${a.have}/${a.need}` },
    h('span', { class: 'badge-emoji' }, a.done ? a.emoji : '🔒'),
    h('b', null, a.name),
    h('span', { class: 'muted small' }, a.desc),
    a.done ? null : h('span', { class: 'progress' }, h('span', { style: { width: `${(a.have / a.need) * 100}%` } })))));
}

const KIND_LABEL = {
  todo: '☑️ To-dos done', task: '📋 Tasks done', habit: '✅ Habit ticks', workout: '🏋️ Workouts', pr: '📈 Personal records', measure: '⚖️ Body weight logs',
  book: '📘 Books finished', article: '📄 Papers & articles read', watched: '🍿 Movies & shows watched', episodes: '📺 Episodes', learning: '💡 Learnings',
  review: '🔁 Reviews', note: '📝 Notes', expense: '🧾 Expenses logged', budget: '🏦 Months under budget', goalSet: '🎯 Goals set', milestone: '🪜 Milestones',
  goal: '🏆 Goals achieved', clean: '🕊️ Clean days (habits to break)',
  habitMiss: '❌ Missed habits', lateTask: '⏳ Overdue tasks', todoMiss: '🗑️ Undone to-dos', screenOver: '📱 Over screen limit',
  overBudget: '💸 Months over budget', slip: '🚬 Slips', routine: '⏰ Routine blocks followed', timelog: '⏱️ Time entries', screenLog: '📱 Screen time logged', screenUnder: '🧘 Days under screen limit',
};

function xpLog(s) {
  const ev = X.events();
  const by = {};
  for (const e of ev) { by[e.kind] ||= { n: 0, xp: 0 }; by[e.kind].n++; by[e.kind].xp += e.xp; }
  const rows = Object.entries(by).filter(([, v]) => v.xp > 0).sort((a, b) => b[1].xp - a[1].xp);
  const bad = Object.entries(by).filter(([, v]) => v.xp < 0).sort((a, b) => a[1].xp - b[1].xp);
  const maxAbs = Math.max(1, ...Object.values(by).map((v) => Math.abs(v.xp)));
  const bar = ([k, v]) => h('div', { class: ['hbar', v.xp < 0 && 'neg'], 'data-tip': `${v.n} × = ${v.xp} XP` },
    h('span', { class: 'hbar-label' }, KIND_LABEL[k] || k),
    h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill', style: { width: `${(Math.abs(v.xp) / maxAbs) * 100}%` } })),
    h('span', { class: 'hbar-value' }, `${v.xp > 0 ? '' : '−'}${Math.abs(v.xp).toLocaleString()}`, h('small', null, ` · ${v.n}×`)));
  return section('Where your XP comes from', null,
    h('div', { class: 'hbars' }, rows.map(bar)),
    bad.length ? h('p', { class: 'sub-head' }, 'Where you lost XP') : null,
    bad.length ? h('div', { class: 'hbars' }, bad.map(bar)) : null,
    h('p', { class: 'muted small' }, 'Penalties (normal): missed habit −3 · overdue task −5 · undone to-do −2 · screen over limit −1 per 15 min · month over budget −100 · slip −5 to −50. Clean day +2. Points: to-do 5 · task 10–25 · habit 10 · workout 30+ · PR 15 · book 50 · learning 10 · review 2 · routine block 5 · goal 50 / 150 / 500 · month under budget 100 · day under screen limit 15.'));
}

// Level chip for the sidebar / Today.
export function levelChip() {
  const s = X.summary();
  return h('a', { class: 'level-chip', href: '#/stats', 'data-tip': `${s.level.rank} · ${s.total.toLocaleString()} XP` },
    h('span', null, `Lv ${s.level.level}`),
    h('span', { class: 'xp-bar thin' }, h('span', { style: { width: `${s.level.frac * 100}%` } })));
}
