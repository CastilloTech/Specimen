// The lounges (one Durable Object for all of them): presence, chat, challenges, the casual queue, friends'
// whereabouts, notifications while the game is closed, and the admin page's moderation. The rules live in
// lobby.ts; this stores them and moves messages.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { newCode, PING, PONG } from './env';
import type { Ban, ChatMsg, FriendStatus, LobbyClientMsg, LobbyServerMsg, LoungeOverview, LoungeTag, Presence, PresenceEntry, PushEvents, Seeker, StoredReport } from './lobby';
import {
  banned,
  CHALLENGE_AGAIN_MS,
  CHALLENGE_MS,
  CHAT_HISTORY,
  chatAllowed,
  checkProfile,
  cleanBlocks,
  compatible,
  cooldownUntil,
  DEVICE_ID,
  FRIEND_PUSH_GAP_MS,
  idleTooLong,
  INVITE_MS,
  LEAVE_WINDOW_MS,
  LOUNGE_SIZE,
  loungeCounts,
  loungeList,
  mutedUntil,
  pickLounge,
  pickPartner,
  pubOf,
  RECENT_MS,
  REPORT_WINDOW_MS,
  searchSince,
  seriesLength,
} from './lobby';
import { cleanChat } from './names';
import type { PushMessage, PushSub } from './push';
import { sendPush, validSub } from './push';

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
const PUB = /^[a-f0-9]{16}$/;
const today = (now: number) => new Date(now).toISOString().slice(0, 10);
const MAX_REPORTS = 200;
const series = (n: number) => (n === 1 ? 'a best of 1' : 'a best of 3');

/** A player's notification settings, kept per public id. */
interface PushPrefs {
  sub: PushSub;
  watch: string[];
  events: PushEvents;
  /** When each friend's "online" was last sent. */
  last?: Record<string, number>;
}
/** An invite to a friend who wasn't online (sent as a notification), delivered when they come in. */
interface Invite {
  id: string;
  from: PresenceEntry;
  fromPub: string;
  until: number;
  bestOf: number;
}


/**
 * All the lounges live in this one object (they're small: LOUNGE_SIZE people each). Who is where (and their
 * search or challenge) lives on the sockets themselves (their attachments), so it survives the object sleeping
 * between messages; storage keeps each lounge's recent chat, match counts, walk-outs, reports, mutes, bans and
 * notification settings. Keep-alive pings are answered without waking it, and lounges get only the changes.
 */
