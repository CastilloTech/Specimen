import { describe, expect, it } from 'vitest';
import { adjacent, chipsFor, computeStats, createMatch, FACTIONS, starterDeck, validateChipChoice, validateDeck, validateLoadout, WORLD_FACTIONS } from '../src/engine';
import type { SlotId, WorldFactionId } from '../src/engine';
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

  it('refuses to create a match with an invalid deck, chip choice, or loadout', () => {
    const predChip = chipsFor('corrosion')[0].id;
    const bastChip = chipsFor('aegis')[0].id;
    const predDeck = starterDeck('predator', 'corrosion');
    const bastDeck = starterDeck('bastion', 'aegis');

    // a 24-card deck
    expect(() =>
      createMatch({
        seed: 1,
        players: [
          { name: 'a', faction: 'predator', worldFaction: 'corrosion', chip: predChip, deck: predDeck.slice(0, 24), loadout: defaultLoadout(predChip) },
          { name: 'b', faction: 'bastion', worldFaction: 'aegis', chip: bastChip, deck: bastDeck, loadout: defaultLoadout(bastChip) },
        ],
      }),
    ).toThrow(/exactly 25/);

    // an empty loadout
    expect(() =>
      createMatch({
        seed: 1,
        players: [
          { name: 'a', faction: 'predator', worldFaction: 'corrosion', chip: predChip, deck: predDeck, loadout: [] },
          { name: 'b', faction: 'bastion', worldFaction: 'aegis', chip: bastChip, deck: bastDeck, loadout: defaultLoadout(bastChip) },
        ],
      }),
    ).toThrow(/Loadout/);

    // a chip from a different World Faction than the one chosen
    expect(() =>
      createMatch({
        seed: 1,
        players: [
          { name: 'a', faction: 'predator', worldFaction: 'aegis', chip: predChip, deck: predDeck, loadout: defaultLoadout(predChip) },
          { name: 'b', faction: 'bastion', worldFaction: 'aegis', chip: bastChip, deck: bastDeck, loadout: defaultLoadout(bastChip) },
        ],
      }),
    ).toThrow(/different World Faction/);
  });
});

describe('Deck rules', () => {
  const wf: WorldFactionId = 'corrosion';
  const pred = starterDeck('predator', wf);
  const swap = (from: string, to: string) => {
    const i = pred.indexOf(from);
    const d = [...pred];
    d[i] = to;
    return d;
  };

  it('every Build x World Faction pairing ships a valid default starter deck', () => {
    for (const f of FACTIONS) for (const w of WORLD_FACTIONS) expect(validateDeck(f, w, starterDeck(f, w))).toEqual([]);
  });

  it('requires exactly 25 cards', () => {
    expect(validateDeck('predator', wf, pred.slice(0, 24)).join()).toMatch(/exactly 25/);
    expect(validateDeck('predator', wf, [...pred, 'tech_bleed']).join()).toMatch(/exactly 25/);
  });

  it('allows at most 2 copies of a standard card', () => {
    expect(validateDeck('predator', wf, [...pred.slice(0, 24), 'pred_bone_spur']).join()).toMatch(/Bone Spur: at most 2/);
  });

  it('allows only 1 copy of a Signature card', () => {
    expect(validateDeck('predator', wf, [...pred.slice(0, 24), 'pred_apex_maw']).join()).toMatch(/Apex Maw: at most 1/);
  });

  it('allows at most 5 tech cards and needs at least 12 build cards', () => {
    const errs = validateDeck('predator', wf, swap('pred_bile_spit', 'tech_stim')).join();
    expect(errs).toMatch(/At most 5 tech/);
    expect(errs).toMatch(/at least 12 predator/);
  });

  it('needs at least 8 World Faction cards', () => {
    const errs = validateDeck('predator', wf, swap('cor_matriarch', 'pred_bone_spur')).join();
    expect(errs).toMatch(/at least 8 corrosion/);
  });

  it('rejects cards from another Build or World Faction', () => {
    expect(validateDeck('predator', wf, swap('pred_bile_spit', 'para_symbiotic_node')).join()).toMatch(/belongs to parasite/);
  });

  it('rejects unknown cards', () => {
    expect(validateDeck('predator', wf, swap('pred_bile_spit', 'nope')).join()).toMatch(/Unknown card/);
  });
});

describe('Chip choice and loadout rules', () => {
  it('every World Faction offers exactly 3 chips, each with 3 rows of 2 nodes', () => {
    for (const w of WORLD_FACTIONS) {
      const chips = chipsFor(w);
      expect(chips).toHaveLength(3);
      for (const c of chips) {
        expect(c.tree).toHaveLength(3);
        for (const row of c.tree) expect(row.nodes).toHaveLength(2);
      }
    }
  });

  it('rejects a chip that belongs to a different World Faction', () => {
    const aegisChip = chipsFor('aegis')[0].id;
    expect(validateChipChoice('corrosion', aegisChip).join()).toMatch(/different World Faction/);
    expect(validateChipChoice('aegis', aegisChip)).toEqual([]);
  });

  it('accepts exactly one node per row, for every chip', () => {
    for (const w of WORLD_FACTIONS) for (const c of chipsFor(w)) expect(validateLoadout(c.id, defaultLoadout(c.id))).toEqual([]);
  });

  it('rejects two nodes in one row, a missing row, and a node from another chip', () => {
    const chip = chipsFor('corrosion')[0];
    const [rowA, rowB, rowC] = chip.tree;
    expect(validateLoadout(chip.id, [rowA.nodes[0].id, rowA.nodes[1].id, rowB.nodes[0].id, rowC.nodes[0].id]).join()).toMatch(new RegExp(`only one node in the ${rowA.name}`));
    expect(validateLoadout(chip.id, [rowA.nodes[0].id, rowB.nodes[0].id]).join()).toMatch(new RegExp(`Pick a node in the ${rowC.name}`));
    expect(validateLoadout(chip.id, [rowA.nodes[0].id, rowB.nodes[0].id, 'not_on_this_chip']).join()).toMatch(/is not on this chip/);
  });
});
