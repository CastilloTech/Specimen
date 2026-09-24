import { describe, expect, it } from 'vitest';
import { computeStats } from '../src/engine';
import type { GameState } from '../src/engine';
import { arena, attached, edit, endRound, go, hands, nextRound, pass, play, playErr, setEnergy, setHp, setStrain, tryGo } from './kit';

describe('Graft cards', () => {
  it('attach to a matching slot, cost Energy and add their Strain', () => {
    let s = hands(arena(), ['t_pred_bone_spur']);
    s = play(s, 0, 't_pred_bone_spur', { slot: 'limbA' });
    const p = s.players[0];
    expect(p.energy).toBe(0);
    expect(p.strain).toBe(2);
    expect(p.hand).toHaveLength(0);
    expect(p.grafts.map((g) => [g.cardId, g.slot, g.strain])).toEqual([['t_pred_bone_spur', 'limbA', 2]]);
    expect(computeStats(s, p).attack).toBe(6);
  });

  it('cannot go in a slot of the wrong type', () => {
    const s = hands(arena(), ['t_pred_bone_spur']);
    expect(playErr(s, 0, 't_pred_bone_spur', { slot: 'head' })).toMatch(/Limb/);
    expect(playErr(s, 0, 't_pred_bone_spur', {})).toMatch(/slot/);
  });

  it('each slot holds only one graft', () => {
    let s = setEnergy(hands(arena(), ['t_pred_bone_spur', 't_pred_bone_spur']), 0, 5);
    s = play(s, 0, 't_pred_bone_spur', { slot: 'limbA' });
    s = pass(s, 1);
    expect(playErr(s, 0, 't_pred_bone_spur', { slot: 'limbA' })).toMatch(/occupied/);
    s = play(s, 0, 't_pred_bone_spur', { slot: 'limbB' }); // Limb B is free
    expect(s.players[0].grafts).toHaveLength(2);
  });

  it('a graft with a text effect runs it (Maw Crown heals when you deal Clash damage)', () => {
    let s = setEnergy(hands(arena(), ['t_pred_maw_crown']), 0, 3);
    s = setHp(s, 0, 20);
    s = play(s, 0, 't_pred_maw_crown', { slot: 'head' });
    s = endRound(s);
    expect(s.players[0].hp).toBe(19); // 20 - 2 clash + 1 heal
  });
});

describe('Graft veterancy (Signature grafts only)', () => {
  // Several rounds of real Clash damage can incidentally satisfy the (deliberately easy) frozen test
  // evolution conditions; strip any evolution before reading stats so only veterancy is under test here.
  const atk = (st: GameState) => {
    const clean = edit(st, (d) => void (d.players[0].evolution = null));
    return computeStats(clean, clean.players[0]).attack;
  };

  it('a Signature graft gains attack after surviving the strain-check threshold', () => {
    let s = attached(hands(arena(), []), 0, 't_pred_sig_graft', 'organ');
    const threshold = s.config.veterancy.signatureThreshold;
    const bonus = s.config.veterancy.signatureAttackBonus;
    const before = atk(s);
    s = endRound(s); // 1st Strain check survived
    for (let i = 1; i < threshold; i++) {
      expect(atk(s)).toBe(before); // not there yet
      s = nextRound(s);
    }
    expect(atk(s)).toBe(before + bonus);
  });

  it('a non-Signature graft never gets the bonus, no matter how long it survives', () => {
    let s = attached(hands(arena(), []), 0, 't_pred_bone_spur', 'limbA');
    const before = atk(s);
    s = endRound(s);
    for (let i = 0; i < 4; i++) s = nextRound(s);
    expect(atk(s)).toBe(before);
  });

  it('a fresh graft in a new slot starts at zero, even if another one on the board is a veteran', () => {
    let s = attached(hands(arena(), []), 0, 't_pred_sig_graft', 'organ');
    const threshold = s.config.veterancy.signatureThreshold;
    for (let i = 0; i < threshold; i++) s = i === 0 ? endRound(s) : nextRound(s);
    const veteranAttack = atk(s);
    s = attached(s, 0, 't_pred_sig_graft', 'organB');
    expect(atk(s)).toBe(veteranAttack + 4); // +4 base attack, no veterancy bonus yet
  });
});

