import { describe, expect, it } from 'vitest';
import { pendingPlayers } from '../src/engine';
import { arena, attached, baseMatch, edit, endActions, endRound, go, hands, nextRound, pass, pickStances, play, playErr, rawStrain, setEnergy, setHp, setStrain, start, tryGo, withNodes } from './kit';

describe('Energy and drawing', () => {
  it('Energy equals the round number, capped at 6', () => {
    let s = arena();
    expect(s.players[0].energy).toBe(1);
    s = edit(s, (d) => void (d.round = 4));
    s = endRound(s);
    expect(s.round).toBe(5);
    expect(s.players[0].energy).toBe(5);
    s = nextRound(s);
    expect(s.round).toBe(6);
    expect(s.players[0].energy).toBe(6);
    s = nextRound(s);
    expect(s.round).toBe(7);
    expect(s.players[0].energy).toBe(6); // capped
  });

  it('unspent Energy is lost (banking off by default)', () => {
    let s = arena();
    expect(s.players[0].energy).toBe(1);
    s = endRound(s);
    expect(s.players[0].energy).toBe(2); // not 3
  });

  it('draws 1 card in every Draw phase', () => {
    let s = arena();
    const deck = s.players[0].deck.length;
    s = endRound(s);
    expect(s.players[0].hand).toHaveLength(1); // arena emptied the hand, then drew 1
    expect(s.players[0].deck).toHaveLength(deck - 1);
  });
});

describe('Stances', () => {
  it('Aggress beats Adapt: +2 damage', () => {
    const s = endRound(arena('predator', 'predator', ['aggress', 'adapt']));
    expect(s.players[1].hp).toBe(26); // 2 + 2
    expect(s.players[0].hp).toBe(28);
  });

  it('Adapt beats Fortify: the attack ignores armor', () => {
    let s = arena('predator', 'predator', ['adapt', 'fortify']);
    s = attached(s, 1, 't_bast_bone_helm', 'head'); // +1 attack, +3 armor
    s = endRound(s);
    expect(s.players[1].hp).toBe(28); // 2 damage: armor ignored
    expect(s.players[0].hp).toBe(27); // 3 damage: Fortify lost the stance, P1 still attacks
  });

  it('armor does apply when the stance does not ignore it', () => {
    let s = arena('predator', 'predator', ['aggress', 'aggress']);
    s = attached(s, 1, 't_bast_bone_helm', 'head');
    s = endRound(s);
    expect(s.players[1].hp).toBe(30); // 2 attack - 3 armor -> 0
  });

  it('Fortify beats Aggress: takes half damage (rounded down), then deals 1 counter damage', () => {
    let s = arena('predator', 'predator', ['aggress', 'fortify']);
    s = attached(s, 0, 't_pred_twitch_nerve', 'nerve'); // attack 3
    s = endRound(s);
    expect(s.players[1].hp).toBe(29); // floor(3 / 2) = 1
    expect(s.players[0].hp).toBe(27); // 2 damage + 1 counter
  });

  it('same stance has no effect', () => {
    for (const st of ['aggress', 'adapt', 'fortify'] as const) {
      const s = endRound(arena('predator', 'predator', [st, st]));
      expect(s.players.map((p) => p.hp), st).toEqual([28, 28]);
    }
  });

  it('stances are secret until both are chosen, then revealed', () => {
    let s = start(baseMatch());
    s = go(s, { type: 'PICK_STANCE', player: 0, stance: 'adapt' });
    expect(s.phase).toBe('stance');
    expect(pendingPlayers(s)).toEqual([1]);
    expect(tryGo(s, { type: 'PICK_STANCE', player: 0, stance: 'aggress' })).toMatch(/already/i);
    s = go(s, { type: 'PICK_STANCE', player: 1, stance: 'fortify' });
    expect(s.phase).toBe('actions');
    expect(s.log.some((l) => l.kind === 'stance' && /Adapt/.test(l.text) && /Fortify/.test(l.text))).toBe(true);
  });

  // Feint is gated purely by hasNode(pl,'feint'), which just checks loadout membership - no chip currently
  // grants it, but the reducer mechanic itself is still real and worth covering directly via withNodes.
  describe('Feint', () => {
    it('once per match, re-pick your stance after a tie; the opponent keeps theirs', () => {
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
      // 'feint' is not a real chip node any more, so nodeParam(pl,'feint',...) reads default to 0: free.
      expect(s.players[0].strain).toBe(0);
      expect(s.players[0].hp).toBe(30);
      s = hands(endRound(hands(s)));
      s = pickStances(s, 'adapt', 'adapt'); // tie again: Feint is spent
      expect(s.phase).toBe('actions');
    });

    it('can be declined and is then still available', () => {
      let s = withNodes(start(baseMatch()), 0, ['feint']);
      s = pickStances(s, 'adapt', 'adapt');
      s = go(s, { type: 'FEINT', player: 0, stance: null });
      expect(s.phase).toBe('actions');
      expect(s.players[0].feintUsed).toBe(false);
      expect(s.players[0].strain).toBe(0); // declining costs nothing
      expect(s.players[0].hp).toBe(30);
    });
  });
});

