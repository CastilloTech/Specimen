import { describe, expect, it } from 'vitest';
import { adjacent, computeStats, createMatch, STARTER_DECKS, validateDeck, validateLoadout, FACTIONS } from '../src/engine';
import type { SlotId } from '../src/engine';
import { baseMatch, defaultLoadout, go, tryGo } from './kit';

describe('Specimen', () => {
  it('starts with 30 HP, attack 2, armor 0 and Strain threshold 10', () => {
    const s = baseMatch();
    for (const p of s.players) {
      expect(p.hp).toBe(30);
      expect(computeStats(s, p)).toEqual({ attack: 2, armor: 0 });
    }
    expect(s.config.strain.threshold).toBe(10);
  });

  it('has five slots: Head, Limb A, Limb B, Organ, Nerve', () => {
    expect(baseMatch().players[0].slots).toEqual(['head', 'limbA', 'limbB', 'organ', 'nerve']);
  });

  it('Nerve is adjacent to every other slot; Limb A and Limb B are adjacent', () => {
    const s = baseMatch();
    for (const slot of ['head', 'limbA', 'limbB', 'organ'] as SlotId[]) expect(adjacent(s, 'nerve', slot)).toBe(true);
    expect(adjacent(s, 'limbA', 'limbB')).toBe(true);
    expect(adjacent(s, 'head', 'limbA')).toBe(false);
    expect(adjacent(s, 'organ', 'limbB')).toBe(false);
    expect(adjacent(s, 'head', 'organ')).toBe(false);
  });
});

describe('Match setup', () => {
  it('deals a 5-card hand from a 25-card deck', () => {
    const s = baseMatch();
    for (const p of s.players) {
      expect(p.hand).toHaveLength(5);
      expect(p.deck).toHaveLength(20);
    }
  });

  it('gives each player one free full-hand mulligan', () => {
    let s = baseMatch();
    const before = s.players[0].hand.map((c) => c.uid).sort();
    s = go(s, { type: 'MULLIGAN', player: 0, mulligan: true });
    const after = s.players[0].hand.map((c) => c.uid).sort();
    expect(after).toHaveLength(5);
    expect(s.players[0].deck).toHaveLength(20);
    expect(after).not.toEqual(before);
    expect(s.players[0].mulliganUsed).toBe(true);
    expect(tryGo(s, { type: 'MULLIGAN', player: 0, mulligan: true })).toMatch(/Already/); // only once
    expect(s.phase).toBe('mulligan'); // waits for the other player
    s = go(s, { type: 'MULLIGAN', player: 1, mulligan: false });
    expect(s.phase).toBe('stance');
    expect(s.round).toBe(1);
  });

  it('starts Round 1 with Energy 1 and draws 1 card', () => {
    const s = go(go(baseMatch(), { type: 'MULLIGAN', player: 0, mulligan: false }), { type: 'MULLIGAN', player: 1, mulligan: false });
    expect(s.players[0].energy).toBe(1);
    expect(s.players[0].hand).toHaveLength(6);
  });

  it('refuses to create a match with an invalid deck or loadout', () => {
    const bad = STARTER_DECKS.predator.slice(0, 24);
    expect(() =>
      createMatch({ seed: 1, players: [{ name: 'a', faction: 'predator', deck: bad, loadout: defaultLoadout('predator') }, { name: 'b', faction: 'bastion', deck: STARTER_DECKS.bastion, loadout: defaultLoadout('bastion') }] }),
    ).toThrow(/exactly 25/);
    expect(() =>
      createMatch({ seed: 1, players: [{ name: 'a', faction: 'predator', deck: STARTER_DECKS.predator, loadout: [] }, { name: 'b', faction: 'bastion', deck: STARTER_DECKS.bastion, loadout: defaultLoadout('bastion') }] }),
    ).toThrow(/Loadout/);
  });
});

describe('Deck rules', () => {
  const pred = STARTER_DECKS.predator;
  const swap = (from: string, to: string) => {
    const i = pred.indexOf(from);
    const d = [...pred];
    d[i] = to;
    return d;
  };

  it('every faction ships a valid default starter deck', () => {
    for (const f of FACTIONS) expect(validateDeck(f, STARTER_DECKS[f])).toEqual([]);
  });

  it('requires exactly 25 cards', () => {
    expect(validateDeck('predator', pred.slice(0, 24)).join()).toMatch(/exactly 25/);
    expect(validateDeck('predator', [...pred, 'tech_bleed']).join()).toMatch(/exactly 25/);
  });

  it('allows at most 2 copies of a standard card', () => {
    expect(validateDeck('predator', [...pred.slice(0, 24), 'pred_bone_spur']).join()).toMatch(/Bone Spur: at most 2/);
  });

  it('allows only 1 copy of a Signature card', () => {
    expect(validateDeck('predator', [...pred.slice(0, 24), 'pred_apex_maw']).join()).toMatch(/Apex Maw: at most 1/);
  });

  it('allows at most 5 tech cards and needs at least 20 faction cards', () => {
    const errs = validateDeck('predator', swap('pred_twitch_nerve', 'tech_stim')).join();
    expect(errs).toMatch(/At most 5 tech/);
    expect(errs).toMatch(/at least 20 predator/);
  });

  it('rejects cards from another faction', () => {
    expect(validateDeck('predator', swap('pred_twitch_nerve', 'para_symbiotic_node')).join()).toMatch(/belongs to parasite/);
  });

  it('rejects unknown cards', () => {
    expect(validateDeck('predator', swap('pred_twitch_nerve', 'nope')).join()).toMatch(/Unknown card/);
  });
});

describe('Skill-tree loadout rules', () => {
  it('accepts exactly one node per row', () => {
    for (const f of FACTIONS) expect(validateLoadout(f, defaultLoadout(f))).toEqual([]);
  });

  it('rejects two nodes in one row, a missing row, and nodes from another faction', () => {
    expect(validateLoadout('predator', ['serratedLimbs', 'adrenalGland', 'painTolerance', 'pounce', 'surge']).join()).toMatch(/only one node in the Grafts/);
    expect(validateLoadout('predator', ['serratedLimbs', 'painTolerance', 'pounce']).join()).toMatch(/Evolution/);
    expect(validateLoadout('predator', ['sporeSacs', 'painTolerance', 'pounce', 'surge']).join()).toMatch(/not available/);
  });
});
