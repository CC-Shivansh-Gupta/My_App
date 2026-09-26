// Knowledge map model: a graph of linked pages, Obsidian-style. Pages come from the Obsidian
// vault (see vault.js) and from Daybook itself (notes, learnings, books, shows, goals).
// Links are [[Title]], [[Title|alias]] or [[folder/Title#heading]]; #tags and learning topics
// become tag nodes. No DOM here so it can be tested.

const LINK_RE = /\[\[([^\[\]\n]+?)\]\]/g;
// A #tag follows a space or line start, has at least one letter, and isn't a "# Heading".
const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu;

// "Paris#History|the city" → "Paris"
export function linkTarget(raw) {
  return raw.split('|')[0].split('#')[0].split('^')[0].trim();
}

export function parseLinks(text = '') {
  const out = [];
  for (const m of stripCode(text).matchAll(LINK_RE)) {
    const target = linkTarget(m[1]);
    if (target) out.push({ target, alias: m[1].includes('|') ? m[1].split('|').slice(1).join('|').trim() : '' });
  }
  return out;
}

// Code spans and fenced blocks don't contain real links or tags.
function stripCode(text) {
  return String(text).replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

export function parseTags(text = '') {
  const out = new Set();
  const clean = stripCode(text).replace(LINK_RE, ' ').replace(/\]\([^)]*\)/g, ' '); // skip link URLs with #anchors
  for (const m of clean.matchAll(TAG_RE)) out.add(m[2].toLowerCase());
  return [...out];
}

export const norm = (t) => String(t || '').trim().replace(/\.md$/i, '').replace(/\s+/g, ' ').toLowerCase();

// Daybook notes: the first non-empty line is the title ("# " and checkboxes stripped).
export function noteTitle(text = '') {
  const first = String(text).split('\n').find((l) => l.trim()) || 'Untitled';
  return first.replace(/^\s*#{1,6}\s+/, '').replace(/^(\s*(?:[-*]\s*)?)\[( |x|X)\]\s?/, '').trim().slice(0, 90) || 'Untitled';
}

export function noteBody(text = '') {
  const lines = String(text).split('\n');
  const i = lines.findIndex((l) => l.trim());
  return lines.slice(i + 1).join('\n').trim();
}

// ---- Frontmatter ------------------------------------------------------------------------------------------
// Just enough YAML for Obsidian properties: scalars, [inline, lists] and "- item" lists.
export function splitFrontmatter(text = '') {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { data: {}, body: String(text) };
  const data = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) { (Array.isArray(data[key]) ? data[key] : (data[key] = [])).push(unquote(item[1])); continue; }
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    const v = kv[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) data[key] = v.slice(1, -1).split(',').map(unquote).filter(Boolean);
    else data[key] = v === '' ? [] : unquote(v);
  }
  return { data, body: String(text).slice(m[0].length) };
}

