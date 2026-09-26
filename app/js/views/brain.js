// Knowledge map: an Obsidian-style graph of the second-brain vault (read from its GitHub repo)
// together with Daybook's own notes, learnings, books, shows and goals. Tap a dot to read the
// page, its links and backlinks; capture thoughts straight into the vault's inbox.

import * as store from '../store.js';
import * as sync from '../sync.js';
import * as vault from '../vault.js';
import * as G from '../graph.js';
import { parseBlocks, inline } from '../md.js';
import * as E from '../editors.js';
import { h, icon, section, toast, sheet, closeSheet, field } from '../ui.js';
import { editNote } from './notes.js';
import { editLearning } from './learnings.js';
import { editWatch } from './watch.js';
import { editGoal } from './goals.js';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

// Kept across re-renders so the map doesn't jump.
const pos = new Map();
const cam = { x: 0, y: 0, k: 1, fitted: 0 }; // fitted: how many dots the view was last fitted to
let selected = null;
let query = '';
let localOnly = false;
let alpha = 1;
let frame = 0;
let rerender = () => {};
let graph = null;
let listening = false;

const hidden = () => new Set(store.pref('mapHidden', ['raw', 'tag']));
const showDaybook = () => store.pref('mapDaybook', true);

function buildDocs() {
  const docs = vault.all().map((f) => G.vaultDoc(f.path, f.text));
  if (showDaybook()) {
    docs.push(...G.daybookDocs({
      notes: store.all('notes'), learnings: store.all('learnings'), reading: store.all('reading'),
      watch: store.all('watch'), goals: store.all('goals'),
    }));
  }
  return docs;
}

export function onLeave() {
  cancelAnimationFrame(frame);
  frame = 0;
}

export function render(ctx) {
  rerender = ctx.rerender;
  if (!listening) {
    listening = true;
    vault.onChange(() => { if (location.hash.startsWith('#/brain')) rerender(); });
  }
  vault.load();

  const hide = hidden();
  graph = G.buildGraph(buildDocs(), { tags: !hide.has('tag') });

  // #/brain?n=Title (from a [[link]] in a note) selects that page.
  const want = new URLSearchParams(location.hash.split('?')[1] || '').get('n');
  if (want) {
    selected = graph.find(want) || `ghost:${G.norm(want)}`;
    history.replaceState(null, '', '#/brain');
  }
  if (selected && !graph.nodes.has(selected)) selected = null;

  let ids = [...graph.nodes.keys()].filter((id) => !hide.has(graph.nodes.get(id).group));
  if (localOnly && selected) {
    const near = G.neighborhood(graph, selected, 2);
    ids = ids.filter((id) => near.has(id));
  }
  const visible = new Set(ids);
  const edges = graph.edges.filter((e) => visible.has(e.a) && visible.has(e.b));
  const before = pos.size;
  G.seed(pos, ids, graph);
  if (pos.size !== before) alpha = Math.max(alpha, before ? 0.5 : 1);

  const st = vault.status();
  const pages = [...graph.nodes.values()].filter((n) => n.kind === 'vault').length;
  const head = h('header', { class: 'page-head' },
    h('div', null, h('h1', null, 'Knowledge map'),
      h('p', { class: 'muted small' }, st.connected
        ? `${pages} vault pages · ${graph.edges.length} links${st.loading ? ` · ${st.progress || 'Syncing…'}` : st.lastSync ? ` · synced ${timeAgo(st.lastSync)}` : ''}`
        : 'Connect your Obsidian vault to see it here')),
    h('div', { class: 'btn-row' },
      st.connected ? h('button', { class: 'btn sm', disabled: st.loading, onclick: () => vault.refresh().then((c) => toast(c ? 'Vault updated' : 'Already up to date')).catch((e) => toast(e.message)) }, icon('sync', 16), st.loading ? 'Syncing…' : 'Sync') : null,
      h('button', { class: 'btn sm', onclick: () => editNote() }, icon('plus', 16), 'Note')));

  const canvasCard = mapCanvas(ids, edges);
  const panel = h('div', { class: 'map-side' });
  fillPanel(panel);
  canvasCard.panel = panel;

  return h('div', { class: 'page map-page' },
    head,
    st.error ? h('p', { class: ['small', st.error.startsWith('Warning') ? 'warn-text' : 'error'] }, st.error) : null,
    toolbar(hide),
    h('div', { class: 'map-grid' }, canvasCard, panel),
    h('div', { class: 'grid-2' }, st.connected ? captureCard() : connectCard(), st.connected ? vaultCard() : whyCard()));
}