describe('Action order', () => {
  it('the stance winner acts first', () => {
    expect(arena('predator', 'predator', ['aggress', 'adapt']).turn).toBe(0);
    expect(arena('predator', 'predator', ['adapt', 'aggress']).turn).toBe(1);
  });

  it('on a stance tie, whoever acted second last round acts first', () => {
    let s = arena('predator', 'predator', ['aggress', 'aggress'], undefined, 0); // P1 acts first in round 1
    expect(s.turn).toBe(0);
    s = endRound(s);
    s = pickStances(s, 'adapt', 'adapt');
    expect(s.turn).toBe(1); // P2 acted second in round 1
    s = endRound(s);
    s = pickStances(s, 'fortify', 'fortify');
    expect(s.turn).toBe(0);
  });

  it('players alternate, one action at a time', () => {
    let s = hands(arena(), ['t_pred_twitch_nerve'], ['t_pred_twitch_nerve']);
    expect(s.turn).toBe(0);
    expect(tryGo(s, { type: 'PASS', player: 1 })).toMatch(/Not your turn/);
    s = play(s, 0, 't_pred_twitch_nerve', { slot: 'nerve' });
    expect(s.turn).toBe(1);
    s = play(s, 1, 't_pred_twitch_nerve', { slot: 'nerve' });
    expect(s.turn).toBe(0);
  });

  it('two passes in a row end the phase; a play in between resets the count', () => {
    let s = hands(arena(), [], ['t_pred_twitch_nerve']);
    s = pass(s); // P1 passes
    s = play(s, 1, 't_pred_twitch_nerve', { slot: 'nerve' }); // P2 acts: streak resets
    s = pass(s); // P1 passes
    expect(s.phase).toBe('actions');
    expect(s.round).toBe(1);
    s = pass(s); // P2 passes: two in a row
    expect(s.round).toBe(2);
    expect(s.phase).toBe('stance');
  });

  it('after each action the opponent may respond with one Protocol', () => {
    let s = hands(arena(), ['t_pred_bile_spit'], ['t_pred_blood_scent', 't_pred_blood_scent']);
    s = setEnergy(s, 1, 5);
    s = play(s, 0, 't_pred_bile_spit');
    expect(s.window?.reactor).toBe(1);
    expect(pendingPlayers(s)).toEqual([1]);
    expect(tryGo(s, { type: 'PASS', player: 0 })).toMatch(/reaction/i);
    s = go(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid });
    expect(s.window).toBeNull();
    expect(s.players[1].hand).toHaveLength(1); // only ONE Protocol per response
    expect(tryGo(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid })).toMatch(/No reaction window/);
    expect(s.turn).toBe(1);
  });

  it('skips the reaction window when the opponent has nothing to respond with', () => {
    const s = play(hands(arena(), ['t_pred_bile_spit'], ['t_pred_bone_spur']), 0, 't_pred_bile_spit');
    expect(s.window).toBeNull();
    expect(s.turn).toBe(1);
  });
});

