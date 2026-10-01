import { useEffect, useReducer } from 'react';
import type { ChatMsg, LobbyServerMsg, LoungeInfo, Presence, PresenceEntry, Profile } from '../../server/lobby';
import { IDLE_WARN_MS } from '../../server/lobby';
import { addFriend, deviceId, isFriend, loadBlocked, loadEmblem, loadFriends, onlineName, refreshFriend } from './device';
import { buzz, play } from './sfx';
import { onlineSummary } from './multiplayer';
import { SERVER_URL } from './online';
import { myDefaults } from './picks';
import { loadSeries } from './storage';

export type { ChatMsg, LoungeInfo, Presence, PresenceEntry, Profile } from '../../server/lobby';
export { IDLE_MS, IDLE_WARN_MS, LOUNGE_SIZE } from '../../server/lobby';

// The lounges, from this device: one connection for as long as you're in online play (or searching from
// elsewhere). It brings the list of lounges, who's in yours and its chat (as changes: arrivals, departures),
// challenges both ways, friend requests and the casual queue, and keeps you visible to friends.

export type SearchStatus = 'idle' | 'searching' | 'matched' | 'cooldown';

export interface Found {
  code: string;
  opponent: string;
  profile: PresenceEntry | null;
  via: 'queue' | 'challenge';
  at: number;
}
export interface Incoming {
  id: string;
  from: PresenceEntry;
  until: number;
}
export interface Toast {
  text: string;
  kind: 'error' | 'notice';
  at: number;
}

/** Your profile card, as others see it: online name, chosen emblem, current Specimen and series record. */
export function myProfile(): Profile | null {
  const name = onlineName();
  if (!name) return null;
  const d = myDefaults();
  const rec = onlineSummary(loadSeries());
  return { name, emblem: (loadEmblem() as Profile['emblem']) ?? d.faction, faction: d.faction, worldFaction: d.worldFaction, won: rec.won, lost: rec.lost };
}

