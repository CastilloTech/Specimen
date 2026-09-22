import { describe, expect, it } from 'vitest';
import { zoneOf } from '../src/engine';
import { arena, attached, baseMatch, edit, endActions, endRound, hands, nextRound, pass, pickStances, play, rawStrain, setStrain, withNodes } from './kit';

describe('Strain zones (T = 10)', () => {
  it('Stable is 0-5, Overclocked 6-10, Rejection 11+', () => {
    const zone = (n: number) => {
      const t = setStrain(baseMatch(), 0, n);
      return zoneOf(t, t.players[0]);
    };
    for (const n of [0, 3, 5]) expect(zone(n)).toBe('stable');
    for (const n of [6, 8, 10]) expect(zone(n)).toBe('overclocked');
    for (const n of [11, 15]) expect(zone(n)).toBe('rejection');
  });

  it('Stable has no effect: no bonus damage, no self-damage', () => {
    let s = setStrain(arena(), 0, 5);
    s = endRound(s);
    expect(s.players[1].hp).toBe(28); // 2 damage only
    expect(s.players[0].hp).toBe(28);
  });

  it('Overclocked deals +1 damage in Clash and takes 1 self-damage at the Strain check', () => {
    let s = setStrain(arena(), 0, 6);
    s = endRound(s);
    expect(s.players[1].hp).toBe(27); // 2 attack + 1 Overclocked
    expect(s.players[0].hp).toBe(27); // 2 from the opponent, 1 self-damage
  });

  it('the Overclocked bonus is only for the Overclocked player', () => {
    let s = setStrain(arena(), 1, 8);
    s = endRound(s);
    expect(s.players[0].hp).toBe(27);
    expect(s.players[1].hp).toBe(27);
  });
});

describe('Rejection', () => {
  it('ejects the graft with the highest Strain and removes its Strain', () => {
    let s = arena();
    s = attached(s, 0, 't_pred_bone_spur', 'limbA'); // strain 2
    s = attached(s, 0, 't_pred_razor_talon', 'limbB'); // strain 3
    s = setStrain(s, 0, 11);
    s = endRound(s);
    expect(s.players[0].grafts.map((g) => g.cardId)).toEqual(['t_pred_bone_spur']);
    expect(s.players[0].strain).toBe(8); // 11 - 3
    expect(s.players[0].discard.map((c) => c.cardId)).toContain('t_pred_razor_talon');
    expect(s.players[0].stats.rejectionsSuffered).toBe(1);
  });

  it('breaks ties by ejecting the most recently attached graft', () => {
    let s = arena();
    s = attached(s, 0, 't_pred_bone_spur', 'limbA'); // strain 2, older
    s = attached(s, 0, 't_pred_predator_eye', 'head'); // strain 2, newer
    s = setStrain(s, 0, 11);
    s = endRound(s);
    expect(s.players[0].grafts.map((g) => g.cardId)).toEqual(['t_pred_bone_spur']);
  });

  it('ejects only one graft per Strain check', () => {
    let s = arena();
    s = attached(s, 0, 't_pred_razor_talon', 'limbA');
    s = attached(s, 0, 't_pred_razor_talon', 'limbB');
    s = attached(s, 0, 't_pred_maw_crown', 'head');
    s = setStrain(s, 0, 30);
    s = endRound(s);
    expect(s.players[0].grafts).toHaveLength(2);
    expect(s.players[0].strain).toBe(27);
  });

  it('happens at 11+ but not at exactly 10', () => {
    let s = arena();
    s = attached(s, 0, 't_pred_bone_spur', 'limbA');
    s = setStrain(s, 0, 10);
    s = endRound(s);
    expect(s.players[0].grafts).toHaveLength(1);
  });

  it('with no graft to eject nothing is removed, but the rejection still counts', () => {
    let s = setStrain(arena(), 0, 12);
    s = endRound(s);
    expect(s.players[0].strain).toBe(12); // no graft, so no Strain is removed
    expect(s.players[0].grafts).toHaveLength(0);
    expect(s.players[0].stats.rejectionsSuffered).toBe(1); // it still counts (evolution conditions, stats)
    expect(s.log.some((l) => l.kind === 'reject' && /no graft to eject/.test(l.text))).toBe(true);
  });

  it('an empty rejection triggers no graft-based effects (Burnout needs a graft to eject)', () => {
    let s = withNodes(arena(), 0, ['burnout']);
    s = setStrain(s, 0, 12);
    s = endRound(s);
    expect(s.players[1].hp).toBe(28); // only the ordinary Clash damage, no Burnout
  });
});

