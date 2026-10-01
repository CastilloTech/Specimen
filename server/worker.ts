// The online match server: a Cloudflare Worker that hands out room codes, one Durable Object per room that
// holds the match, runs the game engine on every move and sends each player only what they may see, and one
// Lobby Durable Object for the matchmaking queue (strangers). The rules live in room.ts and lobby.ts; this
// file stores them and moves messages.
import { DurableObject } from 'cloudflare:workers';
import type { PlayerId } from '../src/engine';
import type { ClientMsg, Outcome, RoomData, ServerMsg } from './room';
import { act, decline, disconnected, emote, join, leave, newRoom, nextWake, ready, tick, upgrade, viewFor } from './room';
import type { LobbyClientMsg, LobbyServerMsg, Seeker } from './lobby';
import { cleanBlocks, cooldownUntil, DEVICE_ID, LEAVE_WINDOW_MS, pickPartner, pubOf, RECENT_MS, searchSince } from './lobby';
import { checkName } from './names';

interface Env {
  ROOMS: DurableObjectNamespace<MatchRoom>;
  LOBBY: DurableObjectNamespace<Lobby>;
  /** Comma-separated origins allowed to create rooms (the game's address, and local dev). */
  ALLOWED_ORIGINS: string;
}

/** Rooms are kept a day, then cleared. */
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: easy to read out loud
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return ok ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' } : {};
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const headers = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    // A new room: a fresh code whose Durable Object starts empty.
    if (url.pathname === '/rooms' && req.method === 'POST') {
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        if (await stub.init(code)) return Response.json({ code }, { headers });
      }
      return Response.json({ error: 'Could not create a room. Try again.' }, { status: 503, headers });
    }
    // The matchmaking queue: one lobby for everyone.
    if (url.pathname === '/queue' && req.headers.get('Upgrade') === 'websocket') return env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch(req);
    // A report about a stranger: written to the server's logs (Workers observability) for review.
    if (url.pathname === '/report' && req.method === 'POST') {
      const b = (await req.json().catch(() => null)) as { device?: string; target?: string; code?: string; reason?: string; name?: string } | null;
      if (!b || typeof b.device !== 'string' || !DEVICE_ID.test(b.device) || typeof b.target !== 'string' || !/^[a-f0-9]{16}$/.test(b.target)) return Response.json({ ok: false }, { status: 400, headers });
      const clip = (x: unknown, n: number) => (typeof x === 'string' ? x.slice(0, n) : '');
      console.log(JSON.stringify({ report: true, at: new Date().toISOString(), from: await pubOf(b.device), target: b.target, name: clip(b.name, 24), room: clip(b.code, 5), reason: clip(b.reason, 40) }));
      return Response.json({ ok: true }, { headers });
    }
    // Joining a room: the WebSocket goes straight to its Durable Object.
    const m = /^\/rooms\/([A-Z]{5})$/.exec(url.pathname);
    if (m && req.headers.get('Upgrade') === 'websocket') return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    return new Response('Specimen match server', { headers: { ...headers, 'Content-Type': 'text/plain' } });
  },
};

const send = (ws: WebSocket, msg: ServerMsg) => {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* the socket closed meanwhile */
  }
};
const seatOf = (ws: WebSocket): PlayerId | undefined => (ws.deserializeAttachment() as { seat?: PlayerId } | null)?.seat;

/** One match room. Uses the WebSocket Hibernation API: it sleeps (costing nothing) while both players think. */
export class MatchRoom extends DurableObject<Env> {
  private room: RoomData | null = null;

  private async load(): Promise<RoomData | null> {
    if (!this.room) {
      const stored = await this.ctx.storage.get<RoomData>('room');
      this.room = stored ? upgrade(stored) : null;
    }
    return this.room;
  }

  private async save(): Promise<void> {
    if (!this.room) return;
    // Players who walked out of a stranger's series: tell the lobby (for its cooldown).
    const pens = this.room.penalties;
    if (pens?.length) {
      this.room.penalties = [];
      const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
      for (const p of pens) await lobby.penalize(p).catch(() => {});
    }
    await this.ctx.storage.put('room', this.room);
    const wake = Math.min(nextWake(this.room) ?? Infinity, this.room.createdAt + ROOM_TTL_MS);
    await this.ctx.storage.setAlarm(wake);
  }

