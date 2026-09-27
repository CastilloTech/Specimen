import { describe, expect, it } from 'vitest';
import { ALL_COMBOS, comboReport } from '../src/ui/comboGuide';
import { matchRecord } from '../src/ui/stats';
import type { MatchRecord } from '../src/ui/storage';
import { arena, attached, endRound, hands, play, setEnergy, setHp, setStrain } from './kit';

describe('Match records: cards', () => {
  it('records the deck you brought and how each card fared', () => {
    let s = setHp(setEnergy(hands(arena(), ['t_tech_dressing']), 0, 3), 0, 20);
    s = play(s, 0, 't_tech_dressing');
    s = attached(s, 0, 't_pred_bone_spur', 'limbA', {}, true);
    s = setStrain(s, 0, s.config.strain.threshold + 2);
    s = endRound(s); // Bone Spur is rejected
    const rec = matchRecord(s, 0);
    expect(rec.me.cards?.t_tech_dressing).toMatchObject({ played: 1 });
    expect(rec.me.cards?.t_pred_bone_spur).toMatchObject({ rejected: 1 });
    expect(rec.me.deck).toContain('t_tech_dressing');
  });
});

const rec = (result: MatchRecord['result'], cards: Record<string, number>, deck: string[], over: Partial<MatchRecord['me']> = {}): MatchRecord => ({
  at: 0,
  result,
  reason: '',
  rounds: 7,
  me: {
    faction: 'predator',
    worldFaction: 'corrosion',
    chip: 'x',
    evolution: null,
    loadout: [],
    dealt: 0,
    taken: 0,
    blocked: 0,
    rejections: 0,
    maxStrain: 0,
    vented: 0,
    hpLeft: 0,
    stances: [],
    deck,
    cards: Object.fromEntries(Object.entries(cards).map(([id, played]) => [id, { played }])),
    ...over,
  },
  opp: { faction: 'bastion', worldFaction: 'aegis', chip: 'y', evolution: null, hpLeft: 0 },
});

describe('Combo guide report', () => {
  const combo = ALL_COMBOS.find((c) => c.key === 'predator/corrosion')!;
  const deck = ['pred_bone_spur', 'pred_razor_talon', 'cor_shard_claw'];
  // Razor Talon is played in every win; Shard Claw never gets played.
  const games: MatchRecord[] = [
    rec('win', { pred_razor_talon: 2, pred_bone_spur: 1 }, deck),
    rec('win', { pred_razor_talon: 1 }, deck),
    rec('win', { pred_razor_talon: 1, pred_bone_spur: 1 }, deck),
    rec('loss', { pred_bone_spur: 2 }, deck),
    rec('loss', { pred_bone_spur: 1 }, deck),
    rec('loss', { pred_bone_spur: 1 }, deck),
  ];

  it('only counts matches played with that combo', () => {
    expect(comboReport(games, ALL_COMBOS.find((c) => c.key === 'bastion/aegis')!)).toBeNull();
    expect(comboReport(games, combo)!.games).toBe(6);
  });

  it('works out each card: plays, games and win rate when played', () => {
    const r = comboReport(games, combo)!;
    const talon = r.cards.find((c) => c.id === 'pred_razor_talon')!;
    expect(talon).toMatchObject({ played: 4, games: 3, winRate: 1 });
    expect(r.cards.find((c) => c.id === 'pred_bone_spur')!.winRate).toBeCloseTo(0.4);
    expect(r.unplayed).toEqual(['cor_shard_claw']);
  });

  it('turns that into tips about your best card and the ones you never play', () => {
    const tips = comboReport(games, combo)!.tips.join('\n');
    expect(tips).toMatch(/Razor Talon is your best card/);
    expect(tips).toMatch(/Never played.*Shard Claw/);
  });
});
