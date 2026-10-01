// One match room (a Durable Object): holds the series, runs the engine on every move, sends each player only what
// they may see (and spectators what both players may not), and wakes on an alarm for time-outs and forfeits. The
// rules live in room.ts; this stores them and moves messages.
import { DurableObject } from 'cloudflare:workers';
import type { PlayerId } from '../src/engine';
import type { Env } from './env';
import { lobbyOf, MIN_ALARM_MS, PING, PONG, ROOM_TTL_MS } from './env';
import { DEVICE_ID, pubOf } from './lobby';
import type { ClientMsg, Outcome, RoomData, RoomInfo, Sent, ServerMsg } from './room';
import { act, decline, disconnected, emote, gameKey, join, leave, MAX_WATCHERS, newRoom, nextWake, ready, slim, spectatorView, tick, upgrade, viewFor } from './room';

const send = (ws: WebSocket, msg: ServerMsg) => {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* the socket closed meanwhile */
  }
};
/** What each room socket carries: its seat (or the side a spectator follows), compact updates, what it has. */
type RoomTag = { seat?: PlayerId; watch?: boolean; follow?: PlayerId; slim?: boolean; sent?: Sent | null };
const roomTag = (ws: WebSocket): RoomTag => (ws.deserializeAttachment() as RoomTag | null) ?? {};
const seatOf = (ws: WebSocket): PlayerId | undefined => roomTag(ws).seat;


/** One match room. Uses the WebSocket Hibernation API: it sleeps (costing nothing) while both players think. */
export class MatchRoom extends DurableObject<Env> {
  private room: RoomData | null = null;
  /** When the alarm is set for (undefined: not known since waking). */
  private alarmAt: number | null | undefined = undefined;

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

  private watchers(): WebSocket[] {
    return this.ctx.getWebSockets().filter((w) => roomTag(w).watch);
  }

  private async save(): Promise<void> {
    if (!this.room) return;
    // Players who walked out of a stranger's series: tell the lobby (for its cooldown).
    const pens = this.room.penalties;
    if (pens?.length) {
      this.room.penalties = [];
      const lobby = lobbyOf(this.env);
      for (const p of pens) await lobby.penalize(p).catch(() => {});
    }
    await this.ctx.storage.put('room', this.room);
    // The alarm only has to go off in time: it moves only when it must ring sooner. Ringing early is harmless (the
    // alarm sees nothing is due and sets the next one), and it saves a storage write on almost every move.
    // Never sooner than a few seconds ahead, and later still after alarms that found nothing to do (doubling each
    // time, up to about 40 minutes): a mistake in the room's rules can't make the alarm ring nonstop.
    const backoff = MIN_ALARM_MS * 2 ** Math.min(this.room.idleRings ?? 0, 9);
    const wake = Math.max(Date.now() + backoff, Math.min(nextWake(this.room) ?? Infinity, this.room.createdAt + ROOM_TTL_MS));
    if (this.alarmAt === undefined) this.alarmAt = await this.ctx.storage.getAlarm();
    if (this.alarmAt === null || wake < this.alarmAt || this.alarmAt <= Date.now()) {
      await this.ctx.storage.setAlarm(wake);
      this.alarmAt = wake;
    }
  }