describe('Serum', () => {
  it('is a one-shot effect that goes to the discard pile', () => {
    let s = setHp(hands(arena(), ['t_tech_dressing']), 0, 20);
    s = play(s, 0, 't_tech_dressing');
    expect(s.players[0].hp).toBe(23);
    expect(s.players[0].energy).toBe(0);
    expect(s.players[0].discard.map((c) => c.cardId)).toEqual(['t_tech_dressing']);
  });

  it('temporary buffs last only for the round (Blood Rush)', () => {
    let s = setEnergy(hands(arena(), ['t_pred_blood_rush']), 0, 2);
    s = play(s, 0, 't_pred_blood_rush');
    expect(s.players[1].hp).toBe(25); // 5 direct damage
    expect(s.players[0].strain).toBe(2); // the card's own Strain
    expect(computeStats(s, s.players[0]).attack).toBe(6);
    s = endRound(s);
    expect(s.players[1].hp).toBe(19); // 25 - (2 + 4 attack)
    expect(computeStats(s, s.players[0]).attack).toBe(2); // buff expired
  });
});

describe('Toxin', () => {
  it('adds Strain to the opponent', () => {
    const s = play(hands(arena(), ['t_pred_bile_spit']), 0, 't_pred_bile_spit');
    expect(s.players[1].strain).toBe(2);
    expect(s.players[0].strain).toBe(0);
  });
});