const unquote = (s) => String(s).trim().replace(/^(['"])(.*)\1$/, '$2');
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);

// ---- Documents --------------------------------------------------------------------------------------------
// Everything becomes a "doc": { id, kind, group, title, aliases, text, tags, path?, ref?, softLinks?, linkIds? }

// Which colour group a vault file belongs to, from its folder.
export function groupFor(path) {
  const p = path.toLowerCase();
  if (p.startsWith('wiki/concepts/')) return 'concept';
  if (p.startsWith('wiki/entities/')) return 'entity';
  if (p.startsWith('wiki/sources/')) return 'source';
  if (p.startsWith('wiki/synthesis/')) return 'synthesis';
  if (p.startsWith('journal/')) return 'journal';
  if (p.startsWith('projects/')) return 'project';
  if (p.startsWith('raw/')) return 'raw';
  return 'page';
}

export function vaultDoc(path, text) {
  const { data, body } = splitFrontmatter(text);
  const base = path.split('/').pop().replace(/\.md$/i, '');
  return {
    id: `vault:${path}`, kind: 'vault', group: groupFor(path), path,
    title: base, display: typeof data.title === 'string' && data.title ? data.title : base,
    aliases: list(data.aliases), tags: list(data.tags).map((t) => t.replace(/^#/, '').toLowerCase()),
    props: data, text: body,
  };
}

// Daybook records → docs. `data` holds live arrays: { notes, learnings, reading, watch, goals }.
export function daybookDocs(data) {
  const docs = [];
  for (const r of data.notes || []) docs.push({ id: `note:${r.id}`, kind: 'note', group: 'note', title: noteTitle(r.text), text: r.text || '', ref: r });
  for (const r of data.reading || []) docs.push({ id: `book:${r.id}`, kind: 'book', group: 'book', title: r.title || 'Untitled', text: r.notes || '', ref: r, aliases: r.author ? [`${r.title} by ${r.author}`] : [] });
  for (const r of data.watch || []) docs.push({ id: `watch:${r.id}`, kind: 'watch', group: 'watch', title: r.title || 'Untitled', text: r.notes || '', ref: r });
  for (const r of data.goals || []) {
    docs.push({ id: `goal:${r.id}`, kind: 'goal', group: 'goal', title: r.title || 'Goal', text: r.notes || '', ref: r, linkIds: r.parent ? [`goal:${r.parent}`] : [] });
  }
  for (const r of data.learnings || []) {
    docs.push({
      id: `learn:${r.id}`, kind: 'learn', group: 'learn', title: (r.text || '').trim().slice(0, 120) || 'Learning',
      text: `${r.text || ''}\n${r.details || ''}`, ref: r, tags: (r.topics || []).map((t) => String(t).toLowerCase()),
      softLinks: r.source ? [r.source] : [], // "Source: Deep Work" ties it to that book or page, if it exists
    });
  }
  return docs;
}

export const GROUPS = {
  concept: { label: 'Concepts', color: '#2a78d6' },
  entity: { label: 'Entities', color: '#eda100' },
  source: { label: 'Sources', color: '#0ca30c' },
  synthesis: { label: 'Synthesis', color: '#8a5cf6' },
  journal: { label: 'Journal', color: '#898781' },
  project: { label: 'Projects', color: '#d03b3b' },
  page: { label: 'Other pages', color: '#52514e' },
  raw: { label: 'Raw & inbox', color: '#b4b2a9' },
  note: { label: 'Daybook notes', color: '#0f9d8a', daybook: true },
  learn: { label: 'Learnings', color: '#f08c00', daybook: true },
  book: { label: 'Books', color: '#c2255c', daybook: true },
  watch: { label: 'Watch list', color: '#1098ad', daybook: true },
  goal: { label: 'Goals', color: '#e8590c', daybook: true },
  tag: { label: 'Tags', color: '#898781' },
  ghost: { label: 'Not written yet', color: '#b4b2a9' },
};

// docs in priority order: the first doc to claim a title wins [[Title]] (vault pages go first).
// Returns { nodes: Map(id → node), edges: [{ a, b }], byKey: Map(key → id) }.
// node = { ...doc, links: Set, backlinks: Set }.
export function buildGraph(docs, { tags = true } = {}) {
  const nodes = new Map();
  const byKey = new Map();
  const edges = [];
  const seen = new Set();
  const claim = (key, id) => { const k = norm(key); if (k && !byKey.has(k)) byKey.set(k, id); };
  const link = (a, b) => {
    if (a === b || !nodes.has(a) || !nodes.has(b)) return;
    nodes.get(a).links.add(b);
    nodes.get(b).backlinks.add(a);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!seen.has(key)) { seen.add(key); edges.push({ a, b }); }
  };

  for (const d of docs) nodes.set(d.id, { aliases: [], tags: [], ...d, links: new Set(), backlinks: new Set() });
  // Exact titles first, then aliases, then full paths ([[wiki/concepts/X]]), so aliases never shadow a title.
  for (const d of docs) claim(d.title, d.id);
  for (const d of docs) for (const a of d.aliases || []) claim(a, d.id);
  for (const d of docs) if (d.path) claim(d.path, d.id);

  const find = (target) => byKey.get(norm(target)) || byKey.get(norm(target.split('/').pop()));
  const resolve = (target) => {
    const hit = find(target);
    if (hit) return hit;
    const id = `ghost:${norm(target.split('/').pop())}`;
    if (!nodes.has(id)) nodes.set(id, { id, kind: 'ghost', group: 'ghost', title: target.split('/').pop(), aliases: [], tags: [], text: '', links: new Set(), backlinks: new Set() });
    return id;
  };
  const tagNode = (t) => {
    const id = `tag:${t}`;
    if (!nodes.has(id)) nodes.set(id, { id, kind: 'tag', group: 'tag', title: `#${t}`, aliases: [], tags: [], text: '', links: new Set(), backlinks: new Set() });
    return id;
  };

  for (const d of docs) {
    for (const { target } of parseLinks(d.text)) link(d.id, resolve(target));
    for (const t of d.softLinks || []) { const hit = find(t); if (hit) link(d.id, hit); }
    for (const id of d.linkIds || []) link(d.id, id);
    if (tags) for (const t of new Set([...(d.tags || []), ...parseTags(d.text)])) link(d.id, tagNode(t));
  }
  return { nodes, edges, byKey, find };
}

// Node ids within `depth` hops of `id`, following links either way.
export function neighborhood(graph, id, depth = 1) {
  const seen = new Set([id]);
  let frontier = [id];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const cur of frontier) {
      const n = graph.nodes.get(cur);
      if (!n) continue;
      for (const o of [...n.links, ...n.backlinks]) if (!seen.has(o)) { seen.add(o); next.push(o); }
    }
    frontier = next;
  }
  return seen;
}

export const degree = (n) => new Set([...n.links, ...n.backlinks]).size;

// ---- Force layout -----------------------------------------------------------------------------------------
// Repulsion between nearby nodes, springs along links, a gentle pull to the centre.
// `pos` maps id → { x, y, vx, vy, fixed } and outlives re-renders so the map doesn't jump around.

export function seed(pos, ids, graph) {
  let i = pos.size;
  for (const id of ids) {
    if (pos.has(id)) continue;
    const n = graph.nodes.get(id);
    // New nodes start beside something they link to, otherwise on a sunflower spiral.
    const near = n ? [...n.links, ...n.backlinks].map((o) => pos.get(o)).find(Boolean) : null;
    const a = i * 2.39996;
    const r = near ? 24 : 14 * Math.sqrt(i + 1);
    const base = near || { x: 0, y: 0 };
    pos.set(id, { x: base.x + r * Math.cos(a), y: base.y + r * Math.sin(a), vx: 0, vy: 0 });
    i++;
  }
}

export function step(pos, ids, edges, { alpha = 1, repel = 1100, spring = 0.05, length = 55, gravity = 0.015 } = {}) {
  const P = ids.map((id) => pos.get(id));
  const n = P.length;
  for (let i = 0; i < n; i++) {
    const a = P[i];
    for (let j = i + 1; j < n; j++) {
      const b = P[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 > 160000) continue; // far apart: skip, keeps big vaults fast
      if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
      const f = (repel * alpha) / (d2 + 25);
      a.vx += dx * f; a.vy += dy * f;
      b.vx -= dx * f; b.vy -= dy * f;
    }
  }
  for (const { a: ia, b: ib } of edges) {
    const a = pos.get(ia);
    const b = pos.get(ib);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = ((d - length) / d) * spring * alpha;
    a.vx += dx * f; a.vy += dy * f;
    b.vx -= dx * f; b.vy -= dy * f;
  }
  let moved = 0;
  for (const p of P) {
    p.vx -= p.x * gravity * alpha;
    p.vy -= p.y * gravity * alpha;
    p.vx *= 0.55; p.vy *= 0.55;
    if (p.fixed) { p.vx = 0; p.vy = 0; continue; }
    p.x += Math.max(-30, Math.min(30, p.vx));
    p.y += Math.max(-30, Math.min(30, p.vy));
    moved += Math.abs(p.vx) + Math.abs(p.vy);
  }
  return n ? moved / n : 0;
}
