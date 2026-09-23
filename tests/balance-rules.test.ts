// Rules added by the balance passes: Energy floor, late / catch-up / second-mover draws, KO tiebreak,
// graft replacement, and the evolution description helpers the UI uses. The test kit switches all of
// these off, so each test turns on exactly the one it covers.
import { describe, expect, it } from 'vitest';
import { ambushText, CARDS, defaultConfig, evolutionBoosts, FACTIONS } from '../src/engine';
import { arena, attached, baseMatch, edit, endRound, go, hands, nextRound, play, playErr, setEnergy, setHp, setStrain, start, toActions, withNodes } from './kit';

describe('Energy floor', () => {
  it('lifts round 1 to the floor and leaves later rounds on the normal curve', () => {
    let s = toActions(baseMatch('predator', 'predator', { energy: { min: 2 } }));
    expect(s.players[0].energy).toBe(2);
    s = endRound(hands(s));
    expect(s.round).toBe(2);
    expect(s.players[0].energy).toBe(2); // the curve gives 2 here anyway
    s = nextRound(hands(s));
    expect(s.round).toBe(3);
    expect(s.players[0].energy).toBe(3);
  });

  it('energyRampBonus fires only on the round the floor stops naturally binding (no plateau into the next round)', () => {
    let s = toActions(baseMatch('predator', 'predator', { energy: { min: 2 }, match: { energyRampBonus: 1 } }));
    expect(s.players[0].energy).toBe(2); // round 1: floored, no ramp yet (round !== min)
    s = endRound(hands(s));
    expect(s.round).toBe(2);
    expect(s.players[0].energy).toBe(3); // round 2 === energy.min: +1 ramp, so it no longer ties round 1
    s = nextRound(hands(s));
    expect(s.round).toBe(3);
    expect(s.players[0].energy).toBe(3); // round 3: the curve's own value, no ramp (round !== min)
  });
});

describe('Extra draws', () => {
  it('late draw: from the chosen round every player draws extra each round', () => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], { match: { lateDraw: 1, lateDrawFromRound: 2 } });
    s = endRound(s); // into round 2
    expect(s.round).toBe(2);
    expect(s.players[0].hand).toHaveLength(2); // hands were emptied by arena(): one normal draw plus one late draw
    expect(s.players[1].hand).toHaveLength(2);
  });

  it('second wind: only the Specimen that is far behind on HP draws extra', () => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], { match: { catchUpDraw: 1, catchUpHpGap: 5 } });
    s = setHp(s, 0, 20); // P1 is 10 behind
    s = endRound(s);
    expect(s.players[0].hand).toHaveLength(2);
    expect(s.players[1].hand).toHaveLength(1);
    expect(s.log.some((l) => /Second wind/.test(l.text))).toBe(true);
  });

  it('second wind does not fire when the gap is small', () => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], { match: { catchUpDraw: 1, catchUpHpGap: 8 } });
    s = setHp(s, 0, 27);
    s = endRound(s);
    expect(s.players[0].hand).toHaveLength(1);
  });

  it('second wind: catchUpEnergy gives the trailing Specimen extra Energy too', () => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], { match: { catchUpDraw: 0, catchUpEnergy: 2, catchUpHpGap: 5 } });
    s = setHp(s, 0, 20); // P1 is 10 behind
    s = endRound(s); // both players get the same round's base Energy; only P1 (trailing) also gets the catch-up
    expect(s.players[0].energy).toBe(s.players[1].energy + 2);
    expect(s.log.some((l) => /Second wind/.test(l.text) && /Energy/.test(l.text))).toBe(true);
  });

  it('second mover draw and Energy: whoever acts second in round 1 gets a small head start', () => {
    const s = toActions(baseMatch('predator', 'predator', { match: { secondMoverDraw: 1, secondMoverEnergy: 1 } }), ['aggress', 'aggress'], 0);
    const second = s.turn === 0 ? 1 : 0;
    expect(s.players[second].hand.length).toBe(s.players[s.turn].hand.length + 1);
    expect(s.players[second].energy).toBe(s.players[s.turn].energy + 1);
  });
});

describe('Hand limit', () => {
  const seven = Array.from({ length: 7 }, () => 't_filler');

  it('a card drawn into a full hand is burned: discarded face-up and logged', () => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], { match: { maxHand: 7 } });
    s = hands(s, seven, []);
    const discardBefore = s.players[0].discard.length;
    s = endRound(s); // the next round's draw
    expect(s.players[0].hand).toHaveLength(7);
    expect(s.players[0].discard.length).toBe(discardBefore + 1);
    expect(s.log.some((l) => /hand is full \(7\).*burned/.test(l.text))).toBe(true);
  });

  it('below the limit draws are unaffected', () => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], { match: { maxHand: 7 } });
    s = hands(s, seven.slice(0, 3), []);
    s = endRound(s);
    expect(s.players[0].hand).toHaveLength(4);
    expect(s.log.some((l) => /burned/.test(l.text))).toBe(false);
  });
});

describe('Simultaneous KO tiebreak', () => {
  const bothDie = (config: Parameters<typeof arena>[3], strain: [number, number]) => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], config);
    s = setHp(setHp(s, 0, 1), 1, 1);
    s = setStrain(setStrain(s, 0, strain[0]), 1, strain[1]);
    return endRound(s);
  };

  it('with the tiebreak on, the lower Strain wins', () => {
    const s = bothDie({ match: { koTiebreak: true } }, [1, 3]);
    expect(s.phase).toBe('over');
    expect(s.result?.winner).toBe(0);
    expect(s.result?.reason).toMatch(/lower Strain/);
  });

  it('equal Strain and equal damage is still a draw', () => {
    const s = bothDie({ match: { koTiebreak: true } }, [2, 2]);
    expect(s.result?.winner).toBeNull();
  });

  it('with the tiebreak off it is a draw whatever the Strain', () => {
    const s = bothDie({ match: { koTiebreak: false } }, [1, 3]);
    expect(s.result?.winner).toBeNull();
  });
});

