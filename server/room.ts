// The match room's rules, independent of Cloudflare: who sits where, what each message does, what each
// player is sent, and what happens when someone goes quiet or leaves. The Durable Object (worker.ts) only
// stores this and moves messages; keeping the logic here lets it be tested without a server.
//
// A room plays a best-of-3 series: games follow one another until a player has 2 wins (draws count for no one,
// and the series stops after 5 games at most). Between games both players tap Ready (or the next game starts
// on its own after a short wait). After the series, both tapping Rematch starts a new series in the same room.
import { createMatch, pendingPlayers, reduce, redactFor, timeoutAction, validateChipChoice, validateDeck, validateLoadout } from '../src/engine';
import type { Action, Faction, GameState, MatchSetup, PlayerId, PlayerSetup, WorldFactionId } from '../src/engine';
import { FACTIONS, WORLD_FACTIONS } from '../src/engine';

/** What a player brings to the table. */
export interface Seat {
  token: string;
  player: PlayerSetup;
  /** When this seat's connection dropped (ms), or null while connected. */
  goneAt: number | null;
  /** The player left on purpose (tapped Leave): no waiting for them to come back. */
  left?: boolean;
}

/** One finished game of the series. */
export interface GameResult {
  winner: PlayerId | null;
  reason: string;
  rounds: number;
}

export interface Series {
  /** Which series this is in the room (1, then 2 after a rematch...). */
  n: number;
  /** The game being played (1-based); `games` holds the finished ones. */
  game: number;
  games: GameResult[];
  wins: [number, number];
  /** Settled: someone reached the wins needed, the game cap was hit, or a player left. */
  done: boolean;
  /** The series winner once done (null: tied, e.g. after draws up to the game cap). */
  winner: PlayerId | null;
  /** Who left (and so forfeited the series), if anyone. */
  forfeit: PlayerId | null;
  /** Who has tapped Ready (between games) or Rematch (after the series). */
  ready: [boolean, boolean];
}

export interface RoomData {
  code: string;
  seats: (Seat | null)[];
  setup: MatchSetup | null;
  state: GameState | null;
  /** When the current decision runs out (ms): the server then makes the timeout move for whoever is late. */
  deadline: number | null;
  createdAt: number;
  series: Series;
  /** Between games: when the next game starts by itself if both players haven't tapped Ready (ms). */
  nextAt: number | null;
  /** When each seat last sent an emote (ms), to keep them from being spammed. */
  lastEmote?: [number, number];
}

/** The series view each player is sent. */
export interface SeriesView {
  n: number;
  bestOf: number;
  game: number;
  games: GameResult[];
  wins: [number, number];
  done: boolean;
  winner: PlayerId | null;
  forfeit: PlayerId | null;
  ready: [boolean, boolean];
  /** Between games: ms until the next game starts by itself. */
  nextIn: number | null;
}

export const EMOTES = ['gg', 'nice', 'wow', 'think', 'oops', 'grr'] as const;
export type EmoteId = (typeof EMOTES)[number];

// Client → server.
export type ClientMsg =
  | { t: 'join'; token?: string; player?: Omit<PlayerSetup, 'isBot' | 'ai'> }
  | { t: 'act'; action: Action }
  | { t: 'ready' }
  | { t: 'leave' }
  | { t: 'emote'; id: EmoteId }
  | { t: 'ping' };
// Server → client.
export type ServerMsg =
  | { t: 'joined'; seat: PlayerId; token: string; code: string }
  | { t: 'waiting'; code: string }
  | {
      t: 'state';
      state: GameState;
      seat: PlayerId;
      setup?: MatchSetup;
      opponentConnected: boolean;
      opponentLeft: boolean;
      series: SeriesView;
      /** ms until the server makes the timeout move for whoever must decide now. */
      deadlineIn: number | null;
    }
  | { t: 'emote'; seat: PlayerId; id: EmoteId }
  | { t: 'error'; message: string }
  | { t: 'pong' };

/** How long a decision may take before the server moves for the player (generous: this is a backstop). */
export const DECISION_MS = 120_000;
/** How long a dropped player has to come back before they forfeit. */
export const ABANDON_MS = 180_000;
/** Games in a series, and the wins that take it. */
export const BEST_OF = 3;
export const WINS_NEEDED = Math.ceil(BEST_OF / 2);
/** Draws don't count, so a series could run on: it stops after this many games. */
export const MAX_GAMES = 5;
/** Between games, the next one starts by itself after this long. */
export const NEXT_GAME_MS = 30_000;
/** At most one emote per player this often. */
export const EMOTE_GAP_MS = 2_500;

