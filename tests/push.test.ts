// Web Push (server/push.ts): what the server sends must be readable by the browser it's for (RFC 8291), and the
// VAPID token must verify with the server's public key (RFC 8292). The test plays the browser's side.
import { describe, expect, it } from 'vitest';
import { b64u, encryptPush, unb64u, vapidAuth, validSub } from '../server/push';

const encoder = new TextEncoder();
const enc = { encode: (t: string) => new Uint8Array(encoder.encode(t)) };
type Bytes = Uint8Array<ArrayBuffer>;
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}
const cat = (...p: Bytes[]): Bytes => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of p) (o.set(x, i), (i += x.length));
  return o;
};

/** A browser: its key pair and auth secret, and how it reads a push message. */
async function browser() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const sub = { endpoint: 'https://push.example.com/send/abc', keys: { p256dh: b64u(pub), auth: b64u(auth) } };
  const read = async (body: Bytes) => {
    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
    const idlen = body[20];
    const asPublic = body.slice(21, 21 + idlen);
    const sealed = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey } as never, pair.privateKey, 256));
    const ikm = await hkdf(auth, shared, cat(enc.encode('WebPush: info\0'), pub, asPublic), 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, sealed));
    expect(rs).toBe(4096);
    expect(plain[plain.length - 1]).toBe(2); // the last-record delimiter
    return new TextDecoder().decode(plain.slice(0, -1));
  };
  return { sub, read };
}

describe('Web Push', () => {
  it('the browser it was sent to can read it', async () => {
    const b = await browser();
    const msg = JSON.stringify({ title: 'Ben challenges you', body: 'Best of 3', url: './#lounge', tag: 'challenge' });
    const body = await encryptPush(b.sub, enc.encode(msg));
    expect(await b.read(body)).toBe(msg);
  });

  it('another browser cannot', async () => {
    const a = await browser();
    const other = await browser();
    const body = await encryptPush(a.sub, enc.encode('secret'));
    await expect(other.read(body)).rejects.toBeTruthy();
  });

  it('the VAPID token is signed with the server key, for the push service, with a short expiry', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const pub = b64u(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer));
    const header = await vapidAuth('https://fcm.googleapis.com/fcm/send/xyz', jwk, pub, 'https://castillotech.github.io/Specimen/');
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(pub);
    const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.exp * 1000 - Date.now()).toBeLessThanOrEqual(12 * 3600 * 1000 + 1000);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, unb64u(m[3]), enc.encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });

  it('only real-looking subscriptions are kept', async () => {
    expect(validSub((await browser()).sub)).toBe(true);
    expect(validSub({ endpoint: 'http://insecure', keys: { p256dh: 'a', auth: 'b' } })).toBe(false);
    expect(validSub({ endpoint: 'https://x' })).toBe(false);
    expect(validSub(null)).toBe(false);
  });
});
