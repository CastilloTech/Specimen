// One or more tests per skill-tree node.
import { describe, expect, it } from 'vitest';
import { computeStats, findNode, overclockBonus, pendingPlayers, zoneOf } from '../src/engine';
import type { Faction } from '../src/engine';

/** A numeric parameter of a skill node, read live so retuning trees.json cannot break these rule tests. */
const np = (id: string, key: string): number => {
  const v = findNode(id)!.params[key];
  return typeof v === 'number' ? v : 0;
};
import { attached, baseMatch, edit, endRound, go, hands, nextRound, pass, pickStances, play, playErr, rawStrain, setEnergy, setHp, start, withNodes } from './kit';

/** Round-1 actions-phase arena where P1 (index 0) has the given nodes. */
const withNode = (f0: Faction, ids: string[], f1: Faction = 'predator', stances: ['aggress' | 'adapt' | 'fortify', 'aggress' | 'adapt' | 'fortify'] = ['aggress', 'aggress']) => {
  const base = start(baseMatch(f0, f1));
  const s = withNodes(base, 0, ids);
  return hands(pickStancesFrom(s, stances));
};
const pickStancesFrom = (s: ReturnType<typeof baseMatch>, st: ['aggress' | 'adapt' | 'fortify', 'aggress' | 'adapt' | 'fortify']) =>
  pickStances(
    edit(s, (d) => void (d.lastInitiative = 1)),
    st[0],
    st[1],
  );

describe('Predator: Grafts row', () => {
  it('Serrated Limbs: Limb grafts +1 attack', () => {
    let s = withNode('predator', ['serratedLimbs']);
    s = attached(s, 0, 't_pred_bone_spur', 'limbA');
    s = attached(s, 0, 't_pred_twitch_nerve', 'nerve');
    expect(computeStats(s, s.players[0]).attack).toBe(2 + 4 + 1 + 1); // only the Limb graft gets +1
  });

  // The discount starts at fromRound, so the tests play in that round.
  const adrenal = () => edit(withNode('predator', ['adrenalGland']), (d) => void (d.round = Math.max(1, np('adrenalGland', 'fromRound'))));

  it('Adrenal Gland: does nothing before its fromRound', () => {
    const from = np('adrenalGland', 'fromRound');
    if (from <= 1) return;
    const s = setEnergy(hands(edit(withNode('predator', ['adrenalGland']), (d) => void (d.round = from - 1)), ['t_pred_furnace_heart']), 0, 2);
    expect(playErr(s, 0, 't_pred_furnace_heart', { slot: 'organ' })).toMatch(/Energy/); // full price 3
  });

  it('Adrenal Gland: the first graft each round costs `discount` less, but never below `floor`', () => {
    const disc = np('adrenalGland', 'discount');
    const floor = np('adrenalGland', 'floor');
    const cases: [string, 'limbA' | 'organ', number][] = [['t_pred_bone_spur', 'limbA', 1], ['t_pred_razor_talon', 'limbA', 2], ['t_pred_furnace_heart', 'organ', 3]];
    for (const [id, slot, cost] of cases) {
      const expected = Math.max(cost - disc, Math.min(cost, floor));
      expect(expected, id).toBeLessThanOrEqual(cost);
      let s = setEnergy(hands(adrenal(), [id]), 0, expected);
      s = play(s, 0, id, { slot });
      expect(s.players[0].energy, id).toBe(0);
      if (expected > 0) expect(playErr(setEnergy(hands(adrenal(), [id]), 0, expected - 1), 0, id, { slot }), id).toMatch(/Energy/);
    }
  });

  it('Adrenal Gland: only the FIRST graft of the round is discounted', () => {
    const cost = 3; // Furnace Heart
    const first = Math.max(cost - np('adrenalGland', 'discount'), Math.min(cost, np('adrenalGland', 'floor')));
    let s = setEnergy(hands(adrenal(), ['t_pred_furnace_heart', 't_pred_maw_crown']), 0, 20);
    s = play(s, 0, 't_pred_furnace_heart', { slot: 'organ' });
    expect(s.players[0].energy).toBe(20 - first);
    s = pass(s, 1);
    s = play(s, 0, 't_pred_maw_crown', { slot: 'head' }); // Maw Crown costs 3 at full price
    expect(s.players[0].energy).toBe(20 - first - 3);
  });

  it('Stripped Frame: -1 slot, grafts add less Strain (minimum 0), plus its flat attack', () => {
    const removed = findNode('strippedFrame')!.params.removeSlot as string;
    const less = np('strippedFrame', 'strainReduction');
    let s = withNode('predator', ['strippedFrame']);
    expect(s.players[0].slots).toEqual(s.config.slots.filter((x) => x !== removed));
    expect(computeStats(s, s.players[0]).attack).toBe(2 + np('strippedFrame', 'attack'));
    // the removed slot cannot be used
    const slotType = s.config.slotTypes[removed as 'nerve'];
    const cardForRemoved = slotType === 'Nerve' ? 't_pred_twitch_nerve' : slotType === 'Organ' ? 't_pred_furnace_heart' : 't_pred_bone_spur';
    expect(playErr(setEnergy(hands(s, [cardForRemoved]), 0, 6), 0, cardForRemoved, { slot: removed as 'nerve' })).toBeTruthy();
    // Strain reduction
    s = setEnergy(hands(s, ['t_pred_razor_talon', 't_pred_twitch_nerve']), 0, 6);
    s = play(s, 0, 't_pred_razor_talon', { slot: 'limbA' });
    expect(s.players[0].strain).toBe(Math.max(0, 3 - less)); // Razor Talon has 3 Strain
  });
});

