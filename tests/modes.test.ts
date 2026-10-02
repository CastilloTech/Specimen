import { describe, expect, it } from 'vitest';
import { CARD_MAP, chipsFor, createMatch, FACTIONS, playBotMatch, validateDeck, WORLD_FACTIONS } from '../src/engine';
import { COSTS, craft, craftCost, deckProblems, finalBossDeck, floorInfo, floorMatch, replayableUpTo, replayResult, replayReward, startProgress, starterSet, TOWER_FLOORS, towerResult, unlock } from '../src/ui/modes';
import type { Progress } from '../src/ui/modes';

const fresh = () => startProgress('predator', 'corrosion', chipsFor('corrosion')[0].id);
const rich = (p: Progress, n = 10_000): Progress => ({ ...p, biomass: n });

describe('Game Modes: starting out', () => {
  it('starter sets have no Signatures and the starting deck is legal', () => {
    for (const f of [...FACTIONS, ...WORLD_FACTIONS]) expect(starterSet(f).some((id) => CARD_MAP[id].signature), f).toBe(false);
    const p = fresh();
    expect(validateDeck('predator', 'corrosion', p.deck.cards)).toEqual([]);
    expect(deckProblems(p)).toEqual([]);
    expect(p.chips).toHaveLength(1);
  });
});

describe('Crafting and unlocks', () => {
  it('crafts cards of unlocked pools for biomass, up to the deck limit', () => {
    const sig = Object.values(CARD_MAP).find((c) => c.faction === 'predator' && c.signature && !c.mastery)!;
    let p = rich(fresh());
    const r = craft(p, sig.id);
    expect(typeof r).toBe('object');
    p = r as Progress;
    expect(p.owned[sig.id]).toBe(1);
    expect(p.biomass).toBe(10_000 - craftCost(sig));
    expect(craft(p, sig.id)).toMatch(/most copies/);
    const locked = Object.values(CARD_MAP).find((c) => c.faction === 'bastion')!;
    expect(craft(p, locked.id)).toMatch(/not available/);
    expect(craft(fresh(), sig.id)).toMatch(/biomass/);
  });

  it('unlocking a Build or World Faction grants its starter set (and a Chip for a World Faction)', () => {
    let p = unlock(rich(fresh()), 'build', 'bastion') as Progress;
    expect(p.builds).toContain('bastion');
    expect(p.biomass).toBe(10_000 - COSTS.build);
    p = unlock(p, 'world', 'aegis') as Progress;
    expect(p.chips).toContain(chipsFor('aegis')[0].id);
    p = { ...p, deck: { faction: 'bastion', worldFaction: 'aegis', chip: chipsFor('aegis')[0].id, loadout: [], cards: [...starterSet('bastion'), ...starterSet('aegis'), ...fresh().deck.cards.slice(16)] } };
    p.deck.loadout = createLoadout(p.deck.chip);
    expect(deckProblems(p)).toEqual([]);
    expect(unlock(p, 'chip', chipsFor('hollow')[0].id)).toMatch(/World Faction first/);
  });
});

const createLoadout = (chip: string) => chipsFor('aegis').find((c) => c.id === chip)!.tree.map((r) => r.nodes[0].id);

