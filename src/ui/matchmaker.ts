import { useEffect, useReducer } from 'react';
import type { LobbyServerMsg } from '../../server/lobby';
import { deviceId, loadBlocked } from './device';
import { SERVER_URL } from './online';

// The matchmaking queue, from this device: one connection to the server's lobby, kept for the whole visit so a
// player can search, go and play a bot while they wait, and still be told the moment a stranger is found.

export type SearchStatus = 'idle' | 'searching' | 'matched' | 'cooldown';

export interface Found {
  code: string;
  opponent: string;
  at: number;
}

class Matchmaker {
  status: SearchStatus = 'idle';
  /** When the current search started (kept when sent back to the queue after a no-show). */
  since: number | null = null;
  counts: { searching: number; recent: number } | null = null;
  found: Found | null = null;
  cooldownUntil: number | null = null;
  error: string | null = null;
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private want: { name: string } | null = null;
  private watchers = 0;
  private retries = 0;
  private ping: ReturnType<typeof setInterval> | null = null;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** The online screen is open: connect, for the live counts. */
  watch(): () => void {
    this.watchers++;
    this.open();
    return () => {
      this.watchers--;
      this.maybeClose();
    };
  }

  private open() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const ws = new WebSocket(`${SERVER_URL.replace(/^http/, 'ws')}/queue`);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.send({ t: 'hello', device: deviceId() });
      if (this.want) this.sendFind();
      if (this.ping) clearInterval(this.ping);
      this.ping = setInterval(() => this.send({ t: 'ping' }), 25_000);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as LobbyServerMsg;
      if (m.t === 'counts') this.counts = { searching: m.searching, recent: m.recent };
      else if (m.t === 'searching') {
        this.status = 'searching';
        this.since = m.since;
        this.error = null;
      } else if (m.t === 'matched') {
        this.want = null;
        this.status = 'matched';
        this.found = { code: m.code, opponent: m.opponent, at: Date.now() };
      } else if (m.t === 'cooldown') {
        this.want = null;
        this.status = 'cooldown';
        this.cooldownUntil = m.until;
      } else if (m.t === 'error') {
        this.want = null;
        if (this.status === 'searching') this.status = 'idle';
        this.error = m.message;
      }
      this.emit();
    };
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping);
      if (this.ws !== ws) return;
      this.ws = null;
      // Still wanted (searching, or the screen is open): reconnect, waiting a little longer each time.
      if (this.want || this.watchers > 0) setTimeout(() => (this.want || this.watchers > 0) && this.open(), Math.min(10_000, 500 * 2 ** this.retries++));
    };
  }

  private maybeClose() {
    if (this.want || this.watchers > 0 || this.status === 'matched') return;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  private sendFind() {
    const blocked = loadBlocked().map((b) => b.id);
    this.send({ t: 'find', device: deviceId(), name: this.want!.name, blocked, ...(this.since ? { since: this.since } : {}) });
  }

  /** Start searching under this name. `keepPlace`: back in the queue after a no-show, keeping the original wait. */
  find(name: string, keepPlace = false) {
    this.want = { name };
    if (!keepPlace) this.since = null;
    this.status = 'searching';
    this.since ??= Date.now();
    this.found = null;
    this.error = null;
    this.open();
    this.sendFind();
    this.emit();
  }

  cancel() {
    this.want = null;
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

  /** The found match was taken up (or let go): the search is over. */
  clearFound() {
    this.found = null;
    if (this.status === 'matched') this.status = 'idle';
    this.since = null;
    this.emit();
    this.maybeClose();
  }

  /** The cooldown ran out. */
  clearCooldown() {
    this.cooldownUntil = null;
    if (this.status === 'cooldown') this.status = 'idle';
    this.emit();
  }
}

export const matchmaker = new Matchmaker();

/** Re-render on any change in the queue. */
export function useMatchmaker() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => matchmaker.subscribe(rerender), []);
  return matchmaker;
}

/** How long a found match waits for you to join before the room gives up (a little under the server's 30 s). */
export const JOIN_WINDOW_MS = 25_000;
