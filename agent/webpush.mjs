// Web Push without a server or any npm package: VAPID (RFC 8292) and payload
// encryption (RFC 8291, aes128gcm), using only node:crypto. The agent calls
// this from GitHub Actions to put a notification on your phone.

import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (str) => Buffer.from(str, 'base64url');

// A new P-256 key pair. `publicKey` (65-byte uncompressed point, base64url) is
// what the browser subscribes with; `privateJwk` stays with the agent.
export function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])),
    privateJwk: privateKey.export({ format: 'jwk' }),
  };
}

// The Authorization header for one push service (its origin is the JWT audience).
export function vapidAuth(endpoint, keys, subject, now = Date.now()) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

// Encrypt `payload` for a subscription's keys ({ p256dh, auth }). Returns the request body.
export function encrypt(payload, subKeys) {
  const uaPublic = unb64u(subKeys.p256dh);
  const authSecret = unb64u(subKeys.auth);
  const salt = crypto.randomBytes(16);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// Send one notification. Resolves to { ok, gone } — `gone` means the device
// unsubscribed (or the app was deleted) and the subscription should be dropped.
export async function sendPush(sub, message, keys, { subject, fetchImpl = fetch, ttl = 6 * 3600 } = {}) {
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuth(sub.endpoint, keys, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'normal',
    },
    body: encrypt(JSON.stringify(message), sub.keys),
  });
  return { ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status };
}
