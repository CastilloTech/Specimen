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
  const base = Math.floor(s.config.strain.threshold * s.config.strain.stableMaxRatio);
  return Math.max(base, nodeParam(p, 'redline', 'stableMax', 0), nodeParam(p, 'dormancy', 'stableMax', 0));
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
  let m = 1;
  if (hasNode(p, 'hairTrigger')) m = nodeParam(p, 'hairTrigger', 'conditionMult', 1);
  else if (hasNode(p, 'lateBloomer')) m = nodeParam(p, 'lateBloomer', 'conditionMult', 1);
  return Math.max(1, Math.ceil(def.condition.target * m - 1e-9));
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

/** A form's numeric bonuses for this player, with Hair Trigger / Late Bloomer applied. */
function scaledEffects(p: PlayerState, def: EvolutionDef): Record<string, number | boolean> {
  let delta = 0;
  if (hasNode(p, 'hairTrigger')) delta = nodeParam(p, 'hairTrigger', 'bonusDelta', 0);
  else if (hasNode(p, 'lateBloomer')) delta = nodeParam(p, 'lateBloomer', 'bonusDelta', 0);
  const out: Record<string, number | boolean> = {};
  // A reduction never cuts a bonus below `bonusFloor` (default 1): small bonuses stay as they are, larger ones lose `delta`.
  // A boost is not floored.
  const floor = hasNode(p, 'hairTrigger') ? nodeParam(p, 'hairTrigger', 'bonusFloor', 1) : 1;
  for (const [k, v] of Object.entries(def.effects)) out[k] = typeof v === 'number' ? Math.max(0, delta < 0 ? Math.max(v + delta, Math.min(v, floor)) : v + delta) : v;
  return out;
}

/** Numeric bonuses of the evolved form, adjusted by Hair Trigger / Late Bloomer. */
export function evoEffects(s: GameState, p: PlayerState): Record<string, number | boolean> {
  if (!p.evolution) return {};
  const def = evolutionDefs(s, p).find((d) => d.id === p.evolution);
  return def ? scaledEffects(p, def) : {};
}