export const freshSeries = (n: number): Series => ({ n, game: 1, games: [], wins: [0, 0], done: false, winner: null, forfeit: null, ready: [false, false] });

export const newRoom = (code: string, now: number): RoomData => ({ code, seats: [null, null], setup: null, state: null, deadline: null, createdAt: now, series: freshSeries(1), nextAt: null });

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

export function seriesView(r: RoomData, now: number): SeriesView {
  const s = r.series;
  return { n: s.n, bestOf: BEST_OF, game: s.game, games: s.games, wins: s.wins, done: s.done, winner: s.winner, forfeit: s.forfeit, ready: s.ready, nextIn: r.nextAt === null ? null : Math.max(0, r.nextAt - now) };
}

/** The message each seat gets after any change: its own view, or the whole game once it is over. */
export function viewFor(r: RoomData, seat: PlayerId, now = 0): ServerMsg | null {
  if (!r.state) return { t: 'waiting', code: r.code };
  const over = r.state.phase === 'over';
  const opp = r.seats[1 - seat];
  return {
    t: 'state',
    state: over ? r.state : redactFor(r.state, seat),
    seat,
    ...(over && r.setup ? { setup: r.setup } : {}),
    opponentConnected: !!opp && opp.goneAt === null,
    opponentLeft: !!opp?.left,
    series: seriesView(r, now),
    deadlineIn: r.deadline === null ? null : Math.max(0, r.deadline - now),
  };
}

export interface Outcome {
  /** A reply to the sender only. */
  reply?: ServerMsg;
  /** Everyone should get a fresh view. */
  broadcast?: boolean;
  /** Sent as-is to everyone in the room (nothing stored). */
  relay?: ServerMsg;
  /** The seat this connection now holds. */
  seat?: PlayerId;
}

/** A new game between the two seated players (the next of the series, or the first of a rematch). */
function startGame(r: RoomData, now: number, rand: () => number): void {
  if (r.series.done) r.series = freshSeries(r.series.n + 1);
  else if (r.state) r.series.game = r.series.games.length + 1;
  r.series.ready = [false, false];
  r.setup = { seed: Math.floor(rand() * 2 ** 31), players: [r.seats[0]!.player, r.seats[1]!.player] };
  r.state = createMatch(r.setup);
  r.deadline = now + DECISION_MS;
  r.nextAt = null;
}

/** A game just ended: count it toward the series, and settle the series if that decides it. */
export function settle(r: RoomData, now: number): void {
  const s = r.series;
  if (!r.state || r.state.phase !== 'over' || s.games.length >= s.game) return;
  const w = r.state.result?.winner ?? null;
  s.games.push({ winner: w, reason: r.state.result?.reason ?? '', rounds: r.state.round });
  if (w !== null) s.wins[w]++;
  if (s.wins.some((x) => x >= WINS_NEEDED) || s.games.length >= MAX_GAMES) {
    s.done = true;
    s.winner = s.wins[0] === s.wins[1] ? null : s.wins[0] > s.wins[1] ? 0 : 1;
  }
  s.ready = [false, false];
  r.deadline = null;
  r.nextAt = s.done ? null : now + NEXT_GAME_MS;
}

/** A player is out of the series (left, or gone too long): the game in progress and the series go to the other. */
function forfeit(r: RoomData, gone: PlayerId, now: number): void {
  const s = r.series;
  if (s.done || !r.state) return;
  const winner = (1 - gone) as PlayerId;
  if (r.state.phase !== 'over') {
    r.state = { ...r.state, phase: 'over', result: { winner, reason: `${r.seats[gone]!.player.name} left the match` } };
    settle(r, now);
  }
  s.done = true;
  s.winner = winner;
  s.forfeit = gone;
  s.ready = [false, false];
  r.deadline = null;
  r.nextAt = null;
}

/** A player joins (or rejoins with their token). The first game starts when both seats are filled. */
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
  if (r.seats[0] && r.seats[1]) startGame(r, now, rand);
  return { seat: free as PlayerId, reply: { t: 'joined', seat: free as PlayerId, token, code: r.code }, broadcast: true };
}

