import { describe, expect, it } from 'vitest';
import { CARD_MAP, chipsFor, createMatch, defaultConfig, playBotMatch } from '../src/engine';
import { afterWave, BETWEEN_HEAL_PCT, BETWEEN_VENT, betweenHeal, ESCAPEE_HP, startBreach, waveMatch, waveStrength, wavesSurvived } from '../src/ui/breach';
import type { BreachRun } from '../src/ui/breach';
import { startProgress } from '../src/ui/modes';

const run = (): BreachRun => startBreach(startProgress('predator', 'hollow', chipsFor('hollow')[0].id).deck);
const HP = defaultConfig.specimen.hp;

describe('Containment Breach', () => {
  it('your carried HP and Strain start the match; escapees have 20 HP, 2-3 grafts and no other cards', () => {
    const s = createMatch(waveMatch({ ...run(), wave: 3, hp: 22, strain: 6 }, 'You'));
    expect(s.players[0].hp).toBe(22);
    expect(s.players[0].maxHp).toBe(HP);
    expect(s.players[0].strain).toBe(6);
    const e = s.players[1];
    expect(e.hp).toBe(ESCAPEE_HP);
    expect(e.hand).toHaveLength(0);
    expect(e.deck).toHaveLength(0);
    expect(e.grafts.length).toBeGreaterThanOrEqual(2);
    expect(e.grafts.length).toBeLessThanOrEqual(3);
    expect(e.strain).toBe(e.grafts.reduce((n, g) => n + g.strain, 0));
    expect(e.ai).toBe('basic');
  });

  it('every wave up to 50 makes a valid, playable match, and later waves bring stronger grafts', () => {
    for (let w = 1; w <= 50; w++) {
      const s = createMatch(waveMatch({ ...run(), wave: w }, 'You'));
      expect(s.players[1].grafts.length, `wave ${w}`).toBeGreaterThanOrEqual(2);
      expect(s.players[1].grafts.every((g) => CARD_MAP[g.cardId].cost <= waveStrength(w).maxCost), `wave ${w}`).toBe(true);
    }
    expect(waveStrength(50).maxCost).toBeGreaterThan(waveStrength(1).maxCost);
    const setup = waveMatch({ ...run(), wave: 2, strain: 8 }, 'You');
    expect(playBotMatch({ ...setup, players: setup.players.map((p) => ({ ...p, isBot: true, ai: 'basic' })) as never }).phase).toBe('over');
  });

  it('surviving carries HP and Strain over with only a little healing and venting', () => {
    const r = run();
    const s = createMatch(waveMatch(r, 'You'));
    const won = { ...s, result: { winner: 0, reason: '' }, players: [{ ...s.players[0], hp: 20, strain: 9 }, s.players[1]] } as never;
    const a = afterWave(r, won);
    expect(a.survived).toBe(true);
    expect(a.run).toMatchObject({ wave: 2, hp: 20 + betweenHeal(HP), strain: 9 - BETWEEN_VENT });
    expect(betweenHeal(HP)).toBe(Math.round(HP * BETWEEN_HEAL_PCT));
    expect(BETWEEN_HEAL_PCT).toBeLessThan(0.5); // "only a little healing"
    const nearFull = afterWave(r, { ...s, result: { winner: 0, reason: '' }, players: [{ ...s.players[0], hp: HP - 2 }, s.players[1]] } as never);
    expect(nearFull.run.hp).toBe(HP); // never above max HP
    expect(a.reward).toBeGreaterThan(0);
    expect(wavesSurvived(a.run)).toBe(1);
  });

  it('the first wave you do not win ends the run', () => {
    const r = { ...run(), wave: 7 };
    const s = createMatch(waveMatch(r, 'You'));
    const lost = afterWave(r, { ...s, result: { winner: 1, reason: '' } } as never);
    expect(lost.run.over).toBe(true);
    expect(lost.reward).toBe(0);
    expect(wavesSurvived(lost.run)).toBe(6);
    const draw = afterWave(r, { ...s, result: { winner: null, reason: '' } } as never);
    expect(draw.run.over).toBe(true);
  });
});
