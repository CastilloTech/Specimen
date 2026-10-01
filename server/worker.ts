// The online match server: a Cloudflare Worker that hands out room codes, one Durable Object per room that
// holds the match, runs the game engine on every move and sends each player only what they may see, and one
// Lobby Durable Object for the matchmaking queue (strangers). The rules live in room.ts and lobby.ts; this
// file stores them and moves messages.
import { DurableObject } from 'cloudflare:workers';
import type { PlayerId } from '../src/engine';
import type { ClientMsg, Outcome, RoomData, ServerMsg } from './room';
import { act, decline, disconnected, emote, gameKey, join, leave, newRoom, nextWake, ready, slim, tick, upgrade, viewFor } from './room';
import type { Sent } from './room';
import type { ChatMsg, LobbyClientMsg, LobbyServerMsg, LoungeTag, Presence, PresenceEntry, Seeker } from './lobby';
import { idleTooLong, CHALLENGE_AGAIN_MS, CHALLENGE_MS, CHAT_HISTORY, chatAllowed, checkProfile, cleanBlocks, compatible, cooldownUntil, DEVICE_ID, LEAVE_WINDOW_MS, LOUNGE_SIZE, loungeCounts, loungeList, mutedUntil, pickLounge, pickPartner, pubOf, RECENT_MS, REPORT_WINDOW_MS, searchSince } from './lobby';
import { cleanChat } from './names';

interface Env {
  ROOMS: DurableObjectNamespace<MatchRoom>;
  LOBBY: DurableObjectNamespace<Lobby>;
  /** Comma-separated origins allowed to create rooms (the game's address, and local dev). */
  ALLOWED_ORIGINS: string;
}

/** Rooms are kept a day, then cleared. */
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
/** An alarm is never set for less than this ahead. */
const MIN_ALARM_MS = 5_000;
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
    // The lounge (presence, chat, challenges, the queue): one for everyone.
    if (url.pathname === '/queue' && req.headers.get('Upgrade') === 'websocket') return env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch(req);
    // Which friends are in online play right now (for the menu).
    if (url.pathname === '/presence' && req.method === 'GET') {
      const res = await env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch(new Request(`https://lobby/presence${url.search}`));
      return new Response(res.body, { status: res.status, headers: { ...headers, 'Content-Type': 'application/json' } });
    }
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

/** The keep-alive ping both clients send, and its answer: Cloudflare replies on its own, without waking the object. */
const PING = JSON.stringify({ t: 'ping' });
const PONG = JSON.stringify({ t: 'pong' });

const send = (ws: WebSocket, msg: ServerMsg) => {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* the socket closed meanwhile */
  }
};
/** What each room socket carries: its seat, whether it takes compact updates, and what it already has. */
type RoomTag = { seat?: PlayerId; slim?: boolean; sent?: Sent | null };
const roomTag = (ws: WebSocket): RoomTag => (ws.deserializeAttachment() as RoomTag | null) ?? {};
const seatOf = (ws: WebSocket): PlayerId | undefined => roomTag(ws).seat;

/** One match room. Uses the WebSocket Hibernation API: it sleeps (costing nothing) while both players think. */
export class MatchRoom extends DurableObject<Env> {
  private room: RoomData | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private async load(): Promise<RoomData | null> {
    if (!this.room) {
      const stored = await this.ctx.storage.get<RoomData>('room');
      this.room = stored ? upgrade(stored) : null;
    }
    return this.room;
  }