/** A player's move: theirs to make, and legal, or it is refused. */
export function act(r: RoomData, seat: PlayerId, action: Action, now: number): Outcome {
  if (!r.state) return { reply: { t: 'error', message: 'The match has not started.' } };
  if (r.state.phase === 'over') return { reply: { t: 'error', message: 'The game is over.' } };
  if (!action || typeof action !== 'object' || action.player !== seat) return { reply: { t: 'error', message: 'Not your move.' } };
  const next = reduce(r.state, action);
  if (next.lastError) return { reply: { t: 'error', message: next.lastError } };
  r.state = next;
  r.deadline = next.phase === 'over' ? null : now + DECISION_MS;
  settle(r, now);
  return { broadcast: true };
}

/** Ready for the next game (between games), or for a rematch (after the series). Both ready: it starts. */
export function ready(r: RoomData, seat: PlayerId, now: number, rand: () => number): Outcome {
  if (!r.state || r.state.phase !== 'over') return { reply: { t: 'error', message: 'The game is still on.' } };
  if (r.seats[1 - seat]?.left) return { reply: { t: 'error', message: 'Your opponent left the room.' } };
  r.series.ready[seat] = true;
  if (r.series.ready[0] && r.series.ready[1]) startGame(r, now, rand);
  return { broadcast: true };
}

/** A player leaves on purpose: they forfeit the series if it's still on, and the other is told straight away. */
export function leave(r: RoomData, seat: PlayerId, now: number): Outcome {
  const s = r.seats[seat];
  if (!s) return {};
  // Before the first game the seat simply frees up for someone else.
  if (!r.state) {
    r.seats[seat] = null;
    return { broadcast: true };
  }
  s.left = true;
  s.goneAt = now;
  forfeit(r, seat, now);
  r.series.ready = [false, false];
  return { broadcast: true };
}

/** A quick reaction, passed straight to both players (nothing stored, at most one every few seconds). */
export function emote(r: RoomData, seat: PlayerId, id: EmoteId, now: number): Outcome {
  if (!EMOTES.includes(id)) return {};
  const last = (r.lastEmote ??= [-EMOTE_GAP_MS, -EMOTE_GAP_MS]);
  if (now - last[seat] < EMOTE_GAP_MS) return {};
  last[seat] = now;
  return { relay: { t: 'emote', seat, id } };
}

export function disconnected(r: RoomData, seat: PlayerId, now: number): void {
  const s = r.seats[seat];
  if (s) s.goneAt = now;
}

/**
 * Time passes (the room's alarm): a player who left long ago forfeits; a decision that ran out gets the
 * timeout move (the same one the offline turn timer makes); between games, the next one starts once the wait
 * is up. Returns whether anything changed.
 */
export function tick(r: RoomData, now: number, rand: () => number = Math.random): boolean {
  if (!r.state || r.series.done) return false;
  const gone = r.seats.findIndex((s) => s && s.goneAt !== null && now - s.goneAt >= ABANDON_MS);
  if (gone >= 0) {
    forfeit(r, gone as PlayerId, now);
    return true;
  }
  if (r.state.phase === 'over') {
    if (r.nextAt !== null && now >= r.nextAt) {
      startGame(r, now, rand);
      return true;
    }
    return false;
  }
  if (r.deadline !== null && now >= r.deadline) {
    let s = r.state;
    for (const p of pendingPlayers(s)) {
      const n = reduce(s, timeoutAction(s, p));
      if (!n.lastError) s = n;
    }
    r.state = s;
    r.deadline = s.phase === 'over' ? null : now + DECISION_MS;
    settle(r, now);
    return true;
  }
  return false;
}

/** When the room next needs to wake: the decision deadline, the next game's start, or a dropped player's forfeit time. */
export function nextWake(r: RoomData): number | null {
  const forfeits = r.series.done ? [] : r.seats.map((s) => (s && s.goneAt !== null ? s.goneAt + ABANDON_MS : null));
  const times = [r.deadline, r.nextAt, ...forfeits].filter((t): t is number => t !== null);
  return times.length ? Math.min(...times) : null;
}

/** Rooms stored before series existed get one, so a deploy doesn't break a game in progress. */
export function upgrade(r: RoomData): RoomData {
  r.series ??= freshSeries(1);
  r.nextAt ??= null;
  return r;
}
