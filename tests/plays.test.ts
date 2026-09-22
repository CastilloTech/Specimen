import { describe, expect, it } from 'vitest';
import { defaultConfig, publicPlay } from '../src/engine';
import { arena, attached, endRound, go, hands, pass, play, setEnergy } from './kit';

describe('Play history (what each player can see being played)', () => {
  it('records every card played, with its slot and target, in order and by round', () => {
    let s = setEnergy(hands(arena(), ['t_pred_bone_spur', 't_pred_bile_spit']), 0, 5);
    s = play(s, 0, 't_pred_bone_spur', { slot: 'limbA' });
    s = pass(s, 1);
    s = play(s, 0, 't_pred_bile_spit');
    expect(s.plays.map((r) => [r.n, r.round, r.player, r.kind, r.cardId, r.slot])).toEqual([
      [0, 1, 0, 'play', 't_pred_bone_spur', 'limbA'],
      [1, 1, 0, 'play', 't_pred_bile_spit', undefined],
    ]);
  });

  it('records the target of a Sabotage', () => {
    let s = setEnergy(hands(arena(), ['t_tech_scalpel']), 0, 3);
    s = attached(s, 1, 't_bast_bone_helm', 'head');
    s = play(s, 0, 't_tech_scalpel', { target: 'head' });
    expect(s.plays[0]).toMatchObject({ cardId: 't_tech_scalpel', target: 'head' });
  });

  it('records Protocol responses as "react", and the round they happened in', () => {
    let s = setEnergy(hands(arena(), ['t_pred_bile_spit'], ['t_tech_antitoxin']), 1, 2);
    s = play(s, 0, 't_pred_bile_spit');
    s = go(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid });
    expect(s.plays.map((r) => [r.player, r.kind, r.cardId])).toEqual([
      [0, 'play', 't_pred_bile_spit'],
      [1, 'react', 't_tech_antitoxin'],
    ]);
    expect(s.plays[0].negated).toBe(true); // the Toxin was negated
  });

  it('records Pressure Valve as a reaction without a card', () => {
    // Bastion (P1) reacts to P2's graft; give it the node and some Strain.
    let s = hands(arena('bastion', 'predator'), [], ['t_pred_twitch_nerve']);
    s = go(s, { type: 'PASS', player: s.turn });
    s = play(s, 1, 't_pred_twitch_nerve', { slot: 'nerve' });
    expect(s.plays.at(-1)).toMatchObject({ player: 1, kind: 'play' });
  });

  it('a cycled card is recorded but its name never is', () => {
    let s = hands(arena(), ['t_tech_stim']);
    s = go(s, { type: 'CYCLE', player: 0, uid: s.players[0].hand[0].uid, mode: 'draw' });
    expect(s.plays).toHaveLength(1);
    expect(s.plays[0].kind).toBe('cycle');
    expect(s.plays[0].cardId).toBeUndefined();
  });

  it('keeps the round number as the match goes on', () => {
    let s = hands(arena(), ['t_pred_twitch_nerve']);
    s = play(s, 0, 't_pred_twitch_nerve', { slot: 'nerve' });
    s = endRound(s);
    expect(s.plays[0].round).toBe(1);
    expect(s.round).toBe(2);
  });
});

describe('Play history privacy', () => {
  const dark = () => {
    let s = setEnergy(hands(arena(), ['t_pred_maw_crown']), 0, 3);
    return play(s, 0, 't_pred_maw_crown', { slot: 'head', faceDown: true });
  };

  it('hides a face-down graft from the opponent but not from its owner', () => {
    const s = dark();
    const rec = s.plays[0];
    expect(rec.faceDown).toBe(true);
    expect(publicPlay(rec, 1).cardId).toBeUndefined(); // the opponent
    expect(publicPlay(rec, 0).cardId).toBe('t_pred_maw_crown'); // the owner
    expect(publicPlay(rec, 1).slot).toBe('head'); // slot stays public
  });

  it('the name becomes public once the graft is revealed (reveal action)', () => {
    let s = dark();
    s = pass(s, 1);
    s = go(s, { type: 'REVEAL', player: 0, slot: 'head' });
    expect(s.plays[0].faceDown).toBeFalsy();
    expect(publicPlay(s.plays[0], 1).cardId).toBe('t_pred_maw_crown');
  });

  it('stays hidden through a whole round of Clash: a sleeping graft never triggers', () => {
    let s = dark();
    s = endRound(s);
    expect(publicPlay(s.plays[0], 1).cardId).toBeUndefined();
  });

  it('the name becomes public when the opponent forces it awake', () => {
    let s = setEnergy(hands(arena(), ['t_pred_maw_crown']), 0, 3);
    s = play(s, 0, 't_pred_maw_crown', { slot: 'head', faceDown: true });
    s = hands(s, [], ['t_tech_scanner']);
    s = play(s, 1, 't_tech_scanner', { target: 'head' });
    expect(publicPlay(s.plays[0], 1).cardId).toBe('t_pred_maw_crown');
  });

  it('a face-down graft stays hidden through a reaction that does not touch it', () => {
    let s = setEnergy(hands(arena(), ['t_pred_maw_crown'], ['t_para_static_jam']), 0, 3);
    s = setEnergy(s, 1, 5);
    s = play(s, 0, 't_pred_maw_crown', { slot: 'head', faceDown: true });
    s = go(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid }); // Static Jam only drains Energy
    expect(publicPlay(s.plays[0], 1).cardId).toBeUndefined();
    expect(s.plays[1]).toMatchObject({ kind: 'react', player: 1, cardId: 't_para_static_jam' });
  });

  it('the JSON of the log never contains a face-down graft name', () => {
    const s = dark();
    expect(s.log.map((l) => l.text).join('\n')).not.toMatch(/Maw Crown/);
  });
});

describe('Timers', () => {
  it('gives the opening mulligan decision much longer than an ordinary action', () => {
    const t = defaultConfig.timers;
    expect(t.mulliganSeconds).toBeGreaterThanOrEqual(60);
    expect(t.mulliganSeconds).toBeGreaterThan(t.actionSeconds * 2);
  });
});
