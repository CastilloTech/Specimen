// Flow helpers: each match's side goal, and Quick match's difficulty adapting to your results.
import { beforeEach, describe, expect, it } from 'vitest';
import { createMatch } from '../src/engine';
import type { GameState } from '../src/engine';
import { objectiveDone, objectiveFailed, pickObjective } from '../src/ui/objectives';
import { quickBotSetup, quickTier, recordQuickResult } from '../src/ui/picks';
import { edit } from './kit';
import { enginesSetup } from '../src/ui/tutorial';

describe('Match objectives', () => {
  const s0 = createMatch(enginesSetup('You'));
  it('are fixed by the seed, and an engine goal names an engine the deck actually pays off', () => {
    expect(pickObjective(s0, 0, 42).id).toBe(pickObjective(s0, 0, 42).id);
    const ids = new Set(Array.from({ length: 40 }, (_, i) => pickObjective(s0, 0, i).id));
    expect(ids.size).toBeGreaterThan(3);
    const engine = [...ids].find((id) => id.startsWith('engine:'));
    expect(engine).toBe('engine:pressure'); // the Part 3 deck is built around Pressure
  });

  it('track progress, need a win when they say so, and fail for good once broken', () => {
    const seed = Array.from({ length: 200 }, (_, i) => i).find((i) => pickObjective(s0, 0, i).id === 'stable')!;
    const o = pickObjective(s0, 0, seed);
    const strained = (n: number, over: boolean, won: boolean): GameState =>
      edit(s0, (d) => {
        d.players[0].stats.maxStrain = n;
        if (over) {
          d.phase = 'over';
          d.result = { winner: won ? 0 : 1, reason: 'test' } as GameState['result'];
        }
      });
    expect(objectiveDone(o, strained(4, false, false), 0)).toBe(false); // needs the win
    expect(objectiveDone(o, strained(4, true, true), 0)).toBe(true);
    expect(objectiveDone(o, strained(4, true, false), 0)).toBe(false);
    expect(objectiveFailed(o, strained(7, false, false), 0)).toBe(true);
  });
});

describe('Quick match difficulty adapts', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it('three wins step the bot up one tier, three losses step it back, never more than one away', () => {
    expect(quickTier()).toBe('basic');
    recordQuickResult('win');
    recordQuickResult('win');
    expect(recordQuickResult('win')).toBe('reader');
    expect(quickBotSetup().players[1].ai).toBe('reader');
    for (let i = 0; i < 6; i++) recordQuickResult('win');
    expect(quickTier()).toBe('reader'); // capped one tier above your pick
    recordQuickResult('loss');
    recordQuickResult('loss');
    expect(recordQuickResult('loss')).toBe('basic');
    recordQuickResult('win'); // a win breaks the losing run
    recordQuickResult('loss');
    recordQuickResult('loss');
    expect(quickTier()).toBe('basic');
    recordQuickResult('loss');
    expect(quickTier()).toBe('basic'); // already the lowest tier
  });
});
