// Polls the feeds in news/sources.json and writes <outDir>/news.json for the app.
// Runs in GitHub Actions every few hours (no dependencies, Node 20+).
// Usage: node scripts/fetch-news.mjs <outDir>

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripHtml(s) {
  return decode(decode(s).replace(/<[^>]*>/g, ' ')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tag(block, names) {
  for (const n of names) {
    const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i');
    const m = block.match(re);
    if (m) return m[1];
  }
  return '';
}

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const pick = links.find((a) => /rel=["']alternate["']/i.test(a)) || links.find((a) => !/rel=/i.test(a)) || links[0];
  const href = pick && pick.match(/href=["']([^"']+)["']/i);
  return href ? decode(href[1]) : '';
}

export function parseFeed(xml) {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = [...xml.matchAll(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  for (const b of blocks) {
    const title = stripHtml(tag(b, ['title']));
    let link = isAtom ? atomLink(b) : decode(tag(b, ['link'])).trim();
    if (!link) link = decode(tag(b, ['guid', 'id'])).trim();
    const date = decode(tag(b, ['pubDate', 'published', 'updated', 'dc:date'])).trim();
    const summary = stripHtml(tag(b, ['description', 'summary', 'content', 'content:encoded']));
    if (!title || !/^https?:/i.test(link)) continue;
    const t = Date.parse(date);
    items.push({ title, link, published: Number.isNaN(t) ? null : new Date(t).toISOString(), summary: summary.slice(0, 320) });
  }
  return items;
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Daybook-news/1.0 (personal RSS reader)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function matchesAny(item, keywords) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  return keywords.some((k) => text.includes(k.toLowerCase()));
}

export async function run(outDir, cfg) {
  const maxAge = Date.now() - (cfg.maxAgeDays || 21) * 86400000;
  const seen = new Set();
  const all = [];
  const sources = [];
  await Promise.all(cfg.feeds.map(async (f) => {
    try {
      let items = parseFeed(await fetchText(f.url));
      if (f.keywords?.length) items = items.filter((i) => matchesAny(i, f.keywords));
      items = items.filter((i) => !i.published || Date.parse(i.published) >= maxAge).slice(0, f.max || cfg.maxPerFeed || 120);
      for (const i of items) all.push({ ...i, source: f.name, category: f.category || 'news' });
      sources.push({ name: f.name, ok: true, count: items.length });
    } catch (e) {
      sources.push({ name: f.name, ok: false, error: String(e.message || e) });
    }
  }));
  const items = [];
  for (const i of all) {
    const key = i.link.replace(/[?#].*$/, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ id: createHash('sha1').update(key).digest('hex').slice(0, 12), ...i });
  }
  items.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
  const out = { generatedAt: new Date().toISOString(), sources: sources.sort((a, b) => a.name.localeCompare(b.name)), items };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/news.json`, JSON.stringify(out));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] || 'app/data';
  const cfg = JSON.parse(readFileSync(new URL('../news/sources.json', import.meta.url), 'utf8'));
  const out = await run(outDir, cfg);
  for (const s of out.sources) console.log(`${s.ok ? '✓' : '✗'} ${s.name}${s.ok ? ` (${s.count})` : ` — ${s.error}`}`);
  console.log(`Wrote ${out.items.length} items to ${outDir}/news.json`);
}
