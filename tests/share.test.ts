import { describe, expect, it } from 'vitest';
import { playBotMatch, replay } from '../src/engine';
import { applyDaily, dailyChallenge, dailySetup, dailyShareText } from '../src/ui/daily';
import { startProgress } from '../src/ui/modes';
import { readIncoming, replayCode, replayFromCode, roundGrid } from '../src/ui/share';
import type { SavedReplay } from '../src/ui/storage';

const bots = (setup: ReturnType<typeof dailySetup>) => ({ ...setup, players: [{ ...setup.players[0], isBot: true, ai: 'basic' as const }, { ...setup.players[1], ai: 'basic' as const }] as typeof setup.players });

describe('replay links', () => {
  it('carry a whole match: the decoded replay rebuilds the same final state', async () => {
    const setup = bots(dailySetup(dailyChallenge('2026-09-29', 'You')));
    const end = playBotMatch(setup);
    const r: SavedReplay = { id: 'x', at: 1, me: 0, names: ['You', 'Them'], result: 'win', rounds: end.round, label: 'Quick match', setup, actions: end.history };
    const code = await replayCode(r);
    expect(code.startsWith('SPR1.')).toBe(true);
    expect(code.length).toBeLessThan(6000); // fits a link comfortably
    const back = await replayFromCode(code);
    expect(back.names).toEqual(['You', 'Them']);
    expect(replay(back.setup, back.actions).log).toEqual(end.log);
  });

  it('reject other codes and garbage', async () => {
    await expect(replayFromCode('SPS1.abc')).rejects.toThrow();
    await expect(replayFromCode('nonsense')).rejects.toThrow();
  });

  it('are recognised in the URL fragment, like the daily link', () => {
    expect(readIncoming('#replay=SPR1.abc_-')).toEqual({ kind: 'replay', code: 'SPR1.abc_-' });
    expect(readIncoming('#daily')).toEqual({ kind: 'daily' });
    expect(readIncoming('')).toBeNull();
    expect(readIncoming('#other')).toBeNull();
  });
});

describe('daily result text', () => {
  it('has one square per round and keeps the best win to share and watch', () => {
    const key = '2026-09-29';
    const d = dailyChallenge(key, 'You');
    let won = null;
    for (let i = 0; i < 30 && !won; i++) {
      const s = playBotMatch({ ...bots(dailySetup(d)), seed: d.seed }, 100 + i);
      if (s.result?.winner === 0) won = s;
    }
    expect(won).not.toBeNull();
    const grid = roundGrid(won!, 0);
    expect([...grid].length).toBe(won!.snapshots.length - 1);
    expect(grid).toMatch(/^[🟩🟥⬜]+$/u);
    const p = startProgress('predator', 'corrosion', 'x');
    const r = applyDaily(p, key, won!);
    expect(r.progress.daily?.bestGrid).toBe(grid);
    expect(r.progress.daily?.bestActions).toEqual(won!.history);
    const text = dailyShareText(d, r.progress.daily!, 1);
    expect(text).toContain('Specimen daily');
    expect(text).toContain(d.twist.name);
    expect(text).toContain(grid);
    expect(text).toContain('first try');
  });
});