describe('The Tower', () => {
  it('has the requested structure', () => {
    expect(floorInfo(1).tier).toBe('basic');
    expect(floorInfo(11).tier).toBe('reader');
    expect(floorInfo(26).tier).toBe('search');
    expect([5, 10, 15].every((f) => floorInfo(f).checkpoint)).toBe(true);
    expect([10, 20, 30, 40].every((f) => floorInfo(f).boss === 'faction')).toBe(true);
    expect(floorInfo(TOWER_FLOORS).boss).toBe('final');
    expect(floorInfo(40).twists).toBe(false);
    expect(floorInfo(41).twists && floorInfo(49).twists).toBe(true);
  });

  it('every floor makes a valid match, with bosses, the final boss and twists as specified', () => {
    const me = fresh().deck;
    for (let f = 1; f <= TOWER_FLOORS; f++) {
      const setup = floorMatch(f, 1234, me, 'You');
      expect(() => createMatch(setup), `floor ${f}`).not.toThrow();
      const bot = setup.players[1];
      if (f % 10 === 0 && f < 50) expect(bot.deck.filter((id) => CARD_MAP[id].mastery).length, `floor ${f}`).toBeGreaterThan(0);
      if (f <= 25 && f % 10 !== 0) expect(bot.deck.some((id) => CARD_MAP[id].signature), `floor ${f}`).toBe(false);
      if (f >= 41) {
        const s = createMatch(setup);
        expect(s.players[1].evolution, `floor ${f}`).toBeTruthy();
        expect(s.config.match.meltdownFromRound).toBe(5);
        expect(s.players[0].ventMalus).toBe(1);
      }
    }
    const boss = finalBossDeck();
    const factions = new Set(boss.map((id) => CARD_MAP[id].faction));
    expect(factions.size).toBeGreaterThanOrEqual(5); // draws on (nearly) every pool
  });

  it('a boss floor can be played to the end', () => {
    const s = playBotMatch({ ...floorMatch(10, 99, fresh().deck, 'You'), players: floorMatch(10, 99, fresh().deck, 'You').players.map((p) => ({ ...p, isBot: true, ai: 'basic' })) as never });
    expect(s.phase).toBe('over');
  });

  it('wins pay biomass and advance; checkpoints every 5th floor; a loss drops one floor, never below the checkpoint', () => {
    let p = fresh();
    for (let f = 1; f <= 6; f++) p = towerResult(p, f, true).progress;
    expect(p.tower.floor).toBe(7);
    expect(p.tower.checkpoint).toBe(6);
    expect(p.biomass).toBe([1, 2, 3, 4, 5, 6].reduce((n, f) => n + floorInfo(f).reward, 0));
    const lost = towerResult(p, 7, false);
    expect(lost.reward).toBe(0);
    expect(lost.progress.tower.floor).toBe(6);
    // Higher up: one floor down per loss, until the checkpoint holds.
    let q = p;
    for (let f = 7; f <= 9; f++) q = towerResult(q, f, true).progress; // on floor 10, checkpoint still 6
    expect(q.tower.floor).toBe(10);
    q = towerResult(q, 10, false).progress;
    expect(q.tower.floor).toBe(9);
    for (const f of [9, 8, 7, 6, 6]) {
      expect(q.tower.floor).toBe(f);
      q = towerResult(q, f, false).progress;
    }
    expect(q.tower.floor).toBe(6); // the checkpoint holds
    // From the very start (no checkpoint yet), floor 1 is the floor.
    expect(towerResult(fresh(), 1, false).progress.tower.floor).toBe(1);
    expect(towerResult(towerResult(fresh(), 1, true).progress, 2, false).progress.tower.floor).toBe(1);
    const cleared = towerResult({ ...p, tower: { ...p.tower, floor: 50 } }, 50, true);
    expect(cleared.cleared).toBe(true);
    expect(cleared.progress.tower).toMatchObject({ floor: 1, checkpoint: 1, clears: 1 });
  });

  it('replays pay a quarter of the reward and never move you', () => {
    let p = fresh();
    for (let f = 1; f <= 7; f++) p = towerResult(p, f, true).progress;
    expect(replayableUpTo(p.tower)).toBe(7);
    const before = p.tower;
    const won = replayResult(p, 5, true);
    expect(won.reward).toBe(replayReward(5));
    expect(replayReward(5)).toBe(Math.round(floorInfo(5).reward / 4));
    expect(won.progress.tower).toEqual(before);
    expect(won.progress.biomass).toBe(p.biomass + replayReward(5));
    const lost = replayResult(p, 5, false);
    expect(lost.progress).toEqual(p);
  });
});

describe('Biomass economy', () => {
  it('a Tower floor pays in full only the first time: climbing back after a loss pays the replay rate', () => {
    let p = fresh();
    for (let f = 1; f <= 7; f++) p = towerResult(p, f, true).progress; // best 7, checkpoint 6
    p = towerResult(p, 8, false).progress; // down one floor, to 7
    expect(p.tower.floor).toBe(7);
    const again = towerResult(p, 7, true);
    expect(again.reward).toBe(replayReward(7));
    let q = again.progress;
    const fresh8 = towerResult(q, 8, true);
    expect(fresh8.reward).toBe(floorInfo(8).reward); // a new floor pays in full
    q = fresh8.progress;
    expect(q.tower.best).toBe(8);
  });

  it('a later run pays the replay rate for floors already cleared', () => {
    let p = fresh();
    p = { ...p, tower: { ...p.tower, floor: 1, checkpoint: 1, best: TOWER_FLOORS, clears: 1 } };
    expect(towerResult(p, 1, true).reward).toBe(replayReward(1));
    expect(towerResult({ ...p, tower: { ...p.tower, floor: 50 } }, 50, true).reward).toBe(replayReward(50));
  });

  it('Breach waves pay a little more each wave, up to a cap', async () => {
    const { waveReward, WAVE_REWARD_CAP } = await import('../src/ui/breach');
    expect(waveReward(2)).toBeGreaterThan(waveReward(1) - 1);
    expect(waveReward(20)).toBeGreaterThan(waveReward(2));
    expect(waveReward(200)).toBe(WAVE_REWARD_CAP);
  });

  it('unlocking everything costs a real grind: over 12,000 biomass', () => {
    let total = (FACTIONS.length - 1) * COSTS.build + (WORLD_FACTIONS.length - 1) * COSTS.world;
    total += (WORLD_FACTIONS.reduce((n, w) => n + chipsFor(w).length, 0) - 1) * COSTS.chip;
    for (const c of Object.values(CARD_MAP)) if (!c.mastery) total += (c.signature ? 1 : 2) * craftCost(c);
    expect(total).toBeGreaterThan(12_000);
  });
});
