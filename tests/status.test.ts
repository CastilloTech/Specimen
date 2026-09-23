import { describe, expect, it } from 'vitest';
import { computeStats } from '../src/engine';
import { arena, attached, edit, endRound, go, hands, nextRound, pass, play, playErr, setEnergy, setHp, tryGo, withNodes } from './kit';

describe('Graft integrity', () => {
  it('a graft starts at its card-defined integrity', () => {
    const s = attached(hands(arena(), []), 0, 't_low_integrity_graft', 'limbA');
    expect(s.players[0].grafts[0].integrity).toBe(2);
  });

  it('a graft with no explicit integrity falls back to the config default', () => {
    const s = attached(hands(arena(), []), 0, 't_pred_bone_spur', 'limbA');
    expect(s.players[0].grafts[0].integrity).toBe(s.config.integrity.default);
  });

  it('graftDamage chips integrity without destroying it if it survives', () => {
    let s = setEnergy(hands(arena(), ['t_test_graft_dmg']), 0, 3);
    s = attached(s, 1, 't_bast_shell_limb', 'limbA'); // integrity defaults to config.integrity.default (3)
    s = play(s, 0, 't_test_graft_dmg', { target: 'limbA' });
    expect(s.players[1].grafts).toHaveLength(1);
    expect(s.players[1].grafts[0].integrity).toBe(s.config.integrity.default - 2);
  });

  it('a graft is destroyed once integrity reaches 0, independent of Strain/rejection', () => {
    let s = setEnergy(hands(arena(), ['t_test_graft_dmg']), 0, 3);
    s = attached(s, 1, 't_low_integrity_graft', 'limbA'); // integrity 2
    s = play(s, 0, 't_test_graft_dmg', { target: 'limbA' });
    expect(s.players[1].grafts).toHaveLength(0);
    expect(s.players[1].discard.map((c) => c.cardId)).toContain('t_low_integrity_graft');
    expect(s.players[1].stats.rejectionsSuffered).toBe(0); // destruction is not a rejection
  });

  it('a face-down graft is revealed before its integrity is chipped', () => {
    let s = setEnergy(hands(arena(), ['t_test_graft_dmg']), 0, 3);
    s = attached(s, 1, 't_low_integrity_graft', 'limbA', { faceDown: true });
    s = play(s, 0, 't_test_graft_dmg', { target: 'limbA' });
    expect(s.players[1].grafts).toHaveLength(0); // 2 damage destroys the 2-integrity graft
  });
});

describe('Integrity heal (op)', () => {
  it('heals every graft the caster controls, capped at its own max', () => {
    let s = setEnergy(hands(arena(), ['t_test_integrity_heal']), 0, 2);
    s = attached(s, 0, 't_low_integrity_graft', 'limbA', { integrity: 1 }); // max 2, currently 1
    s = attached(s, 0, 't_bast_shell_limb', 'organ', { integrity: 3 }); // already at its max of 3
    s = play(s, 0, 't_test_integrity_heal'); // heals 2 on every graft
    expect(s.players[0].grafts.find((g) => g.cardId === 't_low_integrity_graft')!.integrity).toBe(2); // capped at 2, not 3
    expect(s.players[0].grafts.find((g) => g.cardId === 't_bast_shell_limb')!.integrity).toBe(3); // already full: no overheal
  });
});

describe('Clash chips Integrity', () => {
  // t_low_integrity_graft (2 attack, 0 armor) keeps the Clash-damage arithmetic simple: with no armor in
  // the way, P0's base 2 attack always lands as exactly 2 damage on P1, regardless of P1's own graft.
  it('does nothing when the round\'s Clash damage does not clear the divisor', () => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], { integrity: { clashDamageDivisor: 4 } });
    s = attached(s, 1, 't_low_integrity_graft', 'limbA', { integrity: 3 });
    s = endRound(s); // base Clash: 2 attack - 0 armor = 2 damage; floor(2/4) = 0
    expect(s.players[1].grafts[0].integrity).toBe(3);
  });

  it('chips the defender\'s toughest awake graft by floor(damage/divisor), plus graftDamageBonus/Reduction', () => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], { integrity: { clashDamageDivisor: 1 } });
    s = withNodes(s, 0, ['t_dmg']); // graftDamageBonus 2 (also graftDamageReduction 1, irrelevant here: P0 is the attacker)
    s = attached(s, 1, 't_low_integrity_graft', 'limbA', { integrity: 5 });
    s = endRound(s); // base Clash 2 damage, divisor 1 -> base chip 2, +2 from the node = 4
    expect(s.players[1].grafts[0].integrity).toBe(1);
  });

  it('destroying a graft this way still fires onGraftKilled hooks (killHeal/killStrain)', () => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], { integrity: { clashDamageDivisor: 1 } });
    s = withNodes(s, 0, ['t_kill']); // killHeal 2, killStrain 1
    s = attached(s, 1, 't_low_integrity_graft', 'limbA', { integrity: 2 });
    s = setHp(s, 0, 20);
    s = endRound(s); // base Clash 2 damage, divisor 1 -> chip 2: destroys the 2-integrity graft
    expect(s.players[1].grafts).toHaveLength(0);
    // P1's graft also gives P1 +2 attack, so P0 takes 4 return damage (20 -> 16), then heals 2 from killHeal: 18.
    expect(s.players[0].hp).toBe(18);
    expect(s.players[1].strain).toBeGreaterThan(0); // killStrain landed on the victim
  });
});

