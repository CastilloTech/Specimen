// Online match rooms (server/room.ts), without a server: seating, moves, what each player may see, time-outs
// and forfeits. The Durable Object only stores this and passes messages.
import { describe, expect, it } from 'vitest';
import { botAction, chipRows, chipsFor, HIDDEN_CARD_ID, makeRng, pendingPlayers, redactFor, starterDeck } from '../src/engine';
import type { GameState, PlayerId } from '../src/engine';
import { ABANDON_MS, act, DECISION_MS, disconnected, emote, EMOTE_GAP_MS, join, leave, MAX_GAMES, newRoom, NEXT_GAME_MS, nextWake, ready, settle, tick, viewFor } from '../server/room';
import { onlineSummary, rivalLine, seriesRecord } from '../src/ui/multiplayer';
import type { SeriesRecord } from '../src/ui/storage';
import type { RoomData } from '../server/room';

const player = (name: string, f: 'predator' | 'bastion', w: 'corrosion' | 'aegis') => {
  const chip = chipsFor(w)[0].id;
  return { name, faction: f, worldFaction: w, chip, loadout: chipRows(chip).map((r) => r.nodes[0].id), deck: starterDeck(f, w) };
};
let tokens = 0;
const tok = () => `tok${++tokens}`;
const rnd = makeRng(7);

function fullRoom(): RoomData {
  const r = newRoom('ABCDE', 0);
  join(r, { t: 'join', player: player('Ana', 'predator', 'corrosion') }, 0, () => rnd.float(), tok);
  join(r, { t: 'join', player: player('Ben', 'bastion', 'aegis') }, 0, () => rnd.float(), tok);
  return r;
}

describe('Joining a room', () => {
  it('seats two players, then starts the match; a third is turned away', () => {
    const r = newRoom('ABCDE', 0);
    const a = join(r, { t: 'join', player: player('Ana', 'predator', 'corrosion') }, 0, Math.random, tok);
    expect(a.seat).toBe(0);
    expect(r.state).toBeNull();
    expect(viewFor(r, 0)).toEqual({ t: 'waiting', code: 'ABCDE' });
    const b = join(r, { t: 'join', player: player('Ben', 'bastion', 'aegis') }, 0, Math.random, tok);
    expect(b.seat).toBe(1);
    expect(r.state?.phase).toBe('mulligan');
    expect(join(r, { t: 'join', player: player('Cy', 'predator', 'aegis') }, 0, Math.random, tok).reply).toMatchObject({ t: 'error', message: 'This room is full.' });
  });

  it('refuses an illegal deck', () => {
    const r = newRoom('ABCDE', 0);
    const bad = { ...player('Ana', 'predator', 'corrosion'), deck: starterDeck('predator', 'corrosion').slice(0, 10) };
    expect(join(r, { t: 'join', player: bad }, 0, Math.random, tok).reply).toMatchObject({ t: 'error' });
    expect(r.seats).toEqual([null, null]);
  });

  it('a token takes a dropped player back to their seat', () => {
    const r = fullRoom();
    const token = r.seats[1]!.token;
    disconnected(r, 1, 1000);
    expect(viewFor(r, 0)).toMatchObject({ opponentConnected: false });
    const back = join(r, { t: 'join', token }, 2000, Math.random, tok);
    expect(back.seat).toBe(1);
    expect(r.seats[1]!.goneAt).toBeNull();
  });
});

describe('Moves', () => {
  it('only your own legal moves are accepted', () => {
    const r = fullRoom();
    expect(act(r, 0, { type: 'MULLIGAN', player: 1, mulligan: false }, 0).reply).toMatchObject({ t: 'error', message: 'Not your move.' });
    expect(act(r, 0, { type: 'PASS', player: 0 }, 0).reply).toMatchObject({ t: 'error' }); // not the actions phase
    expect(act(r, 0, { type: 'MULLIGAN', player: 0, mulligan: false }, 0).broadcast).toBe(true);
  });

  it('a whole match can be played through the room', () => {
    const r = fullRoom();
    const rngs = [makeRng(1), makeRng(2)];
    for (let i = 0; i < 3000 && r.state!.phase !== 'over'; i++) {
      const p = pendingPlayers(r.state!)[0];
      const out = act(r, p, botAction(r.state!, p, rngs[p]), i);
      expect(out.reply).toBeUndefined();
    }
    expect(r.state!.phase).toBe('over');
    // The end: both see the whole match, with the setup, for their replay.
    expect(viewFor(r, 1)).toMatchObject({ t: 'state', setup: r.setup });
  });
});

