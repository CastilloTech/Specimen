import { describe, expect, it } from 'vitest';
import { budgetOf, CARDS, CHIPS, defaultConfig, FACTIONS, starterDeck, WORLD_FACTIONS } from '../src/engine';
import type { Ability, CardDef, Op } from '../src/engine';

const OPS = new Set(['heal', 'damage', 'strain', 'vent', 'draw', 'discard', 'energy', 'drain', 'buff', 'sabotage', 'reveal', 'negate', 'reflect', 'mod', 'graftDamage', 'status', 'purge', 'integrityHeal']);

/** The bit of an op that makes it a genuinely different mechanic, not just a different number. */
function opShape(op: Op): string {
  switch (op.op) {
    case 'damage':
    case 'strain':
    case 'discard':
      return `${op.op}:${op.who ?? 'opp'}`;
    case 'buff':
      return `buff:${op.who ?? 'self'}:${op.stat}`;
    case 'mod':
      return `mod:${op.stat}${op.per ? `:${op.per.what}` : ''}`;
    case 'sabotage':
      return `sabotage:${op.mode}`;
    case 'status':
      return `status:${op.kind}`;
    case 'purge':
      return `purge:${op.who ?? 'self'}`;
    default:
      return op.op;
  }
}

function abilityShape(ab: Ability): string {
  return `${ab.trigger}|${ab.cond ? 'cond' : 'nocond'}|${ab.ops.map(opShape).sort().join(',')}`;
}

/** A card's mechanical shape: for grafts, its sorted set of triggered-ability shapes; for everything else,
 * its sorted set of instant op shapes plus (protocols only) the sorted list of what it reacts to. Two cards
 * with the same shape are the same mechanic with different numbers, not two genuinely different cards. */
function cardShape(c: CardDef): string {
  if (c.type === 'graft') return (c.effect.abilities ?? []).map(abilityShape).sort().join(';');
  const opsSig = (c.effect.ops ?? []).map(opShape).sort().join(',');
  const reacts = c.type === 'protocol' ? [...(c.effect.reactsTo ?? [])].sort().join(',') : '';
  return `${opsSig}|${reacts}`;
}