// ---- Toolbar: search + legend/filters -------------------------------------------------------------------
function toolbar(hide) {
  const search = h('input', { type: 'search', class: 'quick', placeholder: 'Search pages', value: query, 'data-key': 'map-search', autocomplete: 'off' });
  search.addEventListener('input', () => { query = search.value; draw(); });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const hit = matches()[0];
    if (hit) { select(hit, { center: true }); search.blur(); }
  });
  const present = new Set([...graph.nodes.values()].map((n) => n.group));
  const chip = (g) => h('button', {
    class: ['chip', 'legend', !hide.has(g) && 'on'], 'aria-pressed': String(!hide.has(g)),
    onclick: () => { const s = hidden(); s.has(g) ? s.delete(g) : s.add(g); store.setPref('mapHidden', [...s]); },
  }, h('i', { class: 'dot', style: { background: G.GROUPS[g].color } }), G.GROUPS[g].label);
  const vaultGroups = ['concept', 'entity', 'source', 'synthesis', 'journal', 'project', 'page', 'raw'].filter((g) => present.has(g));
  const dayGroups = ['note', 'learn', 'book', 'watch', 'goal'].filter((g) => present.has(g));
  return h('div', { class: 'map-tools' },
    search,
    h('div', { class: 'chips' },
      vaultGroups.map(chip),
      showDaybook() ? dayGroups.map(chip) : null,
      chip('tag'),
      present.has('ghost') ? chip('ghost') : null,
      h('button', { class: ['chip', showDaybook() && 'on'], onclick: () => store.setPref('mapDaybook', !showDaybook()) }, showDaybook() ? 'Daybook items: on' : 'Daybook items: off'),
      selected ? h('button', { class: ['chip', localOnly && 'on'], onclick: () => { localOnly = !localOnly; rerender(); } }, 'Only around selection') : null));
}

function matches() {
  const q = G.norm(query);
  if (!q) return [];
  return [...graph.nodes.values()]
    .filter((n) => G.norm(n.display || n.title).includes(q) || (n.aliases || []).some((a) => G.norm(a).includes(q)))
    .sort((a, b) => G.norm(a.title).indexOf(q) - G.norm(b.title).indexOf(q) || G.degree(b) - G.degree(a))
    .map((n) => n.id);
}

// ---- Canvas ------------------------------------------------------------------------------------------------
let view = null; // { canvas, ctx, ids, edges, w, h, hover, colors }

function mapCanvas(ids, edges) {
  const canvas = h('canvas', { class: 'map-canvas', 'aria-label': 'Graph of your notes. Use the search box to find a page.' });
  const wrap = h('div', { class: 'card map-card' }, canvas,
    h('div', { class: 'map-zoom' },
      h('button', { class: 'icon-btn sm', 'aria-label': 'Zoom in', onclick: () => zoomBy(1.3) }, icon('plus', 18)),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Zoom out', onclick: () => zoomBy(1 / 1.3) }, h('span', { class: 'minus' }, '−')),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Fit to screen', onclick: () => { fit(); draw(); } }, icon('fit', 18))),
    ids.length ? null : h('p', { class: 'map-empty muted' }, vault.connected() ? 'Nothing to show with these filters.' : 'No notes yet. Connect your vault below, or add a Daybook note with [[links]].'));
  view = { canvas, ctx: canvas.getContext('2d'), ids, edges, w: 0, h: 0, hover: null, wrap };
  bindPointer(canvas);
  // Size and start once it's in the page.
  requestAnimationFrame(() => {
    if (!canvas.isConnected) return;
    resize();
    new ResizeObserver(() => { resize(); draw(); }).observe(canvas);
    // Fit on first show, and again when many new pages arrive (e.g. the vault finished loading).
    if (ids.length && ids.length > cam.fitted * 1.3 + 3) {
      for (let i = 0; i < 150; i++) G.step(pos, ids, edges, { alpha: 1 });
      alpha = 0.3;
      fit();
      cam.fitted = ids.length;
    }
    loop();
  });
  return wrap;
}