describe('Predator: Strain row', () => {
  it('Pain Tolerance: Overclock self-damage only on even rounds', () => {
    let s = rawStrain(withNode('predator', ['painTolerance']), 0, 7);
    s = endRound(s); // round 1 (odd): no self-damage
    expect(s.players[0].hp).toBe(28);
    s = nextRound(s); // round 2 (even): self-damage
    expect(s.players[0].hp).toBe(28 - 2 - 1);
  });

  it('Burnout: when you reject a graft, deal 3 damage to the opponent', () => {
    let s = withNode('predator', ['burnout']);
    s = attached(s, 0, 't_bast_lung_filter', 'organ'); // 0 attack, so the Clash stays at 2 damage
    s = rawStrain(s, 0, 11);
    s = endRound(s);
    expect(s.players[1].hp).toBe(30 - 2 - 3);
  });

  it('Redline: Overclocked starts at 7 and the bonus is +1 more', () => {
    let s = withNode('predator', ['redline']);
    expect(zoneOf(rawStrain(s, 0, 6), rawStrain(s, 0, 6).players[0])).toBe('stable');
    s = rawStrain(s, 0, 7);
    expect(zoneOf(s, s.players[0])).toBe('overclocked');
    expect(overclockBonus(s, s.players[0])).toBe(2);
    s = endRound(s);
    expect(s.players[1].hp).toBe(30 - 2 - 2);
  });
});

