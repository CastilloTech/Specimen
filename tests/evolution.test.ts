import { describe, expect, it } from 'vitest';
import { botAction, computeStats, evoEffects, evolutionProgress, findNode, makeRng, metricValue, overclockBonus, pendingPlayers } from '../src/engine';
import { arena, attached, edit, endRound, go, hands, nextRound, pass, pickStances, play, rawStrain, setEnergy, setStrain, tryGo, withNodes } from './kit';

const stats = (s: ReturnType<typeof arena>, p: 0 | 1, fn: (st: (typeof s.players)[0]['stats']) => void) =>
  edit(s, (d) => {
    fn(d.players[p].stats);
  });

describe('Evolution: general rules', () => {
  it('shows progress toward every condition, for both players', () => {
    let s = arena('predator', 'bastion');
    s = stats(s, 0, (st) => void (st.damageDealt = 5));
    s = rawStrain(s, 0, 4);
    s = stats(s, 1, (st) => void (st.strainVented = 2));
    const p0 = evolutionProgress(s, 0);
    expect(p0.map((p) => [p.id, p.current, p.target, p.met])).toEqual([
      ['apexStalker', 5, 12, false],
      ['frenzyForm', 4, 9, false],
    ]);
    const p1 = evolutionProgress(s, 1);
    expect(p1.map((p) => [p.id, p.current, p.target])).toEqual([
      ['carapace', 2, 6],
      ['juggernaut', 0, 10],
    ]);
  });

  it('happens once per match', () => {
    let s = arena('predator', 'predator');
    s = stats(s, 0, (st) => void (st.damageDealt = 11));
    s = endRound(s);
    expect(s.players[0].evolution).toBe('apexStalker');
    s = rawStrain(s, 0, 9);
    s = nextRound(s);
    expect(s.players[0].evolution).toBe('apexStalker'); // Frenzy's condition is met, but it is too late
    // 2, not 4: the condition-met announcement and the evolve announcement, once each (Frenzy never announces: already evolved).
    expect(s.log.filter((l) => l.kind === 'evolve' && /P1/.test(l.text))).toHaveLength(2);
  });

  it('lets the player choose when both conditions are met in the same check', () => {
    let s = arena('predator', 'predator');
    s = stats(s, 0, (st) => void (st.damageDealt = 11));
    s = rawStrain(s, 0, 9);
    s = endRound(s);
    expect(s.phase).toBe('evolve');
    expect(pendingPlayers(s)).toEqual([0]);
    expect(s.players[0].evolution).toBeNull();
    expect(tryGo(s, { type: 'CHOOSE_EVOLUTION', player: 0, id: 'hiveHost' })).toMatch(/valid/);
    expect(tryGo(s, { type: 'CHOOSE_EVOLUTION', player: 1, id: 'frenzyForm' })).toMatch(/Not your/);
    s = go(s, { type: 'CHOOSE_EVOLUTION', player: 0, id: 'frenzyForm' });
    expect(s.players[0].evolution).toBe('frenzyForm');
    expect(s.phase).toBe('stance'); // the round continues
    expect(s.round).toBe(2);
  });
});

