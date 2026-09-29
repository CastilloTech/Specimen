import { MUTATION_MAP } from './mutations';
// Read-only rule helpers: zones, derived stats, costs, evolution progress.
import { cardOf, findNode } from './data';
import type { AttachedGraft, CardDef, Cond, EvolutionDef, GameState, PlayerState, SlotId, Stance, Zone } from './types';
import { other } from './types';
import type { PlayerId } from './types';

export function hasNode(p: PlayerState, id: string): boolean {
  return p.loadout.includes(id);
}

export function nodeParam(p: PlayerState, id: string, key: string, def = 0): number {
  if (!p.loadout.includes(id)) return def;
  const v = findNode(id)?.params[key];
  return typeof v === 'number' ? v : def;
}

/** Sums a numeric param across every node in a player's loadout (one pick per chip row) that carries it,
 * skipping any node whose `cond` isn't currently met. This is how most chip nodes work: many different
 * nodes can share the same param key (e.g. `flatAttack`) - what makes two nodes genuinely different is the
 * (key, cond) pair, not just the key - without each needing its own hardcoded check. */
/**
 * Amplify: a Chip node keyed `engine_<id>` adds its value to the main number of each of that engine's payoff
 * abilities (the first op with an amount; not on-attach effects). Mastery cards are payoffs of all three of
 * their engines, so any of the three Chips boosts them.
 */
export function engineAmp(s: GameState, p: PlayerState, card: CardDef): number {
  let amp = 0;
  for (const t of card.engines ?? []) if (t.role === 'payoff') amp += sumLoadoutParam(s, p, `engine_${t.id}`);
  return amp;
}

export function sumLoadoutParam(s: GameState, p: PlayerState, key: string): number {
  let total = 0;
  for (const id of p.loadout) {
    const node = findNode(id);
    const v = node?.params[key];
    if (typeof v === 'number' && (!node!.cond || condOk(s, p, node!.cond))) total += v;
  }
  // Lineage mutations work exactly like extra nodes.
  for (const id of p.mutations) {
    const m = MUTATION_MAP[id];
    const v = m?.params[key];
    if (typeof v === 'number' && (!m!.cond || condOk(s, p, m!.cond))) total += v;
  }
  return total;
}

/** True while the player has any of the four status effects active on themselves. */
export function hasAnyStatus(p: PlayerState): boolean {
  return p.bleed > 0 || p.numb > 0 || p.fever > 0 || Object.keys(p.necrosis).length > 0;
}

/** String-valued node parameter (e.g. a slot type a penalty applies to). */
export function nodeText(p: PlayerState, id: string, key: string): string | undefined {
  if (!p.loadout.includes(id)) return undefined;
  const v = findNode(id)?.params[key];
  return typeof v === 'string' ? v : undefined;
}

export function beats(a: Stance, b: Stance): boolean {
  return (a === 'aggress' && b === 'adapt') || (a === 'adapt' && b === 'fortify') || (a === 'fortify' && b === 'aggress');
}