describe('Protocol', () => {
  it('can only be played as a reaction, never on your own turn', () => {
    const s = setEnergy(hands(arena(), ['t_tech_antitoxin']), 0, 5);
    expect(playErr(s, 0, 't_tech_antitoxin')).toMatch(/response/);
  });

  it('answers the opponent\'s action: Antitoxin Reflex negates a Toxin', () => {
    let s = setEnergy(hands(arena(), ['t_pred_bile_spit'], ['t_tech_antitoxin']), 1, 2);
    s = play(s, 0, 't_pred_bile_spit');
    expect(s.window?.reactor).toBe(1);
    s = go(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid });
    expect(s.players[1].strain).toBe(0);
    expect(s.players[1].energy).toBe(0);
    expect(s.players[0].discard.map((c) => c.cardId)).toContain('t_pred_bile_spit'); // spent, but negated
  });

  it('the opponent may also decline to respond', () => {
    let s = setEnergy(hands(arena(), ['t_pred_bile_spit'], ['t_tech_antitoxin']), 1, 2);
    s = play(s, 0, 't_pred_bile_spit');
    s = go(s, { type: 'DECLINE_REACTION', player: 1 });
    expect(s.players[1].strain).toBe(2);
    expect(s.players[1].hand).toHaveLength(1);
  });

  it('only answers plays it is meant for', () => {
    let s = setEnergy(hands(arena(), ['t_pred_twitch_nerve'], ['t_tech_antitoxin', 't_para_static_jam']), 1, 5);
    s = play(s, 0, 't_pred_twitch_nerve', { slot: 'nerve' }); // Static Jam can answer, Antitoxin cannot
    expect(s.window).not.toBeNull();
    const antitoxin = s.players[1].hand.find((c) => c.cardId === 't_tech_antitoxin')!;
    expect(tryGo(s, { type: 'REACT', player: 1, uid: antitoxin.uid })).toMatch(/does not answer/);
  });

  it('Reflective Carapace turns a Toxin back on its caster', () => {
    let s = setEnergy(hands(arena('predator', 'bastion'), ['t_pred_bile_spit'], ['t_bast_reflective_carapace']), 1, 3);
    s = play(s, 0, 't_pred_bile_spit');
    s = go(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid });
    expect(s.players[0].strain).toBe(2);
    expect(s.players[1].strain).toBe(0);
  });

  it('Static Jam drains the opponent\'s Energy', () => {
    let s = setEnergy(hands(arena(), ['t_pred_twitch_nerve', 't_tech_dressing'], ['t_para_static_jam']), 0, 3);
    s = setEnergy(s, 1, 1);
    s = play(s, 0, 't_pred_twitch_nerve', { slot: 'nerve' });
    s = go(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid });
    expect(s.players[0].energy).toBe(1); // 3 - 2
  });

  describe('Energy drain timing', () => {
    // Energy is refilled (not topped up) each round, so a drain that lands after the actions phase would
    // otherwise vanish. Those carry over and come off the victim's next refill instead.
    it('a drain during the Clash (Grave Thorn) comes off the opponent\'s next round', () => {
      let s = attached(attached(arena(), 0, 't_pred_bone_spur', 'limbA'), 1, 't_hol_grave_thorn', 'limbA');
      s = endRound(s); // player 0's Bone Spur hits player 1, whose Grave Thorn drains player 0
      expect(s.log.some((l) => l.text.includes('will lose 1 Energy next round (Grave Thorn)'))).toBe(true);
      expect(s.players[0].energyDebt).toBe(0); // already paid at this round's refill
      expect(s.players[0].energy).toBe(s.players[1].energy - 1);
    });

    it('a drain at the Strain check (Hollow Husk) comes off the opponent\'s next round', () => {
      let s = attached(arena(), 1, 't_hol_hollow_husk', 'head');
      s = endRound(s);
      expect(s.players[0].energy).toBe(s.players[1].energy - 1);
      s = nextRound(s); // the debt is paid once, not every round after
      expect(s.players[0].energy).toBe(s.players[1].energy - 1); // Hollow Husk fired again at this Strain check
    });

    it('a round-start drain (Bone Ward) still hits the fresh Energy immediately, with no carry-over', () => {
      let s = attached(arena(), 1, 't_hol_bone_ward', 'organ');
      s = endRound(s);
      expect(s.players[0].energy).toBe(s.players[1].energy - 1);
      expect(s.players[0].energyDebt).toBe(0);
    });

    it('a drain during the actions phase takes only what is left, and says so when there is nothing', () => {
      let s = setEnergy(hands(arena(), ['t_pred_twitch_nerve'], ['t_para_static_jam']), 0, 0);
      s = setEnergy(s, 1, 1);
      s = play(s, 0, 't_pred_twitch_nerve', { slot: 'nerve' });
      s = go(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid });
      expect(s.players[0].energy).toBe(0);
      expect(s.players[0].energyDebt).toBe(0); // an in-round drain never carries over
      expect(s.log.some((l) => l.text.includes('has no Energy left to lose'))).toBe(true);
    });
  });

  describe('answering a Protocol with a Protocol', () => {
    it('a "respond to any play" Protocol can itself be answered, and both effects apply', () => {
      let s = setEnergy(hands(arena(), ['t_pred_bile_spit', 't_para_static_jam'], ['t_pred_blood_scent']), 0, 5);
      s = setEnergy(s, 1, 5);
      s = play(s, 0, 't_pred_bile_spit'); // opens a window for player 1
      expect(s.window?.reactor).toBe(1);
      s = go(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid }); // Blood Scent
      expect(s.window?.reactor).toBe(0); // player 0 now gets to answer the Protocol itself
      expect(s.players[1].hand).toHaveLength(0);
      s = go(s, { type: 'REACT', player: 0, uid: s.players[0].hand[0].uid }); // Static Jam answers Blood Scent
      expect(s.window).toBeNull();
      expect(s.players[0].strain).toBe(2); // Blood Scent's own effect still landed on player 0
      expect(s.players[1].strain).toBe(2); // and Bile Spit's original effect still landed on player 1
      expect(s.players[1].energy).toBe(2); // 5 - 1 (Blood Scent's own cost) - 2 (Static Jam's drain)
      expect(s.turn).toBe(1); // turn still passes based on the ORIGINAL play's player, not the reaction chain
    });

    it('declining to answer a Protocol just lets it resolve, and only offers the window once', () => {
      let s = setEnergy(hands(arena(), ['t_pred_bile_spit', 't_para_static_jam'], ['t_pred_blood_scent', 't_pred_blood_scent']), 0, 5);
      s = setEnergy(s, 1, 5);
      s = play(s, 0, 't_pred_bile_spit');
      s = go(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid }); // Blood Scent #1
      expect(s.window?.reactor).toBe(0); // player 0 could answer with Static Jam, but declines instead
      s = go(s, { type: 'DECLINE_REACTION', player: 0 });
      expect(s.window).toBeNull(); // resolved straight through, no second window for player 1's remaining Blood Scent
      expect(s.players[0].strain).toBe(2); // Blood Scent landed
      expect(s.players[1].strain).toBe(2); // Bile Spit landed too
      expect(s.players[1].hand).toHaveLength(1); // the second Blood Scent was never used
    });

    it('negating a Protocol stops only that Protocol, not the play it was answering', () => {
      let s = setEnergy(hands(arena(), ['t_pred_bile_spit', 't_tech_universal_negate'], ['t_pred_blood_scent']), 0, 5);
      s = setEnergy(s, 1, 5);
      s = play(s, 0, 't_pred_bile_spit');
      s = go(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid }); // Blood Scent
      expect(s.window?.reactor).toBe(0);
      s = go(s, { type: 'REACT', player: 0, uid: s.players[0].hand[0].uid }); // Universal Negate answers Blood Scent
      expect(s.window).toBeNull();
      expect(s.players[0].strain).toBe(0); // Blood Scent was negated: never landed
      expect(s.players[1].strain).toBe(2); // Bile Spit, the play Blood Scent was answering, still landed
    });
  });
});

