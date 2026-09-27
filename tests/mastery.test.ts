import { describe, expect, it } from 'vitest';
import { FACTION_ACHIEVEMENTS, FACTION_IDS, masteryCard, masteryDone, newlyUnlockedMastery, unlockedMastery } from '../src/ui/achievements';
import type { MatchRecord } from '../src/ui/storage';

const rec = (over: Partial<MatchRecord['me']>, result: MatchRecord['result'] = 'win'): MatchRecord => ({
  at: 0,
  result,
  reason: '',
  rounds: 7,
  me: { faction: 'predator', worldFaction: 'corrosion', chip: 'acidFang', evolution: null, loadout: [], dealt: 20, taken: 20, blocked: 0, rejections: 0, maxStrain: 5, vented: 0, hpLeft: 5, stances: [], ...over },
  opp: { faction: 'bastion', worldFaction: 'aegis', chip: 'ironclad', evolution: null, hpLeft: 0 },
});

describe('Faction achievements', () => {
  it('gives every Build and World Faction five, each with a Mastery card to unlock', () => {
    for (const f of FACTION_IDS) {
      expect(FACTION_ACHIEVEMENTS.filter((a) => a.faction === f), f).toHaveLength(5);
      expect(masteryCard(f)?.mastery, f).toBe(true);
    }
  });

  it('counts only matches played as that faction', () => {
    const asBastion = Array.from({ length: 10 }, () => rec({ faction: 'bastion' }));
    const wins = FACTION_ACHIEVEMENTS.find((a) => a.id === 'predator.wins')!;
    expect(wins.progress(asBastion)).toEqual([0, 10]);
    expect(wins.progress(asBastion.map((r) => ({ ...r, me: { ...r.me, faction: 'predator' as const } })))).toEqual([10, 10]);
  });

  it('unlocks the Mastery card only when all five are done, and reports it once', () => {
    const worlds = ['corrosion', 'aegis', 'miasma', 'hollow'] as const;
    // 30 wins as Predator: 3 in each form, 5 with 45+ damage, spread across every World Faction.
    const thirty = Array.from({ length: 30 }, (_, i) => rec({ worldFaction: worlds[i % 4], evolution: i < 3 ? 'apexStalker' : i < 6 ? 'frenzyForm' : null, dealt: i >= 25 ? 55 : 20 }));
    expect(masteryDone(thirty.slice(0, 29), 'predator')).toBe(false);
    const all = thirty;
    expect(masteryDone(all, 'predator')).toBe(true);
    expect(unlockedMastery(all).has('pred_alpha_carnifex')).toBe(true);
    expect(newlyUnlockedMastery(all).map((c) => c.id)).toEqual(['pred_alpha_carnifex']);
    expect(newlyUnlockedMastery([...all, rec({})])).toEqual([]);
  });

  it('World Factions need a win with each of their Chips', () => {
    const chips = FACTION_ACHIEVEMENTS.find((a) => a.id === 'corrosion.chips')!;
    expect(chips.progress([rec({ chip: 'acidFang' })])).toEqual([1, 9]);
    expect(chips.progress(Array.from({ length: 5 }, () => rec({ chip: 'acidFang' })))[0]).toBe(3); // capped at 3 per Chip
    expect(chips.progress([rec({ chip: 'acidFang' }, 'loss')])[0]).toBe(0);
  });
});

describe('Miasma and Hollow feats', () => {
  it('Suffocation needs a win with 2+ Numbs and 2+ Fevers inflicted', () => {
    const feat = FACTION_ACHIEVEMENTS.find((a) => a.id === 'miasma.feat')!;
    const m = (numb: number, fever: number, result: MatchRecord['result'] = 'win') => rec({ worldFaction: 'miasma', numbDealt: numb, feverDealt: fever }, result);
    expect(feat.progress([m(2, 2), m(1, 5), m(2, 2, 'loss')])).toEqual([1, 8]);
  });
  it('Emptied Vessel needs a win with 5+ Energy drained and a necrosed slot', () => {
    const feat = FACTION_ACHIEVEMENTS.find((a) => a.id === 'hollow.feat')!;
    const h = (drained: number, necrosis: number) => rec({ worldFaction: 'hollow', energyDrained: drained, necrosisDealt: necrosis });
    expect(feat.progress([h(5, 1), h(9, 0), h(4, 1)])).toEqual([1, 5]);
  });
});