/** What a form would give this player (the form they are in, or one they could choose), as readable lines. */
export function evolutionBoosts(s: GameState, p: PlayerState, id: string): string[] {
  const def = evolutionDefs(s, p).find((d) => d.id === id);
  if (!def) return [];
  const e = scaledEffects(p, def);
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

/** Skill-tree nodes that changed how this player's form works, as readable lines. */
export function evolutionNotes(p: PlayerState): string[] {
  const out: string[] = [];
  if (hasNode(p, 'hairTrigger')) out.push('Hair Trigger: the form comes earlier and its bonuses are 1 smaller.');
  if (hasNode(p, 'lateBloomer')) out.push('Late Bloomer: the form comes later and its bonuses are 1 bigger.');
  if (hasNode(p, 'surge')) out.push(`Surge: evolving drops your Strain to ${nodeParam(p, 'surge', 'setTo', 0)} if it is higher.`);
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
  return true;
}

export interface DerivedStats {
  attack: number;
  armor: number;
}

export function computeStats(s: GameState, p: PlayerState): DerivedStats {
  const cfg = s.config;
  let attack = cfg.specimen.attack;
  let armor = cfg.specimen.armor;
  const opp = s.players[other(p.id)];
  const awake = p.grafts.filter((g) => !g.faceDown); // a face-down (Dormant) graft is asleep: it adds nothing
  for (const g of awake) {
    const card = cardOf(g.cardId);
    if (g.poisoned <= 0) {
      attack += card.attack;
      armor += card.armor;
      if (card.slot === 'Limb') attack += nodeParam(p, 'serratedLimbs', 'limbAttack');
      if (card.slot === 'Organ') armor += nodeParam(p, 'platedHide', 'armorPerOrgan');
    }
    if (g.disabled <= 0) {
      for (const ab of card.effect.abilities ?? []) {
        if (ab.trigger !== 'passive' || !condOk(s, p, ab.cond)) continue;
        for (const op of ab.ops) {
          if (op.op !== 'mod') continue;
          let mult = 1;
          if (op.per) {
            const count = op.per.what === 'grafts' ? awake.length : op.per.what === 'strain' ? p.strain : op.per.what === 'oppStrain' ? opp.strain : Math.max(0, cfg.specimen.hp - p.hp);
            mult = Math.floor(count / Math.max(1, op.per.div));
          }
          if (op.stat === 'attack') attack += op.amount * mult;
          else armor += op.amount * mult;
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
  // Flat bonuses some nodes carry as compensation for their drawback.
  attack += p.tempAttack + evoNum(s, p, 'attack') + nodeParam(p, 'strippedFrame', 'attack');
  armor += p.tempArmor + evoNum(s, p, 'armor') + nodeParam(p, 'fortressFrame', 'armor');
  armor = Math.max(0, armor);
  if (evoFlag(s, p, 'armorToAttack')) {
    // Juggernaut: armor adds to attack, optionally capped (armorToAttackCap; no cap when absent).
    const cap = evoEffects(s, p).armorToAttackCap;
    attack += typeof cap === 'number' ? Math.min(armor, cap) : armor;
  }
  return { attack: Math.max(0, attack), armor };
}

export function overclockBonus(s: GameState, p: PlayerState): number {
  const base = s.config.strain.overclockClashBonus;
  const evo = evoNum(s, p, 'overclockBonus');
  return Math.max(base, evo) + nodeParam(p, 'redline', 'overclockBonus');
}

export function momentum(s: GameState, p: PlayerState): boolean {
  if (!s.config.features.stanceMomentum) return false;
  const h = p.stanceHistory;
  return h.length >= 2 && h[h.length - 1] === h[h.length - 2];
}

// ---------- Costs ----------
export function cardCost(s: GameState, p: PlayerState, card: CardDef): number {
  let c = card.cost;
  if (card.type === 'graft') {
    // Fortress Frame: grafts cost more (optionally only grafts of one slot type).
    const only = nodeText(p, 'fortressFrame', 'costIncreaseSlot');
    if (!only || card.slot === only) c += nodeParam(p, 'fortressFrame', 'costIncrease');
    // Adrenal Gland: the first graft each round costs less, but never below `floor`.
    if (p.attachedThisRound === 0 && s.round >= nodeParam(p, 'adrenalGland', 'fromRound', 0)) {
      const before = c;
      c -= nodeParam(p, 'adrenalGland', 'discount');
      c = Math.max(c, Math.min(before, nodeParam(p, 'adrenalGland', 'floor', 0)));
    }
  }
  if (card.type === 'toxin' && p.attachedThisRound > 0) c -= nodeParam(p, 'incubator', 'discount');
  void s;
  return Math.max(0, c);
}

export function graftStrain(p: PlayerState, card: CardDef): number {
  let st = card.strain - nodeParam(p, 'strippedFrame', 'strainReduction');
  if (hasNode(p, 'symbiote') && !p.firstGraftDone) st = nodeParam(p, 'symbiote', 'firstGraftStrain', 0);
  return Math.max(0, st);
}

/** Any graft may sleep: its text (including on-attach text) simply waits until it wakes. */
export function canBeDormant(card: CardDef): boolean {
  return card.type === 'graft';
}

export function slotsFor(config: GameState['config'], loadout: string[]): SlotId[] {
  const slots = [...config.slots] as SlotId[];
  const rm = loadout.includes('strippedFrame') ? findNode('strippedFrame')?.params.removeSlot : undefined;
  const add = loadout.includes('fortressFrame') ? findNode('fortressFrame')?.params.addSlot : undefined;
  const out = slots.filter((x) => x !== rm);
  if (typeof add === 'string' && !out.includes(add as SlotId)) out.push(add as SlotId);
  return out;
}
