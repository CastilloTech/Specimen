// Permanent mutations (the Lineage mode): each works exactly like a Chip node, through the same param keys and
// optional Cond, but belongs to the Specimen rather than to a Chip. `lineage` marks the few that change the
// campaign itself (max HP, a lost slot) instead of a match; the engine ignores those.
import type { Cond } from './types';

export interface Mutation {
  id: string;
  name: string;
  text: string;
  params: Record<string, number>;
  cond?: Cond;
  lineage?: { maxHp?: number; restoreSlot?: boolean };
  /** Not a reward: a trait only bots carry (Containment Breach escapees). Never offered. */
  hidden?: boolean;
}

export const MUTATIONS: Mutation[] = [
  { id: 'serratedBones', name: 'Serrated Bones', text: '+1 attack.', params: { flatAttack: 1 } },
  { id: 'chitinPlates', name: 'Chitin Plates', text: '+1 armor.', params: { flatArmor: 1 } },
  { id: 'denseGrafting', name: 'Dense Grafting', text: 'Your grafts have +1 Integrity.', params: { flatIntegrity: 1 } },
  { id: 'mendingTissue', name: 'Mending Tissue', text: 'At the start of each round, your grafts regain 1 Integrity.', params: { integrityRegen: 1 } },
  { id: 'predatoryInstinct', name: 'Predatory Instinct', text: 'Destroying an enemy graft heals you 3.', params: { killHeal: 3 } },
  { id: 'venomSacs', name: 'Venom Sacs', text: '+1 Integrity damage dealt (Clash wear included).', params: { graftDamageBonus: 1 } },
  { id: 'calloused', name: 'Calloused Sockets', text: 'Integrity damage against your grafts is 1 lower.', params: { graftDamageReduction: 1 } },
  { id: 'metabolicVent', name: 'Metabolic Vent', text: 'Hold vents 1 more Strain.', params: { holdVentBonus: 1 } },
  { id: 'quickCycle', name: 'Quick Cycle', text: 'Cycling to vent vents 1 more Strain.', params: { cycleVentBonus: 1 } },
  { id: 'earlyBloom', name: 'Early Bloom', text: 'Draw 1 extra card in round 1.', params: { firstDrawRoundBonus: 1 } },
  { id: 'seasoned', name: 'Seasoned', text: 'Signature grafts reach Veteran (and Elite) 1 Strain check sooner.', params: { veteranThresholdReduction: 1 } },
  { id: 'efficientGraft', name: 'Efficient Graft', text: 'Your first graft each round costs 1 less Energy.', params: { firstGraftDiscount: 1 } },
  { id: 'lastStand', name: 'Last Stand', text: '+2 attack while you are at 15 HP or less.', params: { flatAttack: 2 }, cond: { hpAtMost: 15 } },
  { id: 'hardenedFlesh', name: 'Hardened Flesh', text: '+4 max HP for the rest of the lineage.', params: {}, lineage: { maxHp: 4 } },
  { id: 'regrowth', name: 'Regrowth', text: 'Regrow one lost graft slot.', params: {}, lineage: { restoreSlot: true } },
];

export const MUTATION_MAP: Record<string, Mutation> = Object.fromEntries(MUTATIONS.map((m) => [m.id, m]));