describe('What each player may see', () => {
  const hiddenIn = (s: GameState, p: PlayerId) => s.players[p].hand.every((c) => c.cardId === HIDDEN_CARD_ID);
  it("the opponent's hand, both decks' order and the random state are hidden; your hand is not", () => {
    const r = fullRoom();
    const v = redactFor(r.state!, 0);
    expect(hiddenIn(v, 1)).toBe(true);
    expect(hiddenIn(v, 0)).toBe(false);
    expect(v.players[0].hand).toEqual(r.state!.players[0].hand);
    expect(v.players.every((p) => p.deck.every((c) => c.cardId === HIDDEN_CARD_ID))).toBe(true);
    expect(v.players[1].hand.length).toBe(r.state!.players[1].hand.length);
    expect([v.seed, v.rng]).toEqual([0, 0]);
  });

  it("the opponent's stance stays hidden until both are picked", () => {
    const r = fullRoom();
    act(r, 0, { type: 'MULLIGAN', player: 0, mulligan: false }, 0);
    act(r, 1, { type: 'MULLIGAN', player: 1, mulligan: false }, 0);
    expect(r.state!.phase).toBe('stance');
    act(r, 1, { type: 'PICK_STANCE', player: 1, stance: 'fortify' }, 0);
    const v = redactFor(r.state!, 0);
    expect(v.players[1].stance).toBeNull();
    expect(JSON.stringify(v.history)).not.toContain('fortify');
    expect(redactFor(r.state!, 1).players[1].stance).toBe('fortify');
  });

  it("the opponent's face-down graft keeps its secret", () => {
    const r = fullRoom();
    const s = r.state!;
    const g = { uid: 'gx', cardId: 'pred_bone_spur', slot: 'limbA' as const, strain: 1, seq: 1, faceDown: true, poisoned: 0, disabled: 0, roundsSurvived: 0, integrity: 3 };
    const withGraft = { ...s, players: [{ ...s.players[0], grafts: [g] }, s.players[1]] as GameState['players'] };
    expect(redactFor(withGraft, 1).players[0].grafts[0].cardId).toBe(HIDDEN_CARD_ID);
    expect(redactFor(withGraft, 0).players[0].grafts[0].cardId).toBe('pred_bone_spur');
  });
});

describe('Time', () => {
  it('a decision that runs out gets the timeout move', () => {
    const r = fullRoom();
    expect(nextWake(r)).toBe(DECISION_MS);
    expect(tick(r, DECISION_MS - 1)).toBe(false);
    expect(tick(r, DECISION_MS)).toBe(true);
    expect(r.state!.phase).toBe('stance'); // both mulligans were kept for them
  });

  it('a player gone too long forfeits', () => {
    const r = fullRoom();
    disconnected(r, 0, 10);
    expect(nextWake(r)).toBe(Math.min(DECISION_MS, 10 + ABANDON_MS));
    tick(r, 10 + ABANDON_MS);
    expect(r.state!.phase).toBe('over');
    expect(r.state!.result).toMatchObject({ winner: 1, reason: 'Ana left the match' });
    expect(r.series).toMatchObject({ done: true, winner: 1, forfeit: 0 });
  });
});

/** End the current game with this winner (null: a draw), as a finished game would. */
function finish(r: RoomData, winner: PlayerId | null, now = 0) {
  r.state = { ...r.state!, phase: 'over', result: { winner, reason: winner === null ? 'Draw' : 'KO' } };
  r.deadline = null;
  settle(r, now);
}

