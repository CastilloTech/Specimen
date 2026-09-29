import { budgetOf, CARD_MAP, CARDS, defaultConfig } from '../engine';
import type { CardDef, CardType, Faction, WorldFactionId } from '../engine';

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
  warnings: string[];
}

export function deckStats(deck: string[]): DeckStats {
  const cards = deck.map((id) => CARD_MAP[id]).filter(Boolean);
  const curve = [0, 0, 0, 0, 0, 0];
  const types: Record<CardType, number> = { graft: 0, serum: 0, toxin: 0, sabotage: 0, protocol: 0 };
  const slots: Record<string, number> = Object.fromEntries(SLOT_TYPES.map((s) => [s, 0]));
  let strain = 0;
  for (const c of cards) {
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
  return { size: n, curve, avgCost, types, grafts, avgGraftStrain, slots, warnings };
}

const strength = (c: CardDef) => {
  const r = budgetOf(c, defaultConfig);
  return r.total - r.target;
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
  const score = (c: CardDef) => {
    const s = deckStats(deck());
    let v = strength(c);
    if ((out[c.id] ?? 0) > 0) v -= 0.75;
    if (c.cost <= 2 && s.curve[0] + s.curve[1] + s.curve[2] < 7) v += 1.5;
    if (c.cost >= 5 && s.curve[5] >= 2) v -= 2;
    if (c.type === 'graft' && s.grafts < 9) v += 1;
    if (c.type === 'graft' && c.slot && s.slots[c.slot] === 0) v += 2;
    if (c.type === 'protocol' && s.types.protocol === 0) v += 1.5;
    return v;
  };
  const pick = (ok: (c: CardDef) => boolean) => {
    const cands = pool.filter((c) => ok(c) && room(c));
    if (!cands.length) return false;
    const best = cands.reduce((a, b) => (score(b) > score(a) || (score(b) === score(a) && b.id < a.id) ? b : a));
    out[best.id] = (out[best.id] ?? 0) + 1;
    return true;
  };
  while (deck().length < D.size && count(faction) < D.minBuild && pick((c) => c.faction === faction));
  while (deck().length < D.size && count(worldFaction) < D.minWorldFaction && pick((c) => c.faction === worldFaction));
  while (deck().length < D.size && pick((c) => c.faction !== 'tech' || count('tech') < D.maxTech));
  return out;
}