export class Lobby extends DurableObject<Env> {
  private histories = new Map<number, ChatMsg[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Which of these players (public ids) are in online play right now, for the menu's "N friends on".
    if (url.pathname === '/presence') {
      const ids = new Set((url.searchParams.get('ids') ?? '').split(',').filter((x) => PUB.test(x)).slice(0, 100));
      return Response.json({ online: this.whereabouts(ids) });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The server's status check: answering at all means the lounge is up. */
  async ping(): Promise<boolean> {
    return true;
  }

  /** A room reports a player who walked out of a stranger's series. */
  async penalize(pub: string): Promise<void> {
    const now = Date.now();
    const key = `leaves:${pub}`;
    const list = ((await this.ctx.storage.get<number[]>(key)) ?? []).filter((t) => now - t < LEAVE_WINDOW_MS);
    await this.ctx.storage.put(key, [...list, now]);
  }

  // ---------- Who's where ----------

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
  /** Where these players are (for friends): status, lounge, and the room they play in (to watch). */
  private whereabouts(ids: Set<string>): Record<string, FriendStatus> {
    const out: Record<string, FriendStatus> = {};
    for (const [, t] of this.tags()) if (ids.has(t.pub) && (!out[t.pub] || t.lounge || t.room)) out[t.pub] = { status: t.status, lounge: t.lounge ?? null, room: t.status === 'playing' ? (t.room ?? null) : null };
    return out;
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
  private async banOf(pub: string): Promise<Ban | null> {
    return (await this.ctx.storage.get<Ban>(`ban:${pub}`)) ?? null;
  }
  private banText(b: Ban): string {
    const when = new Date(b.until).toUTCString().replace(/:\d\d GMT$/, ' UTC');
    return b.scope === 'all' ? `You're suspended from playing with strangers until ${when}. Friend rooms by code still work.` : `You're suspended from the lounge chat until ${when}.`;
  }

  /** Matches made in the last hour (adding one now if `add`, which also counts it for today). */
  private async recent(now: number, add = false): Promise<number> {
    const stored = (await this.ctx.storage.get<number[]>('recent')) ?? [];
    const list = [...stored.filter((t) => now - t < RECENT_MS), ...(add ? [now] : [])];
    if (list.length !== stored.length || add) await this.ctx.storage.put('recent', list);
    if (add) {
      const key = `matches:${today(now)}`;
      await this.ctx.storage.put(key, ((await this.ctx.storage.get<number>(key)) ?? 0) + 1);
    }
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
  private async match(a: WebSocket, b: WebSocket, now: number, via: 'queue' | 'challenge', bestOf: number): Promise<boolean> {
    const [ta, tb] = [tagOf(a)!, tagOf(b)!];
    // Out of the queue (and marked as playing) before waiting on the room, so nothing else can take either of them.
    const busy = (t: LoungeTag, room?: string): LoungeTag => ({ pub: t.pub, profile: t.profile, blocked: t.blocked, status: 'playing', active: now, ...(t.lounge ? { lounge: t.lounge } : {}), ...(t.noAgain ? { noAgain: t.noAgain } : {}), ...(room ? { room } : {}) });
    a.serializeAttachment(busy(ta));
    b.serializeAttachment(busy(tb));
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      if (await this.env.ROOMS.get(this.env.ROOMS.idFromName(code)).init(code, [ta.pub, tb.pub], bestOf)) {
        a.serializeAttachment(busy(ta, code));
        b.serializeAttachment(busy(tb, code));
        sendL(a, { t: 'matched', code, opponent: tb.profile.name, profile: entryOf(tb), via, bestOf });
        sendL(b, { t: 'matched', code, opponent: ta.profile.name, profile: entryOf(ta), via, bestOf });
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

  // ---------- Notifications while the game is closed ----------

  private vapid() {
    const { VAPID_PRIVATE, VAPID_PUBLIC } = this.env;
    if (!VAPID_PRIVATE || !VAPID_PUBLIC) return null;
    try {
      return { privateJwk: JSON.parse(VAPID_PRIVATE) as JsonWebKey, publicKey: VAPID_PUBLIC, subject: this.env.PUSH_SUBJECT ?? 'https://castillotech.github.io/Specimen/' };
    } catch {
      return null;
    }
  }

  /** Send one notification to a player; a subscription the browser dropped is forgotten. */
  private async notify(pub: string, prefs: PushPrefs, msg: PushMessage): Promise<boolean> {
    const vapid = this.vapid();
    if (!vapid) return false;
    try {
      const status = await sendPush(prefs.sub, msg, vapid);
      if (status === 404 || status === 410) await this.dropPush(pub, prefs);
      return status >= 200 && status < 300;
    } catch {
      return false;
    }
  }

  private async dropPush(pub: string, prefs: PushPrefs | null): Promise<void> {
    await this.ctx.storage.delete(`push:${pub}`);
    for (const f of prefs?.watch ?? []) {
      const key = `watchers:${f}`;
      const list = ((await this.ctx.storage.get<string[]>(key)) ?? []).filter((x) => x !== pub);
      await (list.length ? this.ctx.storage.put(key, list) : this.ctx.storage.delete(key));
    }
  }

  /** A player came into online play: friends who asked to know (and aren't here themselves) get a notification. */
  private async friendOnline(t: LoungeTag, now: number): Promise<void> {
    const watchers = (await this.ctx.storage.get<string[]>(`watchers:${t.pub}`)) ?? [];
    for (const w of watchers) {
      if (this.socketsOf(w).length) continue;
      const prefs = await this.ctx.storage.get<PushPrefs>(`push:${w}`);
      if (!prefs?.events.friends || !prefs.watch.includes(t.pub) || now - (prefs.last?.[t.pub] ?? 0) < FRIEND_PUSH_GAP_MS) continue;
      const last = Object.fromEntries(Object.entries({ ...(prefs.last ?? {}), [t.pub]: now }).slice(-50));
      await this.ctx.storage.put(`push:${w}`, { ...prefs, last });
      await this.notify(w, prefs, { title: `★ ${t.profile.name} is online`, body: 'Your friend is in the lounges. Come and play a best of 3.', url: './#lounge', tag: `friend-${t.pub}` });
    }
  }

  // ---------- Messages ----------

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
      const ban = await this.banOf(pub);
      if (banned(ban, 'play', now)) {
        sendL(ws, { t: 'error', message: this.banText(ban!) });
        return this.queueCounts(now, ws);
      }
      const profile = checkProfile(msg.profile);
      if (typeof profile === 'string') return sendL(ws, { t: 'error', message: profile });
      const before = tagOf(ws);
      const firstTab = !this.tags().some(([w, t]) => w !== ws && t.pub === pub);
      const status = PRESENCE.includes(msg.status as Presence) && msg.status !== 'searching' ? msg.status! : 'lounge';
      let tag: LoungeTag = { pub, profile, blocked: cleanBlocks(msg.blocked), status, active: now, ...(before?.lounge ? { lounge: before.lounge } : {}), ...(before?.noAgain ? { noAgain: before.noAgain } : {}) };
      ws.serializeAttachment(tag);
      sendL(ws, { t: 'welcome', you: pub, mutedUntil: banned(ban, 'chat', now) ? ban!.until : await this.muted(pub, now) });
      const until = await this.cooldown(pub, now);
      if (until) sendL(ws, { t: 'cooldown', until });
      await this.queueCounts(now, ws);
      if (msg.lounge !== undefined) {
        // Back to the lounge you were in (after a dropped connection), or a random one if it filled up meanwhile.
        const entered = (await this.enter(ws, tag, msg.lounge)) ?? (msg.lounge !== 'random' ? await this.enter(ws, tag, 'random') : null);
        if (entered) tag = entered;
        await this.idleCheckSoon();
      } else this.sendLounges(ws);
      // A friend's invite that came while the game was closed.
      const inv = await this.ctx.storage.get<Invite>(`invite:${pub}`);
      if (inv && inv.until > now && this.tags().some(([, t]) => t.pub === inv.fromPub && t.challenge?.id === inv.id)) sendL(ws, { t: 'challenged', id: inv.id, from: inv.from, until: inv.until, bestOf: inv.bestOf });
      if (firstTab && !before) await this.friendOnline(tag, now);
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
        const ids = new Set((Array.isArray(msg.ids) ? msg.ids : []).filter((x) => typeof x === 'string' && PUB.test(x)).slice(0, 100));
        return sendL(ws, { t: 'friends', online: this.whereabouts(ids) });
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
        const { since: _s, room: _r, ...rest } = tag;
        const wasSearching = !!tag.since;
        if (msg.status === 'playing') save({ ...rest, status: 'playing', ...(tag.room ? { room: tag.room } : {}) });
        else {
          const { room: _room, ...noRoom } = tag;
          save({ ...noRoom, status: tag.since ? 'searching' : 'lounge' });
        }
        this.changed(tag);
        if (wasSearching && msg.status === 'playing') await this.queueCounts(now);
        return;
      }
      case 'blocked':
        return save({ ...tag, blocked: cleanBlocks(msg.blocked) });

      case 'push': {
        const old = await this.ctx.storage.get<PushPrefs>(`push:${tag.pub}`);
        if (!msg.sub || !validSub(msg.sub)) return this.dropPush(tag.pub, old ?? null);
        const watch = (Array.isArray(msg.watch) ? msg.watch : []).filter((x) => typeof x === 'string' && PUB.test(x)).slice(0, 100);
        const events: PushEvents = { friends: msg.events?.friends !== false, challenges: msg.events?.challenges !== false };
        await this.ctx.storage.put(`push:${tag.pub}`, { sub: msg.sub, watch, events, last: old?.last ?? {} } satisfies PushPrefs);
        // Keep the "who wants to know when X comes online" index in step.
        for (const f of new Set([...(old?.watch ?? []), ...watch])) {
          const key = `watchers:${f}`;
          const list = ((await this.ctx.storage.get<string[]>(key)) ?? []).filter((x) => x !== tag!.pub);
          if (watch.includes(f)) list.push(tag.pub);
          await (list.length ? this.ctx.storage.put(key, list.slice(-200)) : this.ctx.storage.delete(key));
        }
        return;
      }

      case 'find': {
        const ban = await this.banOf(tag.pub);
        if (banned(ban, 'play', now)) return sendL(ws, { t: 'error', message: this.banText(ban!) });
        const until = await this.cooldown(tag.pub, now);
        if (until) return sendL(ws, { t: 'cooldown', until });
        if (msg.blocked) tag = { ...tag, blocked: cleanBlocks(msg.blocked) };
        // The same player searching from another tab: that search stops.
        for (const [w, t] of this.tags()) if (w !== ws && t.pub === tag.pub && t.since) w.serializeAttachment({ ...t, since: undefined, status: 'lounge' });
        const bestOf = seriesLength(msg.bestOf);
        save({ ...tag, since: searchSince(msg.since, now), bestOf, status: 'searching' });
        const me: Seeker = { pub: tag.pub, name: tag.profile.name, blocked: tag.blocked, since: tag.since!, bestOf };
        const others = this.tags().filter(([w, t]) => w !== ws && t.since);
        const partner = pickPartner(
          me,
          others.map(([, t]) => ({ pub: t.pub, name: t.profile.name, blocked: t.blocked, since: t.since!, bestOf: t.bestOf })),
        );
        const pw = partner ? others.find(([, t]) => t.pub === partner.pub)?.[0] : undefined;
        if (!pw || !(await this.match(ws, pw, now, 'queue', bestOf))) {
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
        const ban = await this.banOf(tag.pub);
        if (banned(ban, 'chat', now)) return sendL(ws, { t: 'error', message: this.banText(ban!) });
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
        const ban = await this.banOf(tag.pub);
        if (banned(ban, 'play', now)) return sendL(ws, { t: 'error', message: this.banText(ban!) });
        if (tag.challenge && tag.challenge.until > now) return sendL(ws, { t: 'error', message: 'You already have a challenge out.' });
        if (tag.status === 'playing') return sendL(ws, { t: 'error', message: "You're in a match." });
        if (typeof msg.to !== 'string' || !PUB.test(msg.to)) return;
        if ((tag.noAgain?.[msg.to] ?? 0) > now) return sendL(ws, { t: 'error', message: 'They said no a moment ago. Try again in a minute.' });
        const bestOf = seriesLength(msg.bestOf);
        const target = this.tags().find(([, t]) => t.pub === msg.to)?.[1];
        if (!target) {
          // Not online: a friend who turned notifications on for challenges (and has you as a friend) gets one.
          const prefs = await this.ctx.storage.get<PushPrefs>(`push:${msg.to}`);
          if (!prefs?.events.challenges || !prefs.watch.includes(tag.pub)) return sendL(ws, { t: 'error', message: "They're not online, and they haven't turned on notifications." });
          const c = { id: shortId(), to: msg.to, until: now + INVITE_MS, bestOf };
          save({ ...tag, challenge: c });
          await this.ctx.storage.put(`invite:${msg.to}`, { id: c.id, from: entryOf(tag), fromPub: tag.pub, until: c.until, bestOf } satisfies Invite);
          const sent = await this.notify(msg.to, prefs, { title: `${tag.profile.name} challenges you`, body: `${series(bestOf)[0].toUpperCase()}${series(bestOf).slice(1)}. Tap within 2 minutes to answer.`, url: './#lounge', tag: 'challenge' });
          if (!sent) {
            save({ ...tag, challenge: undefined });
            return sendL(ws, { t: 'error', message: "Couldn't reach them. Try again later." });
          }
          return sendL(ws, { t: 'challengeSent', id: c.id, to: msg.to, until: c.until });
        }
        if (target.status === 'playing') return sendL(ws, { t: 'error', message: `${target.profile.name} is in a match right now.` });
        if (!compatible(tag, target)) return sendL(ws, { t: 'error', message: `${target.profile.name} isn't available.` });
        const c = { id: shortId(), to: msg.to, until: now + CHALLENGE_MS, bestOf };
        save({ ...tag, challenge: c });
        for (const w of this.socketsOf(msg.to)) sendL(w, { t: 'challenged', id: c.id, from: entryOf(tag), until: c.until, bestOf });
        return sendL(ws, { t: 'challengeSent', id: c.id, to: msg.to, until: c.until });
      }
      case 'withdraw': {
        const c = tag.challenge;
        if (!c) return;
        const { challenge: _c, ...rest } = tag;
        save(rest);
        await this.ctx.storage.delete(`invite:${c.to}`);
        for (const w of this.socketsOf(c.to)) sendL(w, { t: 'challengeOver', id: c.id, reason: `${tag.profile.name} withdrew the challenge.` });
        return;
      }
      case 'answer': {
        await this.ctx.storage.delete(`invite:${tag.pub}`);
        const from = this.tags().find(([, t]) => t.challenge?.id === msg.id && t.challenge.to === tag!.pub);
        if (!from || from[1].challenge!.until < now) return sendL(ws, { t: 'challengeOver', id: msg.id, reason: 'That challenge is no longer open.' });
        const [cws, ct] = from;
        const { challenge: ch, ...rest } = ct;
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
        if (!(await this.match(cws, ws, now, 'challenge', seriesLength(ch?.bestOf)))) sendL(ws, { t: 'error', message: 'Could not start the match. Try again.' });
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
        if (typeof msg.target !== 'string' || !PUB.test(msg.target) || msg.target === tag.pub) return;
        const said = msg.msgId && tag.lounge ? (await this.chatLog(tag.lounge)).find((m) => m.id === msg.msgId && m.from === msg.target) : undefined;
        const name = this.tags().find(([, t]) => t.pub === msg.target)?.[1].profile.name ?? said?.name ?? '';
        await this.storeReport({ at: now, from: tag.pub, target: msg.target, name, lounge: tag.lounge ?? null, reason: String(msg.reason ?? '').slice(0, 40), message: said?.text ?? null });
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

  /** A report (from the lounge, or about a friend-room opponent by web request): logged and kept for the admin page. */
  async storeReport(r: StoredReport): Promise<void> {
    console.log(JSON.stringify({ report: true, ...r, at: new Date(r.at).toISOString() }));
    const list = (await this.ctx.storage.get<StoredReport[]>('reportlog')) ?? [];
    await this.ctx.storage.put('reportlog', [...list, r].slice(-MAX_REPORTS));
  }

  // ---------- The admin page ----------

  async adminOverview(): Promise<LoungeOverview> {
    const now = Date.now();
    const pubs = new Map<string, LoungeTag>();
    for (const [, t] of this.tags()) pubs.set(t.pub, t);
    const all = [...pubs.values()];
    const bans = [...(await this.ctx.storage.list<Ban>({ prefix: 'ban:' })).entries()].map(([k, b]) => ({ ...b, id: k.slice(4) })).filter((b) => b.until > now);
    const subs = await this.ctx.storage.list({ prefix: 'push:', limit: 1000 });
    return {
      online: all.length,
      searching: all.filter((t) => t.since).length,
      playing: all.filter((t) => t.status === 'playing').length,
      lounges: loungeList(loungeCounts(all)).filter((l) => l.count > 0),
      matchesToday: (await this.ctx.storage.get<number>(`matches:${today(now)}`)) ?? 0,
      matchesHour: await this.recent(now),
      reports: [...((await this.ctx.storage.get<StoredReport[]>('reportlog')) ?? [])].reverse(),
      bans,
      pushSubscribers: subs.size,
    };
  }

  /** Ban a player (by public id) from chat, or from playing with strangers; they're told at once. */
  async adminBan(target: string, scope: 'chat' | 'all', hours: number, reason: string): Promise<void> {
    if (!PUB.test(target)) return;
    const now = Date.now();
    const ban: Ban = { scope, until: now + Math.max(1, Math.min(24 * 365, hours)) * 3600_000, reason: reason.slice(0, 80) };
    await this.ctx.storage.put(`ban:${target}`, ban);
    for (const w of this.socketsOf(target)) {
      const t = tagOf(w)!;
      sendL(w, { t: 'error', message: this.banText(ban) });
      if (scope === 'all') {
        await this.leaveLounge(w, t);
        w.serializeAttachment(null);
      } else sendL(w, { t: 'welcome', you: t.pub, mutedUntil: ban.until });
    }
    if (scope === 'all') {
      this.sendLounges();
      await this.queueCounts(now);
    }
  }

  async adminUnban(target: string): Promise<void> {
    await this.ctx.storage.delete(`ban:${target}`);
    await this.ctx.storage.delete(`muted:${target}`);
  }

  async adminClearChat(lounge: number): Promise<void> {
    this.histories.delete(lounge);
    await this.ctx.storage.delete(`chat:${lounge}`);
    this.toLounge(lounge, { t: 'chatCleared' });
  }

  async adminDismissReport(at: number, from: string): Promise<void> {
    const list = (await this.ctx.storage.get<StoredReport[]>('reportlog')) ?? [];
    await this.ctx.storage.put(
      'reportlog',
      list.filter((r) => !(r.at === at && r.from === from)),
    );
  }

  // ---------- Time ----------

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
    if (t.challenge && lastTab) {
      for (const w of this.socketsOf(t.challenge.to)) sendL(w, { t: 'challengeOver', id: t.challenge.id, reason: `${t.profile.name} left online play.` });
      await this.ctx.storage.delete(`invite:${t.challenge.to}`);
    }
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