export function adjacent(s: GameState, a: SlotId, b: SlotId): boolean {
  return s.config.adjacency.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

export function graftAt(p: PlayerState, slot: SlotId): AttachedGraft | undefined {
  return p.grafts.find((g) => g.slot === slot);
}

// ---------- Strain zones ----------
export function stableMax(s: GameState, p: PlayerState): number {
  void p; // no chip node currently touches the Stable zone; kept as a function so that could change without callers noticing
  return Math.floor(s.config.strain.threshold * s.config.strain.stableMaxRatio);
}

export function zoneOf(s: GameState, p: PlayerState): Zone {
  if (p.strain <= stableMax(s, p)) return 'stable';
  if (p.strain <= s.config.strain.threshold) return 'overclocked';
  return 'rejection';
}

// ---------- Evolution ----------
export function evolutionDefs(s: GameState, p: PlayerState): EvolutionDef[] {
  return (s.config.evolutions as unknown as Record<string, EvolutionDef[]>)[p.faction] ?? [];
}

export function evolutionTarget(p: PlayerState, def: EvolutionDef): number {
  void p; // evolutions are fixed per Build now: no skill node modifies their condition or bonuses any more
  return def.condition.target;
}

export function metricValue(s: GameState, p: PlayerState, metric: string): number {
  const opp = s.players[other(p.id)];
  switch (metric) {
    case 'damageDealt':
      return p.stats.damageDealt;
    case 'endRoundStrain':
      return p.rejectedThisRound ? 0 : p.strain;
    case 'oppRejections':
      return opp.stats.rejectionsSuffered;
    case 'oppMaxStrain':
      return opp.stats.maxStrain;
    case 'strainVented':
      return p.stats.strainVented;
    case 'damageBlocked':
      return p.stats.damageBlocked;
    case 'hpHealed':
      return p.stats.hpHealed;
    case 'damageTaken':
      return p.stats.damageTaken;
    case 'round':
      return s.round; // used by the simulator's --force-round to make a form arrive at a fixed time
    default:
      throw new Error(`Unknown evolution metric ${metric}`);
  }
}

export interface EvolutionProgress {
  id: string;
  name: string;
  label: string;
  text: string;
  current: number;
  target: number;
  met: boolean;
  active: boolean;
}

export function evolutionProgress(s: GameState, playerId: PlayerId): EvolutionProgress[] {
  const p = s.players[playerId];
  return evolutionDefs(s, p).map((d) => {
    const target = evolutionTarget(p, d);
    const current = metricValue(s, p, d.condition.metric);
    return { id: d.id, name: d.name, label: d.condition.label, text: d.text, current, target, met: current >= target, active: p.evolution === d.id };
  });
}

/** Numeric bonuses of the evolved form. Fixed per Build: no skill node scales them any more. */
export function evoEffects(s: GameState, p: PlayerState): Record<string, number | boolean> {
  if (!p.evolution) return {};
  const def = evolutionDefs(s, p).find((d) => d.id === p.evolution);
  return def?.effects ?? {};
}

/** What a form would give this player (the form they are in, or one they could choose), as readable lines. */
export function evolutionBoosts(s: GameState, p: PlayerState, id: string): string[] {
  const def = evolutionDefs(s, p).find((d) => d.id === id);
  if (!def) return [];
  const e = def.effects;
  const n = (k: string) => (typeof e[k] === 'number' ? (e[k] as number) : 0);
  const out: string[] = [];
  if (n('attack')) out.push(`+${n('attack')} attack`);
  if (n('armor')) out.push(`+${n('armor')} armor`);
  if (n('overclockBonus')) out.push(`Overclocked bonus damage becomes +${n('overclockBonus')}`);
  if (n('fortifyVent')) out.push(`Fortify vents ${n('fortifyVent')} Strain`);
  if (n('healOnOppReject')) out.push(`Heal ${n('healOnOppReject')} whenever the opponent rejects a graft`);
  if (n('toxinDrain')) out.push(`Your Toxins also drain ${n('toxinDrain')} HP`);
  if (e.ignoreFortifyHalving) out.push("Your attacks ignore Fortify's damage halving");
  if (e.armorToAttack) out.push(typeof e.armorToAttackCap === 'number' ? `Your armor adds to your attack (up to +${e.armorToAttackCap})` : 'Your armor adds to your attack');
  return out;
}


export function evoNum(s: GameState, p: PlayerState, key: string): number {
  const v = evoEffects(s, p)[key];
  return typeof v === 'number' ? v : 0;
}

export function evoFlag(s: GameState, p: PlayerState, key: string): boolean {
  return evoEffects(s, p)[key] === true;
}

// ---------- Conditions & stats ----------
export function condOk(s: GameState, p: PlayerState, cond?: Cond): boolean {
  if (!cond) return true;
  const opp = s.players[other(p.id)];
  if (cond.zone && zoneOf(s, p) !== cond.zone) return false;
  if (cond.stance && p.stance !== cond.stance) return false;
  if (cond.strainAtLeast !== undefined && p.strain < cond.strainAtLeast) return false;
  if (cond.strainAtMost !== undefined && p.strain > cond.strainAtMost) return false;
  if (cond.oppStrainAtLeast !== undefined && opp.strain < cond.oppStrainAtLeast) return false;
  if (cond.hpAtMost !== undefined && p.hp > cond.hpAtMost) return false;
  if (cond.minRound !== undefined && s.round < cond.minRound) return false;
  if (cond.evolution !== undefined && p.evolution !== cond.evolution) return false;
  if (cond.oppHasAnyStatus !== undefined && hasAnyStatus(opp) !== cond.oppHasAnyStatus) return false;
  if (cond.selfHasAnyStatus !== undefined && hasAnyStatus(p) !== cond.selfHasAnyStatus) return false;
  if (cond.oppStatusesAtLeast !== undefined && statusCount(opp) < cond.oppStatusesAtLeast) return false;
  if (cond.oppEnergyAtMost !== undefined && opp.energy > cond.oppEnergyAtMost) return false;
  if (cond.oppHas !== undefined && !(opp[cond.oppHas] > 0)) return false;
  if (cond.graftsAtLeast !== undefined && p.grafts.filter((g) => !g.faceDown).length < cond.graftsAtLeast) return false;
  if (cond.discardAtLeast !== undefined && p.discard.length < cond.discardAtLeast) return false;
  return true;
}

/** What a scaling `mod` counts (`per.what`). */
export function perCount(s: GameState, p: PlayerState, what: string): number {
  const opp = s.players[other(p.id)];
  const awake = p.grafts.filter((g) => !g.faceDown);
  switch (what) {
    case 'grafts':
      return awake.length;
    case 'strain':
      return p.strain;
    case 'oppStrain':
      return opp.strain;
    case 'oppBleedStacks':
      return opp.bleed > 0 ? opp.bleedStacks : 0;
    case 'oppNecroticSlots':
      return Object.values(opp.necrosis).filter((n) => (n ?? 0) > 0).length;
    case 'seasonedGrafts': // your grafts that have survived 2 or more Strain checks
      return awake.filter((g) => g.roundsSurvived >= 2).length;
    case 'oppWornGrafts': // enemy grafts below their full Integrity
      return opp.grafts.filter((g) => !g.faceDown && g.integrity < (cardOf(g.cardId).integrity ?? s.config.integrity.default)).length;
    case 'myDiscard':
      return p.discard.length;
    default:
      return Math.max(0, p.maxHp - p.hp);
  }
}

/** How many different statuses a player has on them (Bleed, Numb, Fever, Necrosis). */
export function statusCount(p: PlayerState): number {
  return (p.bleed > 0 ? 1 : 0) + (p.numb > 0 ? 1 : 0) + (p.fever > 0 ? 1 : 0) + (Object.values(p.necrosis).some((n) => (n ?? 0) > 0) ? 1 : 0);
}

export interface DerivedStats {
  attack: number;
  armor: number;
}

/**
 * Veterancy rank of an attached graft: 0 none, 1 Veteran (a Signature that survived signatureThreshold Strain
 * checks), 2 Elite (a Mastery Signature that survived eliteThreshold checks: a step above Veteran). Chip nodes
 * with veteranThresholdReduction shorten both waits, never below 1 check.
 */
export function veteranRank(s: GameState, p: PlayerState, g: { cardId: string; roundsSurvived: number }): 0 | 1 | 2 {
  const card = cardOf(g.cardId);
  if (!card.signature) return 0;
  const cut = sumLoadoutParam(s, p, 'veteranThresholdReduction');
  const v = s.config.veterancy;
  if (card.mastery && g.roundsSurvived >= Math.max(1, v.eliteThreshold - cut)) return 2;
  return g.roundsSurvived >= Math.max(1, v.signatureThreshold - cut) ? 1 : 0;
}

export function computeStats(s: GameState, p: PlayerState): DerivedStats {
  const cfg = s.config;
  let attack = cfg.specimen.attack;
  let armor = cfg.specimen.armor;
  const awake = p.grafts.filter((g) => !g.faceDown); // a face-down (Dormant) graft is asleep: it adds nothing
  for (const g of awake) {
    const card = cardOf(g.cardId);
    if (g.poisoned <= 0) {
      attack += card.attack;
      armor += card.armor;
      // Veterancy: a Signature graft that has survived enough Strain checks unrejected hardens in place;
      // a Mastery Signature keeps going to Elite.
      const rank = veteranRank(s, p, g);
      if (rank >= 1) attack += cfg.veterancy.signatureAttackBonus;
      if (rank >= 2) {
        attack += cfg.veterancy.eliteAttackBonus;
        armor += cfg.veterancy.eliteArmorBonus;
      }
    }
    if (g.disabled <= 0) {
      for (const ab of card.effect.abilities ?? []) {
        if (ab.trigger !== 'passive' || !condOk(s, p, ab.cond)) continue;
        for (const op of ab.ops) {
          if (op.op !== 'mod') continue;
          let mult = 1;
          if (op.per) {
            mult = Math.floor(perCount(s, p, op.per.what) / Math.max(1, op.per.div));
          }
          const amount = op.amount + engineAmp(s, p, card);
          if (op.stat === 'attack') attack += amount * mult;
          else armor += amount * mult;
        }
      }
    }
  }
  if (cfg.features.neuralLinks) {
    for (const n of awake) {
      if (cardOf(n.cardId).slot !== 'Nerve' || n.poisoned > 0 || n.disabled > 0) continue;
      for (const g of awake) if (g !== n && g.poisoned <= 0 && adjacent(s, n.slot, g.slot)) attack += cfg.neuralLinks.attackBonus;
    }
  }
  // Flat bonuses from the evolved form and the equipped chip's nodes (some nodes are conditional - see
  // sumLoadoutParam - e.g. a node granting flatAttack only while the opponent has an active status).
  attack += p.tempAttack + evoNum(s, p, 'attack') + sumLoadoutParam(s, p, 'flatAttack');
  armor += p.tempArmor + evoNum(s, p, 'armor') + sumLoadoutParam(s, p, 'flatArmor');
  // A few nodes scale with your graft count instead of being flat, for genuine mechanical variety.
  attack += sumLoadoutParam(s, p, 'perGraftAttack') * awake.length;
  armor += sumLoadoutParam(s, p, 'perGraftArmor') * awake.length;
  armor = Math.max(0, armor);
  if (evoFlag(s, p, 'armorToAttack')) {
    // Juggernaut: armor adds to attack, optionally capped (armorToAttackCap; no cap when absent).
    const cap = evoEffects(s, p).armorToAttackCap;
    attack += typeof cap === 'number' ? Math.min(armor, cap) : armor;
  }
  return { attack: Math.max(0, attack), armor };
}

export function overclockBonus(s: GameState, p: PlayerState): number {
  return Math.max(s.config.strain.overclockClashBonus, evoNum(s, p, 'overclockBonus'));
}

export function momentum(s: GameState, p: PlayerState): boolean {
  if (!s.config.features.stanceMomentum) return false;
  const h = p.stanceHistory;
  return h.length >= 2 && h[h.length - 1] === h[h.length - 2];
}

// ---------- Costs ----------
export function cardCost(s: GameState, p: PlayerState, card: CardDef): number {
  let c = card.cost;
  if (card.type === 'graft' && p.fever > 0) c += s.config.status.feverCostIncrease; // Fever: grafts cost more while it lasts.
  if (card.faction === p.worldFaction) c -= sumLoadoutParam(s, p, 'worldCardDiscount'); // some chip nodes discount your World Faction's own cards.
  if (card.type === 'graft' && p.attachedThisRound === 0) c -= sumLoadoutParam(s, p, 'firstGraftDiscount'); // some chip nodes discount your first graft each round.
  return Math.max(0, c);
}

export function graftStrain(p: PlayerState, card: CardDef): number {
  void p; // no chip node currently touches a graft's own Strain cost; kept as a function so that could change without callers noticing
  return Math.max(0, card.strain);
}

/** Any graft may sleep: its text (including on-attach text) simply waits until it wakes. */
export function canBeDormant(card: CardDef): boolean {
  return card.type === 'graft';
}

export function slotsFor(config: GameState['config'], loadout: string[]): SlotId[] {
  void loadout; // no current chip node changes slot layout; kept as a function so that could change without callers noticing
  return [...config.slots] as SlotId[];
}
