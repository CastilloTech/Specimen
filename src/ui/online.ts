import type { Action, GameState, MatchSetup, PlayerId, PlayerSetup } from '../engine';
import type { EmoteId, SeriesView } from '../../server/room';
import { deviceId } from './device';

export type { EmoteId, GameResult, SeriesView } from '../../server/room';
export { BEST_OF, EMOTES, WINS_NEEDED } from '../../server/room';

// The client side of online play: create a room (a 5-letter code), join one, and keep a WebSocket to the match
// server (server/worker.ts). The server runs the match; this only sends your moves and hands the views it
// sends back to the match screen. A dropped connection reconnects on its own, back into the same seat.

/** The match server: the deployed Worker, or a local one (`npm run server:dev`) while developing. */
export const SERVER_URL: string =
  (import.meta.env.VITE_MATCH_SERVER as string | undefined) ??
  (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:8787' : 'https://specimen-match.specimen-card-game.workers.dev');

export const ROOM_CODE = /^[A-HJ-NP-Z]{5}$/;
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);

/** A link that opens the game straight into this room. */
export const roomLink = (code: string) => `${location.origin}${location.pathname}#room=${code}`;

export async function createRoom(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error(`The match server answered ${res.status}.`);
  const { code } = (await res.json()) as { code: string };
  return code;
}

/** `noshow`: a room the queue made, given up because the other player never arrived. */
export type OnlineStatus = 'connecting' | 'waiting' | 'playing' | 'reconnecting' | 'closed' | 'noshow';

export interface OnlineView {
  state: GameState;
  seat: PlayerId;
  /** The full setup, sent once the match is over (for the replay). */
  setup?: MatchSetup;
  opponentConnected: boolean;
  /** The opponent left the room on purpose (no rematch with them). */
  opponentLeft: boolean;
  /** The opponent's public id (for Block / Report), and whether they're a stranger from the queue. */
  opponentId: string | null;
  queue: boolean;
  series: SeriesView;
  /** When the current decision times out, on this device's clock (ms), or null. */
  deadlineAt: number | null;
  /** Between games: when the next one starts by itself, on this device's clock (ms), or null. */
  nextAt: number | null;
}

/** A reaction one of the players just sent. */
export interface EmoteEvent {
  seat: PlayerId;
  id: EmoteId;
  at: number;
}

type ServerMsg =
  | { t: 'joined'; seat: PlayerId; token: string; code: string }
  | { t: 'waiting'; code: string }
  | { t: 'state'; state: GameState; seat: PlayerId; setup?: MatchSetup; opponentConnected: boolean; opponentLeft: boolean; series: SeriesView; deadlineIn: number | null; opponentId?: string | null; queue?: boolean }
  | { t: 'noshow' }
  | { t: 'emote'; seat: PlayerId; id: EmoteId }
  | { t: 'error'; message: string }
  | { t: 'pong' };

const tokenKey = (code: string) => `specimen.room.${code}`;
const LAST_ROOM = 'specimen.lastRoom';

/** The room this tab was last seated in (within 2 hours), to offer a rejoin after a reload. */
export function lastRoom(): string | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(LAST_ROOM) ?? 'null') as { code: string; at: number } | null;
    if (!r || Date.now() - r.at > 2 * 60 * 60 * 1000 || !sessionStorage.getItem(tokenKey(r.code))) return null;
    return r.code;
  } catch {
    return null;
  }
}

/** A room code from whatever was typed or pasted: the code itself, or an invite link. */
export function codeFrom(text: string): string {
  const link = /room=([A-Za-z]{5})/.exec(text);
  return link ? link[1].toUpperCase() : normalizeCode(text);
}

/** One player's connection to one room. */
export class OnlineConn {
  readonly code: string;
  seat: PlayerId | null = null;
  status: OnlineStatus = 'connecting';
  view: OnlineView | null = null;
  error: string | null = null;
  /** The latest reaction (either player's). */
  emote: EmoteEvent | null = null;
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private retries = 0;
  private closedByUs = false;
  private ping: ReturnType<typeof setInterval> | null = null;

