// "Share with friends" sheet, used by books, shows, learnings, notes, goals and workouts.

import * as S from './social.js';
import { h, icon, sheet, closeSheet, toast, field } from './ui.js';

export const TYPE_EMOJI = { text: '💬', book: '📘', paper: '📄', article: '📰', watch: '🍿', learning: '💡', note: '📝', goal: '🎯', goalDone: '🏆', workout: '🏋️', levelup: '⭐', badge: '🏅', cheer: '👏', challenge: '⚔️' };

export function shareButton(getItem, label = 'Share') {
  return h('button', { class: 'btn ghost', onclick: () => openShare(getItem()) }, icon('upload', 16), label);
}

export function openShare(item) {
  const gs = S.groups();
  if (!gs.length) { closeSheet(); toast('Set up Friends first to share'); location.hash = '#/friends'; return; }
  let chosen = gs.map((g) => g.gid);
  const note = h('textarea', { rows: 2, placeholder: 'Add a comment (optional)' });
  const groupsRow = h('div', { class: 'chips' });
  const draw = () => groupsRow.replaceChildren(...gs.map((g) => h('button', {
    type: 'button', class: ['chip', chosen.includes(g.gid) && 'on'],
    onclick: () => { chosen = chosen.includes(g.gid) ? chosen.filter((x) => x !== g.gid) : [...chosen, g.gid]; draw(); },
  }, g.name)));
  draw();
  sheet('Share with friends', h('div', { class: 'form' },
    h('p', { class: 'post-title' }, `${TYPE_EMOJI[item.type] || '💬'} ${item.title}`),
    gs.length > 1 ? field('Groups', groupsRow) : null, note), {
    actions: [h('button', { class: 'btn primary', onclick: async () => {
      closeSheet();
      const body = [note.value.trim(), item.body].filter(Boolean).join('\n');
      const results = await Promise.all(gs.filter((g) => chosen.includes(g.gid)).map((g) => S.post(g, { ...item, body }).then(() => true, (e) => { toast(e.message); return false; })));
      if (results.some(Boolean)) toast('Shared 🎉');
    } }, 'Share')],
  });
}