describe('Card pool', () => {
  it('has 18 tech cards', () => {
    expect(CARDS.filter((c) => c.faction === 'tech')).toHaveLength(18);
  });

  for (const f of FACTIONS) {
    describe(f, () => {
      const pool = CARDS.filter((c) => c.faction === f);
      it('has 14 standard cards and exactly 1 Signature', () => {
        expect(pool.filter((c) => !c.signature)).toHaveLength(14);
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
    for (const f of FACTIONS) for (const w of WORLD_FACTIONS) for (const id of starterDeck(f, w)) expect(ids.has(id)).toBe(true);
  });

  it('gives every graft a real ability: no vanilla stat-sticks', () => {
    for (const c of CARDS.filter((x) => x.type === 'graft')) expect((c.effect.abilities ?? []).length, c.id).toBeGreaterThan(0);
  });

  it("ties every World Faction graft's ability to that World Faction's own mechanic", () => {
    // Matches the taglines already shipped in WORLD_FACTION_META: Corrosion -> integrity damage/Bleed,
    // Aegis -> integrity healing/Purge (it manages statuses rather than inflicting one), Miasma ->
    // Numb/Fever, Hollow -> Necrosis/Purge.
    const signatureOps: Record<string, string[]> = {
      corrosion: ['graftDamage', 'status'],
      aegis: ['integrityHeal', 'purge'],
      miasma: ['status'],
      hollow: ['sabotage', 'purge', 'drain', 'discard'],
    };
    for (const wf of WORLD_FACTIONS) {
      for (const c of CARDS.filter((x) => x.faction === wf && x.type === 'graft')) {
        const ops = (c.effect.abilities ?? []).flatMap((a) => a.ops.map((o) => o.op));
        expect(ops.some((op) => signatureOps[wf].includes(op)), `${c.id}: no ${wf} signature op among [${ops.join(',')}]`).toBe(true);
      }
    }
  });

  it('gives no two cards in the whole pool the same effect shape', () => {
    const seen = new Map<string, string>();
    for (const c of CARDS) {
      const shape = cardShape(c);
      const owner = seen.get(shape);
      expect(owner, `${c.id} duplicates the effect shape of ${owner ?? ''} ("${shape}")`).toBeUndefined();
      seen.set(shape, c.id);
    }
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

describe('Chips', () => {
  // Most chip nodes work by summing a shared, engine-implemented param key (sumLoadoutParam) rather than
  // each needing a bespoke hook - this pins the set of keys the engine actually reads, so a typo'd or
  // stale key in chips.json (a silently-dead node) fails loudly instead of just never doing anything.
  const KNOWN_PARAM_KEYS = new Set([
    'flatAttack',
    'flatArmor',
    'flatIntegrity',
    'graftDamageBonus',
    'graftDamageReduction',
    'bleedRoundsBonus',
    'numbRoundsBonus',
    'feverRoundsBonus',
    'necrosisRoundsBonus',
    'poisonRoundsBonus',
    'disableRoundsBonus',
    'killHeal',
    'killStrain',
    'killIntegrityHeal',
    'killDraw',
    'severHeal',
    'necrosisVent',
    'purgeHeal',
    'purgeVent',
    'purgeIntegrityHeal',
    'worldCardDiscount',
    'firstGraftDiscount',
    'replaceCostReduction',
    'cycleVentBonus',
    'firstDrawRoundBonus',
    'veteranThresholdReduction',
    'holdVentBonus',
    'integrityRegen',
    'perGraftAttack',
    'perGraftArmor',
  ]);

  it('gives every World Faction exactly 3 chips of exactly 2 rows x 2 nodes', () => {
    for (const wf of WORLD_FACTIONS) expect(CHIPS.filter((c) => c.worldFaction === wf)).toHaveLength(3);
    for (const c of CHIPS) {
      expect(c.tree, c.id).toHaveLength(2);
      for (const row of c.tree) expect(row.nodes, `${c.id}/${row.id}`).toHaveLength(2);
    }
  });

  it('only uses known, engine-implemented loadout-param keys', () => {
    for (const c of CHIPS) for (const row of c.tree) for (const n of row.nodes) for (const key of Object.keys(n.params)) expect(KNOWN_PARAM_KEYS.has(key), `${c.id}/${n.id}: unknown param "${key}"`).toBe(true);
  });

  it('gives every node a name and non-empty text', () => {
    for (const c of CHIPS) for (const row of c.tree) for (const n of row.nodes) {
      expect(n.name.length, `${c.id}/${n.id}`).toBeGreaterThan(0);
      expect(n.text.length, `${c.id}/${n.id}`).toBeGreaterThan(0);
    }
  });

  it('has no duplicate chip or node ids', () => {
    const chipIds = CHIPS.map((c) => c.id);
    expect(new Set(chipIds).size).toBe(chipIds.length);
    const nodeIds = CHIPS.flatMap((c) => c.tree.flatMap((r) => r.nodes.map((n) => n.id)));
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
  });

  it('gives every node a genuinely different shape: no two nodes share the same (param key, condition)', () => {
    // A node's shape is its param key paired with its gating condition (or "none"): a node granting
    // flatAttack unconditionally and one granting flatAttack only while Overclocked are different shapes,
    // but two nodes with the identical key AND identical condition are just the same mechanic twice.
    const seen = new Map<string, string>();
    for (const c of CHIPS) {
      for (const row of c.tree) {
        for (const n of row.nodes) {
          const condKey = n.cond ? JSON.stringify(Object.entries(n.cond).sort()) : 'none';
          for (const key of Object.keys(n.params)) {
            const shape = `${key}|${condKey}`;
            const owner = seen.get(shape);
            expect(owner, `${c.id}/${n.id} duplicates the shape of ${owner ?? ''}`).toBeUndefined();
            seen.set(shape, `${c.id}/${n.id}`);
          }
        }
      }
    }
  });
});
