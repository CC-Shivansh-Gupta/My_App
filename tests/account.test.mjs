import test from 'node:test';
import assert from 'node:assert/strict';

// A tiny localStorage for Node.
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), clear: () => mem.clear() };

const keys = await import('../app/js/keys.js');
const login = await import('../app/js/login.js');

const TOKEN = 'ghp_exampleexampleexampleexample1234';
const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const get = (k) => JSON.parse(localStorage.getItem(k) || 'null');

test('keys travel between devices through the sync file, encrypted', async () => {
  // Laptop: has a Groq key, a Whisper key and a vault.
  mem.clear();
  set('daybook.jarvis.v1', { engine: 'local', localModel: 'Qwen3-4B', cloud: 'groq', cloudKey: 'gsk_brain', dailyCloud: 150 });
  set('daybook.voice.v1', { engine: 'local', provider: 'groq', key: 'gsk_voice', reply: 'local:bm_george' });
  set('daybook.vault', { repo: 'me/second-brain', token: 'github_pat_vault', branch: 'main' });
  const file = await keys.sync(null, TOKEN);
  assert.ok(file);
  assert.ok(!file.includes('gsk_brain') && !file.includes('github_pat_vault')); // encrypted
  assert.equal(await keys.sync(file, TOKEN), null); // nothing new to push

  // Phone: fresh, signs in with the same token.
  mem.clear();
  set('daybook.jarvis.v1', { engine: 'auto', cloud: 'groq', dailyCloud: 150 });
  assert.equal(await keys.sync(file, TOKEN), null);
  assert.equal(get('daybook.jarvis.v1').cloudKey, 'gsk_brain');
  assert.equal(get('daybook.jarvis.v1').engine, 'auto'); // device choices stay put
  assert.equal(get('daybook.voice.v1').key, 'gsk_voice');
  assert.equal(get('daybook.voice.v1').reply, undefined);
  assert.equal(get('daybook.vault').token, 'github_pat_vault');

  // A different token can't read them.
  mem.clear();
  assert.equal(await keys.sync(file, 'ghp_someoneelse'), null);
  assert.equal(get('daybook.vault'), null);
});

test('a key changed on one device reaches the others; a removal does too', async () => {
  mem.clear();
  set('daybook.jarvis.v1', { cloud: 'groq', cloudKey: 'gsk_old' });
  set('daybook.vault', { repo: 'me/vault', token: 't1' });
  let file = await keys.sync(null, TOKEN);
  const laptop = new Map(mem);

  mem.clear();
  await keys.sync(file, TOKEN); // phone picks them up
  set('daybook.jarvis.v1', { ...get('daybook.jarvis.v1'), cloudKey: 'gsk_new' });
  localStorage.removeItem('daybook.vault'); // disconnected the vault
  file = await keys.sync(file, TOKEN);
  assert.ok(file);

  mem.clear(); for (const [k, v] of laptop) mem.set(k, v);
  assert.equal(await keys.sync(file, TOKEN), null);
  assert.equal(get('daybook.jarvis.v1').cloudKey, 'gsk_new');
  assert.equal(get('daybook.vault'), null);
});

test('first sync with keys on both sides combines them', async () => {
  mem.clear();
  set('daybook.vault', { repo: 'me/vault', token: 'tv' });
  const file = await keys.sync(null, TOKEN);
  mem.clear();
  set('daybook.jarvis.v1', { cloud: 'groq', cloudKey: 'gsk_phone' });
  const up = await keys.sync(file, TOKEN);
  assert.ok(up);
  assert.equal(get('daybook.vault').token, 'tv');
  assert.equal(get('daybook.jarvis.v1').cloudKey, 'gsk_phone');
});

test('password sign-in: the token is sealed with the password', async () => {
  const blob = await login.seal('mangoes taste best in may', { token: TOKEN, user: 'me' });
  assert.ok(!JSON.stringify(blob).includes(TOKEN));
  assert.equal(blob.iterations, 600000);
  assert.deepEqual(await login.unseal('mangoes taste best in may', blob), { token: TOKEN, user: 'me' });
  await assert.rejects(login.unseal('mangoes taste best in june', blob), /Wrong password/);
  assert.match(login.checkPassword('short'), /12 characters/);
  assert.equal(login.checkPassword('mangoes taste best in may'), '');
});
