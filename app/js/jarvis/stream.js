// Streaming helpers, so Jarvis can start talking while the AI is still writing.
//   sse()           — reads an OpenAI-style Server-Sent Events stream, chunk by chunk.
//   partialSay()    — pulls the "say" text out of a JSON reply that is still arriving.
//   sentenceStream() — hands out whole sentences as soon as they're complete, for the voice.
// No DOM here so it can be tested.

// Feed it text chunks from a streaming response; it calls onData(json) for each `data:` event.
export function sse(onData) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) read(line);
    },
    end() { if (buf) read(buf); buf = ''; },
  };
  function read(line) {
    const m = line.match(/^data:\s?(.*)$/);
    if (!m || !m[1] || m[1] === '[DONE]') return;
    try { onData(JSON.parse(m[1])); } catch { /* a keep-alive or a broken line */ }
  }
}

// The text of a streamed chat-completion chunk (OpenAI-compatible or WebLLM).
export function deltaText(j) {
  return j?.choices?.[0]?.delta?.content || '';
}

const ESC = { n: '\n', t: '\t', r: '', '"': '"', '\\': '\\', '/': '/', b: '', f: '' };

// `raw` is the reply so far. Returns { text, done } with what "say" holds so far, or null when
// there's nothing to say yet. A reply that isn't JSON at all (small models sometimes just talk)
// is returned as it is.
export function partialSay(raw) {
  let s = String(raw || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').replace(/^\s*```(?:json)?\s*/i, '');
  const lead = s.trimStart();
  if (!lead) return null;
  if (lead[0] !== '{' && lead[0] !== '[') {
    if (/^[<`]/.test(lead)) return null;
    return { text: lead.replace(/```\s*$/, ''), done: false, plain: true };
  }
  const m = s.match(/"(?:say|reply|answer)"\s*:\s*"/);
  if (!m) return null;
  let out = '';
  let i = m.index + m[0].length;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '"') return { text: out, done: true };
    if (c !== '\\') { out += c; continue; }
    const n = s[i + 1];
    if (n === undefined) break; // the escape hasn't fully arrived
    if (n === 'u') {
      const hex = s.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16) || 32);
      i += 5;
    } else {
      out += ESC[n] ?? n;
      i += 1;
    }
  }
  return { text: out, done: false };
}

// Collects streamed text and calls onSentence(sentence) for each complete one. A sentence counts
// as complete once whitespace follows its full stop, so "3.5 km" and "e.g." don't split early.
export function sentenceStream(onSentence) {
  let used = 0;
  let spoken = '';
  const SENT = /[\s\S]*?[.!?…]+["”’')\]]*\s+/y;
  const emit = (s) => {
    const t = s.trim();
    if (!t) return;
    spoken += (spoken ? ' ' : '') + t;
    onSentence(t);
  };
  return {
    push(full) {
      const text = String(full || '');
      if (text.length < used) return; // a different stream; ignore
      for (;;) {
        SENT.lastIndex = used;
        const m = SENT.exec(text);
        if (!m || !m[0].trim()) break;
        // Don't cut after an abbreviation or a lone initial ("Dr. ", "e.g. ", "J. ").
        if (/(?:\b(?:mr|mrs|ms|dr|st|vs|etc|e\.g|i\.e|approx)|\b\p{L})\.["”’')\]]*\s+$/iu.test(m[0])) {
          const next = SENT.exec(text);
          if (!next) break;
          emit(m[0] + next[0]);
          used = SENT.lastIndex;
          continue;
        }
        used = SENT.lastIndex;
        emit(m[0]);
      }
    },
    end(full) {
      this.push(full);
      const rest = String(full || '').slice(used);
      used = String(full || '').length;
      emit(rest);
    },
    spoken: () => spoken,
  };
}

const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// What's left to say of `final` after `spoken` was already streamed out loud.
export function remainder(final, spoken) {
  const f = flat(final);
  const s = flat(spoken);
  if (!s) return f;
  if (f === s) return '';
  if (f.startsWith(s)) return f.slice(s.length).trim();
  return f;
}
