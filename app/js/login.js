// Password sign-in: open Daybook on a new device, type your password, and everything —
// your data, AI keys, vault and voice settings — arrives. No tokens to paste.
//
// How, with no server: your sync token is encrypted with your password (PBKDF2, 600k rounds →
// AES-GCM) and the result is kept in a small PUBLIC gist on your GitHub account, which any device
// can find from your username alone. Without the password it's unreadable noise, and everything
// else (data, keys) stays in your secret gist. The password never leaves the device and isn't stored.
// Because the encrypted token is public, the password must be long: at least 12 characters.

import * as sync from './sync.js';
import * as store from './store.js';
import { b64, unb64, sealWith, openWith } from './keys.js';

export const FILE = 'daybook-login.json';
export const MIN_LENGTH = 12;
const ITERATIONS = 600000;
const API = 'https://api.github.com';
const enc = new TextEncoder();

// On GitHub Pages the site's address names the account: cc-shivansh-gupta.github.io → cc-shivansh-gupta.
export function defaultUser() {
  const host = typeof location !== 'undefined' ? location.hostname : '';
  return /\.github\.io$/i.test(host) ? host.split('.')[0] : (sync.status().user || '');
}

async function passwordKey(password, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(password, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const sealed = await sealWith(await passwordKey(password, salt), secret);
  return { app: 'daybook-login', v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), ...sealed };
}

export async function unseal(password, blob) {
  try {
    return await openWith(await passwordKey(password, unb64(blob.salt), blob.iterations || ITERATIONS), blob);
  } catch {
    throw new Error('Wrong password.');
  }
}

export function checkPassword(pw) {
  if (pw.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters — a short sentence is easiest to remember.`;
  if (/^(.)\1+$/.test(pw) || /^(?:0123456789|1234567890|password|qwerty)/i.test(pw)) return 'That one’s too easy to guess.';
  return '';
}

async function gh(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method, cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
    if (res.status === 403 && /rate limit/i.test(msg)) msg = 'GitHub is limiting requests from this network. Try again in a few minutes.';
    throw new Error(msg);
  }
  return res.status === 204 ? true : res.json();
}

// The sign-in gist among this account's public gists.
async function findGist(user, token) {
  for (let page = 1; page <= 5; page++) {
    const list = await gh(token ? `/gists?per_page=100&page=${page}` : `/users/${encodeURIComponent(user)}/gists?per_page=100&page=${page}`, { token });
    if (!list) return null;
    const hit = list.find((g) => g.files && g.files[FILE]);
    if (hit) return hit;
    if (list.length < 100) return null;
  }
  return null;
}

// On a device that's already syncing: turn on (or change) password sign-in.
export async function setPassword(password) {
  const problem = checkPassword(password);
  if (problem) throw new Error(problem);
  const token = sync.token();
  if (!token) throw new Error('Turn on sync first.');
  const blob = await seal(password, { token, user: sync.status().user || '' });
  const files = { [FILE]: { content: JSON.stringify(blob) } };
  const found = await findGist('', token);
  if (found) await gh(`/gists/${found.id}`, { token, method: 'PATCH', body: { files } });
  else await gh('/gists', { token, method: 'POST', body: { description: 'Daybook sign-in (encrypted; safe to leave public)', public: true, files } });
  store.setPref('passwordLogin', { on: true, at: Date.now(), user: sync.status().user || '' });
}

export async function removePassword() {
  const token = sync.token();
  if (!token) throw new Error('Turn on sync first.');
  const found = await findGist('', token);
  if (found) await gh(`/gists/${found.id}`, { token, method: 'DELETE' });
  store.setPref('passwordLogin', { on: false, at: Date.now() });
}

// On a new device: username + password → signed in, synced, keys in place.
export async function signIn(user, password) {
  user = String(user || '').trim().replace(/^@/, '');
  if (!user) throw new Error('Enter your GitHub username.');
  const hit = await findGist(user);
  if (!hit) throw new Error(`No Daybook sign-in found for ${user}. On a device that already syncs, go to Settings → Sync and set a password first.`);
  const gist = await gh(`/gists/${hit.id}`);
  const file = gist?.files?.[FILE];
  let text = file?.content || '';
  if (file?.truncated) text = await (await fetch(file.raw_url, { cache: 'no-store' })).text();
  const { token } = await unseal(password, JSON.parse(text));
  await sync.connect(token);
  return sync.status();
}