  constructor(
    code: string,
    private player: Omit<PlayerSetup, 'isBot' | 'ai'>,
  ) {
    this.code = code;
    this.open();
  }

  /** Be told about any change (status, a new view, an error). Returns the unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  private open() {
    const url = `${SERVER_URL.replace(/^http/, 'ws')}/rooms/${this.code}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      let token: string | null = null;
      try {
        token = sessionStorage.getItem(tokenKey(this.code));
      } catch {
        /* no session storage */
      }
      ws.send(JSON.stringify(token ? { t: 'join', token, player: this.player } : { t: 'join', player: this.player, device: deviceId() }));
      // Keep the connection alive through proxies that drop idle sockets.
      if (this.ping) clearInterval(this.ping);
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ t: 'ping' })), 25_000);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as ServerMsg;
      if (m.t === 'joined') {
        this.seat = m.seat;
        try {
          sessionStorage.setItem(tokenKey(this.code), m.token);
          sessionStorage.setItem(LAST_ROOM, JSON.stringify({ code: this.code, at: Date.now() }));
        } catch {
          /* reconnecting to the same seat won't work this time */
        }
      } else if (m.t === 'waiting') this.status = 'waiting';
      else if (m.t === 'noshow') {
        this.status = 'noshow';
        this.closedByUs = true;
        ws.close();
      }
      else if (m.t === 'state') {
        const now = Date.now();
        // A server from before series existed: treat the room as a single game.
        m.series ??= { n: 1, bestOf: 1, game: 1, games: [], wins: [0, 0], done: m.state.phase === 'over', winner: m.state.result?.winner ?? null, forfeit: null, ready: [false, false], nextIn: null };
        m.deadlineIn ??= null;
        m.opponentLeft ??= false;
        this.view = {
          state: m.state,
          seat: m.seat,
          setup: m.setup,
          opponentConnected: m.opponentConnected,
          opponentLeft: m.opponentLeft,
          opponentId: m.opponentId ?? null,
          queue: !!m.queue,
          series: m.series,
          deadlineAt: m.deadlineIn === null ? null : now + m.deadlineIn,
          nextAt: m.series.nextIn === null ? null : now + m.series.nextIn,
        };
        this.status = 'playing';
        this.error = null;
      } else if (m.t === 'emote') this.emote = { seat: m.seat, id: m.id, at: Date.now() };
      else if (m.t === 'error') this.error = m.message;
      this.emit();
    };
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping);
      // Between games and after the series the room stays open (the next game, a rematch), so reconnect then too.
      if (this.closedByUs) {
        if (this.status !== 'noshow') this.status = 'closed';
        return this.emit();
      }
      // Try again, waiting a little longer each time (up to ~10 s).
      this.status = 'reconnecting';
      this.emit();
      const wait = Math.min(10_000, 500 * 2 ** this.retries++);
      setTimeout(() => !this.closedByUs && this.open(), wait);
    };
  }

  send(action: Action) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'act', action }));
    else {
      this.error = 'Not connected: your move was not sent.';
      this.emit();
    }
  }

  /** Ready for the next game, or for a rematch once the series is over. */
  ready() {
    this.raw({ t: 'ready' });
  }

  /** A quick reaction to the opponent. */
  sendEmote(id: EmoteId) {
    this.raw({ t: 'emote', id });
  }

  /** Leave the room for good: forfeits a series still in progress, and the opponent is told at once. */
  leave() {
    this.raw({ t: 'leave' });
    try {
      sessionStorage.removeItem(tokenKey(this.code));
      sessionStorage.removeItem(LAST_ROOM);
    } catch {
      /* nothing kept */
    }
    // Give the message a moment to go out before the socket closes.
    setTimeout(() => this.close(), 150);
  }

  private raw(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closedByUs = true;
    if (this.ping) clearInterval(this.ping);
    this.ws?.close();
  }
}