describe('Predator: Stance row', () => {
  it('Pounce: winning with Aggress adds Strain to the opponent', () => {
    const s = withNode('predator', ['pounce'], 'predator', ['aggress', 'adapt']);
    expect(s.players[1].strain).toBe(np('pounce', 'strain'));
  });

  it('Pounce does nothing on a tie or when winning with another stance', () => {
    expect(withNode('predator', ['pounce']).players[1].strain).toBe(0);
    expect(withNode('predator', ['pounce'], 'predator', ['adapt', 'fortify']).players[1].strain).toBe(0);
  });

  it('Bloodlust: Aggress ties deal +1 damage', () => {
    let s = withNode('predator', ['bloodlust']);
    s = endRound(s);
    expect(s.players[1].hp).toBe(27);
    expect(s.players[0].hp).toBe(28);
  });

  it('Feint: once per match, re-pick your stance after a tie; the opponent keeps theirs', () => {
    let s = withNodes(start(baseMatch()), 0, ['feint']);
    s = edit(s, (d) => void (d.lastInitiative = 1));
    s = pickStances(s, 'aggress', 'aggress');
    expect(s.phase).toBe('feint');
    expect(pendingPlayers(s)).toEqual([0]);
    s = go(s, { type: 'FEINT', player: 0, stance: 'fortify' });
    expect(s.phase).toBe('actions');
    expect(s.players[0].stance).toBe('fortify');
    expect(s.players[1].stance).toBe('aggress'); // kept
    expect(s.stanceResult?.winner).toBe(0); // Fortify beats Aggress
    expect(s.players[0].feintUsed).toBe(true);
    expect(s.players[0].strain).toBe(np('feint', 'strain')); // the price of the free stance win
    expect(s.players[0].hp).toBe(30 - np('feint', 'damage'));
    expect(s.players[1].strain).toBe(0);
    s = hands(endRound(hands(s)));
    s = pickStances(s, 'adapt', 'adapt'); // tie again: Feint is spent
    expect(s.phase).toBe('actions');
  });

  it('Feint can be declined and is then still available', () => {
    let s = withNodes(start(baseMatch()), 0, ['feint']);
    s = pickStances(s, 'adapt', 'adapt');
    s = go(s, { type: 'FEINT', player: 0, stance: null });
    expect(s.phase).toBe('actions');
    expect(s.players[0].feintUsed).toBe(false);
    expect(s.players[0].strain).toBe(0); // declining costs nothing
    expect(s.players[0].hp).toBe(30);
  });
});

describe('Parasite: Grafts row', () => {
  it('Spore Sacs: Organ grafts add 1 Strain to the opponent on attach', () => {
    let s = setEnergy(hands(withNode('parasite', ['sporeSacs'], 'predator'), ['t_para_gland_of_rot', 't_para_hooked_limb']), 0, 5);
    s = play(s, 0, 't_para_gland_of_rot', { slot: 'organ' });
    expect(s.players[1].strain).toBe(1);
    s = pass(s, 1);
    s = play(s, 0, 't_para_hooked_limb', { slot: 'limbA' });
    expect(s.players[1].strain).toBe(1); // non-Organ: nothing
  });

  it('Symbiote: your first graft each match adds a fixed, lower Strain', () => {
    let s = setEnergy(hands(withNode('parasite', ['symbiote']), ['t_pred_bone_spur', 't_pred_razor_talon']), 0, 6);
    const first = np('symbiote', 'firstGraftStrain');
    s = play(s, 0, 't_pred_bone_spur', { slot: 'limbA' });
    expect(s.players[0].strain).toBe(first);
    s = pass(s, 1);
    s = play(s, 0, 't_pred_razor_talon', { slot: 'limbB' });
    expect(s.players[0].strain).toBe(first + 3);
  });

  it('Incubator: Toxins cost 1 less if you grafted this round', () => {
    let s = setEnergy(hands(withNode('parasite', ['incubator']), ['t_pred_twitch_nerve', 't_para_neurotoxin']), 0, 1);
    expect(playErr(s, 0, 't_para_neurotoxin')).toMatch(/Energy/); // full price 2
    s = play(s, 0, 't_pred_twitch_nerve', { slot: 'nerve' }); // free graft
    s = pass(s, 1);
    s = play(s, 0, 't_para_neurotoxin'); // now costs 1
    expect(s.players[0].energy).toBe(0);
    expect(s.players[1].strain).toBe(3);
  });
});

describe('Parasite: Strain row', () => {
  it('Contagion: the opponent vents 1 less in the Draw phase', () => {
    let s = rawStrain(withNode('parasite', ['contagion']), 1, 4);
    s = pass(s);
    s = pass(s); // nobody grafts
    expect(s.players[1].strain).toBe(4); // would be 3
    expect(s.players[0].strain).toBe(0);
  });

  it('Feedback: when you reject a graft, the opponent gains 2 Strain', () => {
    let s = withNode('parasite', ['feedback']);
    s = attached(s, 0, 't_para_hooked_limb', 'limbA');
    s = rawStrain(s, 0, 11);
    s = endRound(s);
    expect(s.players[1].strain).toBe(2);
  });

  it('Dormancy: your Stable zone extends to 6', () => {
    const s = rawStrain(withNode('parasite', ['dormancy']), 0, 6);
    expect(zoneOf(s, s.players[0])).toBe('stable');
    const t = rawStrain(s, 0, 7);
    expect(zoneOf(t, t.players[0])).toBe('overclocked');
  });
});

