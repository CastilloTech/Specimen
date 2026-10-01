// Web Push from the server, with no library: a notification to a player whose game is closed ("Ben challenged
// you", "Ana is online"). The message is encrypted for that browser (RFC 8291, aes128gcm) and signed with the
// server's VAPID key (RFC 8292), then posted to the browser's push service.

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushMessage {
  title: string;
  body: string;
  /** Opened on tap (relative to the game). */
  url: string;
  /** Notifications with the same tag replace each other. */
  tag: string;
}

const encoder = new TextEncoder();
/** Text as bytes (a fresh, plain ArrayBuffer-backed array, as WebCrypto wants). */
const utf8 = (text: string) => new Uint8Array(encoder.encode(text));
export const b64u = (b: Uint8Array<ArrayBuffer>) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};
async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** The encrypted body for one browser subscription (RFC 8291: one aes128gcm record). */
export async function encryptPush(sub: PushSub, payload: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16))): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as never, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

/** The VAPID authorization header for a push service (a short-lived ES256 token). */
export async function vapidAuth(endpoint: string, privateJwk: JsonWebKey, publicKey: string, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const head = b64u(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(utf8(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`;
}

/**
 * Send one notification. Returns the push service's status: 201 sent; 404 / 410 means the subscription is gone
 * (the player turned notifications off or uninstalled), so it should be forgotten.
 */
export async function sendPush(sub: PushSub, msg: PushMessage, vapid: { privateJwk: JsonWebKey; publicKey: string; subject: string }): Promise<number> {
  const body = await encryptPush(sub, utf8(JSON.stringify(msg)));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { TTL: '300', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Topic: msg.tag.slice(0, 32), Authorization: await vapidAuth(sub.endpoint, vapid.privateJwk, vapid.publicKey, vapid.subject) },
    body,
  });
  return res.status;
}

/** Whether a subscription looks like one a browser made (an https push endpoint and both keys). */
export function validSub(x: unknown): x is PushSub {
  const s = x as PushSub;
  return !!s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string' && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;
}
