// Compact text codes for saves and shared replays: JSON, deflated, then base64url with a short tag in front
// ("SPS1." a save, "SPR1." a replay). Codes survive copy-paste through chats and emails. Uses the
// browser's built-in CompressionStream (also in Node 18+), so there is no library.

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeCode(tag: string, value: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  return `${tag}.${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
}

/** Decode a code with this tag. Whitespace (line breaks from a chat app) is ignored. Throws a readable
 * error for anything that isn't one. */
export async function decodeCode<T>(tag: string, code: string, what = 'code for this'): Promise<T> {
  const clean = code.replace(/\s+/g, '');
  const at = clean.indexOf(`${tag}.`);
  if (at < 0) throw new Error(`That isn't a ${what}.`);
  const body = clean.slice(at + tag.length + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new Error('The code is damaged (unexpected characters).');
  try {
    const bytes = await pipe(fromBase64Url(body), new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new Error('The code is incomplete or damaged. Copy all of it and try again.');
  }
}
