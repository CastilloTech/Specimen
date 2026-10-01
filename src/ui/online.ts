import type { Action, GameState, MatchSetup, PlayerId, PlayerSetup } from '../engine';

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

export type OnlineStatus = 'connecting' | 'waiting' | 'playing' | 'reconnecting' | 'closed';

export interface OnlineView {
  state: GameState;
  seat: PlayerId;
  /** The full setup, sent once the match is over (for the replay). */
  setup?: MatchSetup;
  opponentConnected: boolean;
}

type ServerMsg =
  | { t: 'joined'; seat: PlayerId; token: string; code: string }
  | { t: 'waiting'; code: string }
  | ({ t: 'state' } & OnlineView)
  | { t: 'error'; message: string }
  | { t: 'pong' };

const tokenKey = (code: string) => `specimen.room.${code}`;

/** One player's connection to one room. */
export class OnlineConn {
  readonly code: string;
  seat: PlayerId | null = null;
  status: OnlineStatus = 'connecting';
  view: OnlineView | null = null;
  error: string | null = null;
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
      ws.send(JSON.stringify(token ? { t: 'join', token, player: this.player } : { t: 'join', player: this.player }));
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
        } catch {
          /* reconnecting to the same seat won't work this time */
        }
      } else if (m.t === 'waiting') this.status = 'waiting';
      else if (m.t === 'state') {
        this.view = { state: m.state, seat: m.seat, setup: m.setup, opponentConnected: m.opponentConnected };
        this.status = 'playing';
        this.error = null;
      } else if (m.t === 'error') this.error = m.message;
      this.emit();
    };
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping);
      if (this.closedByUs || this.view?.state.phase === 'over') {
        this.status = 'closed';
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

  close() {
    this.closedByUs = true;
    if (this.ping) clearInterval(this.ping);
    this.ws?.close();
  }
}