describe('Declining an evolution', () => {
  it('a single met condition still offers a choice: evolve, or hold off', () => {
    let s = arena('predator', 'predator');
    s = stats(s, 0, (st) => void (st.damageDealt = 11));
    s = pass(s);
    s = pass(s);
    expect(s.phase).toBe('evolve');
    expect(s.players[0].evolutionOptions).toEqual(['apexStalker']);
    expect(s.players[0].evolution).toBeNull();
  });

  it('holding off leaves the Specimen unevolved and the round continues normally', () => {
    let s = arena('predator', 'predator');
    s = stats(s, 0, (st) => void (st.damageDealt = 11));
    s = pass(s);
    s = pass(s); // does not auto-accept: only the kit's endActions() convenience wrapper does that
    s = go(s, { type: 'CHOOSE_EVOLUTION', player: 0, id: null });
    expect(s.players[0].evolution).toBeNull();
    expect(s.log.some((l) => /holds off/.test(l.text))).toBe(true);
    expect(s.phase).toBe('stance'); // the round still finished
    expect(s.round).toBe(2);
  });

  it('is offered again next round if the condition is still met, and can be accepted later', () => {
    let s = arena('predator', 'predator');
    s = stats(s, 0, (st) => void (st.damageDealt = 11));
    s = pass(s);
    s = pass(s);
    s = go(s, { type: 'CHOOSE_EVOLUTION', player: 0, id: null });
    s = pickStances(s, 'aggress', 'aggress');
    s = pass(s);
    s = pass(s); // damageDealt is cumulative and still >= target: offered again
    expect(s.phase).toBe('evolve');
    expect(s.players[0].evolutionOptions).toEqual(['apexStalker']);
    s = go(s, { type: 'CHOOSE_EVOLUTION', player: 0, id: 'apexStalker' });
    expect(s.players[0].evolution).toBe('apexStalker');
  });

  it('cannot decline on the other player\'s behalf, and cannot decline outside the evolve phase', () => {
    let s = arena('predator', 'predator');
    s = stats(s, 0, (st) => void (st.damageDealt = 11));
    s = pass(s);
    s = pass(s);
    expect(tryGo(s, { type: 'CHOOSE_EVOLUTION', player: 1, id: null })).toMatch(/Not your/);
    s = go(s, { type: 'CHOOSE_EVOLUTION', player: 0, id: null });
    expect(tryGo(s, { type: 'CHOOSE_EVOLUTION', player: 0, id: null })).toMatch(/Not your/);
  });

  it('the bot always accepts and never declines', () => {
    let s = arena('predator', 'predator');
    s = stats(s, 0, (st) => void (st.damageDealt = 11));
    s = edit(s, (d) => void (d.players[0].isBot = true));
    s = pass(s);
    s = pass(s);
    expect(s.phase).toBe('evolve');
    const a = botAction(s, 0, makeRng(1));
    expect(a).toMatchObject({ type: 'CHOOSE_EVOLUTION', id: 'apexStalker' });
  });
});

describe('Predator evolutions', () => {
  it('Apex Stalker: 12+ total damage -> +2 attack and ignores Fortify\'s damage halving', () => {
    let s = arena('predator', 'predator');
    s = stats(s, 0, (st) => void (st.damageDealt = 11));
    s = endRound(s); // deals 2 more: 13
    expect(s.players[0].evolution).toBe('apexStalker');
    expect(computeStats(s, s.players[0]).attack).toBe(4);
    s = nextRound(s, 'aggress', 'fortify');
    expect(s.players[1].hp).toBe(30 - 2 - 4); // not halved
    expect(s.players[0].hp).toBe(30 - 2 - 2 - 1); // P2 still hits and still counters
  });

  it('does not trigger below 12 damage', () => {
    let s = arena('predator', 'predator');
    s = stats(s, 0, (st) => void (st.damageDealt = 9));
    s = endRound(s);
    expect(s.players[0].evolution).toBeNull();
  });

  it('Frenzy Form: ending a round at 9+ Strain with no rejection -> Overclocked bonus becomes +2', () => {
    let s = arena('predator', 'predator');
    s = rawStrain(s, 0, 9);
    expect(overclockBonus(s, s.players[0])).toBe(1);
    s = endRound(s);
    expect(s.players[0].evolution).toBe('frenzyForm');
    expect(overclockBonus(s, s.players[0])).toBe(2);
  });

  it('Frenzy Form does not trigger on a round that had a rejection', () => {
    let s = arena('predator', 'predator');
    s = attached(s, 0, 't_pred_razor_talon', 'limbA'); // strain 3
    s = rawStrain(s, 0, 12); // rejects -> 9, but that round had a rejection
    s = endRound(s);
    expect(s.players[0].strain).toBe(9);
    expect(s.players[0].evolution).toBeNull();
  });
});

