// The online match server: a Cloudflare Worker that hands out room codes, and one Durable Object per room
// that holds the match, runs the game engine on every move, and sends each player only what they may see.
// The room's rules live in room.ts; this file stores them and moves messages.
import { DurableObject } from 'cloudflare:workers';
import type { PlayerId } from '../src/engine';
import type { ClientMsg, Outcome, RoomData, ServerMsg } from './room';
import { act, disconnected, join, newRoom, nextWake, tick, viewFor } from './room';

interface Env {
  ROOMS: DurableObjectNamespace<MatchRoom>;
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
    if (!this.room) this.room = (await this.ctx.storage.get<RoomData>('room')) ?? null;
    return this.room;
  }

  private async save(): Promise<void> {
    if (!this.room) return;
    await this.ctx.storage.put('room', this.room);
    const wake = Math.min(nextWake(this.room) ?? Infinity, this.room.createdAt + ROOM_TTL_MS);
    await this.ctx.storage.setAlarm(wake);
  }

  private broadcast(): void {
    if (!this.room) return;
    for (const ws of this.ctx.getWebSockets()) {
      const seat = seatOf(ws);
      if (seat === undefined) continue;
      const view = viewFor(this.room, seat);
      if (view) send(ws, view);
    }
  }

  private async apply(ws: WebSocket, out: Outcome): Promise<void> {
    if (out.seat !== undefined) ws.serializeAttachment({ seat: out.seat });
    if (out.reply) send(ws, out.reply);
    if (out.broadcast) {
      await this.save();
      this.broadcast();
    }
  }

  /** Called once by the Worker for a new code: false if the code is already taken. */
  async init(code: string): Promise<boolean> {
    if (await this.load()) return false;
    this.room = newRoom(code, Date.now());
    await this.save();
    return true;
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
    if (msg.t === 'join') return this.apply(ws, join(r, msg, Date.now(), Math.random, () => crypto.randomUUID()));
    if (msg.t === 'act') {
      const seat = seatOf(ws);
      if (seat === undefined) return send(ws, { t: 'error', message: 'Join the room first.' });
      return this.apply(ws, act(r, seat, msg.action, Date.now()));
    }
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