describe('Graft replacement', () => {
  const withOld = (enabled = true) => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], { replace: { enabled, extraCost: 1 } });
    s = attached(s, 0, 't_pred_razor_talon', 'limbA', {}, true); // Strain 3
    return hands(setEnergy(s, 0, 2), ['t_pred_bone_spur']); // cost 1, Strain 2
  };

  it('costs extra Energy and swaps the graft, taking the old graft out with its Strain', () => {
    let s = withOld();
    s = play(s, 0, 't_pred_bone_spur', { slot: 'limbA' });
    expect(s.players[0].grafts.map((g) => g.cardId)).toEqual(['t_pred_bone_spur']);
    expect(s.players[0].energy).toBe(0); // 1 cost + 1 extra
    expect(s.players[0].strain).toBe(2); // 3 - 3 + 2
    expect(s.players[0].discard.map((c) => c.cardId)).toContain('t_pred_razor_talon');
    expect(s.log.some((l) => /replaces Razor Talon/.test(l.text))).toBe(true);
  });

  it('needs the extra Energy', () => {
    const s = setEnergy(withOld(), 0, 1);
    expect(playErr(s, 0, 't_pred_bone_spur', { slot: 'limbA' })).toMatch(/Replacing a graft costs 1 more/);
  });

  it('an empty slot costs no extra', () => {
    let s = setEnergy(hands(arena('predator', 'predator', ['aggress', 'aggress'], { replace: { enabled: true, extraCost: 1 } }), ['t_pred_bone_spur']), 0, 1);
    s = play(s, 0, 't_pred_bone_spur', { slot: 'limbB' });
    expect(s.players[0].energy).toBe(0);
  });

  it('is refused when the rule is off', () => {
    expect(playErr(withOld(false), 0, 't_pred_bone_spur', { slot: 'limbA' })).toMatch(/occupied/);
  });
});

describe('Evolution descriptions (what the banners show)', () => {
  const player = (nodes: string[], faction: 'predator' | 'bastion' | 'parasite' = 'predator') => {
    const s = withNodes(start(baseMatch(faction, 'predator')), 0, nodes);
    return { s, p: s.players[0] };
  };

  it('lists every boost of a form, in words', () => {
    const { s, p } = player([]);
    expect(evolutionBoosts(s, p, 'apexStalker')).toEqual(['+2 attack', "Your attacks ignore Fortify's damage halving"]);
  });

  it('describes a boolean effect and a capped one', () => {
    const { s, p } = player([], 'bastion');
    expect(evolutionBoosts(s, p, 'juggernaut')).toEqual(['Your armor adds to your attack']);
  });

  it('is fixed per Build: no chip node changes the numbers shown', () => {
    const plain = player([]);
    const withSomeChip = player(['t_flat', 't_dmg', 't_kill']);
    expect(evolutionBoosts(withSomeChip.s, withSomeChip.p, 'apexStalker')).toEqual(evolutionBoosts(plain.s, plain.p, 'apexStalker'));
  });
});

describe('Ambush is per faction', () => {
  const woken = (faction: 'parasite' | 'bastion', hp = 30) => {
    let s = arena(faction, 'predator', ['aggress', 'aggress'], {
      dormant: { ambush: { parasite: { attack: 1, oppStrain: 2 }, bastion: { attack: 0, armor: 3, heal: 2 } } },
    });
    s = setHp(s, 0, hp);
    s = attached(s, 0, 't_pred_bone_spur', 'limbA', { faceDown: true, dormantStrain: 0, sleptSince: 0, strain: 2 });
    s = edit(s, (d) => void (d.round = 2)); // it has slept through a round
    return go(s, { type: 'REVEAL', player: 0, slot: 'limbA' });
  };

  it('Parasite: a little attack, and the opponent gains Strain', () => {
    const s = woken('parasite');
    expect(s.players[0].tempAttack).toBe(1);
    expect(s.players[1].strain).toBe(2);
    expect(s.log.some((l) => /AMBUSH/.test(l.text) && /gains 2 Strain/.test(l.text))).toBe(true);
  });

  it('Bastion: armor and healing instead of attack', () => {
    const s = woken('bastion', 20);
    expect(s.players[0].tempAttack).toBe(0);
    expect(s.players[0].tempArmor).toBe(3);
    expect(s.players[0].hp).toBe(22);
  });

  it('describes each faction\'s Ambush in words', () => {
    expect(ambushText(defaultConfig, 'predator')).toMatch(/attack/);
    expect(ambushText(defaultConfig, 'bastion')).toMatch(/armor/);
    expect(ambushText(defaultConfig, 'parasite')).toMatch(/Strain/);
  });
});

describe('Signature cards', () => {
  it('each Build has exactly one and it costs at most 4, so it can be cast (and replace a graft) well before the cap', () => {
    for (const f of FACTIONS) {
      const sigs = CARDS.filter((c) => c.faction === f && c.signature);
      expect(sigs, f).toHaveLength(1);
      expect(sigs[0].cost, sigs[0].id).toBeLessThanOrEqual(4);
    }
  });
});