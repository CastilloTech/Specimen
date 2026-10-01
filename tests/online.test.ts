// Online match rooms (server/room.ts), without a server: seating, moves, what each player may see, time-outs
// and forfeits. The Durable Object only stores this and passes messages.
import { describe, expect, it } from 'vitest';
import { botAction, chipRows, chipsFor, HIDDEN_CARD_ID, makeRng, pendingPlayers, redactFor, starterDeck } from '../src/engine';
import type { GameState, PlayerId } from '../src/engine';
import { ABANDON_MS, act, DECISION_MS, disconnected, join, newRoom, nextWake, tick, viewFor } from '../server/room';
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
  });
});
