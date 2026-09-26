import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../app/js/graph.js';
import { parseBlocks, inline, safeHref } from '../app/js/md.js';
import { parseRepo, isNote, inboxFile, daybookMarkdown, slug } from '../app/js/vault.js';

test('wikilinks and tags', () => {
  assert.deepEqual(G.parseLinks('See [[Deep Work]] and [[wiki/concepts/Flow#Why|flow]]. `[[not a link]]`'), [
    { target: 'Deep Work', alias: '' },
    { target: 'wiki/concepts/Flow', alias: 'flow' },
  ]);
  assert.deepEqual(G.parseTags('# Heading\nabout #ai and #ml/nlp, not #1 or [link](http://x.com/#frag) or `#code`'), ['ai', 'ml/nlp']);
});

test('frontmatter', () => {
  const { data, body } = G.splitFrontmatter('---\ntitle: "LLM wiki"\naliases: [llm-wiki, AI wiki]\ntags:\n  - pkm\n  - ai\ncreated: 2026-09-25\n---\n\n# LLM wiki\nBody');
  assert.equal(data.title, 'LLM wiki');
  assert.deepEqual(data.aliases, ['llm-wiki', 'AI wiki']);
  assert.deepEqual(data.tags, ['pkm', 'ai']);
  assert.equal(body.trim(), '# LLM wiki\nBody');
  assert.deepEqual(G.splitFrontmatter('no frontmatter').data, {});
});

test('graph resolves links like Obsidian: title, alias, path; unknown targets become ghosts', () => {
  const docs = [
    G.vaultDoc('wiki/concepts/LLM wiki.md', '---\naliases: [llm-wiki]\ntags: [ai]\n---\nBuilt on [[Second brain]] and [[Atomic notes]].'),
    G.vaultDoc('wiki/concepts/Second brain.md', 'See [[llm-wiki]] and [[wiki/concepts/LLM wiki|the pattern]].'),
    ...G.daybookDocs({
      notes: [{ id: 'n1', text: '# Reading plan\nStart with [[Second brain]] then [[Deep Work]]' }],
      reading: [{ id: 'b1', title: 'Deep Work', author: 'Cal Newport' }],
      learnings: [{ id: 'l1', text: 'Focus is a skill', topics: ['Focus'], source: 'deep work' }],
      goals: [{ id: 'g1', title: 'Read 24 books' }, { id: 'g2', title: 'Read 2 books in May', parent: 'g1' }],
    }),
  ];
  const g = G.buildGraph(docs);
  const llm = 'vault:wiki/concepts/LLM wiki.md';
  const sb = 'vault:wiki/concepts/Second brain.md';
  assert.ok(g.nodes.get(sb).links.has(llm), 'alias and path both resolve');
  assert.equal(g.edges.filter((e) => [e.a, e.b].includes(sb) && [e.a, e.b].includes(llm)).length, 1, 'one edge per pair');
  assert.ok(g.nodes.has('ghost:atomic notes'));
  assert.equal(g.nodes.get('note:n1').title, 'Reading plan');
  assert.ok(g.nodes.get('note:n1').links.has('book:b1'), 'a note links to a Daybook book');
  assert.ok(g.nodes.get('learn:l1').links.has('book:b1'), 'learning source ties to the book');
  assert.ok(g.nodes.get('learn:l1').links.has('tag:focus'));
  assert.ok(g.nodes.get(llm).links.has('tag:ai'), 'frontmatter tags');
  assert.ok(g.nodes.get('goal:g2').links.has('goal:g1'));
  assert.equal(g.find('LLM WIKI'), llm);
  assert.ok(G.neighborhood(g, 'book:b1', 1).has('note:n1'));
  assert.equal(G.buildGraph(docs, { tags: false }).nodes.has('tag:ai'), false);
});

test('vault pages win a title over Daybook items', () => {
  const g = G.buildGraph([G.vaultDoc('wiki/entities/Obsidian.md', ''), ...G.daybookDocs({ notes: [{ id: 'x', text: 'Obsidian\nmy note' }, { id: 'y', text: 'Uses [[Obsidian]]' }] })]);
  assert.ok(g.nodes.get('note:y').links.has('vault:wiki/entities/Obsidian.md'));
});