  /** When the alarm is set for (undefined: not known since waking). */
  private alarmAt: number | null | undefined = undefined;

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
    // The alarm only has to go off in time: it moves only when it must ring sooner. Ringing early is harmless (the
    // alarm sees nothing is due and sets the next one), and it saves a storage write on almost every move.
    // Never sooner than a few seconds ahead: a time already past would make the alarm ring nonstop (each ring is a
    // billed request), so a mistake in the room's rules can at worst cost one ring every few seconds.
    const wake = Math.max(Date.now() + MIN_ALARM_MS, Math.min(nextWake(this.room) ?? Infinity, this.room.createdAt + ROOM_TTL_MS));
    if (this.alarmAt === undefined) this.alarmAt = await this.ctx.storage.getAlarm();
    if (this.alarmAt === null || wake < this.alarmAt || this.alarmAt <= Date.now()) {
      await this.ctx.storage.setAlarm(wake);
      this.alarmAt = wake;
    }
  }

  private broadcast(): void {
    if (!this.room) return;
    const key = gameKey(this.room);
    for (const ws of this.ctx.getWebSockets()) {
      const tag = roomTag(ws);
      if (tag.seat === undefined) continue;
      const view = viewFor(this.room, tag.seat, Date.now());
      if (!view) continue;
      if (!tag.slim) {
        send(ws, view);
        continue;
      }
      const out = slim(view, tag.sent ?? null, key);
      ws.serializeAttachment({ ...tag, sent: out.sent });
      send(ws, out.msg);
    }
  }

  private async apply(ws: WebSocket, out: Outcome): Promise<void> {
    if (out.seat !== undefined) ws.serializeAttachment({ ...roomTag(ws), seat: out.seat, sent: null });
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
      ws.serializeAttachment({ ...roomTag(ws), slim: msg.slim === true });
      const pub = typeof msg.device === 'string' && DEVICE_ID.test(msg.device) ? await pubOf(msg.device) : undefined;
      return this.apply(ws, join(r, { t: 'join', token: msg.token, player: msg.player }, Date.now(), Math.random, () => crypto.randomUUID(), pub));
    }
    const seat = seatOf(ws);
    if (seat === undefined) return send(ws, { t: 'error', message: 'Join the room first.' });
    if (msg.t === 'resync') {
      ws.serializeAttachment({ ...roomTag(ws), sent: null });
      const view = viewFor(r, seat, Date.now());
      if (view) send(ws, view);
      const tag = roomTag(ws);
      if (view && tag.slim) ws.serializeAttachment({ ...tag, sent: slim(view, null, gameKey(r)).sent });
      return;
    }
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
    this.alarmAt = null;
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

// ---------- The lounges (presence, chat, challenges, the casual queue) ----------

const sendL = (ws: WebSocket, msg: LobbyServerMsg) => {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* the socket closed meanwhile */
  }
};
const tagOf = (ws: WebSocket): LoungeTag | null => (ws.deserializeAttachment() as LoungeTag | null) ?? null;
const entryOf = (t: LoungeTag): PresenceEntry => ({ ...t.profile, id: t.pub, status: t.status });
const PRESENCE: Presence[] = ['lounge', 'searching', 'playing'];
const shortId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

/**
 * All the lounges live in this one object (they're small: LOUNGE_SIZE people each). Who is where (and their
 * search or challenge) lives on the sockets themselves (their attachments), so it survives the object sleeping
 * between messages; storage keeps each lounge's recent chat, recent match times, walk-outs, reports and mutes.
 * Keep-alive pings are answered without waking it, and lounges get only the changes ("here", "gone"), not the
 * whole list each time.
 */
