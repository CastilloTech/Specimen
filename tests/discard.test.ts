import { describe, expect, it } from 'vitest';
import { publicDiscard } from '../src/engine';
import { arena, attached, endRound, go, hands, pass, play, setEnergy, setHp, setStrain } from './kit';

// The discard pile remembers how and when each card got there, and a Protocol remembers what it answered,
// so the UI can show "rejected", "destroyed", "negated by ..." instead of a bare list.
describe('Discard pile records', () => {
  it('a spent Serum is recorded as played, with the round', () => {
    let s = setHp(hands(arena(), ['t_tech_dressing']), 0, 20);
    s = play(s, 0, 't_tech_dressing');
    expect(s.players[0].discard).toEqual([expect.objectContaining({ cardId: 't_tech_dressing', why: 'played', round: s.round })]);
  });

  it('a severed graft names the card that severed it', () => {
    let s = setEnergy(hands(arena(), ['t_tech_scalpel']), 0, 3);
    s = attached(s, 1, 't_bast_bone_helm', 'head');
    s = play(s, 0, 't_tech_scalpel', { target: 'head' });
    const entry = s.players[1].discard[0];
    expect(entry).toMatchObject({ cardId: 't_bast_bone_helm', why: 'severed' });
    expect(entry.by).toBeTruthy();
  });

  it('a graft ejected at the Strain check is recorded as rejected', () => {
    let s = attached(arena(), 0, 't_pred_bone_spur', 'limbA', {}, true);
    s = setStrain(s, 0, s.config.strain.threshold + 2);
    s = endRound(s);
    expect(s.players[0].discard).toEqual([expect.objectContaining({ cardId: 't_pred_bone_spur', why: 'rejected', by: 'Strain check' })]);
  });

  it('a cycled card is recorded as cycled and stays hidden from the opponent', () => {
    let s = hands(arena(), ['t_tech_stim']);
    s = go(s, { type: 'CYCLE', player: 0, uid: s.players[0].hand[0].uid, mode: 'vent' });
    expect(s.players[0].discard[0]).toMatchObject({ cardId: 't_tech_stim', why: 'cycled' });
    expect(publicDiscard(s, 0, 0)[0].cardId).toBe('t_tech_stim');
    expect(publicDiscard(s, 0, 1)[0].cardId).toBeUndefined();
  });
});

describe('Protocol answers', () => {
  it('a Protocol records the play it answered, and the negated card is recorded as negated', () => {
    let s = setEnergy(hands(arena(), ['t_pred_bile_spit'], ['t_tech_antitoxin']), 1, 2);
    s = play(s, 0, 't_pred_bile_spit');
    s = go(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid });
    const toxin = s.plays.find((r) => r.cardId === 't_pred_bile_spit')!;
    const answer = s.plays.find((r) => r.kind === 'react')!;
    expect(answer.against).toBe(toxin.uid);
    expect(toxin.negated).toBe(true);
    expect(s.players[0].discard).toEqual([expect.objectContaining({ cardId: 't_pred_bile_spit', why: 'negated' })]);
  });
});

describe('Status and drain counters', () => {
  it('counts Energy the opponent actually lost to your drains', () => {
    let s = setEnergy(hands(arena(), ['t_pred_twitch_nerve'], ['t_para_static_jam']), 0, 3);
    s = setEnergy(s, 1, 1);
    s = play(s, 0, 't_pred_twitch_nerve', { slot: 'nerve' });
    s = go(s, { type: 'REACT', player: 1, uid: s.players[1].hand[0].uid });
    expect(s.players[1].stats.energyDrained).toBe(2);
  });
  it('counts Numb inflicted on the opponent', () => {
    // t_test_numb is a Protocol: answer the opponent's Toxin with it.
    let s = setEnergy(hands(arena(), ['t_test_numb'], ['t_pred_bile_spit']), 0, 3);
    s = setEnergy(s, 1, 3);
    s = pass(s, 0);
    s = play(s, 1, 't_pred_bile_spit');
    s = go(s, { type: 'REACT', player: 0, uid: s.players[0].hand[0].uid });
    expect(s.players[0].stats.numbDealt).toBe(1);
  });
});
