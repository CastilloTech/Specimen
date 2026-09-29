import { budgetOf, CARD_MAP, CARDS, defaultConfig, engineSynergy } from '../engine';
import type { CardDef, CardType, EngineId, Faction, WorldFactionId } from '../engine';
import { ENGINE_META } from './meta';

// Deck-building help: the numbers behind a deck (curve, card types, Strain, slot coverage) with plain
// warnings, and an auto-fill that completes a deck to a legal 20 with sensible picks.

const D = defaultConfig.deck;
const SLOT_TYPES = [...new Set(Object.values(defaultConfig.slotTypes as Record<string, string>))];

export interface DeckStats {
  size: number;
  /** Cards at each Energy cost: 0, 1, 2, 3, 4, 5+. */
  curve: number[];
  avgCost: number;
  types: Record<CardType, number>;
  grafts: number;
  /** Average Strain a graft adds, and the whole deck's graft Strain. */
  avgGraftStrain: number;
  /** Grafts per slot type (Head, Limb, Organ, Nerve). */
  slots: Record<string, number>;
  /** Engine pieces in the deck: enablers and payoffs per engine. */
  engines: Partial<Record<EngineId, { enablers: number; payoffs: number }>>;
  warnings: string[];
}

export function deckStats(deck: string[]): DeckStats {
  const cards = deck.map((id) => CARD_MAP[id]).filter(Boolean);
  const curve = [0, 0, 0, 0, 0, 0];
  const types: Record<CardType, number> = { graft: 0, serum: 0, toxin: 0, sabotage: 0, protocol: 0 };
  const slots: Record<string, number> = Object.fromEntries(SLOT_TYPES.map((s) => [s, 0]));
  let strain = 0;
  const engines: DeckStats['engines'] = {};
  for (const c of cards) {
    for (const t of c.engines ?? []) {
      const e = (engines[t.id] ??= { enablers: 0, payoffs: 0 });
      if (t.role === 'payoff') e.payoffs++;
      else e.enablers++;
    }
    curve[Math.min(5, c.cost)]++;
    types[c.type]++;
    if (c.type === 'graft') {
      strain += c.strain;
      if (c.slot) slots[c.slot] = (slots[c.slot] ?? 0) + 1;
    }
  }
  const n = cards.length;
  const grafts = types.graft;
  const avgCost = n ? cards.reduce((a, c) => a + c.cost, 0) / n : 0;
  const avgGraftStrain = grafts ? strain / grafts : 0;
  const cheap = curve[0] + curve[1] + curve[2];
  const warnings: string[] = [];
  if (n >= 8) {
    if (cheap < Math.round(n * 0.35)) warnings.push(`Few cheap cards (${cheap} cost 2 or less): round 1 has only ${defaultConfig.energy.min} Energy, so early rounds may pass empty.`);
    if (avgCost > 3) warnings.push(`Heavy deck (average cost ${avgCost.toFixed(1)}): expensive cards pile up in your hand before you can afford them.`);
    if (grafts < Math.round(n * 0.35)) warnings.push(`Few grafts (${grafts}): grafts are where your attack and armor come from.`);
    for (const s of SLOT_TYPES) if (slots[s] === 0) warnings.push(`No ${s} grafts: that slot will stay empty.`);
    if (avgGraftStrain >= 2.8) warnings.push(`High-Strain grafts (${avgGraftStrain.toFixed(1)} each): plan to vent with Fortify, Hold or Cycle, or you'll reject grafts.`);
    if (types.protocol === 0) warnings.push("No Protocols: you can't answer your opponent's plays.");
  }
  for (const [id, e] of Object.entries(engines)) if (e!.payoffs > 0 && e!.enablers < 3) warnings.push(`Few enablers for ${ENGINE_META[id as EngineId].name} (${e!.enablers}): its payoffs need 3 or more to fire reliably.`);
  return { size: n, curve, avgCost, types, grafts, avgGraftStrain, slots, engines, warnings };
}

// A card's power-budget margin never changes during a session, so it is worked out once per card.
const STRENGTH = new Map<string, number>();
const strengthOf = (c: CardDef) => {
  let v = STRENGTH.get(c.id);
  if (v === undefined) {
    const r = budgetOf(c, defaultConfig);
    v = r.total - r.target;
    STRENGTH.set(c.id, v);
  }
  return v;
};

/**
 * Complete a deck to the legal size: first the Build and World Faction minimums, then the best remaining
 * picks. Picks favour what the deck lacks (cheap cards, an empty slot type, a first Protocol, enough grafts)
 * and otherwise the stronger card by the power budget; a new card beats a second copy. Only adds cards.
 */
export function autoFill(faction: Faction, worldFaction: WorldFactionId, counts: Record<string, number>, allowed: (c: CardDef) => boolean = () => true, /** Copies available (a Game Modes collection). */ owned?: (c: CardDef) => number): Record<string, number> {
  const out = { ...counts };
  const deck = () => Object.entries(out).flatMap(([id, k]) => Array<string>(k).fill(id));
  const count = (f: string) => deck().filter((id) => CARD_MAP[id]?.faction === f).length;
  const room = (c: CardDef) => (out[c.id] ?? 0) < Math.min(c.signature ? D.signatureCopies : D.maxCopies, owned ? owned(c) : Infinity);
  const pool = CARDS.filter((c) => (c.faction === faction || c.faction === worldFaction || c.faction === 'tech') && allowed(c));
  /** A candidate's value against the deck as it stands (its stats are computed once per pick, not per card). */
  const score = (c: CardDef, cur: string[], s: DeckStats) => {
    let v = strengthOf(c);
    if ((out[c.id] ?? 0) > 0) v -= 0.75;
    if (c.cost <= 2 && s.curve[0] + s.curve[1] + s.curve[2] < 7) v += 1.5;
    if (c.cost >= 5 && s.curve[5] >= 2) v -= 2;
    if (c.type === 'graft' && s.grafts < 9) v += 1;
    if (c.type === 'graft' && c.slot && s.slots[c.slot] === 0) v += 2;
    if (c.type === 'protocol' && s.types.protocol === 0) v += 1.5;
    // Keep engines together: a piece is worth more next to the other half of its engine.
    v += engineSynergy(c, cur, []) * 1.2;
    return v;
  };
  const pick = (ok: (c: CardDef) => boolean) => {
    const cands = pool.filter((c) => ok(c) && room(c));
    if (!cands.length) return false;
    const cur = deck();
    const s = deckStats(cur);
    // The highest score wins; ties go to the smaller id, so the result never depends on pool order.
    let best = cands[0];
    let bestV = score(best, cur, s);
    for (let i = 1; i < cands.length; i++) {
      const v = score(cands[i], cur, s);
      if (v > bestV || (v === bestV && cands[i].id < best.id)) {
        best = cands[i];
        bestV = v;
      }
    }
    out[best.id] = (out[best.id] ?? 0) + 1;
    return true;
  };
  while (deck().length < D.size && count(faction) < D.minBuild && pick((c) => c.faction === faction));
  while (deck().length < D.size && count(worldFaction) < D.minWorldFaction && pick((c) => c.faction === worldFaction));
  while (deck().length < D.size && pick((c) => c.faction !== 'tech' || count('tech') < D.maxTech));
  return out;
}