  private broadcast(): void {
    if (!this.room) return;
    for (const ws of this.ctx.getWebSockets()) {
      const seat = seatOf(ws);
      if (seat === undefined) continue;
      const view = viewFor(this.room, seat, Date.now());
      if (view) send(ws, view);
    }
  }

  private async apply(ws: WebSocket, out: Outcome): Promise<void> {
    if (out.seat !== undefined) ws.serializeAttachment({ seat: out.seat });
    if (out.reply) send(ws, out.reply);
    if (out.relay) for (const o of this.ctx.getWebSockets()) if (seatOf(o) !== undefined) send(o, out.relay);
    if (out.broadcast) {
      await this.save();
      this.broadcast();
    }
  }

  /** Called once for a new code (by the Worker, or by the Lobby with the two matched players): false if taken. */
  async init(code: string, queue?: string[]): Promise<boolean> {
    if (await this.load()) return false;
    this.room = newRoom(code, Date.now(), queue);
    await this.save();
    return true;
  }

  /** The lobby passes on a matched player's "Not now". */
  async decline(pub: string): Promise<void> {
    const r = await this.load();
    if (!r || !decline(r, pub)) return;
    await this.save();
    this.broadcast();
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    if (!(await this.load())) return new Response('No such room', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const r = await this.load();
    if (!r) return send(ws, { t: 'error', message: 'This room no longer exists.' });
    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as ClientMsg;
    } catch {
      return send(ws, { t: 'error', message: 'Unreadable message.' });
    }
    if (msg.t === 'ping') return send(ws, { t: 'pong' });
    if (msg.t === 'join') {
      const pub = typeof msg.device === 'string' && DEVICE_ID.test(msg.device) ? await pubOf(msg.device) : undefined;
      return this.apply(ws, join(r, { t: 'join', token: msg.token, player: msg.player }, Date.now(), Math.random, () => crypto.randomUUID(), pub));
    }
    const seat = seatOf(ws);
    if (seat === undefined) return send(ws, { t: 'error', message: 'Join the room first.' });
    if (msg.t === 'act') return this.apply(ws, act(r, seat, msg.action, Date.now()));
    if (msg.t === 'ready') return this.apply(ws, ready(r, seat, Date.now(), Math.random));
    if (msg.t === 'leave') return this.apply(ws, leave(r, seat, Date.now()));
    if (msg.t === 'emote') return this.apply(ws, emote(r, seat, msg.id, Date.now()));
  }

  private async gone(ws: WebSocket): Promise<void> {
    const r = await this.load();
    const seat = seatOf(ws);
    if (!r || seat === undefined) return;
    // A player with another tab still open hasn't left.
    if (this.ctx.getWebSockets().some((o) => o !== ws && seatOf(o) === seat)) return;
    disconnected(r, seat, Date.now());
    await this.save();
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.gone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.gone(ws);
  }

  /** Time-outs, forfeits, and clearing the room after a day. */
  async alarm(): Promise<void> {
    const r = await this.load();
    if (!r) return;
    if (Date.now() >= r.createdAt + ROOM_TTL_MS) {
      for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'Room expired');
      this.room = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    if (tick(r, Date.now())) this.broadcast();
    await this.save();
  }
}

// ---------- The matchmaking queue ----------

const sendL = (ws: WebSocket, msg: LobbyServerMsg) => {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* the socket closed meanwhile */
  }
};
/** What each lobby socket carries: who it is, and their search while they're in the queue. */
type LobbyTag = { pub?: string; seek?: Seeker };
const tagOf = (ws: WebSocket): LobbyTag => (ws.deserializeAttachment() as LobbyTag | null) ?? {};

/**
 * The one lobby everyone searching connects to. The queue lives on the sockets themselves (their attachments),
 * so it survives the lobby sleeping between messages; storage keeps only recent match times and walk-outs.
 */