export class Lobby extends DurableObject<Env> {
  private histories = new Map<number, ChatMsg[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Which of these players (public ids) are in online play right now, and in which lounge, for friends lists.
    if (url.pathname === '/presence') {
      const ids = new Set((url.searchParams.get('ids') ?? '').split(',').filter((x) => /^[a-f0-9]{16}$/.test(x)).slice(0, 100));
      const online: Record<string, { status: Presence; lounge: number | null }> = {};
      for (const [, t] of this.tags()) if (ids.has(t.pub) && (!online[t.pub] || t.lounge)) online[t.pub] = { status: t.status, lounge: t.lounge ?? null };
      return Response.json({ online });
    }
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

  private tags(): [WebSocket, LoungeTag][] {
    return this.ctx.getWebSockets().flatMap((w) => {
      const t = tagOf(w);
      return t ? [[w, t] as [WebSocket, LoungeTag]] : [];
    });
  }
  private socketsOf(pub: string): WebSocket[] {
    return this.tags()
      .filter(([, t]) => t.pub === pub)
      .map(([w]) => w);
  }
  private members(lounge: number): [WebSocket, LoungeTag][] {
    return this.tags().filter(([, t]) => t.lounge === lounge);
  }
  /** Who's in a lounge, one entry per player. */
  private entries(lounge: number): PresenceEntry[] {
    const byPub = new Map<string, PresenceEntry>();
    for (const [, t] of this.members(lounge)) byPub.set(t.pub, entryOf(t));
    return [...byPub.values()];
  }
  private toLounge(lounge: number | undefined, msg: LobbyServerMsg, except?: WebSocket) {
    if (!lounge) return;
    for (const [w] of this.members(lounge)) if (w !== except) sendL(w, msg);
  }
  /** Someone in a lounge changed (status, profile): everyone there gets the new entry. */
  private changed(t: LoungeTag) {
    this.toLounge(t.lounge, { t: 'here', entry: entryOf(t) });
  }

  private async chatLog(lounge: number): Promise<ChatMsg[]> {
    let h = this.histories.get(lounge);
    if (!h) {
      h = (await this.ctx.storage.get<ChatMsg[]>(`chat:${lounge}`)) ?? [];
      this.histories.set(lounge, h);
    }
    return h;
  }

  private async cooldown(pub: string, now: number): Promise<number | null> {
    return cooldownUntil((await this.ctx.storage.get<number[]>(`leaves:${pub}`)) ?? [], now);
  }

  private async muted(pub: string, now: number): Promise<number | null> {
    const until = await this.ctx.storage.get<number>(`muted:${pub}`);
    return until && until > now ? until : null;
  }

  /** Matches made in the last hour (adding one now if `add`). */
  private async recent(now: number, add = false): Promise<number> {
    const stored = (await this.ctx.storage.get<number[]>('recent')) ?? [];
    const list = [...stored.filter((t) => now - t < RECENT_MS), ...(add ? [now] : [])];
    if (list.length !== stored.length || add) await this.ctx.storage.put('recent', list);
    return list.length;
  }

  /** The queue's numbers, to everyone (they change only when someone starts or stops searching, or is matched). */
  private async queueCounts(now: number, only?: WebSocket): Promise<void> {
    const searching = new Set(this.tags().filter(([, t]) => t.since).map(([, t]) => t.pub)).size;
    const msg: LobbyServerMsg = { t: 'counts', searching, recent: await this.recent(now) };
    for (const w of only ? [only] : this.ctx.getWebSockets()) sendL(w, msg);
  }

  /** The lounges and how full they are, to everyone (or one newcomer). */
  private sendLounges(only?: WebSocket) {
    const msg: LobbyServerMsg = { t: 'lounges', list: loungeList(loungeCounts(this.tags().map(([, t]) => t))) };
    for (const w of only ? [only] : this.tags().map(([w]) => w)) sendL(w, msg);
  }

  /** Out of a lounge: the others there are told (unless another tab of yours is still in), and an empty lounge forgets its chat. */
  private async leaveLounge(ws: WebSocket, t: LoungeTag): Promise<void> {
    const old = t.lounge;
    if (!old) return;
    const rest = this.members(old).filter(([w]) => w !== ws);
    if (!rest.some(([, o]) => o.pub === t.pub)) this.toLounge(old, { t: 'gone', id: t.pub }, ws);
    if (!rest.length) {
      this.histories.delete(old);
      await this.ctx.storage.delete(`chat:${old}`);
    }
  }

  /** Into a lounge (a given one with room, or a random one). Returns the updated tag, or null if it was full. */
  private async enter(ws: WebSocket, t: LoungeTag, want: unknown): Promise<LoungeTag | null> {
    const counts = loungeCounts(this.tags().filter(([w]) => w !== ws).map(([, x]) => x));
    const id = want === 'random' ? pickLounge(counts, Math.random) : typeof want === 'number' && Number.isInteger(want) && want >= 1 && want <= 9999 ? want : null;
    if (!id) {
      sendL(ws, { t: 'error', message: 'No such lounge.' });
      return null;
    }
    const alreadyMine = this.members(id).some(([w, o]) => w !== ws && o.pub === t.pub);
    if (t.lounge !== id && !alreadyMine && (counts.get(id) ?? 0) >= LOUNGE_SIZE) {
      sendL(ws, { t: 'error', message: `Lounge ${id} is full. Pick another, or a random one.` });
      return null;
    }
    if (t.lounge !== id) await this.leaveLounge(ws, t);
    const next: LoungeTag = { ...t, lounge: id };
    ws.serializeAttachment(next);
    sendL(ws, { t: 'lounge', id, players: this.entries(id), chat: await this.chatLog(id) });
    if (t.lounge !== id && !alreadyMine) this.toLounge(id, { t: 'here', entry: entryOf(next) }, ws);
    this.sendLounges();
    return next;
  }

  /** A room for the two, then both are told where to go. */
  private async match(a: WebSocket, b: WebSocket, now: number, via: 'queue' | 'challenge'): Promise<boolean> {
    const [ta, tb] = [tagOf(a)!, tagOf(b)!];
    // Out of the queue (and marked as playing) before waiting on the room, so nothing else can take either of them.
    const busy = (t: LoungeTag): LoungeTag => ({ pub: t.pub, profile: t.profile, blocked: t.blocked, status: 'playing', ...(t.lounge ? { lounge: t.lounge } : {}), ...(t.noAgain ? { noAgain: t.noAgain } : {}) });
    a.serializeAttachment(busy(ta));
    b.serializeAttachment(busy(tb));
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      if (await this.env.ROOMS.get(this.env.ROOMS.idFromName(code)).init(code, [ta.pub, tb.pub])) {
        sendL(a, { t: 'matched', code, opponent: tb.profile.name, profile: entryOf(tb), via });
        sendL(b, { t: 'matched', code, opponent: ta.profile.name, profile: entryOf(ta), via });
        await this.recent(now, true);
        this.changed(busy(ta));
        this.changed(busy(tb));
        await this.queueCounts(now);
        return true;
      }
    }
    // No room could be made: both go back to what they were doing.
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

    if (msg.t === 'hello') {
      if (typeof msg.device !== 'string' || !DEVICE_ID.test(msg.device)) return sendL(ws, { t: 'error', message: 'Missing device id.' });
      const pub = await pubOf(msg.device);
      // Not in the lounges yet (no online name): only the queue's numbers.
      if (!msg.profile) return this.queueCounts(now, ws);
      const profile = checkProfile(msg.profile);
      if (typeof profile === 'string') return sendL(ws, { t: 'error', message: profile });
      const before = tagOf(ws);
      const status = PRESENCE.includes(msg.status as Presence) && msg.status !== 'searching' ? msg.status! : 'lounge';
      let tag: LoungeTag = { pub, profile, blocked: cleanBlocks(msg.blocked), status, active: now, ...(before?.lounge ? { lounge: before.lounge } : {}), ...(before?.noAgain ? { noAgain: before.noAgain } : {}) };
      ws.serializeAttachment(tag);
      sendL(ws, { t: 'welcome', you: pub, mutedUntil: await this.muted(pub, now) });
      const until = await this.cooldown(pub, now);
      if (until) sendL(ws, { t: 'cooldown', until });
      await this.queueCounts(now, ws);
      if (msg.lounge !== undefined) {
        // Back to the lounge you were in (after a dropped connection), or a random one if it filled up meanwhile.
        const entered = (await this.enter(ws, tag, msg.lounge)) ?? (msg.lounge !== 'random' ? await this.enter(ws, tag, 'random') : null);
        if (entered) tag = entered;
        await this.idleCheckSoon();
      } else this.sendLounges(ws);
      return;
    }

    let tag = tagOf(ws);
    if (tag) {
      tag = { ...tag, active: now };
      ws.serializeAttachment(tag);
    }
    // A version of the game from before the lounges: it sends its device and name with the search.
    if (!tag && msg.t === 'find' && typeof msg.device === 'string' && DEVICE_ID.test(msg.device)) {
      const profile = checkProfile({ name: msg.name, emblem: 'predator', faction: 'predator', worldFaction: 'corrosion', won: 0, lost: 0 });
      if (typeof profile === 'string') return sendL(ws, { t: 'error', message: profile });
      tag = { pub: await pubOf(msg.device), profile, blocked: cleanBlocks(msg.blocked), status: 'lounge' };
    }
    if (!tag) return sendL(ws, { t: 'error', message: 'Not in the lounge yet.' });
    const save = (t: LoungeTag) => {
      ws.serializeAttachment(t);
      tag = t;
    };

    switch (msg.t) {
      case 'join':
        await this.enter(ws, tag, msg.lounge);
        return this.idleCheckSoon();
      case 'active':
        return;
      case 'leaveLounge': {
        await this.leaveLounge(ws, tag);
        const { lounge: _l, ...rest } = tag;
        save(rest);
        return this.sendLounges();
      }
      case 'friends': {
        const ids = new Set((Array.isArray(msg.ids) ? msg.ids : []).filter((x) => typeof x === 'string' && /^[a-f0-9]{16}$/.test(x)).slice(0, 100));
        const online: Record<string, { status: Presence; lounge: number | null }> = {};
        for (const [, t] of this.tags()) if (ids.has(t.pub) && (!online[t.pub] || t.lounge)) online[t.pub] = { status: t.status, lounge: t.lounge ?? null };
        return sendL(ws, { t: 'friends', online });
      }
      case 'profile': {
        const profile = checkProfile(msg.profile);
        if (typeof profile === 'string') return sendL(ws, { t: 'error', message: profile });
        save({ ...tag, profile });
        return this.changed(tag);
      }
      case 'status': {
        if (!PRESENCE.includes(msg.status)) return;
        // In a match: out of the queue. Back in the lounge: still searching if a search is on.
        const { since: _s, ...rest } = tag;
        const wasSearching = !!tag.since;
        save(msg.status === 'playing' ? { ...rest, status: 'playing' } : { ...tag, status: tag.since ? 'searching' : 'lounge' });
        this.changed(tag);
        if (wasSearching && msg.status === 'playing') await this.queueCounts(now);
        return;
      }
      case 'blocked':
        return save({ ...tag, blocked: cleanBlocks(msg.blocked) });

      case 'find': {
        const until = await this.cooldown(tag.pub, now);
        if (until) return sendL(ws, { t: 'cooldown', until });
        if (msg.blocked) tag = { ...tag, blocked: cleanBlocks(msg.blocked) };
        // The same player searching from another tab: that search stops.
        for (const [w, t] of this.tags()) if (w !== ws && t.pub === tag.pub && t.since) w.serializeAttachment({ ...t, since: undefined, status: 'lounge' });
        save({ ...tag, since: searchSince(msg.since, now), status: 'searching' });
        const me: Seeker = { pub: tag.pub, name: tag.profile.name, blocked: tag.blocked, since: tag.since! };
        const others = this.tags().filter(([w, t]) => w !== ws && t.since);
        const partner = pickPartner(
          me,
          others.map(([, t]) => ({ pub: t.pub, name: t.profile.name, blocked: t.blocked, since: t.since! })),
        );
        const pw = partner ? others.find(([, t]) => t.pub === partner.pub)?.[0] : undefined;
        if (!pw || !(await this.match(ws, pw, now, 'queue'))) {
          sendL(ws, { t: 'searching', since: tag.since! });
          this.changed(tag);
          await this.queueCounts(now);
        }
        return;
      }
      case 'cancel': {
        const { since: _s, ...rest } = tag;
        save({ ...rest, status: rest.status === 'searching' ? 'lounge' : rest.status });
        this.changed(tag);
        return this.queueCounts(now);
      }
      case 'decline':
        if (typeof msg.code === 'string' && /^[A-Z]{5}$/.test(msg.code)) await this.env.ROOMS.get(this.env.ROOMS.idFromName(msg.code)).decline(tag.pub).catch(() => {});
        return;

      case 'chat': {
        const lounge = tag.lounge;
        if (!lounge) return sendL(ws, { t: 'error', message: 'Join a lounge to chat.' });
        const muted = await this.muted(tag.pub, now);
        if (muted) return sendL(ws, { t: 'error', message: `You're muted in chat for ${Math.ceil((muted - now) / 60000)} more minutes, after reports from several players.` });
        const times = chatAllowed(tag.chat, now);
        if (!times) return sendL(ws, { t: 'error', message: 'Slow down a little: a few seconds between messages.' });
        const clean = cleanChat(msg.text);
        if (!clean.ok) return sendL(ws, { t: 'error', message: clean.reason });
        save({ ...tag, chat: times });
        const m: ChatMsg = { id: shortId(), from: tag.pub, name: tag.profile.name, emblem: tag.profile.emblem, text: clean.text, at: now };
        const log = (await this.chatLog(lounge)).concat(m).slice(-CHAT_HISTORY);
        this.histories.set(lounge, log);
        await this.ctx.storage.put(`chat:${lounge}`, log);
        return this.toLounge(lounge, { t: 'chat', msg: m });
      }

      case 'challenge': {
        if (tag.challenge && tag.challenge.until > now) return sendL(ws, { t: 'error', message: 'You already have a challenge out.' });
        if (tag.status === 'playing') return sendL(ws, { t: 'error', message: "You're in a match." });
        if ((tag.noAgain?.[msg.to] ?? 0) > now) return sendL(ws, { t: 'error', message: 'They said no a moment ago. Try again in a minute.' });
        const target = this.tags().find(([, t]) => t.pub === msg.to)?.[1];
        if (!target) return sendL(ws, { t: 'error', message: "They're no longer in online play." });
        if (target.status === 'playing') return sendL(ws, { t: 'error', message: `${target.profile.name} is in a match right now.` });
        if (!compatible(tag, target)) return sendL(ws, { t: 'error', message: `${target.profile.name} isn't available.` });
        const c = { id: shortId(), to: msg.to, until: now + CHALLENGE_MS };
        save({ ...tag, challenge: c });
        for (const w of this.socketsOf(msg.to)) sendL(w, { t: 'challenged', id: c.id, from: entryOf(tag), until: c.until });
        return sendL(ws, { t: 'challengeSent', id: c.id, to: msg.to, until: c.until });
      }
      case 'withdraw': {
        const c = tag.challenge;
        if (!c) return;
        const { challenge: _c, ...rest } = tag;
        save(rest);
        for (const w of this.socketsOf(c.to)) sendL(w, { t: 'challengeOver', id: c.id, reason: `${tag.profile.name} withdrew the challenge.` });
        return;
      }
      case 'answer': {
        const from = this.tags().find(([, t]) => t.challenge?.id === msg.id && t.challenge.to === tag!.pub);
        if (!from || from[1].challenge!.until < now) return sendL(ws, { t: 'challengeOver', id: msg.id, reason: 'That challenge is no longer open.' });
        const [cws, ct] = from;
        const { challenge: _c, ...rest } = ct;
        if (!msg.yes) {
          // No: they can't challenge you again straight away (the five most recent "no"s are remembered).
          const noAgain = Object.fromEntries(
            Object.entries({ ...(ct.noAgain ?? {}), [tag.pub]: now + CHALLENGE_AGAIN_MS })
              .filter(([, t]) => t > now)
              .slice(-5),
          );
          cws.serializeAttachment({ ...rest, noAgain });
          for (const w of this.socketsOf(ct.pub)) sendL(w, { t: 'challengeOver', id: msg.id, reason: `${tag.profile.name} said no this time.` });
          return;
        }
        cws.serializeAttachment(rest);
        if (tag.status === 'playing' || ct.status === 'playing') return sendL(ws, { t: 'challengeOver', id: msg.id, reason: 'One of you is already in a match.' });
        if (!(await this.match(cws, ws, now, 'challenge'))) sendL(ws, { t: 'error', message: 'Could not start the match. Try again.' });
        return;
      }

      case 'friend': {
        const to = this.socketsOf(msg.to);
        if (!to.length) return sendL(ws, { t: 'error', message: "They've left online play: add them next time you meet." });
        const target = tagOf(to[0])!;
        if (!compatible(tag, target)) return sendL(ws, { t: 'error', message: `${target.profile.name} isn't available.` });
        for (const w of to) sendL(w, { t: 'friendReq', from: entryOf(tag) });
        return sendL(ws, { t: 'notice', text: `Friend request sent to ${target.profile.name}.` });
      }
      case 'friendAnswer':
        if (msg.yes) for (const w of this.socketsOf(msg.to)) sendL(w, { t: 'friendAccepted', from: entryOf(tag) });
        return;

      case 'report': {
        if (typeof msg.target !== 'string' || !/^[a-f0-9]{16}$/.test(msg.target) || msg.target === tag.pub) return;
        const said = msg.msgId && tag.lounge ? (await this.chatLog(tag.lounge)).find((m) => m.id === msg.msgId && m.from === msg.target) : undefined;
        const name = this.tags().find(([, t]) => t.pub === msg.target)?.[1].profile.name ?? said?.name ?? '';
        console.log(JSON.stringify({ report: true, at: new Date(now).toISOString(), from: tag.pub, target: msg.target, name, lounge: tag.lounge ?? null, reason: String(msg.reason ?? '').slice(0, 40), message: said?.text ?? null }));
        // Reported in chat by several different players: muted for a while.
        if (said) {
          const key = `reports:${msg.target}`;
          const list = ((await this.ctx.storage.get<{ from: string; at: number }[]>(key)) ?? []).filter((r) => now - r.at < REPORT_WINDOW_MS && r.from !== tag!.pub);
          list.push({ from: tag.pub, at: now });
          await this.ctx.storage.put(key, list);
          const until = mutedUntil(list, now);
          if (until && !(await this.muted(msg.target, now))) {
            await this.ctx.storage.put(`muted:${msg.target}`, until);
            for (const w of this.socketsOf(msg.target)) sendL(w, { t: 'notice', text: "You've been muted in the lounge chat for an hour, after reports from several players." });
          }
        }
        return sendL(ws, { t: 'notice', text: 'Report sent. Thank you.' });
      }
    }
  }

