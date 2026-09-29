import { describe, expect, it } from 'vitest';
import { chipsFor, computeStats, createMatch, MUTATIONS, playBotMatch } from '../src/engine';
import { applyLineageMatch, chooseMutation, lineageMatch, LINEAGE_MATCHES, LOSS_SCAR, MATRIARCH_HP, MAX_LOSSES, MIN_MAX_HP, mutationOffer, RIVAL_HP, scarsFrom, startLineage } from '../src/ui/lineage';
import type { LineageState } from '../src/ui/lineage';
import { startProgress } from '../src/ui/modes';

const progress = () => startProgress('bastion', 'aegis', chipsFor('aegis')[0].id);
const fresh = () => startLineage(progress(), 'Lin');

describe('Lineage engine hooks', () => {
  it('a scarred Specimen starts at its lower max HP, without its lost slots, and heals only up to it', () => {
    const l: LineageState = { ...fresh(), maxHp: 30, lostSlots: ['limbB'] };
    const s = createMatch(lineageMatch(l, 'You'));
    expect(s.players[0].hp).toBe(30);
    expect(s.players[0].maxHp).toBe(30);
    expect(s.players[0].slots).not.toContain('limbB');
    expect(s.snapshots[0].hp[0]).toBe(30);
  });

  it('mutations add their params like Chip nodes', () => {
    const base = createMatch(lineageMatch(fresh(), 'You'));
    const mutated = createMatch(lineageMatch({ ...fresh(), mutations: ['serratedBones', 'chitinPlates'] }, 'You'));
    const a = computeStats(base, base.players[0]);
    const b = computeStats(mutated, mutated.players[0]);
    expect(b.attack - a.attack).toBe(1);
    expect(b.armor - a.armor).toBe(1);
  });

  it('every campaign match makes a valid, playable match', () => {
    let l = fresh();
    for (let m = 1; m <= LINEAGE_MATCHES; m++) {
      l = { ...l, match: m };
      expect(() => createMatch(lineageMatch(l, 'You')), `match ${m}`).not.toThrow();
    }
    const setup = lineageMatch({ ...fresh(), maxHp: 28, lostSlots: ['nerve'], mutations: ['mendingTissue'] }, 'You');
    const s = playBotMatch({ ...setup, players: setup.players.map((p) => ({ ...p, isBot: true, ai: 'basic' })) as never });
    expect(s.phase).toBe('over');
  });
});

describe('Scars and mutations', () => {
  it('rejections kill their slot (keeping at least 3), losses cost LOSS_SCAR max HP, near-death wins cost 2', () => {
    const l = fresh();
    expect(scarsFrom(l, true, 20, [])).toMatchObject({ maxHp: 40, lostSlots: [] });
    expect(scarsFrom(l, false, 0, []).maxHp).toBe(40 - LOSS_SCAR);
    expect(scarsFrom(l, true, 5, []).maxHp).toBe(38);
    const r = scarsFrom(l, true, 20, ['limbA']);
    expect(r.lostSlots).toEqual(['limbA']);
    const worn = { ...l, lostSlots: ['limbA', 'limbB'] as LineageState['lostSlots'] };
    const r2 = scarsFrom(worn, true, 20, ['head']);
    expect(r2.lostSlots).toHaveLength(2); // 5 slots - 2 lost = 3: none can be spared
    expect(r2.maxHp).toBe(38);
  });

  it('a win offers three mutations; choosing one keeps it, campaign ones apply at once', () => {
    const l = fresh();
    const offer = mutationOffer(l, []);
    expect(offer).toHaveLength(3);
    expect(offer).not.toContain('regrowth'); // nothing to regrow yet
    const picked = chooseMutation({ ...l, offer }, offer[0]);
    expect(picked.mutations).toContain(offer[0]);
    expect(picked.offer).toBeNull();
    const hardened = chooseMutation({ ...l, maxHp: 30, offer: ['hardenedFlesh'] }, 'hardenedFlesh');
    expect(hardened.maxHp).toBe(34);
    const regrown = chooseMutation({ ...l, lostSlots: ['limbA'], offer: ['regrowth'] }, 'regrowth');
    expect(regrown.lostSlots).toEqual([]);
    expect(MUTATIONS.length).toBeGreaterThanOrEqual(12);
  });

  it('rivals are smaller Specimens: a Matriarch is bigger, and the Progenitor has full HP', () => {
    const hpAt = (match: number) => createMatch(lineageMatch({ ...fresh(), match }, 'You')).players[1].maxHp;
    expect(hpAt(1)).toBe(RIVAL_HP);
    expect(hpAt(4)).toBe(MATRIARCH_HP); // match 4 is Tower floor 10, a Faction Boss
    expect(lineageMatch({ ...fresh(), match: 4 }, 'You').players[1].name).toMatch(/^Matriarch of the /);
    expect(hpAt(10)).toBe(40);
  });

  it('the lineage dies at its loss limit and completes after 10 matches', () => {
    let l = fresh();
    const lose = (x: LineageState) => applyLineageMatch(x, { ...createMatch(lineageMatch(x, 'You')), result: { winner: 1, reason: '' } } as never);
    for (let i = 0; i < MAX_LOSSES; i++) l = lose(l).lineage;
    expect(l.status).toBe('dead');
    const win = (x: LineageState) => applyLineageMatch(x, { ...createMatch(lineageMatch(x, 'You')), result: { winner: 0, reason: '' } } as never);
    let w = fresh();
    for (let i = 0; i < LINEAGE_MATCHES; i++) {
      const r = win(w);
      w = r.lineage.offer ? chooseMutation(r.lineage, r.lineage.offer[0]) : r.lineage;
    }
    expect(w.status).toBe('complete');
    expect(w.mutations.length).toBe(LINEAGE_MATCHES - 1); // an offer after every win but the last
  });

  it('a new lineage inherits one non-campaign mutation', () => {
    expect(startLineage(progress(), 'Next', 'venomSacs').mutations).toEqual(['venomSacs']);
    expect(startLineage(progress(), 'Next', 'hardenedFlesh').mutations).toEqual([]);
  });

  it('a scarred Specimen dies when its max HP falls below the line, even before its third loss', () => {
    const l: LineageState = { ...fresh(), maxHp: MIN_MAX_HP + 2, losses: 1 };
    const r = applyLineageMatch(l, { ...createMatch(lineageMatch(l, 'You')), result: { winner: 1, reason: '' } } as never);
    expect(r.lineage.maxHp).toBeLessThan(MIN_MAX_HP);
    expect(r.lineage.status).toBe('dead');
    expect(r.lineage.losses).toBeLessThan(MAX_LOSSES);
  });

  it('match 9 brings Tower rule twists and match 10 is the Progenitor', () => {
    const nine = createMatch(lineageMatch({ ...fresh(), match: 9 }, 'You'));
    expect(nine.players[1].evolution).toBeTruthy();
    expect(nine.players[0].ventMalus).toBe(1);
    expect(nine.config.match.meltdownFromRound).toBe(5);
    const ten = lineageMatch({ ...fresh(), match: 10 }, 'You');
    expect(ten.players[1].name).toBe('The Progenitor');
    expect(ten.players[1].ai).toBe('search');
  });
});
