import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, stripHtml } from '../scripts/fetch-news.mjs';

test('parses RSS', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
    <item><title><![CDATA[Scaling &amp; Agents]]></title><link>https://arxiv.org/abs/2609.00001</link>
      <description>&lt;p&gt;We study &lt;b&gt;LLM&lt;/b&gt; agents.&lt;/p&gt;</description><pubDate>Thu, 24 Sep 2026 04:00:00 GMT</pubDate></item>
    <item><title>No link</title></item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Scaling & Agents');
  assert.equal(items[0].link, 'https://arxiv.org/abs/2609.00001');
  assert.equal(items[0].summary, 'We study LLM agents.');
  assert.equal(items[0].published, '2026-09-24T04:00:00.000Z');
});

test('parses Atom', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Hiring: ML Engineer</title>
    <link rel="self" href="https://x/self"/><link rel="alternate" href="https://jobs.example.com/1"/>
    <updated>2026-09-20T10:00:00Z</updated><summary>Remote, full-time</summary></entry></feed>`;
  const [item] = parseFeed(xml);
  assert.equal(item.link, 'https://jobs.example.com/1');
  assert.equal(item.title, 'Hiring: ML Engineer');
  assert.equal(item.summary, 'Remote, full-time');
});

test('strips html', () => {
  assert.equal(stripHtml('<p>a&nbsp;<i>b</i></p>'), 'a b');
});