describe('Sabotage', () => {
  it('sever destroys the graft', () => {
    let s = setEnergy(hands(arena(), ['t_tech_scalpel']), 0, 3);
    s = attached(s, 1, 't_bast_bone_helm', 'head');
    s = play(s, 0, 't_tech_scalpel', { target: 'head' });
    expect(s.players[1].grafts).toHaveLength(0);
    expect(s.players[1].discard.map((c) => c.cardId)).toEqual(['t_bast_bone_helm']);
    expect(computeStats(s, s.players[1])).toEqual({ attack: 2, armor: 0 });
  });

  it('poison makes the graft give 0 stats for 2 rounds', () => {
    let s = setEnergy(hands(arena(), ['t_tech_acid']), 0, 2);
    s = attached(s, 1, 't_pred_bone_spur', 'limbA');
    expect(computeStats(s, s.players[1]).attack).toBe(6);
    s = play(s, 0, 't_tech_acid', { target: 'limbA' });
    expect(s.players[1].grafts[0].poisoned).toBe(2);
    expect(computeStats(s, s.players[1]).attack).toBe(2);
    s = endRound(s); // round 1 ends
    expect(computeStats(s, s.players[1]).attack).toBe(2); // still poisoned in round 2
    s = nextRound(s);
    expect(computeStats(s, s.players[1]).attack).toBe(6); // recovered for round 3
  });

  it('disable turns the graft\'s text off for 1 round (stats stay)', () => {
    let s = setEnergy(hands(arena(), ['t_tech_pinch']), 0, 1);
    s = attached(s, 1, 't_pred_predator_eye', 'head'); // attack 4, +2 while Overclocked
    s = setStrain(s, 1, 6);
    expect(computeStats(s, s.players[1]).attack).toBe(8);
    s = play(s, 0, 't_tech_pinch', { target: 'head' });
    expect(computeStats(s, s.players[1]).attack).toBe(6);
    s = endRound(s);
    expect(s.players[1].grafts[0].disabled).toBe(0);
    expect(computeStats(s, s.players[1]).attack).toBe(8);
  });

  it('needs an enemy graft to target', () => {
    const s = setEnergy(hands(arena(), ['t_tech_scalpel']), 0, 3);
    expect(playErr(s, 0, 't_tech_scalpel', { target: 'head' })).toMatch(/target/);
  });

  it('Immune Response negates a Sabotage', () => {
    let s = setEnergy(hands(arena(), ['t_tech_scalpel'], ['t_tech_immune']), 0, 3);
    s = setEnergy(s, 1, 2);
    s = attached(s, 1, 't_bast_bone_helm', 'head');
    s = play(s, 0, 't_tech_scalpel', { target: 'head' });
    s = go(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid });
    expect(s.players[1].grafts).toHaveLength(1);
  });
});

describe('Other tech cards', () => {
  it('Purge Serum vents, Energy Cell nets Energy, Armor Piercer strips armor for the round', () => {
    let s = setEnergy(hands(arena(), ['t_tech_purge', 't_tech_cell', 't_tech_pierce']), 0, 4);
    s = setStrain(s, 0, 4);
    s = play(s, 0, 't_tech_purge');
    expect(s.players[0].strain).toBe(2);
    s = pass(s, 1);
    s = play(s, 0, 't_tech_cell');
    expect(s.players[0].energy).toBe(3); // 4 - 2 - 1 + 2
    s = pass(s, 1);
    s = attached(s, 1, 't_bast_shell_limb', 'limbA'); // armor 5
    s = play(s, 0, 't_tech_pierce');
    expect(computeStats(s, s.players[1]).armor).toBe(2);
  });
});
