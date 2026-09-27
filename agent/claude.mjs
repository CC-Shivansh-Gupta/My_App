// Claude Code as the agent's AI, on your own Claude plan: no API key and nothing extra to pay.
// It runs the official Claude Code CLI in print mode (`claude -p`), signed in with the long-lived
// token `claude setup-token` makes (CLAUDE_CODE_OAUTH_TOKEN). Same interface as ai.mjs's client,
// so any agent step can use it. Usage counts towards your plan's limits like any Claude Code use.
//
// It runs in an empty temporary folder with editing, shell and web tools switched off: it only
// reads the prompt and writes an answer.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PACKAGE = '@anthropic-ai/claude-code';
const NO_TOOLS = 'Bash Edit Write MultiEdit NotebookEdit WebFetch WebSearch Task';

// Messages → one prompt: the system text first, then the conversation.
export function toPrompt(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');
  const convo = turns.length === 1 ? turns[0].content
    : turns.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n\n');
  return `${system}\n\n${convo}\n\nAnswer directly in the format asked for. Don't use any tools.`;
}

// `claude -p --output-format json` prints one JSON object whose `result` is the answer.
export function readOutput(stdout) {
  const text = String(stdout || '').trim();
  let j = null;
  try { j = JSON.parse(text.slice(text.indexOf('{'))); } catch { j = null; }
  if (!j) { if (text) return text; throw new Error('Claude Code printed nothing'); }
  if (j.is_error || j.subtype === 'error') throw new Error(`Claude Code: ${String(j.result || j.error || j.subtype).slice(0, 80)}`);
  const out = String(j.result ?? '').trim();
  if (!out) throw new Error('Claude Code returned nothing');
  return out;
}

export function claudeClient({ token, model = '', bin = '', spawnImpl = spawn, timeoutMs = 240000 }) {
  const [cmd, ...pre] = bin ? bin.split(/\s+/) : ['npx', '-y', PACKAGE];
  const args = [...pre, '-p', '--output-format', 'json', '--max-turns', '3', '--disallowedTools', NO_TOOLS, ...(model ? ['--model', model] : [])];

  async function chat(messages) {
    const cwd = mkdtempSync(join(tmpdir(), 'daybook-claude-'));
    try {
      const stdout = await new Promise((resolve, reject) => {
        const child = spawnImpl(cmd, args, { cwd, env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = ''; let err = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Claude Code timed out')); }, timeoutMs);
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Claude Code didn’t start: ${e.message}`)); });
        child.on('close', (code) => {
          clearTimeout(timer);
          // Never echo stderr wholesale into logs: it could quote the prompt. First line only.
          if (code !== 0 && !out.trim()) reject(new Error(`Claude Code exited ${code}${err ? `: ${err.split('\n')[0].slice(0, 80)}` : ''}`));
          else resolve(out);
        });
        child.stdin.end(toPrompt(messages));
      });
      return readOutput(stdout);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  return { chat, model: () => model || 'Claude', kind: 'claude' };
}
