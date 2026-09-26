// Small Markdown reader for vault pages: parses into plain objects (no HTML strings, so nothing in
// a note can inject markup), which views turn into DOM. Covers what notes actually use: headings,
// paragraphs, lists and checkboxes, quotes and callouts, code, rules, links, [[wikilinks]], #tags,
// **bold**, *italic*, ~~strike~~, ==highlight== and `code`.

export function parseBlocks(md = '') {
  const lines = String(md).replace(/\r/g, '').split('\n');
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push({ type: 'p', text: para.join(' ') }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)\s*(\S*)/);
    if (fence) {
      flush();
      const body = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i]);
      out.push({ type: 'code', lang: fence[2], text: body.join('\n') });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const hd = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (hd) { flush(); out.push({ type: 'h', level: hd[1].length, text: hd[2] }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push({ type: 'hr' }); continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      i--;
      const callout = body[0]?.match(/^\[!(\w+)\][+-]?\s*(.*)$/);
      if (callout) out.push({ type: 'callout', kind: callout[1].toLowerCase(), title: callout[2] || callout[1], blocks: parseBlocks(body.slice(1).join('\n')) });
      else out.push({ type: 'quote', blocks: parseBlocks(body.join('\n')) });
      continue;
    }
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!m) {
          // A wrapped continuation line belongs to the previous item.
          if (items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1].text += ` ${lines[i].trim()}`; i++; continue; }
          break;
        }
        // A top-level item of the other kind (1. vs -) starts a new list.
        if (items.length && !m[1] && /\d/.test(m[2]) !== ordered) break;
        const cb = m[3].match(/^\[( |x|X)\]\s*(.*)$/);
        items.push({ depth: Math.min(4, Math.floor(m[1].replace(/\t/g, '  ').length / 2)), text: cb ? cb[2] : m[3], checked: cb ? cb[1] !== ' ' : null });
        i++;
      }
      i--;
      out.push({ type: ordered ? 'ol' : 'ul', items });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

const INLINE = [
  ['code', /`([^`]+)`/y],
  ['wiki', /!?\[\[([^\[\]\n]+?)\]\]/y],
  ['link', /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/y],
  ['url', /https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?'"]/y],
  ['b', /\*\*(.+?)\*\*|__(.+?)__/y],
  ['i', /\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])/y],
  ['s', /~~(.+?)~~/y],
  ['mark', /==(.+?)==/y],
  ['tag', /(?<![\w&])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/uy],
];

// Text → [{ t: 'text'|'code'|'wiki'|'link'|'b'|'i'|'s'|'mark'|'tag', v, target?, href? }]
export function inline(text = '') {
  const s = String(text);
  const out = [];
  let buf = '';
  let i = 0;
  const push = (tok) => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } out.push(tok); };
  outer: while (i < s.length) {
    for (const [t, re] of INLINE) {
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) continue;
      if (t === 'wiki') {
        const [target, ...alias] = m[1].split('|');
        push({ t, target: target.split('#')[0].split('^')[0].trim(), v: alias.length ? alias.join('|').trim() : target.replace(/#\^?/, ' › ').trim() });
      } else if (t === 'link') {
        push({ t, v: m[1], href: safeHref(m[2]) });
      } else if (t === 'url') {
        push({ t: 'link', v: m[0], href: safeHref(m[0]) });
      } else {
        push({ t, v: m[1] ?? m[2] });
      }
      i = re.lastIndex;
      continue outer;
    }
    buf += s[i++];
  }
  if (buf) out.push({ t: 'text', v: buf });
  return out;
}

// Only web, mail and obsidian links; anything else (javascript:, data:) is dropped.
export function safeHref(href) {
  const h = String(href).trim();
  if (/^(https?:|mailto:|obsidian:)/i.test(h)) return h;
  if (/^[\w-]+:/.test(h)) return null;
  return h; // relative link inside the vault
}