describe('Parasite evolutions', () => {
  it('Hive Host: when the opponent rejects, evolve; afterwards heal 3 on every opponent rejection', () => {
    let s = arena('parasite', 'predator');
    s = attached(s, 1, 't_bast_lung_filter', 'organ'); // strain 1, 0 attack
    s = attached(s, 1, 't_bast_scale_patch', 'limbA'); // strain 0, 0 attack
    s = rawStrain(s, 1, 12);
    s = endRound(s);
    expect(s.players[0].evolution).toBe('hiveHost');
    expect(s.players[1].grafts.map((g) => g.cardId)).toEqual(['t_bast_scale_patch']);
    const hp = s.players[0].hp;
    s = rawStrain(s, 1, 12);
    s = nextRound(s);
    expect(s.players[1].stats.rejectionsSuffered).toBe(2);
    expect(s.players[0].hp).toBe(hp - 2 + 3); // clash damage 2, heal 3
  });

  it('Leech Form: opponent reaches 8+ Strain -> your Toxins also drain 1 HP', () => {
    let s = arena('parasite', 'predator');
    s = setStrain(s, 1, 8);
    s = endRound(s);
    expect(s.players[0].evolution).toBe('leechForm');
    s = hands(s, ['t_para_neurotoxin'], []);
    s = setEnergy(s, 0, 2);
    const hp = s.players[1].hp;
    s = go(s, { type: 'PICK_STANCE', player: 0, stance: 'aggress' });
    s = go(s, { type: 'PICK_STANCE', player: 1, stance: 'aggress' });
    s = go(s, { type: 'PASS', player: s.turn }); // tie: P2 acted second last round, so P2 acts first
    s = play(s, 0, 't_para_neurotoxin');
    expect(s.players[1].hp).toBe(hp - 1);
    expect(s.players[1].strain).toBe(11);
  });

  it('a non-evolved Parasite\'s Toxins do not drain HP', () => {
    let s = arena('parasite', 'predator');
    s = setEnergy(hands(s, ['t_para_neurotoxin'], []), 0, 2);
    s = play(s, 0, 't_para_neurotoxin');
    expect(s.players[1].hp).toBe(30);
  });
});

describe('Bastion evolutions', () => {
  it('Carapace: vent 6 total Strain -> +3 armor, and Fortify vents 3 instead of 2', () => {
    let s = arena('bastion', 'predator', ['fortify', 'fortify']);
    s = stats(s, 0, (st) => void (st.strainVented = 5));
    s = rawStrain(s, 0, 3);
    s = endRound(s); // Fortify vents 2 -> total 7
    expect(s.players[0].evolution).toBe('carapace');
    expect(computeStats(s, s.players[0]).armor).toBe(3);
    s = rawStrain(s, 0, 5);
    s = nextRound(s, 'fortify', 'fortify');
    expect(s.players[0].strain).toBe(2); // vented 3
  });

  it('Juggernaut: block 10 total damage -> armor adds to attack', () => {
    let s = arena('bastion', 'predator');
    s = attached(s, 0, 't_bast_scale_patch', 'limbA'); // armor 1
    s = stats(s, 0, (st) => void (st.damageBlocked = 9));
    s = endRound(s); // the opponent's 2 attack is reduced by 1 armor: blocked 10
    expect(s.players[0].stats.damageBlocked).toBe(10);
    expect(s.players[0].evolution).toBe('juggernaut');
    expect(computeStats(s, s.players[0])).toEqual({ attack: 3, armor: 1 });
  });

  it('counts damage prevented by Fortify toward Juggernaut', () => {
    let s = arena('bastion', 'predator', ['fortify', 'aggress']);
    s = attached(s, 1, 't_pred_bone_spur', 'limbA'); // P2 attack 6, halved to 3: prevents 3
    s = endRound(s);
    expect(s.players[0].stats.damageBlocked).toBe(3);
  });
});