describe('Parasite: Stance row', () => {
  it('Latch: winning with Adapt adds 1 Strain to the opponent', () => {
    const s = withNode('parasite', ['latch'], 'predator', ['adapt', 'fortify']);
    expect(s.players[1].strain).toBe(1);
  });

  it('Mirror: a stance tie draws only on every `period`-th round', () => {
    const period = Math.max(1, np('mirror', 'period'));
    const tie = (round: number) => {
      let s = withNodes(start(baseMatch('parasite', 'predator')), 0, ['mirror']);
      s = edit(s, (d) => void (d.round = round));
      const before = s.players[0].hand.length;
      s = pickStances(s, 'adapt', 'adapt');
      return [s.players[0].hand.length - before, s.players[1].hand.length - before];
    };
    expect(tie(period)).toEqual([np('mirror', 'draw'), 0]);
    if (period > 1) expect(tie(period + 1)).toEqual([0, 0]); // off-period rounds draw nothing
  });

  it('Siphon: a successful Fortify block heals 1', () => {
    let s = setHp(withNode('parasite', ['siphon'], 'predator', ['fortify', 'aggress']), 0, 25);
    s = endRound(s);
    expect(s.players[0].hp).toBe(25 - 1 + 1); // the opponent's attack of 2 is halved to 1, then Siphon heals 1
  });
});

describe('Bastion: Grafts row', () => {
  it('Plated Hide: +1 armor per Organ graft', () => {
    let s = withNode('bastion', ['platedHide']);
    s = attached(s, 0, 't_bast_lung_filter', 'organ');
    expect(computeStats(s, s.players[0]).armor).toBe(1);
    s = attached(s, 0, 't_bast_bone_helm', 'head'); // not an Organ graft: helm's own 3 armor only
    expect(computeStats(s, s.players[0]).armor).toBe(4);
  });

  it('Fortress Frame: +1 Organ B slot, a flat armor bonus, and Organ grafts cost more', () => {
    const more = np('fortressFrame', 'costIncrease');
    let s = withNode('bastion', ['fortressFrame']);
    expect(s.players[0].slots).toContain('organB');
    expect(computeStats(s, s.players[0]).armor).toBe(np('fortressFrame', 'armor'));
    // Organ grafts (Lung Filter costs 2) pay the increase...
    s = hands(s, ['t_bast_lung_filter', 't_bast_lung_filter', 't_pred_bone_spur']);
    s = setEnergy(s, 0, 2 + more - 1);
    if (more > 0) expect(playErr(s, 0, 't_bast_lung_filter', { slot: 'organ' })).toMatch(/Energy/);
    s = setEnergy(s, 0, 20);
    s = play(s, 0, 't_bast_lung_filter', { slot: 'organ' });
    expect(s.players[0].energy).toBe(20 - (2 + more));
    s = pass(s, 1);
    s = play(s, 0, 't_bast_lung_filter', { slot: 'organB' });
    expect(s.players[0].grafts.map((g) => g.slot)).toEqual(['organ', 'organB']);
    s = pass(s, 1);
    // ...but a Limb graft (Bone Spur costs 1) does not.
    const before = s.players[0].energy;
    s = play(s, 0, 't_pred_bone_spur', { slot: 'limbA' });
    expect(s.players[0].energy).toBe(before - 1);
  });

  it('Regenerator: heals at the Strain check while Stable, on rounds divisible by its period', () => {
    const period = np('regenerator', 'period') || 1;
    const heal = np('regenerator', 'heal');
    for (const round of [1, 2, 3, 4]) {
      let s = edit(setHp(withNode('bastion', ['regenerator']), 0, 20), (d) => void (d.round = round));
      s = endRound(s);
      expect(s.players[0].hp, `round ${round}`).toBe(20 - 2 + (round % period === 0 ? heal : 0));
    }
    // Overclocked: never heals
    let t = edit(setHp(rawStrain(withNode('bastion', ['regenerator']), 0, 8), 0, 20), (d) => void (d.round = period));
    t = endRound(t);
    expect(t.players[0].hp).toBe(20 - 2 - 1);
  });
});