test('layout settles', () => {
  const g = G.buildGraph(G.daybookDocs({ notes: [{ id: 'a', text: 'A\n[[B]] [[C]]' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C\n[[B]]' }] }));
  const pos = new Map();
  const ids = [...g.nodes.keys()];
  G.seed(pos, ids, g);
  let moved = Infinity;
  for (let i = 0; i < 300; i++) moved = G.step(pos, ids, g.edges, { alpha: 0.5 });
  assert.ok(moved < 0.5, `still moving: ${moved}`);
  for (const p of pos.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test('markdown blocks', () => {
  const b = parseBlocks('# Title\n\nPara one\ncontinues.\n\n- [ ] todo\n- [x] done\n  - nested\n1. first\n\n> [!note] Heads up\n> inside\n\n```js\nconst a = 1;\n```\n---');
  assert.deepEqual(b.map((x) => x.type), ['h', 'p', 'ul', 'ol', 'callout', 'code', 'hr']);
  assert.equal(b[1].text, 'Para one continues.');
  assert.deepEqual(b[2].items.map((i) => [i.text, i.checked, i.depth]), [['todo', false, 0], ['done', true, 0], ['nested', null, 1]]);
  assert.equal(b[4].title, 'Heads up');
  assert.equal(b[5].text, 'const a = 1;');
});

test('markdown inline, and unsafe links are dropped', () => {
  const t = inline('**Bold** and *it* with [[Page|alias]], `code`, #tag, [x](javascript:alert(1)) and https://ex.com/a.');
  assert.deepEqual(t.filter((x) => x.t !== 'text').map((x) => x.t), ['b', 'i', 'wiki', 'code', 'tag', 'link', 'link']);
  assert.equal(t.find((x) => x.t === 'wiki').target, 'Page');
  assert.equal(t.filter((x) => x.t === 'link')[0].href, null);
  assert.equal(t.filter((x) => x.t === 'link')[1].href, 'https://ex.com/a');
  assert.equal(safeHref('obsidian://open?vault=x'), 'obsidian://open?vault=x');
  assert.equal(safeHref('data:text/html,hi'), null);
});

test('vault helpers', () => {
  assert.equal(parseRepo('https://github.com/Me/second-brain.git'), 'Me/second-brain');
  assert.equal(parseRepo('me/second-brain'), 'me/second-brain');
  assert.equal(parseRepo('nonsense'), '');
  assert.ok(isNote('wiki/concepts/LLM wiki.md'));
  assert.ok(isNote('Home.md'));
  for (const p of ['.obsidian/x.md', '_fit/a.md', 'templates/daily.md', 'raw/inbox/README.md', 'AGENTS.md', 'output/context-pack.md', 'img.png']) assert.equal(isNote(p), false, p);
  assert.equal(slug('Café & Crème: ideas!'), 'cafe-creme-ideas');
  const f = inboxFile('Try spaced repetition\nfor [[LLM wiki]] pages', new Date(2026, 8, 26, 9, 5));
  assert.equal(f.path, 'raw/inbox/2026-09-26-0905-try-spaced-repetition.md');
  assert.match(f.text, /^---\ncaptured: .+\nfrom: daybook\n---\n\n# Try spaced repetition\n\nfor \[\[LLM wiki\]\] pages\n$/);
});

test('Daybook export to raw/daybook', () => {
  const out = daybookMarkdown({
    learnings: [{ text: 'Sleep consolidates memory', type: 'fact', topics: ['sleep science'], source: 'Why We Sleep', details: 'REM + deep sleep', createdAt: Date.UTC(2026, 8, 20) }],
    reading: [{ title: 'Deep Work', author: 'Cal Newport', status: 'done', finishedAt: '2026-09-01', rating: 4 }, { title: 'SICP', status: 'reading', progress: 30 }],
    watch: [], goals: [{ id: 'g1', title: 'Read 24 books', horizon: 'year', period: '2026', mode: 'number', current: 7, target: 24, unit: 'books' }],
    notes: [{ text: 'Idea\nlink [[LLM wiki]]', updatedAt: 1 }],
  }, '2026-09-26');
  assert.deepEqual(Object.keys(out).sort(), ['raw/daybook/goals.md', 'raw/daybook/learnings.md', 'raw/daybook/notes.md', 'raw/daybook/reading.md', 'raw/daybook/watch.md']);
  assert.match(out['raw/daybook/learnings.md'], /\*\*Sleep consolidates memory\*\*\n {2}fact · 2026-09-2\d · #sleep-science · source: Why We Sleep\n {2}REM \+ deep sleep/);
  assert.match(out['raw/daybook/reading.md'], /## Reading now\n\n- \*\*SICP\*\* · 30%[\s\S]*## Finished\n\n- \*\*Deep Work\*\* by Cal Newport · finished 2026-09-01 · ★★★★/);
  assert.match(out['raw/daybook/goals.md'], /## Yearly\n\n- \*\*Read 24 books\*\* \(2026\) · active · 7\/24 books/);
  assert.match(out['raw/daybook/notes.md'], /## Idea\n\nlink \[\[LLM wiki\]\]/);
  assert.match(out['raw/daybook/watch.md'], /exported: 2026-09-26/);
});