describe('Evolution row nodes', () => {
  // The multipliers are node parameters (trees.json), so these tests read them live. The evolution
  // conditions themselves are pinned to the original spec numbers (12 damage / 9 Strain) by the test kit.
  const mult = (id: string) => Number(findNode(id)!.params.conditionMult);
  const scaled = (base: number, m: number) => Math.max(1, Math.ceil(base * m - 1e-9));

  const hairTriggered = (v: number) => {
    const { bonusDelta, bonusFloor } = findNode('hairTrigger')!.params as Record<string, number>;
    return Math.max(v + bonusDelta, Math.min(v, bonusFloor ?? 1));
  };

  it('Hair Trigger: conditions scaled (rounded up), evolved numeric bonuses reduced', () => {
    const m = mult('hairTrigger');
    const apex = scaled(12, m);
    let s = withNodes(arena('predator', 'predator'), 0, ['hairTrigger']);
    expect(evolutionProgress(s, 0).map((p) => p.target)).toEqual([apex, scaled(9, m)]);
    s = stats(s, 0, (st) => void (st.damageDealt = apex - 2 - 1)); // one short after this round's 2 damage
    s = endRound(s);
    expect(s.players[0].evolution).toBeNull();
    s = stats(s, 0, (st) => void (st.damageDealt = apex - 2));
    s = nextRound(s); // reaches exactly the target
    expect(s.players[0].evolution).toBe('apexStalker');
    expect(computeStats(s, s.players[0]).attack).toBe(2 + hairTriggered(2)); // Apex +2, reduced (but not below the floor)
  });

  it('Late Bloomer: conditions scaled (rounded up), evolved numeric bonuses increased', () => {
    const m = mult('lateBloomer');
    const apex = scaled(12, m);
    let s = withNodes(arena('predator', 'predator'), 0, ['lateBloomer']);
    expect(evolutionProgress(s, 0).map((p) => p.target)).toEqual([apex, scaled(9, m)]);
    s = stats(s, 0, (st) => void (st.damageDealt = apex - 3)); // 2 more this round: still one short
    s = endRound(s);
    expect(s.players[0].evolution).toBeNull();
    s = stats(s, 0, (st) => void (st.damageDealt = apex - 2));
    s = nextRound(s);
    expect(s.players[0].evolution).toBe('apexStalker');
    expect(computeStats(s, s.players[0]).attack).toBe(2 + (2 + Number(findNode('lateBloomer')!.params.bonusDelta)));
  });

  it('Hair Trigger reduces bonuses by its delta but never below its floor (small bonuses stay as they are)', () => {
    const effects = (evo: string, faction: 'predator' | 'parasite' | 'bastion', nodes: string[]) => {
      let s = withNodes(arena(faction, 'predator'), 0, nodes);
      s = edit(s, (d) => void (d.players[0].evolution = evo));
      return evoEffects(s, s.players[0]);
    };
    expect(effects('leechForm', 'parasite', [])).toMatchObject({ toxinDrain: 1 });
    expect(effects('leechForm', 'parasite', ['hairTrigger'])).toMatchObject({ toxinDrain: hairTriggered(1) }); // a +1 stays +1
    expect(effects('carapace', 'bastion', ['hairTrigger'])).toMatchObject({ armor: hairTriggered(3), fortifyVent: hairTriggered(3) });
    expect(hairTriggered(0)).toBe(0);
    expect(effects('carapace', 'bastion', ['lateBloomer'])).toMatchObject({ armor: 4, fortifyVent: 4 }); // +1
  });

  it('Juggernaut adds armor to attack, up to armorToAttackCap when one is set', () => {
    const board = (cap?: number) => {
      let s = arena('bastion', 'predator');
      s = attached(s, 0, 't_bast_shell_limb', 'limbA'); // attack 1, armor 5
      s = edit(s, (d) => {
        d.players[0].evolution = 'juggernaut';
        if (cap !== undefined) (d.config.evolutions.bastion[1].effects as unknown as Record<string, number | boolean>).armorToAttackCap = cap;
      });
      return computeStats(s, s.players[0]);
    };
    expect(board()).toEqual({ attack: 2 + 1 + 5, armor: 5 }); // uncapped
    expect(board(3)).toEqual({ attack: 2 + 1 + 3, armor: 5 }); // capped at +3
    expect(board(9)).toEqual({ attack: 2 + 1 + 5, armor: 5 }); // cap above the armor: no effect
  });

  it('Surge: evolving lowers your Strain to `setTo`', () => {
    const setTo = findNode('surge')!.params.setTo as number;
    let s = withNodes(arena('predator', 'predator'), 0, ['surge']);
    s = rawStrain(s, 0, 9);
    s = endRound(s);
    expect(s.players[0].evolution).toBe('frenzyForm');
    expect(s.players[0].strain).toBe(setTo);
  });

  it("the 'round' metric reads the current round number", () => {
    const s = edit(arena('predator', 'predator'), (d) => void (d.round = 5));
    expect(metricValue(s, s.players[0], 'round')).toBe(5);
  });
});