describe('Bastion: Strain row', () => {
  it('Heat Sink: vent extra on rounds you Hold', () => {
    let s = rawStrain(withNode('bastion', ['heatSink']), 0, 4);
    s = go(s, { type: 'HOLD', player: 0 });
    s = endRound(s);
    expect(s.players[0].strain).toBe(4 - (s.config.strain.holdVent + np('heatSink', 'vent'))); // the baseline Hold vent, plus Heat Sink's own
    let t = rawStrain(withNode('bastion', ['heatSink']), 0, 4);
    t = endRound(t); // round 1 is not a `period` round and there is no Hold: no extra venting
    expect(t.players[0].strain).toBe(4);
  });

  it('Heat Sink: also vents a little on every `period`-th round, Hold or not', () => {
    const period = np('heatSink', 'period') || 1;
    let s = edit(rawStrain(withNode('bastion', ['heatSink']), 0, 6), (d) => void (d.round = period));
    s = endRound(s);
    expect(s.players[0].strain).toBe(6 - np('heatSink', 'ventAlways'));
    if (period > 1) {
      let t = edit(rawStrain(withNode('bastion', ['heatSink']), 0, 6), (d) => void (d.round = period + 1));
      t = endRound(t);
      expect(t.players[0].strain).toBe(6);
    }
  });

  it('Pressure Valve: once per match, vent as a reaction', () => {
    let s = rawStrain(withNode('bastion', ['pressureValve']), 0, 5);
    s = setEnergy(hands(s, [], ['t_pred_twitch_nerve', 't_pred_bone_spur']), 1, 3);
    s = pass(s); // the Bastion passes; P2 acts
    s = play(s, 1, 't_pred_twitch_nerve', { slot: 'nerve' });
    expect(s.window?.reactor).toBe(0);
    s = go(s, { type: 'REACT', player: 0, ability: 'pressureValve' });
    expect(s.players[0].strain).toBe(5 - np('pressureValve', 'vent'));
    expect(s.players[0].valveUsed).toBe(true);
    s = pass(s);
    s = play(s, 1, 't_pred_bone_spur', { slot: 'limbA' });
    expect(s.window).toBeNull(); // used up: no second reaction
  });

  it('Hardened: rejection ejects your lowest-Strain graft instead', () => {
    let s = withNode('bastion', ['hardened']);
    s = attached(s, 0, 't_pred_razor_talon', 'limbA'); // 3
    s = attached(s, 0, 't_pred_bone_spur', 'limbB'); // 2
    s = rawStrain(s, 0, 11);
    s = endRound(s);
    expect(s.players[0].grafts.map((g) => g.cardId)).toEqual(['t_pred_razor_talon']);
  });
});

describe('Bastion: Stance row', () => {
  it('Counterweight: the Fortify counter deals its own damage', () => {
    let s = withNode('bastion', ['counterweight'], 'predator', ['fortify', 'aggress']);
    s = endRound(s);
    expect(s.players[1].hp).toBe(30 - 2 - np('counterweight', 'counter'));
  });

  it('Brace: stance tie gives +2 armor this round', () => {
    let s = withNode('bastion', ['brace']);
    expect(computeStats(s, s.players[0]).armor).toBe(2);
    s = endRound(s);
    expect(s.players[0].hp).toBe(30); // 2 attack - 2 armor
  });

  it('Unshakable: losing to Adapt halves your armor instead of it being ignored', () => {
    const run = (nodes: string[]) => {
      let s = withNode('bastion', nodes, 'predator', ['fortify', 'adapt']);
      s = attached(s, 0, 't_bast_bone_helm', 'head'); // armor 3, attack 1
      s = attached(s, 1, 't_pred_bone_spur', 'limbA'); // P2 attack 6
      return endRound(s);
    };
    expect(run(['unshakable']).players[0].hp).toBe(30 - (6 - 1)); // armor 3 halved to 1
    expect(run(['counterweight']).players[0].hp).toBe(30 - 6); // armor ignored
  });
});
