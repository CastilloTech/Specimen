// Flow, part 2: evolution offered without pausing the match, the Clash and play previews, and the next goals.
import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '../src/engine';
import { legalPlays, pendingPlayers } from '../src/engine';
import { previewClash } from '../src/engine/rules';
import { clashPreview, playPreview } from '../src/ui/preview';
import { nextGoals } from '../src/ui/nextGoals';
import { startProgress } from '../src/ui/modes';
import { chipsFor } from '../src/engine';
import { arena, attached, baseMatch, edit, endRound, go, hands, nextRound, setEnergy, setStrain, toActions, tryGo } from './kit';

const deferred = { evolution: { deferredChoice: true } };
const stats = (s: GameState, p: 0 | 1, fn: (st: GameState['players'][0]['stats']) => void) => edit(s, (d) => fn(d.players[p].stats));

describe('Evolution without pausing the match', () => {
  it('a met condition is offered, the round goes on, and the player chooses when they like', () => {
    let s = toActions(baseMatch('predator', 'predator', deferred));
    s = stats(s, 0, (st) => void (st.damageDealt = 11));
    s = endRound(s);
    expect(s.phase).not.toBe('evolve');
    expect(s.round).toBe(2);
    expect(s.players[0].evolutionOptions).toEqual(['apexStalker']);
    expect(tryGo(s, { type: 'CHOOSE_EVOLUTION', player: 1, id: null })).toMatch(/No evolution/);
    s = go(s, { type: 'CHOOSE_EVOLUTION', player: 0, id: 'apexStalker' });
    expect(s.players[0].evolution).toBe('apexStalker');
    expect(s.players[0].evolutionOptions).toEqual([]);
  });

  it('holding off clears the offer until a later Strain check makes it again', () => {
    let s = toActions(baseMatch('predator', 'predator', deferred));
    s = stats(s, 0, (st) => void (st.damageDealt = 11));
    s = endRound(s);
    s = go(s, { type: 'CHOOSE_EVOLUTION', player: 0, id: null });
    expect(s.players[0].evolutionOptions).toEqual([]);
    expect(s.players[0].evolution).toBeNull();
    s = nextRound(s);
    expect(s.players[0].evolutionOptions).toEqual(['apexStalker']);
  });

  it('a bot takes its offer at its next decision', async () => {
    const { botAction } = await import('../src/engine');
    const { makeRng } = await import('../src/engine');
    let s = toActions(baseMatch('predator', 'predator', deferred));
    s = stats(s, 1, (st) => void (st.damageDealt = 11));
    s = endRound(s);
    const p = pendingPlayers(s).includes(1) ? 1 : null;
    expect(p).toBe(1);
    expect(botAction(s, 1, makeRng(1))).toMatchObject({ type: 'CHOOSE_EVOLUTION', player: 1, id: 'apexStalker' });
  });
});

describe('Previews', () => {
  it('the Clash preview matches what the Clash then does, and leaves the match untouched', () => {
    const s = attached(arena('predator', 'bastion'), 0, 'pred_razor_talon', 'limbA');
    const before = JSON.stringify(s);
    const [l0, l1] = previewClash(s);
    expect(JSON.stringify(s)).toBe(before);
    const after = endRound(s);
    const hpLoss = (p: 0 | 1) => s.players[p].hp - after.players[p].hp;
    // The round's Strain check can add more (Bleed, Overclock): the Clash part is at most the total loss.
    expect(l1).toBeLessThanOrEqual(hpLoss(1));
    expect(l0).toBeLessThanOrEqual(hpLoss(0));
    expect(clashPreview(s, 0)).toEqual({ deal: l1, take: l0 });
  });

  it('a play preview shows Strain, Energy and the Clash after the card', () => {
    let s = hands(arena('predator', 'bastion'), ['pred_frenzy_gland'], []);
    s = setEnergy(setStrain(s, 0, 4), 0, 5);
    const play = legalPlays(s, 0).find((a): a is Extract<Action, { type: 'PLAY_CARD' }> => a.type === 'PLAY_CARD' && !a.faceDown)!;
    const p = playPreview(s, 0, play)!;
    expect(p.strain[0]).toBe(4);
    expect(p.strain[1]).toBeGreaterThan(4);
    expect(p.energy[1]).toBeLessThan(p.energy[0]);
    expect(p.clash).not.toBeNull();
  });
});

describe('Next goals', () => {
  it('names mastery progress for what you played, the cheapest unlock, and stays short', () => {
    const p = startProgress('predator', 'corrosion', chipsFor('corrosion')[0].id);
    const g = nextGoals([], { ...p, biomass: 100 }, { faction: 'predator', worldFaction: 'corrosion' }, false);
    expect(g.length).toBeLessThanOrEqual(2);
    expect(g.some((t) => /biomass to unlock|unlock .* now/.test(t))).toBe(true);
    expect(nextGoals([], null, { faction: 'predator', worldFaction: 'corrosion' }, false).every((t) => /mastery/.test(t))).toBe(true);
  });
});
