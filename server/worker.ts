// The online match server: a Cloudflare Worker that hands out room codes, one Durable Object per room that
// holds the match (matchroom.ts), and one for all the lounges (lounge.ts). This file routes requests, limits
// how often one address may call, answers "is online play up?", and serves the admin page's data.
// The rules live in room.ts and lobby.ts.
import type { Env, Limiter } from './env';
import { isAllowanceError, lobbyOf, newCode } from './env';
import { DEVICE_ID, nextReset, pubOf, seriesLength } from './lobby';

export { MatchRoom } from './matchroom';
export { Lobby } from './lounge';

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', Vary: 'Origin' } : {};
}

/** Whether this address may make one more call of this kind (no limiter configured: yes). */
async function allowed(limiter: Limiter | undefined, req: Request): Promise<boolean> {
  if (!limiter) return true;
  const key = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    return true;
  }
}

/** Constant-time comparison for the admin code. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const headers = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
    const busy = () => json({ error: 'Too many requests from your connection. Wait a minute and try again.' }, 429);
    try {
      // Is online play up? (The game asks when it can't connect, to explain why.)
      if (url.pathname === '/status') {
        if (!(await allowed(env.RL_MISC, req))) return busy();
        await lobbyOf(env).ping();
        return json({ ok: true });
      }
      // The server's public key for notifications (the game subscribes with it).
      if (url.pathname === '/push-key') return json({ key: env.VAPID_PUBLIC ?? null });
      // A new room: a fresh code whose Durable Object starts empty.
      if (url.pathname === '/rooms' && req.method === 'POST') {
        if (!(await allowed(env.RL_ROOMS, req))) return busy();
        const body = (await req.json().catch(() => null)) as { bestOf?: number } | null;
        for (let i = 0; i < 5; i++) {
          const code = newCode();
          if (await env.ROOMS.get(env.ROOMS.idFromName(code)).init(code, undefined, seriesLength(body?.bestOf))) return json({ code });
        }
        return json({ error: 'Could not create a room. Try again.' }, 503);
      }
      // The lounges (presence, chat, challenges, the queue): one object for everyone.
      if (url.pathname === '/queue' && req.headers.get('Upgrade') === 'websocket') {
        if (!(await allowed(env.RL_CONNECT, req))) return new Response('Too many connections', { status: 429 });
        return await lobbyOf(env).fetch(req);
      }
      // Which friends are in online play right now (for the menu).
      if (url.pathname === '/presence' && req.method === 'GET') {
        if (!(await allowed(env.RL_MISC, req))) return busy();
        const res = await lobbyOf(env).fetch(new Request(`https://lobby/presence${url.search}`));
        return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
      }
      // A report about an opponent (from a series' result): kept for the admin page.
      if (url.pathname === '/report' && req.method === 'POST') {
        if (!(await allowed(env.RL_MISC, req))) return busy();
        const b = (await req.json().catch(() => null)) as { device?: string; target?: string; code?: string; reason?: string; name?: string } | null;
        if (!b || typeof b.device !== 'string' || !DEVICE_ID.test(b.device) || typeof b.target !== 'string' || !/^[a-f0-9]{16}$/.test(b.target)) return json({ ok: false }, 400);
        const clip = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '');
        await lobbyOf(env).storeReport({ at: Date.now(), from: await pubOf(b.device), target: b.target, name: clip(b.name, 24), lounge: null, reason: `${clip(b.reason, 40)}${b.code ? ` (room ${clip(b.code, 5)})` : ''}`, message: null });
        return json({ ok: true });
      }
      // The admin page.
      if (url.pathname.startsWith('/admin/')) return await admin(req, env, url, json);
      // Joining (or watching) a room: the WebSocket goes straight to its Durable Object.
      const m = /^\/rooms\/([A-Z]{5})$/.exec(url.pathname);
      if (m && req.headers.get('Upgrade') === 'websocket') {
        if (!(await allowed(env.RL_CONNECT, req))) return new Response('Too many connections', { status: 429 });
        return await env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
      }
      return new Response('Specimen match server', { headers: { ...headers, 'Content-Type': 'text/plain' } });
    } catch (e) {
      // The free plan's daily allowance is used up: say so, and when it comes back (midnight UTC).
      if (isAllowanceError(e)) return json({ error: 'resting', resetAt: nextReset(Date.now()) }, 503);
      console.error(e);
      return json({ error: 'Server error' }, 500);
    }
  },
};

// ---------- Admin ----------

const FREE_DO_REQUESTS = 100_000;
/** A pasted token, without surrounding spaces or quotes, or a "Bearer " copied along with it. */
const cleanToken = (t: string) => t.trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '').trim();