describe('Clash', () => {
  it('deals attack + modifiers - armor, with a minimum of 0', () => {
    let s = arena();
    s = attached(s, 1, 't_bast_shell_limb', 'limbA'); // armor 5, attack 1
    s = endRound(s);
    expect(s.players[1].hp).toBe(30); // 2 - 5 -> 0, not negative
    expect(s.players[0].hp).toBe(27); // 3
  });

  it('both Specimens deal damage at the same time', () => {
    let s = arena();
    s = setHp(setHp(s, 0, 2), 1, 2);
    s = endRound(s);
    expect(s.phase).toBe('over');
    expect(s.players.map((p) => p.hp)).toEqual([0, 0]);
    expect(s.result?.winner).toBeNull(); // both hit 0 together: draw
  });

  it('a player who declared Hold deals no Clash damage, and gets some armor from it', () => {
    let s = arena();
    const holdArmor = s.config.strain.holdArmor;
    s = go(s, { type: 'HOLD', player: 0 });
    expect(tryGo(pass(s), { type: 'HOLD', player: 0 })).toMatch(/Already holding/);
    s = endRound(s);
    expect(s.players[1].hp).toBe(30); // P1 dealt no Clash damage
    expect(s.players[0].hp).toBe(30 - Math.max(0, 2 - holdArmor)); // P2's base attack, reduced by Hold's armor
  });

  it('Hold does not stop the Fortify counter', () => {
    let s = arena('predator', 'predator', ['aggress', 'fortify']); // Fortify wins the stance and acts first
    s = go(s, { type: 'HOLD', player: 1 });
    s = endRound(s);
    expect(s.players[0].hp).toBe(29); // no attack from the holder, only the 1 counter
  });

  it('Hold also vents a little Strain, for any faction, even without Heat Sink', () => {
    let s = rawStrain(arena(), 0, 5);
    s = go(s, { type: 'HOLD', player: 0 });
    s = endRound(s);
    expect(s.players[0].strain).toBe(5 - s.config.strain.holdVent);
  });

  it("Hold's armor bonus lasts only the round it is declared in", () => {
    let s = arena();
    s = go(s, { type: 'HOLD', player: 0 });
    expect(s.players[0].tempArmor).toBe(s.config.strain.holdArmor);
    s = endRound(s);
    expect(s.players[0].tempArmor).toBe(0);
    expect(s.players[0].hold).toBe(false); // Hold is per round too
  });
});

describe('End of match', () => {
  it('a player at 0 HP loses', () => {
    let s = setHp(arena(), 1, 2);
    s = endRound(s);
    expect(s.result?.winner).toBe(0);
    expect(s.phase).toBe('over');
  });

  it('after round 8 the higher HP wins', () => {
    let s = setHp(arena(), 0, 20);
    s = edit(s, (d) => void (d.round = 8));
    s = endRound(s);
    expect(s.phase).toBe('over');
    expect(s.result?.winner).toBe(1);
  });

  it('tied HP after round 8: the lower Strain wins', () => {
    let s = edit(arena(), (d) => void (d.round = 8));
    s = setStrain(setStrain(s, 0, 4), 1, 3);
    s = endActions(s);
    expect(s.result?.winner).toBe(1);
  });

  it('tied HP and Strain after round 8 is a draw', () => {
    let s = edit(arena(), (d) => void (d.round = 8));
    s = endActions(s);
    expect(s.phase).toBe('over');
    expect(s.result?.winner).toBeNull();
  });

  it('the match runs at most 8 rounds', () => {
    let s = endRound(arena());
    for (let i = 0; i < 6; i++) s = nextRound(s);
    expect(s.round).toBe(8);
    s = pickStances(s, 'aggress', 'aggress');
    s = endActions(s);
    expect(s.phase).toBe('over');
    expect(s.round).toBe(8);
  });

  it('refuses actions once the match is over', () => {
    let s = setHp(arena(), 1, 1);
    s = endRound(s);
    expect(tryGo(s, { type: 'PASS', player: 0 })).toMatch(/over/);
  });
});

describe('Playing in the wrong situation', () => {
  it('cannot play a card you cannot afford', () => {
    const s = hands(arena(), ['t_pred_furnace_heart'], []);
    expect(playErr(s, 0, 't_pred_furnace_heart', { slot: 'organ' })).toMatch(/Energy/);
  });
});