function resize() {
  const { canvas } = view;
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  view.w = r.width; view.h = r.height;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  view.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  view.colors = { ink: css.getPropertyValue('--ink').trim(), ink2: css.getPropertyValue('--ink-2').trim(), line: css.getPropertyValue('--axis').trim(), bg: css.getPropertyValue('--surface').trim(), accent: css.getPropertyValue('--accent').trim() };
}

function loop() {
  cancelAnimationFrame(frame);
  const tick = () => {
    if (!view?.canvas.isConnected) { frame = 0; return; }
    if (alpha > 0.02) {
      G.step(pos, view.ids, view.edges, { alpha });
      alpha *= 0.97;
    }
    draw();
    frame = alpha > 0.02 || dragging ? requestAnimationFrame(tick) : 0;
  };
  frame = requestAnimationFrame(tick);
}

const kick = (a = 0.3) => { alpha = Math.max(alpha, a); if (!frame) loop(); };
const toScreen = (p) => [(p.x - cam.x) * cam.k + view.w / 2, (p.y - cam.y) * cam.k + view.h / 2];
const toWorld = (sx, sy) => [(sx - view.w / 2) / cam.k + cam.x, (sy - view.h / 2) / cam.k + cam.y];
const radius = (n) => (n.kind === 'tag' ? 2.5 : 3.5) + Math.sqrt(G.degree(n)) * 1.6;

function fit() {
  if (!view?.ids.length || !view.w) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of view.ids) { const p = pos.get(id); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  cam.x = (x0 + x1) / 2; cam.y = (y0 + y1) / 2;
  cam.k = Math.max(0.15, Math.min(2.5, Math.min(view.w / (x1 - x0 + 80), view.h / (y1 - y0 + 80))));
}

function zoomBy(f, sx = view.w / 2, sy = view.h / 2) {
  const [wx, wy] = toWorld(sx, sy);
  cam.k = Math.max(0.1, Math.min(6, cam.k * f));
  cam.x = wx - (sx - view.w / 2) / cam.k;
  cam.y = wy - (sy - view.h / 2) / cam.k;
  draw();
}

function draw() {
  if (!view?.w) return;
  const { ctx, ids, edges, colors } = view;
  ctx.clearRect(0, 0, view.w, view.h);
  const focus = view.hover || selected;
  const near = focus ? G.neighborhood(graph, focus, 1) : null;
  const found = new Set(query ? matches() : []);
  const dim = (id) => (near && !near.has(id)) || (found.size && !found.has(id) && !(near && near.has(id)));

  ctx.lineWidth = 1;
  for (const e of edges) {
    const a = pos.get(e.a); const b = pos.get(e.b);
    const on = focus && (e.a === focus || e.b === focus);
    ctx.globalAlpha = on ? 0.9 : dim(e.a) || dim(e.b) ? 0.08 : 0.5;
    ctx.strokeStyle = on ? colors.accent : colors.line;
    ctx.lineWidth = on ? 1.6 : 1;
    const [ax, ay] = toScreen(a); const [bx, by] = toScreen(b);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }

  const scale = Math.max(0.6, Math.min(1.8, Math.sqrt(cam.k)));
  const labelAll = cam.k > 1.1;
  const topDeg = [...ids].map((id) => G.degree(graph.nodes.get(id))).sort((a, b) => b - a)[Math.min(ids.length - 1, 12)] || 99;
  ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const id of ids) {
    const n = graph.nodes.get(id);
    const [x, y] = toScreen(pos.get(id));
    if (x < -40 || y < -40 || x > view.w + 40 || y > view.h + 40) continue;
    const r = radius(n) * scale;
    const color = G.GROUPS[n.group]?.color || colors.ink2;
    const faded = dim(id);
    ctx.globalAlpha = faded ? 0.15 : 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (G.GROUPS[n.group]?.daybook || n.kind === 'ghost') {
      // Daybook items and not-yet-written pages are rings, vault pages are solid.
      ctx.fillStyle = colors.bg; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(n.kind === 'ghost' ? [2, 2] : []); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.fillStyle = color; ctx.fill();
    }
    if (id === selected || found.has(id)) {
      ctx.beginPath(); ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = colors.accent; ctx.lineWidth = 2; ctx.stroke();
    }
    const strong = id === focus || (near && near.has(id)) || found.has(id);
    if (labelAll || strong || (cam.k > 0.55 && G.degree(n) >= topDeg && G.degree(n) > 1)) {
      ctx.globalAlpha = faded ? 0.12 : strong || labelAll ? 1 : 0.75;
      ctx.fillStyle = id === focus ? colors.ink : colors.ink2;
      ctx.fillText(short(n.display || n.title), x, y + r + 3);
    }
  }
  ctx.globalAlpha = 1;
}