/** Today's usage from Cloudflare's analytics (needs a read-only analytics token): requests, and the busiest objects. */
async function usage(env: Env) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return null;
  const day = new Date().toISOString().slice(0, 10);
  const query = `query($a:String!,$d:Date!){viewer{accounts(filter:{accountTag:$a}){
    total: durableObjectsInvocationsAdaptiveGroups(limit:1,filter:{date_geq:$d}){sum{requests}}
    top: durableObjectsInvocationsAdaptiveGroups(limit:15,filter:{date_geq:$d},orderBy:[sum_requests_DESC]){sum{requests}dimensions{objectId}}
    worker: workersInvocationsAdaptive(limit:5,filter:{date_geq:$d}){sum{requests errors}dimensions{scriptName}}}}}`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { Authorization: `Bearer ${cleanToken(env.CF_API_TOKEN)}`, 'Content-Type': 'application/json', 'User-Agent': 'specimen-match-admin/1.0' }, body: JSON.stringify({ query, variables: { a: env.CF_ACCOUNT_ID, d: day } }) });
  const text = await res.text();
  const body = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })() as { data?: { viewer: { accounts: { total: { sum: { requests: number } }[]; top: { sum: { requests: number }; dimensions: { objectId: string } }[]; worker: { sum: { requests: number; errors: number }; dimensions: { scriptName: string } }[] }[] } }; errors?: { message: string }[] } | null;
  const acc = body?.data?.viewer.accounts[0];
  if (!acc) {
    // Say what's wrong without showing the token: Cloudflare API tokens are 40 letters, digits, - and _.
    const t = cleanToken(env.CF_API_TOKEN);
    const shape = /^[A-Za-z0-9_-]{40}$/.test(t) ? '' : ` The saved CF_API_TOKEN doesn't look like an API token (${t.length} characters; API tokens have 40 letters, digits, - or _).`;
    return { error: `${body?.errors?.[0]?.message ?? `Analytics answered ${res.status}.`}${shape}` };
  }
  const lobbyId = env.LOBBY.idFromName('lobby').toString();
  const w = acc.worker.find((x) => x.dimensions.scriptName === 'specimen-match');
  return {
    day,
    durableRequests: acc.total[0]?.sum.requests ?? 0,
    freeLimit: FREE_DO_REQUESTS,
    resetAt: nextReset(Date.now()),
    workerRequests: w?.sum.requests ?? 0,
    workerErrors: w?.sum.errors ?? 0,
    top: acc.top.map((t) => ({ id: t.dimensions.objectId, requests: t.sum.requests, kind: t.dimensions.objectId === lobbyId ? 'lounges' : 'room' })),
  };
}

async function admin(req: Request, env: Env, url: URL, json: (b: unknown, s?: number) => Response): Promise<Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || !token || !sameSecret(token, env.ADMIN_TOKEN)) return json({ error: 'Not allowed' }, 401);
  const lobby = lobbyOf(env);
  const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
  const path = url.pathname.slice('/admin/'.length);
  if (path === 'overview') {
    // Usage comes from Cloudflare's analytics, so it still shows while the lounges are resting (when it matters most).
    const [lounges, use] = await Promise.all([lobby.adminOverview().catch((e) => (isAllowanceError(e) ? null : Promise.reject(e))), usage(env).catch((e) => ({ error: String(e) }))]);
    return json({ lounges, usage: use, resting: lounges === null ? nextReset(Date.now()) : null });
  }
  if (path === 'ban' && req.method === 'POST') {
    await lobby.adminBan(String(body.target ?? ''), body.scope === 'all' ? 'all' : 'chat', Number(body.hours) || 24, String(body.reason ?? ''));
    return json({ ok: true });
  }
  if (path === 'unban' && req.method === 'POST') {
    await lobby.adminUnban(String(body.target ?? ''));
    return json({ ok: true });
  }
  if (path === 'clear-chat' && req.method === 'POST') {
    await lobby.adminClearChat(Number(body.lounge));
    return json({ ok: true });
  }
  if (path === 'dismiss-report' && req.method === 'POST') {
    await lobby.adminDismissReport(Number(body.at), String(body.from ?? ''));
    return json({ ok: true });
  }
  // A room by its object id (from the usage list): look inside, or close it.
  const room = /^room\/([a-f0-9]{64})(\/close)?$/.exec(path);
  if (room) {
    if (room[1] === env.LOBBY.idFromName('lobby').toString()) return json({ kind: 'lounges' });
    const stub = env.ROOMS.get(env.ROOMS.idFromString(room[1]));
    if (room[2] && req.method === 'POST') {
      await stub.close();
      return json({ ok: true });
    }
    return json({ kind: 'room', info: await stub.inspect() });
  }
  return json({ error: 'Unknown' }, 404);
}
