// The match room's rules, independent of Cloudflare: who sits where, what each message does, what each
// player is sent, and what happens when someone goes quiet or leaves. The Durable Object (worker.ts) only
// stores this and moves messages; keeping the logic here lets it be tested without a server.
import { createMatch, pendingPlayers, reduce, redactFor, timeoutAction, validateChipChoice, validateDeck, validateLoadout } from '../src/engine';
import type { Action, Faction, GameState, MatchSetup, PlayerId, PlayerSetup, WorldFactionId } from '../src/engine';
import { FACTIONS, WORLD_FACTIONS } from '../src/engine';

/** What a player brings to the table. */
export interface Seat {
  token: string;
  player: PlayerSetup;
  /** When this seat's connection dropped (ms), or null while connected. */
  goneAt: number | null;
}

export interface RoomData {
  code: string;
  seats: (Seat | null)[];
  setup: MatchSetup | null;
  state: GameState | null;
  /** When the current decision runs out (ms): the server then makes the timeout move for whoever is late. */
  deadline: number | null;
  createdAt: number;
}

// Client → server.
export type ClientMsg = { t: 'join'; token?: string; player?: Omit<PlayerSetup, 'isBot' | 'ai'> } | { t: 'act'; action: Action } | { t: 'ping' };
// Server → client.
export type ServerMsg =
  | { t: 'joined'; seat: PlayerId; token: string; code: string }
  | { t: 'waiting'; code: string }
  | { t: 'state'; state: GameState; seat: PlayerId; setup?: MatchSetup; opponentConnected: boolean }
  | { t: 'error'; message: string }
  | { t: 'pong' };

/** How long a decision may take before the server moves for the player (generous: this is a backstop). */
export const DECISION_MS = 120_000;
/** How long a dropped player has to come back before they forfeit. */
export const ABANDON_MS = 180_000;

export const newRoom = (code: string, now: number): RoomData => ({ code, seats: [null, null], setup: null, state: null, deadline: null, createdAt: now });

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '');

/** Check what a joining player brings: a legal deck, Chip and loadout for their Build and World Faction. */
export function checkPlayer(p: Extract<ClientMsg, { t: 'join' }>['player']): PlayerSetup | string {
  if (!p) return 'Missing player.';
  if (!FACTIONS.includes(p.faction as Faction) || !WORLD_FACTIONS.includes(p.worldFaction as WorldFactionId)) return 'Unknown Build or World Faction.';
  if (!Array.isArray(p.deck) || !Array.isArray(p.loadout)) return 'Missing deck or loadout.';
  const errs = [...validateDeck(p.faction, p.worldFaction, p.deck), ...validateChipChoice(p.worldFaction, p.chip), ...validateLoadout(p.chip, p.loadout)];
  if (errs.length) return errs[0];
  return { name: clean(p.name, 24) || 'Player', faction: p.faction, worldFaction: p.worldFaction, chip: p.chip, deck: [...p.deck], loadout: [...p.loadout] };
}

/** The message each seat gets after any change: its own view, or the whole match once it is over. */
export function viewFor(r: RoomData, seat: PlayerId): ServerMsg | null {
  if (!r.state) return { t: 'waiting', code: r.code };
  const over = r.state.phase === 'over';
  const opp = r.seats[1 - seat];
  return { t: 'state', state: over ? r.state : redactFor(r.state, seat), seat, ...(over && r.setup ? { setup: r.setup } : {}), opponentConnected: !!opp && opp.goneAt === null };
}

export interface Outcome {
  /** A reply to the sender only. */
  reply?: ServerMsg;
  /** Everyone should get a fresh view. */
  broadcast?: boolean;
  /** The seat this connection now holds. */
  seat?: PlayerId;
}

/** A player joins (or rejoins with their token). The match starts when both seats are filled. */
export function join(r: RoomData, msg: Extract<ClientMsg, { t: 'join' }>, now: number, rand: () => number, newToken: () => string): Outcome {
  // Rejoining: the token says which seat.
  if (msg.token) {
    const i = r.seats.findIndex((s) => s?.token === msg.token);
    if (i >= 0) {
      r.seats[i]!.goneAt = null;
      return { seat: i as PlayerId, reply: { t: 'joined', seat: i as PlayerId, token: msg.token, code: r.code }, broadcast: true };
    }
  }
  const free = r.seats.findIndex((s) => s === null);
  if (free < 0) return { reply: { t: 'error', message: 'This room is full.' } };
  const player = checkPlayer(msg.player);
  if (typeof player === 'string') return { reply: { t: 'error', message: player } };
  const token = newToken();
  r.seats[free] = { token, player, goneAt: null };
  if (r.seats[0] && r.seats[1]) {
    r.setup = { seed: Math.floor(rand() * 2 ** 31), players: [r.seats[0].player, r.seats[1].player] };
    r.state = createMatch(r.setup);
    r.deadline = now + DECISION_MS;
  }
  return { seat: free as PlayerId, reply: { t: 'joined', seat: free as PlayerId, token, code: r.code }, broadcast: true };
}

/** A player's move: theirs to make, and legal, or it is refused. */
export function act(r: RoomData, seat: PlayerId, action: Action, now: number): Outcome {
  if (!r.state) return { reply: { t: 'error', message: 'The match has not started.' } };
  if (r.state.phase === 'over') return { reply: { t: 'error', message: 'The match is over.' } };
  if (!action || typeof action !== 'object' || action.player !== seat) return { reply: { t: 'error', message: 'Not your move.' } };
  const next = reduce(r.state, action);
  if (next.lastError) return { reply: { t: 'error', message: next.lastError } };
  r.state = next;
  r.deadline = next.phase === 'over' ? null : now + DECISION_MS;
  return { broadcast: true };
}

export function disconnected(r: RoomData, seat: PlayerId, now: number): void {
  const s = r.seats[seat];
  if (s) s.goneAt = now;
}

/**
 * Time passes (the room's alarm): a player who left long ago forfeits; a decision that ran out gets the
 * timeout move (the same one the offline turn timer makes). Returns whether anything changed.
 */
export function tick(r: RoomData, now: number): boolean {
  if (!r.state || r.state.phase === 'over') return false;
  const gone = r.seats.findIndex((s) => s && s.goneAt !== null && now - s.goneAt >= ABANDON_MS);
  if (gone >= 0) {
    const winner = (1 - gone) as PlayerId;
    r.state = { ...r.state, phase: 'over', result: { winner, reason: `${r.seats[gone]!.player.name} left the match` } };
    r.deadline = null;
    return true;
  }
  if (r.deadline !== null && now >= r.deadline) {
    let s = r.state;
    for (const p of pendingPlayers(s)) {
      const n = reduce(s, timeoutAction(s, p));
      if (!n.lastError) s = n;
    }
    r.state = s;
    r.deadline = s.phase === 'over' ? null : now + DECISION_MS;
    return true;
  }
  return false;
}

/** When the room next needs to wake: the decision deadline, or a dropped player's forfeit time. */
export function nextWake(r: RoomData): number | null {
  const times = [r.deadline, ...r.seats.map((s) => (s && s.goneAt !== null ? s.goneAt + ABANDON_MS : null))].filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : null;
}
