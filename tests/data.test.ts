import { describe, expect, it } from 'vitest';
import { budgetOf, CARDS, defaultConfig, FACTIONS, STARTER_DECKS, treeRows } from '../src/engine';

const OPS = new Set(['heal', 'damage', 'strain', 'vent', 'draw', 'discard', 'energy', 'drain', 'buff', 'sabotage', 'reveal', 'negate', 'reflect', 'mod']);

describe('Card pool', () => {
  it('has 15 tech cards', () => {
    expect(CARDS.filter((c) => c.faction === 'tech')).toHaveLength(15);
  });

  for (const f of FACTIONS) {
    describe(f, () => {
      const pool = CARDS.filter((c) => c.faction === f);
      it('has 11 standard cards and exactly 1 Signature', () => {
        expect(pool.filter((c) => !c.signature)).toHaveLength(11);
        expect(pool.filter((c) => c.signature)).toHaveLength(1);
      });
      it('has at least 5 grafts covering every slot, 1+ Toxin and 1+ Protocol', () => {
        const grafts = pool.filter((c) => c.type === 'graft');
        expect(grafts.length).toBeGreaterThanOrEqual(5);
        for (const slot of ['Head', 'Limb', 'Organ', 'Nerve']) expect(grafts.some((g) => g.slot === slot)).toBe(true);
        expect(pool.some((c) => c.type === 'toxin')).toBe(true);
        expect(pool.some((c) => c.type === 'protocol')).toBe(true);
      });
    });
  }

  it('tech covers anti-Toxin, graft removal, vent, card draw and anti-armor', () => {
    const tech = CARDS.filter((c) => c.faction === 'tech');
    const ops = (c: (typeof CARDS)[number]) => c.effect.ops ?? [];
    expect(tech.some((c) => c.type === 'protocol' && c.effect.reactsTo?.includes('toxin') && ops(c).some((o) => o.op === 'negate'))).toBe(true);
    expect(tech.some((c) => c.type === 'sabotage' && ops(c).some((o) => o.op === 'sabotage' && o.mode === 'sever'))).toBe(true);
    expect(tech.some((c) => ops(c).some((o) => o.op === 'vent'))).toBe(true);
    expect(tech.some((c) => ops(c).some((o) => o.op === 'draw'))).toBe(true);
    expect(tech.some((c) => ops(c).some((o) => o.op === 'buff' && o.who === 'opp' && o.stat === 'armor' && o.amount < 0))).toBe(true);
  });

  it('has a real Energy curve from 0 to 4 (the cap stays 6 for combos; a 5-6 cost card was almost never castable, see the README sixth pass)', () => {
    const costs = new Set(CARDS.map((c) => c.cost));
    for (let c = 0; c <= 4; c++) expect(costs.has(c)).toBe(true);
    expect(Math.max(...costs)).toBeLessThanOrEqual(defaultConfig.energy.cap - 1); // replacing costs 1 extra, so every card stays castable that way
    const count = (c: number) => CARDS.filter((x) => x.cost === c).length;
    expect(count(1) + count(2)).toBeGreaterThan(count(5) + count(6) + count(4)); // cheap cards outnumber expensive ones
  });

  it('gives every card the required fields and a machine-readable effect', () => {
    for (const c of CARDS) {
      for (const k of ['id', 'name', 'faction', 'type', 'cost', 'strain', 'attack', 'armor', 'text', 'signature', 'effect', 'budgetNote']) expect(c, `${c.id}.${k}`).toHaveProperty(k);
      expect(c.budgetNote.length, c.id).toBeGreaterThan(10);
      if (c.type === 'graft') expect(c.slot, c.id).toBeTruthy();
      else expect(c.effect.ops?.length, `${c.id} needs ops`).toBeGreaterThan(0);
      if (c.type === 'protocol') expect(c.effect.reactsTo?.length, c.id).toBeGreaterThan(0);
      if (c.type === 'sabotage') expect(c.effect.target, c.id).toBe('enemySlot');
      const all = [...(c.effect.ops ?? []), ...(c.effect.abilities ?? []).flatMap((a) => a.ops)];
      for (const op of all) expect(OPS.has(op.op), `${c.id}: unknown op ${op.op}`).toBe(true);
    }
  });

  it('keeps every card within the power budget (1.5 x Strain + 1 + Cost)', () => {
    for (const c of CARDS) {
      const r = budgetOf(c, defaultConfig);
      expect(Math.abs(r.diff), `${c.id}: target ${r.target}, actual ${r.total}`).toBeLessThanOrEqual(defaultConfig.budget.tolerance);
    }
  });

  it('keeps zero-Strain grafts weak', () => {
    for (const c of CARDS.filter((x) => x.type === 'graft' && x.strain === 0)) {
      const r = budgetOf(c, defaultConfig);
      expect(r.total, c.id).toBeLessThanOrEqual(2);
    }
  });

  it('only references card ids that exist in starter decks', () => {
    const ids = new Set(CARDS.map((c) => c.id));
    for (const f of FACTIONS) for (const id of STARTER_DECKS[f]) expect(ids.has(id)).toBe(true);
  });
});

describe('Evolution config (live values)', () => {
  const METRICS = ['damageDealt', 'endRoundStrain', 'oppRejections', 'oppMaxStrain', 'strainVented', 'damageBlocked'];
  it('gives every faction two evolutions with a known metric and a positive target', () => {
    for (const f of FACTIONS) {
      const defs = (defaultConfig.evolutions as Record<string, { id: string; condition: { metric: string; target: number }; effects: object }[]>)[f];
      expect(defs, f).toHaveLength(2);
      for (const d of defs) {
        expect(METRICS, d.id).toContain(d.condition.metric);
        expect(d.condition.target, d.id).toBeGreaterThan(0);
        expect(Object.keys(d.effects).length, d.id).toBeGreaterThan(0);
      }
    }
  });

  it("never gives a faction's two forms the same trigger metric (they must be reachable in visibly different ways)", () => {
    for (const f of FACTIONS) {
      const defs = (defaultConfig.evolutions as Record<string, { id: string; condition: { metric: string } }[]>)[f];
      expect(defs[0].condition.metric, f).not.toBe(defs[1].condition.metric);
    }
  });
});

describe('Skill trees', () => {
  it('give every faction 3 nodes in each of Grafts / Strain / Stance plus the shared Evolution row', () => {
    for (const f of FACTIONS) {
      const rows = treeRows(f);
      expect(rows.map((r) => r.id)).toEqual(['grafts', 'strain', 'stance', 'evolution']);
      for (const r of rows) expect(r.nodes).toHaveLength(3);
    }
  });
});
