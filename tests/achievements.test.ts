import { describe, expect, it } from 'vitest';
import { achievementStates, newlyUnlocked } from '../src/ui/achievements';
import type { MatchRecord } from '../src/ui/storage';

let t = 0;
function rec(result: MatchRecord['result'], over: Partial<MatchRecord['me']> = {}, extra: Partial<MatchRecord> = {}): MatchRecord {
  return {
    at: ++t,
    result,
    reason: '',
    rounds: 8,
    me: { faction: 'predator', worldFaction: 'corrosion', chip: 'acidFang', evolution: null, loadout: [], dealt: 20, taken: 30, blocked: 5, rejections: 0, maxStrain: 5, vented: 2, hpLeft: 10, stances: [], ...over },
    opp: { faction: 'bastion', worldFaction: 'aegis', chip: 'ironclad', evolution: null, hpLeft: 5 },
    ...extra,
  };
}
const state = (rs: MatchRecord[], id: string) => achievementStates(rs).find((s) => s.a.id === id)!;

describe('Achievements', () => {
  it('first win unlocks on the first won match, and only that match reports it as new', () => {
    const rs = [rec('loss'), rec('win')];
    expect(newlyUnlocked(rs).map((a) => a.id)).toContain('firstWin');
    expect(newlyUnlocked([...rs, rec('win')]).map((a) => a.id)).not.toContain('firstWin');
    expect(state(rs, 'firstWin').at).toBe(rs[1].at);
  });

  it('counts distinct Builds won with as progress', () => {
    const rs = [rec('win'), rec('win', { faction: 'bastion' }), rec('loss', { faction: 'parasite' })];
    const s = state(rs, 'builds');
    expect([s.have, s.need, s.unlocked]).toEqual([2, 3, false]);
    expect(state([...rs, rec('win', { faction: 'parasite' })], 'builds').unlocked).toBe(true);
  });

  it('streaks need consecutive wins', () => {
    expect(state([rec('win'), rec('win'), rec('loss'), rec('win')], 'streak3').have).toBe(2);
    expect(state([rec('win'), rec('win'), rec('win')], 'streak3').unlocked).toBe(true);
  });

  it('older records without the newer fields never unlock the achievements that need them', () => {
    expect(state([rec('win')], 'ko').unlocked).toBe(false); // no `ko` field recorded
    expect(state([rec('win', {}, { ko: true })], 'ko').unlocked).toBe(true);
  });
});