export class Lobby extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** A room reports a player who walked out of a stranger's series. */
  async penalize(pub: string): Promise<void> {
    const now = Date.now();
    const key = `leaves:${pub}`;
    const list = ((await this.ctx.storage.get<number[]>(key)) ?? []).filter((t) => now - t < LEAVE_WINDOW_MS);
    await this.ctx.storage.put(key, [...list, now]);
  }

  private async cooldown(pub: string, now: number): Promise<number | null> {
    return cooldownUntil((await this.ctx.storage.get<number[]>(`leaves:${pub}`)) ?? [], now);
  }

  /** Matches made in the last hour (adding one now if `add`). */
  private async recent(now: number, add = false): Promise<number> {
    const stored = (await this.ctx.storage.get<number[]>('recent')) ?? [];
    const list = [...stored.filter((t) => now - t < RECENT_MS), ...(add ? [now] : [])];
    if (list.length !== stored.length || add) await this.ctx.storage.put('recent', list);
    return list.length;
  }

  private async counts(now: number): Promise<void> {
    const searching = this.ctx.getWebSockets().filter((w) => tagOf(w).seek).length;
    const msg: LobbyServerMsg = { t: 'counts', searching, recent: await this.recent(now) };
    for (const w of this.ctx.getWebSockets()) sendL(w, msg);
  }

  /** A room for the two, then both are told where to go. */
  private async match(a: WebSocket, b: WebSocket, now: number): Promise<boolean> {
    const [ta, tb] = [tagOf(a), tagOf(b)];
    // Out of the queue before waiting on the room, so no other search can take either of them meanwhile.
    a.serializeAttachment({ pub: ta.pub });
    b.serializeAttachment({ pub: tb.pub });
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      if (await this.env.ROOMS.get(this.env.ROOMS.idFromName(code)).init(code, [ta.pub!, tb.pub!])) {
        sendL(a, { t: 'matched', code, opponent: tb.seek!.name });
        sendL(b, { t: 'matched', code, opponent: ta.seek!.name });
        await this.recent(now, true);
        return true;
      }
    }
    // No room could be made: both go back to waiting.
    a.serializeAttachment(ta);
    b.serializeAttachment(tb);
    return false;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: LobbyClientMsg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as LobbyClientMsg;
    } catch {
      return sendL(ws, { t: 'error', message: 'Unreadable message.' });
    }
    const now = Date.now();
    if (msg.t === 'ping') return sendL(ws, { t: 'pong' });
    if (msg.t === 'cancel') {
      ws.serializeAttachment({ pub: tagOf(ws).pub });
      return this.counts(now);
    }
    if (msg.t === 'decline') {
      const pub = tagOf(ws).pub;
      if (pub && typeof msg.code === 'string' && /^[A-Z]{5}$/.test(msg.code)) await this.env.ROOMS.get(this.env.ROOMS.idFromName(msg.code)).decline(pub).catch(() => {});
      return;
    }
    if (msg.t !== 'hello' && msg.t !== 'find') return;
    if (typeof msg.device !== 'string' || !DEVICE_ID.test(msg.device)) return sendL(ws, { t: 'error', message: 'Missing device id.' });
    const pub = await pubOf(msg.device);
    const until = await this.cooldown(pub, now);
    if (msg.t === 'hello') {
      ws.serializeAttachment({ pub, seek: tagOf(ws).seek });
      if (until) sendL(ws, { t: 'cooldown', until });
      return this.counts(now);
    }
    if (until) return sendL(ws, { t: 'cooldown', until });
    const name = checkName(msg.name);
    if (!name.ok) return sendL(ws, { t: 'error', message: name.reason });
    // The same player searching from another tab: that search stops.
    for (const w of this.ctx.getWebSockets()) if (w !== ws && tagOf(w).pub === pub && tagOf(w).seek) w.serializeAttachment({ pub });
    const seek: Seeker = { pub, name: name.name, blocked: cleanBlocks(msg.blocked), since: searchSince(msg.since, now) };
    ws.serializeAttachment({ pub, seek });
    const others = this.ctx.getWebSockets().filter((w) => w !== ws && tagOf(w).seek);
    const partner = pickPartner(
      seek,
      others.map((w) => tagOf(w).seek!),
    );
    const pw = partner ? others.find((w) => tagOf(w).seek?.pub === partner.pub) : undefined;
    if (!pw || !(await this.match(ws, pw, now))) sendL(ws, { t: 'searching', since: seek.since });
    await this.counts(now);
  }

  async webSocketClose(): Promise<void> {
    await this.counts(Date.now());
  }

  async webSocketError(): Promise<void> {
    await this.counts(Date.now());
  }
}