const short = (t) => (t.length > 34 ? `${t.slice(0, 32)}…` : t);

function hit(sx, sy) {
  let best = null; let bd = Infinity;
  const scale = Math.max(0.6, Math.min(1.8, Math.sqrt(cam.k)));
  for (const id of view.ids) {
    const [x, y] = toScreen(pos.get(id));
    const d = Math.hypot(x - sx, y - sy);
    const r = radius(graph.nodes.get(id)) * scale + 8;
    if (d < r && d < bd) { best = id; bd = d; }
  }
  return best;
}

let dragging = null;
function bindPointer(canvas) {
  const pts = new Map();
  let start = null; let moved = 0; let pinch = null;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = local(e);
    pts.set(e.pointerId, [sx, sy]);
    moved = 0;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: cam.k };
      if (dragging) { pos.get(dragging).fixed = false; dragging = null; }
      return;
    }
    const id = hit(sx, sy);
    start = { sx, sy, cx: cam.x, cy: cam.y, id };
    if (id) { dragging = id; pos.get(id).fixed = true; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const [sx, sy] = local(e);
    if (!pts.has(e.pointerId)) {
      // Mouse hover: highlight neighbours.
      const id = e.pointerType === 'mouse' ? hit(sx, sy) : null;
      if (id !== view.hover) { view.hover = id; canvas.style.cursor = id ? 'pointer' : 'grab'; draw(); }
      return;
    }
    pts.set(e.pointerId, [sx, sy]);
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomBy((pinch.k * d) / pinch.d / cam.k, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      moved = 99;
      return;
    }
    if (!start) return;
    moved = Math.max(moved, Math.hypot(sx - start.sx, sy - start.sy));
    if (moved < 4) return;
    if (dragging) {
      const [wx, wy] = toWorld(sx, sy);
      const p = pos.get(dragging); p.x = wx; p.y = wy;
      kick(0.25);
    } else {
      cam.x = start.cx - (sx - start.sx) / cam.k;
      cam.y = start.cy - (sy - start.sy) / cam.k;
      draw();
    }
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size) return;
    if (dragging) { pos.get(dragging).fixed = false; }
    if (start && moved < 4) select(start.id);
    dragging = null; start = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (view.hover) { view.hover = null; draw(); } });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [sx, sy] = local(e);
    zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), sx, sy);
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => { const id = hit(...local(e)); if (id) openItem(graph.nodes.get(id)); });
}

function select(id, { center = false } = {}) {
  selected = id;
  if (center && id && pos.has(id)) { const p = pos.get(id); cam.x = p.x; cam.y = p.y; cam.k = Math.max(cam.k, 1.2); }
  if (localOnly) { rerender(); return; }
  draw();
  const panel = view?.wrap.panel;
  if (panel) { fillPanel(panel); if (id && window.innerWidth < 1000) panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

// ---- Side panel ---------------------------------------------------------------------------------------------
function fillPanel(panel) {
  const n = selected && graph.nodes.get(selected);
  panel.replaceChildren(n ? nodeCard(n) : overviewCard());
}

function overviewCard() {
  const nodes = [...graph.nodes.values()].filter((n) => n.kind !== 'tag' && n.kind !== 'ghost');
  const orphans = nodes.filter((n) => !G.degree(n) && n.kind === 'vault' && n.group !== 'raw');
  const hubs = [...nodes].sort((a, b) => G.degree(b) - G.degree(a)).filter((n) => G.degree(n) > 1).slice(0, 8);
  const ghosts = [...graph.nodes.values()].filter((n) => n.kind === 'ghost').sort((a, b) => b.backlinks.size - a.backlinks.size).slice(0, 6);
  return section('Overview', null,
    h('div', { class: 'stat-row' },
      stat(nodes.length, 'pages & items'), stat(graph.edges.length, 'links'), stat(orphans.length, 'unlinked')),
    h('p', { class: 'small muted' }, 'Tap a dot to read it. Drag to move around, pinch or scroll to zoom. Link pages by writing [[Page name]] in a note.'),
    hubs.length ? h('div', null, h('h4', { class: 'map-h4' }, 'Most connected'), nodeList(hubs)) : null,
    ghosts.length ? h('div', null, h('h4', { class: 'map-h4' }, 'Linked but not written yet'), nodeList(ghosts)) : null,
    orphans.length ? h('div', null, h('h4', { class: 'map-h4' }, 'Not linked to anything'), nodeList(orphans.slice(0, 8))) : null);
}

const stat = (v, label) => h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, v), h('span', { class: 'stat-label' }, label));

