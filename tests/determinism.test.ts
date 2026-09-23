import { describe, expect, it } from 'vitest';
import { chipRows, chipsFor, createMatch, makeRng, playBotMatch, reduce, replay, starterDeck, WORLD_FACTIONS } from '../src/engine';
import type { Faction, MatchSetup, WorldFactionId } from '../src/engine';
import { baseMatch, pickStances, start } from './kit';

function setup(seed: number, f0: Faction = 'predator', f1: Faction = 'bastion', w0: WorldFactionId = 'corrosion', w1: WorldFactionId = 'aegis'): MatchSetup {
  const rng = makeRng(seed);
  const load = (wf: WorldFactionId) => {
    const chip = rng.pick(chipsFor(wf)).id;
    return { chip, loadout: chipRows(chip).map((r) => rng.pick(r.nodes).id) };
  };
  const p0 = load(w0);
  const p1 = load(w1);
  return {
    seed,
    players: [
      { name: 'A', faction: f0, worldFaction: w0, chip: p0.chip, deck: starterDeck(f0, w0), loadout: p0.loadout, isBot: true },
      { name: 'B', faction: f1, worldFaction: w1, chip: p1.chip, deck: starterDeck(f1, w1), loadout: p1.loadout, isBot: true },
    ],
  };
}

describe('Seeded RNG and replays', () => {
  it('the same seed gives an identical match', () => {
    const a = playBotMatch(setup(42));
    const b = playBotMatch(setup(42));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a recorded action list replays the exact same match', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const cfg = setup(seed, 'parasite', 'predator');
      const played = playBotMatch(cfg);
      const again = replay(cfg, played.history);
      expect(JSON.stringify(again)).toBe(JSON.stringify(played));
    }
  });

  it('different seeds give different matches', () => {
    expect(playBotMatch(setup(1)).log.map((l) => l.text).join()).not.toBe(playBotMatch(setup(2)).log.map((l) => l.text).join());
  });

  it('the shuffle depends on the seed', () => {
    const order = (seed: number) => createMatch(setup(seed)).players[0].hand.map((c) => c.cardId).join();
    expect(order(1)).toBe(order(1));
    expect(order(1)).not.toBe(order(2));
  });

  it('reduce never mutates the state it is given', () => {
    let s = start(baseMatch());
    const before = JSON.stringify(s);
    reduce(s, { type: 'PICK_STANCE', player: 0, stance: 'adapt' });
    reduce(s, { type: 'PASS', player: 0 }); // illegal: still must not mutate
    expect(JSON.stringify(s)).toBe(before);
    s = pickStances(s, 'adapt', 'aggress');
    expect(s.round).toBe(1);
  });

  it('illegal actions leave the game unchanged and report an error', () => {
    const s = start(baseMatch());
    const n = reduce(s, { type: 'PASS', player: 0 });
    expect(n.lastError).toBeTruthy();
    expect({ ...n, lastError: null }).toEqual({ ...s, lastError: null });
  });

  it('bot-vs-bot matches always finish with a result', () => {
    for (let seed = 100; seed < 130; seed++) {
      const f = (['predator', 'parasite', 'bastion'] as Faction[])[seed % 3];
      const g = (['predator', 'parasite', 'bastion'] as Faction[])[(seed >> 1) % 3];
      const w = WORLD_FACTIONS[(seed >> 2) % WORLD_FACTIONS.length];
      const x = WORLD_FACTIONS[(seed >> 3) % WORLD_FACTIONS.length];
      const s = playBotMatch(setup(seed, f, g, w, x));
      expect(s.phase).toBe('over');
      expect(s.result).toBeTruthy();
      expect(s.round).toBeLessThanOrEqual(8);
    }
  });
});