  /** While anyone is in a lounge, look for idle players once a minute (an alarm; it costs one wake a minute). */
  private async idleCheckSoon(): Promise<void> {
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 60_000);
  }

  /** The once-a-minute look: players idle too long leave their lounge (and are told why). */
  async alarm(): Promise<void> {
    const now = Date.now();
    let changed = false;
    for (const [w, t] of this.tags()) {
      if (!idleTooLong(t, now)) continue;
      await this.leaveLounge(w, t);
      const { lounge, ...rest } = t;
      w.serializeAttachment(rest);
      sendL(w, { t: 'kicked', lounge: lounge! });
      changed = true;
    }
    if (changed) this.sendLounges();
    if (this.tags().some(([, t]) => t.lounge)) await this.ctx.storage.setAlarm(now + 60_000);
  }

  private async gone(ws: WebSocket): Promise<void> {
    const t = tagOf(ws);
    if (!t) return;
    const lastTab = !this.ctx.getWebSockets().some((w) => w !== ws && tagOf(w)?.pub === t.pub);
    // A challenge out from someone who left is off.
    if (t.challenge && lastTab) for (const w of this.socketsOf(t.challenge.to)) sendL(w, { t: 'challengeOver', id: t.challenge.id, reason: `${t.profile.name} left online play.` });
    await this.leaveLounge(ws, t);
    ws.serializeAttachment(null);
    if (t.lounge) this.sendLounges();
    if (t.since) await this.queueCounts(Date.now());
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.gone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.gone(ws);
  }
}
