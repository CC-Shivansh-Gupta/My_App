// Optional AI step for the agent, through any OpenAI-compatible chat API.
// Default: Groq's free tier (free key at console.groq.com, no card; it doesn't
// keep inference data by default). Gemini, OpenRouter, Mistral and others work
// by setting AI_BASE_URL (and AI_MODEL if the automatic pick isn't what you want).
// Everything here fails soft: no key or an error just means no AI this run.

export const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

// Picked in this order from the provider's model list when AI_MODEL isn't set.
// Non-reasoning chat models first: they answer within a small token budget.
const PREFERRED = [/llama-3\.3-70b/, /llama-4/, /gemini-[\d.]+-flash(?!-lite)/, /gpt-oss-120b/, /gpt-oss/, /mistral-small/, /qwen/, /llama/];
const NOT_CHAT = /whisper|tts|guard|embed|audio|moderation|image|playai|orpheus|compound|prompt/i;

export function aiClient({ apiKey, baseUrl = DEFAULT_BASE_URL, model = '', fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const base = baseUrl.replace(/\/+$/, '');
  let chosen = model;
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  async function pick() {
    if (chosen) return chosen;
    const res = await fetchImpl(`${base}/models`, { headers });
    if (!res.ok) throw new Error(`AI model list: ${res.status}`);
    const ids = ((await res.json()).data || []).map((m) => String(m.id).replace(/^models\//, '')).filter((id) => !NOT_CHAT.test(id));
    for (const re of PREFERRED) {
      const hit = ids.find((id) => re.test(id));
      if (hit) return (chosen = hit);
    }
    if (!ids.length) throw new Error('AI provider lists no chat models');
    return (chosen = ids[0]);
  }

  async function chat(messages, { maxTokens = 1200 } = {}) {
    const m = await pick();
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST', headers,
        body: JSON.stringify({ model: m, messages, temperature: 0.2, max_tokens: maxTokens }),
      });
      if (res.status === 429 && attempt === 0) {
        await wait(Math.min(Number(res.headers?.get?.('retry-after')) || 10, 30) * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`AI ${res.status}`);
      const text = String((await res.json()).choices?.[0]?.message?.content || '')
        .replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (!text) throw new Error('AI returned nothing');
      return text;
    }
  }

  return { chat, model: () => chosen };
}

export function parseJson(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e < s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Two or three plain sentences on top of the brief's bullet points.
export async function summarize(ai, { title, date, lines }) {
  const text = await ai.chat([
    { role: 'system', content: 'You write a short summary for one person about their own day or week, from their personal tracker. '
      + 'Use only the facts given; never invent anything. Second person, plain and warm, no greeting, no emoji, no lists. '
      + 'At most 3 sentences and 70 words. If one thing clearly matters most, lead with it.' },
    { role: 'user', content: `${title} for ${date}:\n${lines.join('\n')}` },
  ], { maxTokens: 800 });
  return text.replace(/\s+/g, ' ').slice(0, 600);
}

// To-dos hidden in notes, e.g. "call the bank Friday". `notes` is [{ id, text }].
export async function findTasks(ai, notes, date) {
  if (!notes.length) return [];
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00`).getDay()];
  const text = await ai.chat([
    { role: 'system', content: 'You find to-dos hidden in someone\'s personal notes. Reply with JSON only, shaped '
      + '{"tasks":[{"note":<note number>,"title":"<short imperative task>","due":"YYYY-MM-DD" or null}]}. '
      + 'Include a task only when a note clearly says the writer means or needs to do something ("call the bank Friday", "need to renew passport"). '
      + 'Skip ideas, facts, quotes, reference details (codes, addresses, numbers), lines written as checkboxes like "[ ] milk" or "[x] done", and anything already done. '
      + `Today is ${weekday} ${date}; turn relative dates into YYYY-MM-DD. At most 5 tasks. If there are none, reply {"tasks":[]}.` },
    { role: 'user', content: notes.map((n, i) => `Note ${i + 1}:\n${n.text}`).join('\n\n') },
  ], { maxTokens: 1200 });
  const json = parseJson(text);
  if (!json || !Array.isArray(json.tasks)) throw new Error('AI reply was not the expected JSON');
  const out = [];
  for (const t of json.tasks.slice(0, 5)) {
    const note = notes[Number(t?.note) - 1];
    const title = String(t?.title || '').replace(/\s+/g, ' ').trim();
    if (!note || title.length < 3 || title.length > 120) continue;
    out.push({ noteId: note.id, title, due: DAY.test(t.due || '') ? t.due : null });
  }
  return out;
}