  private broadcast(): void {
    if (!this.room) return;
    const key = gameKey(this.room);
    const now = Date.now();
    const watching = this.watchers().length;
    for (const ws of this.ctx.getWebSockets()) {
      const tag = roomTag(ws);
      const view = tag.watch ? spectatorView(this.room, tag.follow ?? 0, now, watching) : tag.seat !== undefined ? viewFor(this.room, tag.seat, now, watching) : null;
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

  /** The players hear how many are watching (without resending the match). */
  private watchingChanged(): void {
    const n = this.watchers().length;
    for (const ws of this.ctx.getWebSockets()) if (seatOf(ws) !== undefined) send(ws, { t: 'watching', n });
  }

  private async apply(ws: WebSocket, out: Outcome): Promise<void> {
    if (out.seat !== undefined) ws.serializeAttachment({ ...roomTag(ws), seat: out.seat, sent: null });
    if (out.reply) send(ws, out.reply);
    if (out.relay) for (const o of this.ctx.getWebSockets()) if (seatOf(o) !== undefined) send(o, out.relay);
    if (out.broadcast) {
      // Something happened: the alarm's backoff starts over.
      if (this.room) this.room.idleRings = 0;
      await this.save();
      this.broadcast();
    }
  }

  /** Called once for a new code (by the Worker, or by the Lobby with the two matched players): false if taken. */
  async init(code: string, queue?: string[], bestOf?: number): Promise<boolean> {
    if (await this.load()) return false;
    this.room = newRoom(code, Date.now(), queue, bestOf);
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

  /** For the admin page. */
  async inspect(): Promise<RoomInfo | null> {
    const r = await this.load();
    if (!r) return null;
    const s = r.series;
    return {
      code: r.code,
      players: r.seats.map((x) => (x ? `${x.player.name}${x.goneAt !== null ? ' (gone)' : ''}` : '(empty)')),
      phase: r.state?.phase ?? null,
      series: `series ${s.n}, game ${s.game}, ${s.wins.join('–')}${s.done ? ', done' : ''}`,
      createdAt: r.createdAt,
      alarmAt: await this.ctx.storage.getAlarm(),
      idleRings: r.idleRings ?? 0,
      sockets: this.ctx.getWebSockets().length,
      watching: this.watchers().length,
    };
  }

  /** The admin page closes a room: everyone is disconnected and the room forgotten. */
  async close(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'Room closed');
    this.room = null;
    this.alarmAt = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
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
    if (msg.t === 'watch') {
      if (!r.state) return send(ws, { t: 'error', message: "The match hasn't started yet." });
      if (!roomTag(ws).watch && this.watchers().length >= MAX_WATCHERS) return send(ws, { t: 'error', message: 'This match has as many watchers as it can take.' });
      const follow = Math.max(0, r.seats.findIndex((s) => !!msg.follow && s?.pub === msg.follow)) as PlayerId;
      ws.serializeAttachment({ watch: true, follow, slim: msg.slim === true, sent: null });
      const view = spectatorView(r, follow, Date.now(), this.watchers().length);
      if (view) {
        send(ws, view);
        if (msg.slim) ws.serializeAttachment({ ...roomTag(ws), sent: slim(view, null, gameKey(r)).sent });
      }
      return this.watchingChanged();
    }
    const tag = roomTag(ws);
    if (msg.t === 'resync' && (tag.seat !== undefined || tag.watch)) {
      const view = tag.watch ? spectatorView(r, tag.follow ?? 0, Date.now(), this.watchers().length) : viewFor(r, tag.seat!, Date.now());
      if (view) send(ws, view);
      if (view && tag.slim) ws.serializeAttachment({ ...tag, sent: slim(view, null, gameKey(r)).sent });
      return;
    }
    const seat = tag.seat;
    if (seat === undefined) return send(ws, { t: 'error', message: tag.watch ? "You're watching this match." : 'Join the room first.' });
    if (msg.t === 'act') return this.apply(ws, act(r, seat, msg.action, Date.now()));
    if (msg.t === 'ready') return this.apply(ws, ready(r, seat, Date.now(), Math.random));
    if (msg.t === 'leave') return this.apply(ws, leave(r, seat, Date.now()));
    if (msg.t === 'emote') return this.apply(ws, emote(r, seat, msg.id, Date.now()));
  }

  private async gone(ws: WebSocket): Promise<void> {
    const tag = roomTag(ws);
    if (tag.watch) {
      ws.serializeAttachment(null);
      return this.watchingChanged();
    }
    const r = await this.load();
    const seat = tag.seat;
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
    if (tick(r, Date.now())) {
      r.idleRings = 0;
      this.broadcast();
    } else r.idleRings = (r.idleRings ?? 0) + 1;
    await this.save();
  }
}