class Lounge {
  status: SearchStatus = 'idle';
  /** When the current search started (kept when sent back to the queue after a no-show). */
  since: number | null = null;
  counts: { searching: number; recent: number } | null = null;
  found: Found | null = null;
  cooldownUntil: number | null = null;
  /** Your public id, once the lounge has welcomed you. */
  you: string | null = null;
  /** The lounge you're in (null until you pick one), and all of them with how full they are. */
  lounge: number | null = null;
  lounges: LoungeInfo[] = [];
  players: PresenceEntry[] = [];
  chat: ChatMsg[] = [];
  mutedUntil: number | null = null;
  incoming: Incoming[] = [];
  outgoing: { id: string; to: string; until: number } | null = null;
  friendReqs: PresenceEntry[] = [];
  /** When you last did something in the lounge (taps, typing), for the inactivity timeout. */
  lastInput = Date.now();
  private lastActiveSent = 0;
  /** Your friends in online play right now, and in which lounge (asked for while the lounge is open). */
  friendsOn: Record<string, FriendOnline> = {};
  toast: Toast | null = null;
  /** A game is being played on this device: requests wait instead of popping up. */
  quiet = false;
  connected = false;
  private presence: Presence = 'lounge';
  /** A lounge asked for before the connection was ready (sent with the hello). */
  private wantLounge: number | 'random' | null = null;
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private searching = false;
  private watchers = 0;
  private retries = 0;
  private ping: ReturnType<typeof setInterval> | null = null;
  private closing: ReturnType<typeof setTimeout> | null = null;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }
  private say(text: string, kind: Toast['kind'] = 'notice') {
    this.toast = { text, kind, at: Date.now() };
  }

  /** In online play (the lounge or a match): stay connected. Returns the "left" callback. */
  watch(): () => void {
    this.watchers++;
    if (this.closing) clearTimeout(this.closing);
    this.closing = null;
    this.open();
    return () => {
      this.watchers--;
      this.maybeClose();
    };
  }
  private wanted() {
    return this.watchers > 0 || this.searching || !!this.outgoing || this.status === 'matched';
  }

  private open() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const ws = new WebSocket(`${SERVER_URL.replace(/^http/, 'ws')}/queue`);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.connected = true;
      this.hello();
      if (this.searching) this.sendFind();
      if (this.ping) clearInterval(this.ping);
      this.ping = setInterval(() => this.send({ t: 'ping' }), 25_000);
      this.emit();
    };
    ws.onmessage = (e) => this.receive(JSON.parse(String(e.data)) as LobbyServerMsg);
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping);
      if (this.ws !== ws) return;
      this.ws = null;
      this.connected = false;
      this.players = [];
      this.emit();
      // Still wanted: reconnect, waiting a little longer each time.
      if (this.wanted()) setTimeout(() => this.wanted() && this.open(), Math.min(10_000, 500 * 2 ** this.retries++));
    };
  }

  private hello() {
    const profile = myProfile();
    // Reconnecting: back into the lounge you were in (or the one asked for meanwhile).
    const lounge = this.lounge ?? this.wantLounge;
    this.send({ t: 'hello', device: deviceId(), ...(profile ? { profile } : {}), blocked: loadBlocked().map((b) => b.id), status: this.presence, ...(lounge ? { lounge } : {}) });
  }

  private receive(m: LobbyServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.you = m.you;
        this.mutedUntil = m.mutedUntil;
        break;
      case 'lounges':
        this.lounges = m.list;
        break;
      case 'lounge':
        this.lounge = m.id;
        this.wantLounge = null;
        this.players = m.players;
        this.chat = m.chat;
        for (const p of m.players) refreshFriend(p.id, p.name, p.emblem);
        break;
      case 'here':
        // A friend walking into your lounge: worth a look up from the chat.
        if (!this.players.some((p) => p.id === m.entry.id) && m.entry.id !== this.you && isFriend(m.entry.id)) {
          this.say(`★ ${m.entry.name} joined the lounge`);
          play('ready', { gain: 0.5 });
        }
        this.players = [...this.players.filter((p) => p.id !== m.entry.id), m.entry];
        refreshFriend(m.entry.id, m.entry.name, m.entry.emblem);
        break;
      case 'gone':
        this.players = this.players.filter((p) => p.id !== m.id);
        break;
      case 'counts':
        this.counts = { searching: m.searching, recent: m.recent };
        break;
      case 'searching':
        this.status = 'searching';
        this.since = m.since;
        break;
      case 'matched':
        this.searching = false;
        this.outgoing = null;
        this.incoming = [];
        this.status = 'matched';
        this.found = { code: m.code, opponent: m.opponent, profile: m.profile ?? null, via: m.via ?? 'queue', at: Date.now() };
        break;
      case 'cooldown':
        this.searching = false;
        this.status = 'cooldown';
        this.cooldownUntil = m.until;
        break;
      case 'chat':
        this.chat = [...this.chat, m.msg].slice(-100);
        // Someone wrote your name: a small ping.
        if (m.msg.from !== this.you && mentions(m.msg.text, onlineName())) {
          play('emote');
          buzz(15);
        }
        break;
      case 'friends':
        this.friendsOn = m.online;
        break;
      case 'kicked':
        this.leftLounge();
        this.say(`You left Lounge ${m.lounge} after 10 minutes without activity. Pick a lounge to come back.`);
        break;
      case 'challenged':
        this.incoming = [...this.incoming.filter((c) => c.from.id !== m.from.id), { id: m.id, from: m.from, until: m.until }];
        break;
      case 'challengeSent':
        this.outgoing = { id: m.id, to: m.to, until: m.until };
        break;
      case 'challengeOver':
        if (this.outgoing?.id === m.id) {
          this.outgoing = null;
          this.say(m.reason);
        }
        this.incoming = this.incoming.filter((c) => c.id !== m.id);
        break;
      case 'friendReq':
        if (!this.friendReqs.some((f) => f.id === m.from.id)) this.friendReqs = [...this.friendReqs, m.from];
        break;
      case 'friendAccepted':
        addFriend({ id: m.from.id, name: m.from.name, emblem: m.from.emblem });
        this.say(`${m.from.name} is now your friend.`);
        break;
      case 'notice':
        this.say(m.text);
        break;
      case 'error':
        this.wantLounge = null;
        if (this.status === 'searching' && !this.since) this.status = 'idle';
        this.say(m.message, 'error');
        break;
    }
    this.emit();
  }

  /**
   * Nothing needs the lounge any more: close it, after a moment. A screen loading can unmount and remount the
   * app's effects in a blink, and that must not throw you out of your lounge.
   */
  private maybeClose() {
    if (this.wanted() || this.closing) return;
    this.closing = setTimeout(() => {
      this.closing = null;
      if (!this.wanted()) this.close();
    }, 1500);
  }
  private close() {
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    // Out of online play: out of your lounge too (next time you pick again).
    this.lounge = null;
    this.wantLounge = null;
    this.players = [];
    this.chat = [];
    ws?.close();
  }

  /** You did something (tap, type, scroll): the inactivity timer starts over, and the lounge hears it now and then. */
  noteActivity() {
    const now = Date.now();
    const warned = now - this.lastInput >= IDLE_WARN_MS;
    this.lastInput = now;
    // The "still there?" warning was up: take it down at once.
    if (warned) this.emit();
    if (this.you && this.lounge && now - this.lastActiveSent > 60_000) {
      this.lastActiveSent = now;
      this.send({ t: 'active' });
    }
  }
  /** Out of your lounge, back to the list (online play goes on: friends, challenges, search). */
  leaveLounge() {
    this.send({ t: 'leaveLounge' });
    this.leftLounge();
    this.emit();
  }
  private leftLounge() {
    this.lounge = null;
    this.wantLounge = null;
    this.players = [];
    this.chat = [];
  }

  /** Go to a lounge: a given one, or a random one with room. */
  joinLounge(id: number | 'random') {
    this.lastInput = Date.now();
    this.wantLounge = id;
    this.open();
    if (this.you) this.send({ t: 'join', lounge: id });
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  private sendFind() {
    this.send({ t: 'find', ...(this.since ? { since: this.since } : {}) });
  }

  /** Your name, emblem or Specimen changed: tell the lounge (or say hello, the first time). */
  refreshProfile() {
    const profile = myProfile();
    if (!profile) return;
    if (this.you) this.send({ t: 'profile', profile });
    else this.hello();
  }
  /** Your block list changed. */
  refreshBlocked() {
    this.send({ t: 'blocked', blocked: loadBlocked().map((b) => b.id) });
  }
  /** In a match, or back in the lounge (so others know whether you can be challenged). */
  setPresence(p: Presence) {
    if (this.presence === p) return;
    this.presence = p;
    this.send({ t: 'status', status: p });
  }

  /** Search the casual queue. `keepPlace`: back in the queue after a no-show, keeping the original wait. */
  find(keepPlace = false) {
    if (!keepPlace) this.since = null;
    this.searching = true;
    this.status = 'searching';
    this.since ??= Date.now();
    this.found = null;
    this.presence = 'lounge';
    this.open();
    this.sendFind();
    this.emit();
  }
  cancel() {
    this.searching = false;
    this.send({ t: 'cancel' });
    this.status = 'idle';
    this.since = null;
    this.emit();
    this.maybeClose();
  }
  /** Turn the found match down: the room is called off now, so the other player goes straight back to searching. */
  decline() {
    if (this.found) this.send({ t: 'decline', code: this.found.code });
    this.clearFound();
  }
  /** The found match was taken up (or let go). */
  clearFound() {
    this.found = null;
    if (this.status === 'matched') this.status = 'idle';
    this.since = null;
    this.emit();
    this.maybeClose();
  }
  clearCooldown() {
    this.cooldownUntil = null;
    if (this.status === 'cooldown') this.status = 'idle';
    this.emit();
  }
  /** A notice from the game itself (not the server). */
  toastNow(text: string) {
    this.say(text);
    this.emit();
  }
  clearToast() {
    this.toast = null;
    this.emit();
  }
  setQuiet(q: boolean) {
    if (this.quiet === q) return;
    this.quiet = q;
    this.emit();
  }

  sayInChat(text: string) {
    this.send({ t: 'chat', text });
  }
  challenge(to: string) {
    this.send({ t: 'challenge', to });
  }
  withdraw() {
    this.send({ t: 'withdraw' });
    this.outgoing = null;
    this.emit();
    this.maybeClose();
  }
  answer(id: string, yes: boolean) {
    this.send({ t: 'answer', id, yes });
    this.incoming = this.incoming.filter((c) => c.id !== id);
    this.emit();
  }
  /** A challenge ran out without an answer. */
  expireIncoming(id: string) {
    this.incoming = this.incoming.filter((c) => c.id !== id);
    this.emit();
  }
  befriend(to: string) {
    this.send({ t: 'friend', to });
  }
  answerFriend(from: PresenceEntry, yes: boolean) {
    if (yes) {
      addFriend({ id: from.id, name: from.name, emblem: from.emblem });
      this.say(`${from.name} is now your friend.`);
    }
    this.send({ t: 'friendAnswer', to: from.id, yes });
    this.friendReqs = this.friendReqs.filter((f) => f.id !== from.id);
    this.emit();
  }
  /** Ask which friends are on (the lounge answers over the same connection: no extra request). */
  askFriends() {
    const ids = loadFriends().map((f) => f.id);
    if (ids.length) this.send({ t: 'friends', ids });
  }
  report(target: string, reason: string, msgId?: string) {
    this.send({ t: 'report', target, reason, ...(msgId ? { msgId } : {}) });
  }
}

export const matchmaker = new Lounge();
// For debugging in development (the browser console, and the end-to-end checks).
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __lounge: Lounge }).__lounge = matchmaker;

/** Re-render on any change in the lounge. */
export function useMatchmaker() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => matchmaker.subscribe(rerender), []);
  return matchmaker;
}

/** How long a found match waits for you to join before the room gives up (a little under the server's 30 s). */
export const JOIN_WINDOW_MS = 25_000;

export interface FriendOnline {
  status: Presence;
  lounge: number | null;
}

/** Whether a chat message names you (your online name as a whole word, any case). */
export function mentions(text: string, name: string | null): boolean {
  if (!name) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])@?${esc}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}
/** Which of these friends (public ids) are in online play right now, and in which lounge. Empty on any failure. */
export async function friendsOnline(ids: string[]): Promise<Record<string, FriendOnline>> {
  if (!ids.length) return {};
  try {
    const res = await fetch(`${SERVER_URL}/presence?ids=${ids.slice(0, 100).join(',')}`);
    return res.ok ? ((await res.json()) as { online: Record<string, FriendOnline> }).online : {};
  } catch {
    return {};
  }
}
