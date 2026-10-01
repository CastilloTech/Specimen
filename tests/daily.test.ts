import { describe, expect, it } from 'vitest';
import { chipsFor, createMatch, playBotMatch, replay } from '../src/engine';
import type { GameState } from '../src/engine';
import { applyDaily, dailyChallenge, dailyReward, dailySetup, dayKey, prevDay, TWISTS } from '../src/ui/daily';
import { startProgress } from '../src/ui/modes';

const days = (n: number) => Array.from({ length: n }, (_, i) => dayKey(new Date(2026, 0, 1 + i)));
const fakeEnd = (won: boolean, hp = 20, round = 6) => ({ result: { winner: won ? 0 : 1, reason: 'x' }, round, players: [{ hp }, { hp: 0 }], snapshots: [{ round: 0, hp: [40, 40], strain: [0, 0] }, { round: 1, hp: [hp, 0], strain: [0, 0] }], history: [] }) as unknown as GameState;

describe('Daily challenge', () => {
  it('is the same match all day and changes from day to day', () => {
    const a = dailyChallenge('2026-09-28', 'A');
    const b = dailyChallenge('2026-09-28', 'B');
    expect({ ...a.you, name: '' }).toEqual({ ...b.you, name: '' });
    expect(a.opponent).toEqual(b.opponent);
    expect(a.seed).toBe(b.seed);
    const keys = new Set(days(30).map((k) => JSON.stringify([dailyChallenge(k, 'x').you.faction, dailyChallenge(k, 'x').opponent.faction, dailyChallenge(k, 'x').twist.id, dailyChallenge(k, 'x').seed])));
    expect(keys.size).toBe(30);
  });

  it('every day of a year builds a legal match, and every twist shows up', () => {
    const seen = new Set<string>();
    for (const k of days(365)) {
      const d = dailyChallenge(k, 'You');
      seen.add(d.twist.id);
      expect(d.you.faction).not.toBe(d.opponent.faction);
      const s = createMatch(dailySetup(d));
      expect(s.lastError ?? null).toBeNull();
      if (d.twist.id === 'grafted') expect(s.players[0].grafts.length).toBe(2);
      if (d.twist.id === 'glass') expect(s.players[1].maxHp).toBe(26);
      if (d.twist.id === 'evolved') expect(s.players[1].evolution).toBeTruthy();
    }
    expect(seen).toEqual(new Set(TWISTS.map((t) => t.id)));
  });

  it('a daily match plays to the end and its replay rebuilds it exactly', () => {
    for (const k of days(8)) {
      const setup = dailySetup(dailyChallenge(k, 'You'));
      const both = { ...setup, players: [{ ...setup.players[0], isBot: true, ai: 'basic' as const }, { ...setup.players[1], ai: 'basic' as const }] as typeof setup.players };
      const end = playBotMatch(both);
      expect(end.phase).toBe('over');
      expect(replay(both, end.history).log).toEqual(end.log);
    }
  });

  it('the first win of the day pays, later wins only improve the score, and streaks grow day by day', () => {
    let p = startProgress('predator', 'corrosion', chipsFor('corrosion')[0].id);
    const d1 = '2026-03-01';
    let r = applyDaily(p, d1, fakeEnd(false));
    expect(r.outcome.reward).toBe(0);
    expect(r.progress.daily).toMatchObject({ attempts: 1, won: false });
    r = applyDaily(r.progress, d1, fakeEnd(true, 12));
    expect(r.outcome).toMatchObject({ firstWin: true, reward: dailyReward(1), streak: 1 });
    r = applyDaily(r.progress, d1, fakeEnd(true, 30));
    expect(r.outcome).toMatchObject({ firstWin: false, reward: 0, newBest: true });
    expect(r.progress.daily).toMatchObject({ attempts: 3, bestHp: 30 });
    p = r.progress;
    // The next day continues the streak. One missed day a week is forgiven; a second within the week resets it.
    r = applyDaily(p, '2026-03-02', fakeEnd(true));
    expect(r.outcome.streak).toBe(2);
    expect(r.outcome.reward).toBe(dailyReward(2));
    expect(r.progress.daily).toMatchObject({ key: '2026-03-02', attempts: 1 });
    r = applyDaily(r.progress, '2026-03-04', fakeEnd(true)); // missed the 3rd: grace
    expect(r.outcome.streak).toBe(3);
    expect(r.progress.dailyStreak?.grace).toBe('2026-03-04');
    r = applyDaily(r.progress, '2026-03-06', fakeEnd(true)); // missed the 5th, grace already spent this week
    expect(r.outcome.streak).toBe(1);
    expect(r.progress.dailyStreak?.best).toBe(3);
    r = applyDaily(r.progress, '2026-03-07', fakeEnd(true));
    r = applyDaily(r.progress, '2026-03-12', fakeEnd(true)); // four days missed: no grace covers that
    expect(r.outcome.streak).toBe(1);
    // Every first win recovers the next dispatch.
    expect(r.progress.dailyWins).toBe(6);
    expect(r.outcome.dispatch).toBe(6);
  });

  it('day keys roll over months and years', () => {
    expect(prevDay('2026-03-01')).toBe('2026-02-28');
    expect(prevDay('2026-01-01')).toBe('2025-12-31');
    expect(dailyReward(1)).toBeLessThan(dailyReward(7));
    expect(dailyReward(30)).toBe(dailyReward(7));
  });
});
