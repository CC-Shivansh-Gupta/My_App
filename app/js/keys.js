// Your keys travel with sync, so you set them up once, not on every device.
// The AI brain's cloud key, the Whisper/voice key, the Obsidian vault connection and the Home Assistant token are
// bundled, encrypted (AES-GCM, with a key derived from your sync token) and kept as a separate
// file in your secret sync gist. A device that signs in picks them up on its first sync;
// change a key anywhere and the others follow. Device-only choices (on-device model, Ollama,
// wake word, the reply voice) stay put.

export const FILE = 'daybook-keys.json';
const META = 'daybook.keys.meta';

// localStorage key → the fields that travel (null = the whole object).
const SHARED = [
  ['jarvis', 'daybook.jarvis.v1', ['cloud', 'cloudKey', 'cloudModel', 'cloudBase', 'dailyCloud', 'cloudVision']],
  ['voice', 'daybook.voice.v1', ['provider', 'key']],
  ['vault', 'daybook.vault', null],
  ['home', 'daybook.home.v1', ['url', 'token']],
];

function ls() { try { return globalThis.localStorage || null; } catch { return null; } }
const read = (k) => { try { return JSON.parse(ls()?.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { if (v == null) ls()?.removeItem(k); else ls()?.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

// What this device would share. Only fields that are set.
export function bundle() {
  const out = {};
  for (const [name, key, fields] of SHARED) {
    const v = read(key);
    if (!v) continue;
    const pick = fields ? Object.fromEntries(fields.filter((f) => v[f] !== undefined && v[f] !== '').map((f) => [f, v[f]])) : v;
    if (Object.keys(pick).length) out[name] = pick;
  }
  return out;
}

const SECRET = { jarvis: 'cloudKey', voice: 'key', vault: 'token', home: 'token' };
const hasSecrets = (b) => Object.entries(SECRET).some(([s, f]) => b[s]?.[f]);

// A device's first sync with keys on both sides: per section, keep whichever has the secret (this device first).
export function merge(remote, local) {
  const out = {};
  for (const [s, f] of Object.entries(SECRET)) {
    const pick = local[s]?.[f] ? local[s] : remote[s]?.[f] ? remote[s] : local[s] || remote[s];
    if (pick) out[s] = pick;
  }
  return out;
}

// Take another device's keys: its fields replace ours (a key removed there is removed here).
export function apply(b) {
  for (const [name, key, fields] of SHARED) {
    const cur = read(key);
    if (!fields) { write(key, b[name] || null); continue; }
    const next = { ...(cur || {}) };
    for (const f of fields) { if (b[name] && b[name][f] !== undefined) next[f] = b[name][f]; else delete next[f]; }
    write(key, Object.keys(next).length ? next : null);
  }
}

// ---- Crypto (Web Crypto: browsers and Node 20+) ---------------------------------------------------------------
const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
export const b64 = (buf) => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function tokenKey(token) {
  const base = await subtle().importKey('raw', enc.encode(token), 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('daybook-keys-v1'), info: enc.encode('keys') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function fingerprint(token) {
  const h = await subtle().digest('SHA-256', enc.encode(`daybook:${token}`));
  return b64(h).slice(0, 12);
}

export async function sealWith(key, obj) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function openWith(key, { iv, ct }) {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
  return JSON.parse(dec.decode(pt));
}

// ---- Sync ------------------------------------------------------------------------------------------------------
function meta() { return read(META) || {}; }
export function status() { return { ...meta(), local: hasSecrets(bundle()) }; }

// Called by sync with the gist's keys file (text or null). Applies newer keys from other devices
// and returns the file content to upload when this device's keys changed (else null).
export async function sync(remoteText, token) {
  const local = bundle();
  const hash = JSON.stringify(local);
  const m = meta();
  const fp = await fingerprint(token);
  let remote = null;
  if (remoteText) {
    try {
      const env = JSON.parse(remoteText);
      if (env.fp === fp) remote = await openWith(await tokenKey(token), env);
      else write(META, { ...m, error: 'Your keys were saved with a different sync token. Save them again on one device to share them.' });
    } catch { remote = null; }
  }
  if (remote && !m.hash && hasSecrets(local)) {
    // First time here, and both sides have keys: combine them rather than one overwriting the other.
    apply(merge(remote.keys, local));
    const both = bundle();
    const at = Date.now();
    write(META, { hash: JSON.stringify(both), at, pushed: at });
    if (JSON.stringify(both) === JSON.stringify(remote.keys)) return null;
    return JSON.stringify({ app: 'daybook-keys', v: 1, fp, ...(await sealWith(await tokenKey(token), { at, keys: both })) });
  }
  // A change here since the last sync, removals included; on a brand-new device only real keys count.
  const changedHere = m.hash !== undefined ? hash !== m.hash : hasSecrets(local);
  if (remote && !changedHere && JSON.stringify(remote.keys) !== hash) {
    apply(remote.keys);
    write(META, { hash: JSON.stringify(bundle()), at: remote.at, applied: Date.now() });
    return null;
  }
  if (changedHere || (!remoteText && hasSecrets(local))) {
    const at = Date.now();
    const sealed = await sealWith(await tokenKey(token), { at, keys: local });
    write(META, { hash, at, pushed: at });
    return JSON.stringify({ app: 'daybook-keys', v: 1, fp, ...sealed });
  }
  if (remote && m.hash !== hash) write(META, { ...m, hash, error: undefined });
  return null;
}