describe('Bleed', () => {
  it('deals 1 damage per round for the configured number of rounds, then stops', () => {
    let s = setEnergy(hands(arena(), ['t_test_bleed']), 0, 2);
    s = play(s, 0, 't_test_bleed');
    expect(s.players[1].bleed).toBe(s.config.status.bleedRounds);
    const hpBefore = s.players[1].hp;
    s = endRound(s); // 1st Strain check: bleed ticks
    expect(s.players[1].hp).toBe(hpBefore - 2 - s.config.status.bleedDamage); // base Clash (2) + Bleed
    expect(s.players[1].bleed).toBe(s.config.status.bleedRounds - 1);
    s = nextRound(s); // 2nd tick
    expect(s.players[1].bleed).toBe(s.config.status.bleedRounds - 2);
    const hpBeforeThird = s.players[1].hp;
    s = nextRound(s); // bleed expired: no more ticks
    expect(s.players[1].hp).toBe(hpBeforeThird - 2); // only the base Clash damage now
  });
});

describe('Numb', () => {
  it('blocks the numbed player from answering with a Protocol', () => {
    let s = setEnergy(hands(arena(), ['t_test_numb', 't_pred_twitch_nerve'], ['t_pred_bile_spit']), 0, 3);
    s = setEnergy(s, 1, 3);
    s = pass(s, 0);
    s = play(s, 1, 't_pred_bile_spit'); // opens a window for player 0
    expect(s.window?.reactor).toBe(0);
    s = go(s, { type: 'REACT', player: 0, uid: s.players[0].hand.find((c) => c.cardId === 't_test_numb')!.uid });
    expect(s.window).toBeNull(); // player 1 has nothing left in hand to counter-react with
    expect(s.players[1].numb).toBe(s.config.status.numbRounds);
    // Give the now-numbed player a matching Protocol: it is not even offered as a reaction option.
    s = edit(s, (d) => void d.players[1].hand.push({ uid: 'x:1', cardId: 't_pred_blood_scent' }));
    s = play(s, 0, 't_pred_twitch_nerve', { slot: 'nerve' });
    expect(s.window).toBeNull(); // no window opens: Numb rules the Protocol out entirely
    expect(s.players[1].hand).toHaveLength(1); // Blood Scent was never spent
    expect(tryGo(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid })).toMatch(/No reaction window/);
  });
});

describe('Fever', () => {
  it('makes grafts cost extra Energy while it lasts', () => {
    let s = setEnergy(hands(arena(), ['t_test_fever'], ['t_pred_bone_spur']), 0, 2);
    s = play(s, 0, 't_test_fever');
    expect(s.players[1].fever).toBe(s.config.status.feverRounds);
    const fullCost = 1 + s.config.status.feverCostIncrease; // Bone Spur costs 1, plus Fever's live increase
    s = setEnergy(s, 1, fullCost - 1);
    expect(playErr(s, 1, 't_pred_bone_spur', { slot: 'limbA' })).toMatch(/Energy/); // one short
    s = setEnergy(s, 1, fullCost);
    s = play(s, 1, 't_pred_bone_spur', { slot: 'limbA' });
    expect(s.players[1].energy).toBe(0);
  });
});

describe('Necrosis', () => {
  it('blocks a slot from being refilled for the configured number of rounds', () => {
    let s = setEnergy(hands(arena(), ['t_test_necrosis']), 0, 3);
    s = attached(s, 1, 't_bast_shell_limb', 'limbA');
    s = play(s, 0, 't_test_necrosis', { target: 'limbA' });
    expect(s.players[1].grafts).toHaveLength(0);
    expect(s.players[1].necrosis.limbA).toBe(s.config.sabotage.necrosisRounds);
    // The necrosis play resolved with no reaction available, so it is already player 1's turn.
    s = edit(s, (d) => void d.players[1].hand.push({ uid: 'x:1', cardId: 't_pred_bone_spur' }));
    s = edit(s, (d) => void (d.players[1].energy = 3));
    expect(playErr(s, 1, 't_pred_bone_spur', { slot: 'limbA' })).toMatch(/necrotic/);
  });

  it('heals over after enough rounds pass', () => {
    let s = setEnergy(hands(arena(), ['t_test_necrosis']), 0, 3);
    s = attached(s, 1, 't_bast_shell_limb', 'limbA');
    s = play(s, 0, 't_test_necrosis', { target: 'limbA' });
    const rounds = s.config.sabotage.necrosisRounds;
    for (let i = 0; i < rounds; i++) s = i === 0 ? endRound(s) : nextRound(s);
    expect(s.players[1].necrosis.limbA).toBeUndefined();
  });
});

describe('Purge', () => {
  it('clears bleed, numb, fever and necrosis on the caster', () => {
    let s = setEnergy(hands(arena(), ['t_test_purge']), 0, 2);
    s = edit(s, (d) => {
      d.players[0].bleed = 2;
      d.players[0].numb = 1;
      d.players[0].fever = 1;
      d.players[0].necrosis = { limbA: 2 };
    });
    s = play(s, 0, 't_test_purge');
    const p = s.players[0];
    expect(p.bleed).toBe(0);
    expect(p.numb).toBe(0);
    expect(p.fever).toBe(0);
    expect(p.necrosis).toEqual({});
  });
});

describe('Evolution-conditional card text', () => {
  it('a passive ability gated on a specific evolution only applies once that form is reached', () => {
    let s = attached(hands(arena(), []), 0, 't_pred_evo_graft', 'organ');
    expect(computeStats(s, s.players[0]).attack).toBe(2); // base only: not evolved yet
    s = edit(s, (d) => void (d.players[0].evolution = 'apexStalker'));
    expect(computeStats(s, s.players[0]).attack).toBe(6); // base 2 + apexStalker's own +2 + the graft's evolution-gated +2
  });
});