describe('Venting', () => {
  it('vents 1 in the Draw phase if you attached no graft last round', () => {
    let s = hands(arena(), [], ['t_pred_twitch_nerve']);
    s = setStrain(s, 0, 4);
    s = setStrain(s, 1, 4);
    s = pass(s); // P1 (first to act) passes
    s = play(s, 1, 't_pred_twitch_nerve', { slot: 'nerve' }); // P2 grafts (0 Strain)
    s = pass(s);
    s = pass(s);
    expect(s.round).toBe(2);
    expect(s.players[0].strain).toBe(3); // no graft -> vented 1
    expect(s.players[1].strain).toBe(4); // grafted -> no venting
  });

  it('Fortify vents 2 extra at the Strain check', () => {
    let s = arena('predator', 'predator', ['fortify', 'fortify']);
    s = setStrain(s, 0, 4);
    s = endRound(s);
    expect(s.players[0].strain).toBe(2);
  });

  it('Strain cannot go below 0', () => {
    let s = arena('predator', 'predator', ['fortify', 'fortify']);
    s = setStrain(s, 0, 1);
    s = endRound(s);
    expect(s.players[0].strain).toBe(0);
    expect(s.players[0].stats.strainVented).toBe(1); // only what was actually removed
  });

  it('venting happens every round you skip grafting', () => {
    let s = setStrain(arena(), 0, 5);
    s = endActions(s); // nobody grafted
    expect(s.players[0].strain).toBe(4);
    s = pickStances(s, 'aggress', 'aggress');
    s = endActions(s);
    expect(s.players[0].strain).toBe(3);
  });
});

describe('Meltdown (rounds 7-8)', () => {
  it('both players gain +2 Strain in the Draw phase of rounds 7 and 8, not before', () => {
    let s = arena();
    s = edit(s, (d) => void (d.round = 5));
    s = endRound(s); // -> round 6
    expect(s.round).toBe(6);
    expect(s.players.map((p) => p.strain)).toEqual([0, 0]);
    s = nextRound(s); // -> round 7
    expect(s.round).toBe(7);
    expect(s.players.map((p) => p.strain)).toEqual([2, 2]);
    s = nextRound(s); // -> round 8
    expect(s.round).toBe(8);
    expect(s.players.map((p) => p.strain)).toEqual([4, 4]);
  });
});

describe('Strain check order: Overclock damage, Fortify venting, rejection, evolution', () => {
  it('Overclock self-damage comes before Fortify venting', () => {
    // Strain 6 is Overclocked; Fortify then vents it to 4 (Stable). Self-damage still applies.
    let s = arena('predator', 'predator', ['fortify', 'fortify']);
    s = setStrain(s, 0, 6);
    s = endRound(s);
    expect(s.players[0].hp).toBe(27); // 2 clash + 1 self-damage
    expect(s.players[0].strain).toBe(4);
  });

  it('Fortify venting comes before rejection', () => {
    // Strain 12 with Fortify: vent 2 -> 10, so no rejection happens.
    let s = arena('predator', 'predator', ['fortify', 'fortify']);
    s = attached(s, 0, 't_pred_bone_spur', 'limbA');
    s = setStrain(s, 0, 12);
    s = endRound(s);
    expect(s.players[0].grafts).toHaveLength(1);
    expect(s.players[0].strain).toBe(10);
    expect(s.players[0].hp).toBe(28); // in Rejection at check start: no Overclock damage
  });

  it('rejection comes before evolution triggers (same check)', () => {
    let s = arena('parasite', 'predator');
    s = attached(s, 1, 't_pred_razor_talon', 'limbA');
    s = rawStrain(s, 1, 12);
    s = endRound(s);
    expect(s.players[1].stats.rejectionsSuffered).toBe(1);
    expect(s.players[0].evolution).toBe('hiveHost');
  });
});