describe('Best of 3', () => {
  it('each finished game counts once; the next starts when both are ready, with a new deal', () => {
    const r = fullRoom();
    const seed1 = r.setup!.seed;
    finish(r, 0, 100);
    settle(r, 100); // counting twice does nothing
    expect(r.series).toMatchObject({ game: 1, wins: [1, 0], done: false });
    expect(r.series.games).toHaveLength(1);
    expect(nextWake(r)).toBe(100 + NEXT_GAME_MS);
    expect(ready(r, 0, 200, () => 0.5).broadcast).toBe(true);
    expect(r.state!.phase).toBe('over'); // still waiting for Ben
    expect(viewFor(r, 1, 200)).toMatchObject({ series: { ready: [true, false], nextIn: NEXT_GAME_MS - 100 } });
    ready(r, 1, 300, () => 0.25);
    expect(r.state!.phase).toBe('mulligan');
    expect(r.series).toMatchObject({ game: 2, ready: [false, false] });
    expect(r.setup!.seed).not.toBe(seed1);
    expect(r.nextAt).toBeNull();
  });

  it('the next game starts by itself if a player never taps Ready', () => {
    const r = fullRoom();
    finish(r, 1, 0);
    expect(tick(r, NEXT_GAME_MS - 1)).toBe(false);
    expect(tick(r, NEXT_GAME_MS)).toBe(true);
    expect(r.series.game).toBe(2);
    expect(r.state!.phase).toBe('mulligan');
  });

  it('two wins take the series; a rematch starts series 2 in the same room', () => {
    const r = fullRoom();
    finish(r, 0);
    ready(r, 0, 0, Math.random);
    ready(r, 1, 0, Math.random);
    finish(r, 1);
    ready(r, 0, 0, Math.random);
    ready(r, 1, 0, Math.random);
    expect(r.series.game).toBe(3);
    finish(r, 1);
    expect(r.series).toMatchObject({ done: true, winner: 1, wins: [1, 2], forfeit: null });
    expect(nextWake(r)).toBeNull(); // nothing starts by itself after the series
    expect(tick(r, 10 ** 9)).toBe(false);
    ready(r, 1, 0, Math.random);
    expect(r.series.n).toBe(1);
    ready(r, 0, 0, Math.random);
    expect(r.series).toMatchObject({ n: 2, game: 1, wins: [0, 0], games: [], done: false });
    expect(r.state!.phase).toBe('mulligan');
  });

  it('draws count for no one, and the series stops after the game cap', () => {
    const r = fullRoom();
    for (let i = 0; i < MAX_GAMES; i++) {
      finish(r, null);
      if (i < MAX_GAMES - 1) {
        ready(r, 0, 0, Math.random);
        ready(r, 1, 0, Math.random);
      }
    }
    expect(r.series).toMatchObject({ done: true, winner: null, wins: [0, 0] });
    expect(r.series.games).toHaveLength(MAX_GAMES);
  });

  it('leaving mid-series forfeits it at once; no rematch with someone who left', () => {
    const r = fullRoom();
    finish(r, 1);
    ready(r, 0, 0, Math.random);
    ready(r, 1, 0, Math.random);
    leave(r, 1, 50);
    expect(r.state!.result).toMatchObject({ winner: 0, reason: 'Ben left the match' });
    expect(r.series).toMatchObject({ done: true, winner: 0, forfeit: 1, wins: [1, 1] });
    expect(viewFor(r, 0)).toMatchObject({ opponentLeft: true });
    expect(ready(r, 0, 60, Math.random).reply).toMatchObject({ t: 'error' });
  });

  it('leaving before the first game frees the seat', () => {
    const r = newRoom('ABCDE', 0);
    join(r, { t: 'join', player: player('Ana', 'predator', 'corrosion') }, 0, Math.random, tok);
    leave(r, 0, 1);
    expect(r.seats).toEqual([null, null]);
  });

  it('a player away between games forfeits the series too', () => {
    const r = fullRoom();
    finish(r, 0, 0);
    disconnected(r, 0, 0);
    ready(r, 1, 0, Math.random);
    // Ben is ready, Ana is gone: the next game starts on time, and Ana's absence still counts.
    tick(r, NEXT_GAME_MS);
    tick(r, ABANDON_MS);
    expect(r.series).toMatchObject({ done: true, winner: 1, forfeit: 0 });
  });

  it('emotes are relayed, but only known ones and not too often', () => {
    const r = fullRoom();
    expect(emote(r, 0, 'gg', 1000).relay).toEqual({ t: 'emote', seat: 0, id: 'gg' });
    expect(emote(r, 0, 'nice', 1000 + EMOTE_GAP_MS - 1).relay).toBeUndefined();
    expect(emote(r, 1, 'nice', 1001).relay).toBeDefined();
    expect(emote(r, 0, 'nice', 1000 + EMOTE_GAP_MS).relay).toBeDefined();
    expect(emote(r, 0, 'insult' as never, 10 ** 6).relay).toBeUndefined();
  });
});

describe('Multiplayer stats', () => {
  it('a series becomes a record from your side, and the summary adds them up', () => {
    const r = fullRoom();
    finish(r, 1);
    ready(r, 0, 0, Math.random);
    ready(r, 1, 0, Math.random);
    finish(r, 0);
    ready(r, 0, 0, Math.random);
    ready(r, 1, 0, Math.random);
    finish(r, 0);
    const rec = seriesRecord('ABCDE', { ...r.series, bestOf: 3, nextIn: null }, r.state!, 0);
    expect(rec).toMatchObject({ id: 'ABCDE-1', opp: 'Ben', games: ['loss', 'win', 'win'], result: 'win' });
    expect(rec.forfeit).toBeUndefined();
    const other = seriesRecord('ABCDE', { ...r.series, bestOf: 3, nextIn: null }, r.state!, 1);
    expect(other).toMatchObject({ opp: 'Ana', games: ['win', 'loss', 'loss'], result: 'loss' });

    const sweep: SeriesRecord = { ...rec, id: 'X-1', games: ['win', 'win'] };
    const lost: SeriesRecord = { ...rec, id: 'X-2', opp: 'Cy', games: ['loss', 'loss'], result: 'loss' };
    const o = onlineSummary([rec, sweep, lost]);
    expect(o).toMatchObject({ series: 3, won: 2, lost: 1, games: 7, gamesWon: 4, gamesLost: 3, deciders: 1, decidersWon: 1, comebacks: 1, sweeps: 1, streak: -1, bestStreak: 2 });
    expect(o.rivals[0]).toMatchObject({ name: 'Ben', series: 2, won: 2, lost: 0 });
    expect(rivalLine([rec, sweep, lost], 'ben')).toBe('Series vs Ben: 2–0 (you lead)');
    expect(rivalLine([rec], 'Nobody')).toBeNull();
  });

  it('walking out mid-game records a forfeited loss', () => {
    const r = fullRoom();
    finish(r, 0);
    ready(r, 0, 0, Math.random);
    ready(r, 1, 0, Math.random);
    const rec = seriesRecord('ABCDE', { ...r.series, bestOf: 3, nextIn: null }, r.state!, 0, true);
    expect(rec).toMatchObject({ games: ['win', 'loss'], result: 'loss', forfeit: 'me' });
  });
});