function nodeList(nodes) {
  return h('ul', { class: 'list compact' }, nodes.map((n) => h('li', { class: 'row', onclick: () => select(n.id, { center: true }) },
    h('i', { class: 'dot', style: { background: G.GROUPS[n.group]?.color } }),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, n.display || n.title)),
    h('span', { class: 'row-sub' }, G.degree(n) || ''))));
}

const KIND_LABEL = { note: 'Daybook note', learn: 'Learning', book: 'Book', watch: 'Watch list', goal: 'Goal', tag: 'Tag', ghost: 'Not written yet' };

function nodeCard(n) {
  const g = G.GROUPS[n.group] || {};
  const label = n.kind === 'vault' ? `${g.label?.replace(/s$/, '') || 'Page'} · ${n.path}` : KIND_LABEL[n.kind];
  const out = [...n.links].map((id) => graph.nodes.get(id)).filter((x) => x && x.kind !== 'tag');
  const back = [...n.backlinks].map((id) => graph.nodes.get(id)).filter(Boolean);
  const tagsOf = [...n.links].map((id) => graph.nodes.get(id)).filter((x) => x?.kind === 'tag');

  const actions = [];
  if (n.kind === 'vault') {
    actions.push(h('a', { class: 'btn sm primary', href: vault.obsidianUrl(n.path) }, 'Open in Obsidian'));
    actions.push(h('a', { class: 'btn sm', href: vault.githubUrl(n.path), target: '_blank', rel: 'noopener' }, icon('external', 16), 'GitHub'));
  } else if (G.GROUPS[n.group]?.daybook) {
    actions.push(h('button', { class: 'btn sm primary', onclick: () => openItem(n) }, 'Open'));
  } else if (n.kind === 'ghost') {
    actions.push(h('button', { class: 'btn sm primary', onclick: () => { const r = store.put('notes', { text: `${n.title}\n`, pinned: false }); editNote(r); } }, 'Write it as a note'));
  }
  if (n.kind !== 'tag') actions.push(h('button', { class: 'btn sm', onclick: () => copyForAI(n) }, 'Copy for AI'));

  return h('section', { class: 'card map-node' },
    h('div', { class: 'card-head' },
      h('span', { class: 'map-kind' }, h('i', { class: 'dot', style: { background: g.color } }), label),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Close', onclick: () => select(null) }, icon('close', 18))),
    h('h2', { class: 'map-title' }, n.display || n.title),
    tagsOf.length ? h('div', { class: 'chips' }, tagsOf.map((t) => h('button', { class: 'chip', onclick: () => select(t.id, { center: true }) }, t.title))) : null,
    h('div', { class: 'btn-row' }, actions),
    n.kind === 'vault' ? h('div', { class: 'md' }, renderMd(n.text, n.display || n.title)) : null,
    G.GROUPS[n.group]?.daybook ? h('div', { class: 'md' }, renderMd(n.kind === 'note' ? G.noteBody(n.text) : n.text.trim() === n.title ? '' : n.text)) : null,
    n.kind === 'ghost' ? h('p', { class: 'small muted' }, `No page called “${n.title}” yet. ${back.length} page${back.length === 1 ? ' links' : 's link'} to it. Write it as a Daybook note, or ask an assistant to write the vault page.`) : null,
    out.length ? h('div', null, h('h4', { class: 'map-h4' }, `Links to (${out.length})`), nodeList(out)) : null,
    back.length ? h('div', null, h('h4', { class: 'map-h4' }, `${n.kind === 'tag' ? 'Tagged' : 'Linked from'} (${back.length})`), nodeList(back)) : null);
}

function openItem(n) {
  const r = n.ref;
  if (!r) { if (n.kind === 'vault') location.href = vault.obsidianUrl(n.path); return; }
  if (n.kind === 'note') editNote(r);
  else if (n.kind === 'learn') editLearning(r);
  else if (n.kind === 'book') E.editReading(r);
  else if (n.kind === 'watch') editWatch(r);
  else if (n.kind === 'goal') editGoal(r);
}

// ---- Markdown → DOM ----------------------------------------------------------------------------------------
function renderMd(md, title) {
  const blocks = parseBlocks(md);
  // Most pages open with "# Title", which the card already shows.
  if (title && blocks[0]?.type === 'h' && blocks[0].level === 1 && G.norm(blocks[0].text) === G.norm(title)) blocks.shift();
  return blocks.map(block);
}

function block(b) {
  if (b.type === 'h') return h(`h${Math.min(6, b.level + 2)}`, null, inl(b.text));
  if (b.type === 'p') return h('p', null, inl(b.text));
  if (b.type === 'hr') return h('hr');
  if (b.type === 'code') return h('pre', null, h('code', null, b.text));
  if (b.type === 'quote') return h('blockquote', null, b.blocks.map(block));
  if (b.type === 'callout') return h('div', { class: ['callout', b.kind] }, h('p', { class: 'callout-title' }, inl(b.title)), b.blocks.map(block));
  return h(b.type, null, b.items.map((it) => h('li', { style: it.depth ? { marginLeft: `${it.depth * 16}px` } : null },
    it.checked !== null ? h('input', { type: 'checkbox', checked: it.checked, disabled: true }) : null, inl(it.text))));
}

function inl(text) {
  return inline(text).map((t) => {
    if (t.t === 'text') return t.v;
    if (t.t === 'code') return h('code', null, t.v);
    if (t.t === 'b') return h('strong', null, t.v);
    if (t.t === 'i') return h('em', null, t.v);
    if (t.t === 's') return h('s', null, t.v);
    if (t.t === 'mark') return h('mark', null, t.v);
    if (t.t === 'tag') return h('button', { class: 'md-tag', onclick: () => select(`tag:${t.v.toLowerCase()}`, { center: true }) }, `#${t.v}`);
    if (t.t === 'wiki') {
      const id = graph.find(t.target) || `ghost:${G.norm(t.target.split('/').pop())}`;
      return h('button', { class: ['md-link', !graph.nodes.has(id) || id.startsWith('ghost:') ? 'missing' : null], onclick: () => select(graph.nodes.has(id) ? id : null, { center: true }) }, t.v);
    }
    if (t.t === 'link') {
      if (!t.href) return t.v;
      if (/^[a-z]+:/i.test(t.href)) return h('a', { href: t.href, target: '_blank', rel: 'noopener' }, t.v);
      // A relative Markdown link to another vault page.
      const id = graph.find(decodeURIComponent(t.href.split('#')[0]));
      return id ? h('button', { class: 'md-link', onclick: () => select(id, { center: true }) }, t.v) : t.v;
    }
    return t.v;
  });
}

// ---- Copy for any chatbot ------------------------------------------------------------------------------------
function copyForAI(n) {
  const near = [...G.neighborhood(graph, n.id, 1)].filter((id) => id !== n.id).map((id) => graph.nodes.get(id)).filter((x) => x && x.kind !== 'tag' && x.kind !== 'ghost');
  const body = (x) => (x.kind === 'vault' ? `File: ${x.path}\n\n${x.text.trim()}` : `${KIND_LABEL[x.kind]}: ${x.title}\n\n${x.text.trim()}`).slice(0, 6000);
  let text = `These are pages from my second brain (an Obsidian vault). Answer from them and cite page titles. If something isn't covered, say so rather than guessing.\n\n=== ${n.display || n.title} ===\n${body(n)}\n`;
  for (const x of near) {
    const part = `\n=== Linked: ${x.display || x.title} ===\n${body(x)}\n`;
    if (text.length + part.length > 40000) break;
    text += part;
  }
  text += '\nMy question: ';
  const done = () => toast(`Copied ${1 + near.length} page${near.length ? 's' : ''}. Paste into any chatbot.`);
  navigator.clipboard?.writeText(text).then(done).catch(() => showText(text));
  if (!navigator.clipboard) showText(text);
}

function showText(text) {
  const ta = h('textarea', { class: 'note-editor', rows: 14, readonly: true }, text);
  sheet('Copy this into your chatbot', ta, { actions: [h('button', { class: 'btn primary', onclick: closeSheet }, 'Done')] });
  setTimeout(() => { ta.focus(); ta.select(); }, 50);
}

// ---- Cards: capture, vault, connect ---------------------------------------------------------------------------
function captureCard() {
  const ta = h('textarea', { rows: 3, class: 'note-compose', placeholder: 'A thought, link or quote… first line is the title. It lands in raw/inbox/ for an assistant to file.', 'data-key': 'map-capture' });
  const btn = h('button', { class: 'btn primary sm' }, 'Send to inbox');
  btn.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) return;
    btn.disabled = true;
    try {
      await vault.capture(text);
      ta.value = '';
      toast('Sent to your vault inbox');
    } catch (e) { toast(e.message); } finally { btn.disabled = false; }
  });
  return section('Send to your vault', null, ta, h('div', { class: 'compose-actions' }, h('span', { class: 'muted small' }, 'Then ask any assistant to “process my inbox”.'), btn));
}

function vaultCard() {
  const cfg = vault.config();
  const exportBtn = h('button', { class: 'btn sm' }, icon('upload', 16), 'Copy Daybook to vault');
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    try {
      const n = await vault.exportDaybook({ notes: store.all('notes'), learnings: store.all('learnings'), reading: store.all('reading'), watch: store.all('watch'), goals: store.all('goals') });
      toast(n ? `Updated ${n} file${n === 1 ? '' : 's'} in raw/daybook/` : 'raw/daybook/ is already up to date');
    } catch (e) { toast(e.message); } finally { exportBtn.disabled = false; }
  });
  const name = h('input', { value: cfg.vaultName, 'data-key': 'map-vault-name' });
  name.addEventListener('change', () => { vault.setVaultName(name.value); toast('Saved'); });
  return section('Vault', h('span', { class: 'badge good' }, 'Connected'),
    h('p', { class: 'small' }, h('a', { href: `https://github.com/${cfg.repo}`, target: '_blank', rel: 'noopener' }, cfg.repo), ` · branch ${cfg.branch}. The token stays on this device.`),
    h('p', { class: 'small muted' }, 'Copy your learnings, reading list, watch list, goals and notes into raw/daybook/, so assistants can ingest them and every chatbot can see them.'),
    field('Vault name in Obsidian (for “Open in Obsidian”)', name),
    h('div', { class: 'btn-row' }, exportBtn,
      h('button', { class: 'btn ghost sm', onclick: async () => { await vault.disconnect(); pos.clear(); cam.fitted = 0; toast('Vault disconnected on this device'); } }, 'Disconnect')));
}

function connectCard() {
  const user = sync.status().user;
  const repo = h('input', { placeholder: 'owner/second-brain', value: user ? `${user}/second-brain` : '', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  const token = h('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: 'false' });
  const name = h('input', { placeholder: 'second-brain', value: 'second-brain', autocapitalize: 'off' });
  const btn = h('button', { class: 'btn primary' }, 'Connect vault');
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Connecting…';
    try {
      await vault.connect({ repo: repo.value, token: token.value, vaultName: name.value });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast('Vault connected');
    } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Connect vault'; }
  });
  return section('Connect your vault', null,
    h('p', { class: 'small' }, 'Shows your Obsidian second brain here, on every device. Daybook reads it from its private GitHub repo, the one the FIT plugin syncs.'),
    h('ol', { class: 'small steps' },
      h('li', null, h('a', { href: TOKEN_URL, target: '_blank', rel: 'noopener' }, 'Create a fine-grained token'), ': only the second-brain repo, Contents: Read and write. The FIT sync token works too.'),
      h('li', null, 'Paste it below. It stays on this device and isn’t synced.')),
    field('Repo', repo), field('Token', token), field('Vault name in Obsidian', name, 'Used for “Open in Obsidian” links.'),
    h('div', { class: 'btn-row' }, btn));
}

function whyCard() {
  return section('How it fits together', null,
    h('ul', { class: 'small steps' },
      h('li', null, 'Your vault is plain Markdown in a private GitHub repo. Obsidian syncs it to your iPad, phone and laptop.'),
      h('li', null, 'Any assistant (Claude, ChatGPT, Gemini…) can read it there, and some can file and link notes for you.'),
      h('li', null, 'Daybook shows the map, sends quick thoughts to the inbox, and copies your learnings and books across.'),
      h('li', null, 'Without a vault, the map still shows your Daybook notes and learnings. Link them with [[Page name]].')));
}

function timeAgo(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
