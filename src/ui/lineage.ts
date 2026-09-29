import { defaultConfig, makeRng, MUTATION_MAP, MUTATIONS, SLOT_LABEL } from '../engine';
import type { GameState, MatchSetup, SlotId } from '../engine';
import { floorMatch } from './modes';
import type { ModeDeck, Progress } from './modes';

// Lineage: one Specimen carried through a 10-match campaign. Losses and hard wins lower its max HP for good,
// every rejected graft kills the slot it was in, and each victory offers a permanent mutation. When the
// lineage ends (complete or dead), one mutation can be passed on to the next Specimen.

export const LINEAGE_MATCHES = 10;
/** The Specimen dies if its max HP drops below this, or at this many losses. */
export const MIN_MAX_HP = 24;
/** Max HP a lost match costs. */
export const LOSS_SCAR = 3;
export const MAX_LOSSES = 4;
/** Rival Specimens come from other scarred bloodlines: their max HP (a Matriarch's, and the Progenitor's). */
export const RIVAL_HP = 32;
export const MATRIARCH_HP = 36;
const MIN_SLOTS = 3;
const BASE_HP = defaultConfig.specimen.hp;
/** Which Tower floor each campaign match borrows its opponent from: steadily harder, with Tower rule twists
 * in match 9 and the Progenitor itself as the final match. */
export const FLOOR_FOR_MATCH = [1, 3, 6, 10, 14, 22, 30, 38, 44, 50];

export interface LineageEntry {
  match: number;
  won: boolean;
  scars: string[];
  mutation?: string;
}

export interface LineageState {
  name: string;
  deck: ModeDeck;
  /** The next match (1..LINEAGE_MATCHES). */
  match: number;
  wins: number;
  losses: number;
  maxHp: number;
  lostSlots: SlotId[];
  mutations: string[];
  seed: number;
  history: LineageEntry[];
  /** After a win: the mutations on offer (pick one before the next match). */
  offer: string[] | null;
  status: 'active' | 'complete' | 'dead';
}

export function startLineage(p: Progress, name: string, heritage?: string | null): LineageState {
  return {
    name,
    deck: { ...p.deck, cards: [...p.deck.cards], loadout: [...p.deck.loadout] },
    match: 1,
    wins: 0,
    losses: 0,
    maxHp: BASE_HP,
    lostSlots: [],
    mutations: heritage && MUTATION_MAP[heritage] && !MUTATION_MAP[heritage].lineage ? [heritage] : [],
    seed: Math.floor(Math.random() * 2 ** 31),
    history: [],
    offer: null,
    status: 'active',
  };
}

/** The next match's setup: your scarred, mutated Specimen against a surprise opponent. */
export function lineageMatch(l: LineageState, playerName: string): MatchSetup {
  const setup = floorMatch(FLOOR_FOR_MATCH[l.match - 1], l.seed, l.deck, playerName);
  const you = { ...setup.players[0], maxHp: l.maxHp, lostSlots: l.lostSlots, mutations: l.mutations.filter((id) => !MUTATION_MAP[id]?.lineage) };
  const towerName = setup.players[1].name;
  const rivalHp = towerName === 'The Progenitor' ? BASE_HP : towerName.startsWith('Boss:') ? MATRIARCH_HP : RIVAL_HP;
  // The late floors keep their Tower rule twists (the bot starts evolved, early Meltdown, you vent less).
  return { ...setup, players: [you, { ...setup.players[1], name: rivalName(l, setup.players[1].faction, towerName), maxHp: rivalHp }] };
}

// Opponents are rival Specimens from other bloodlines, named for their Build; the bosses are a bloodline's
// matriarch and, last of all, the Progenitor every lineage descends from.
const EPITHETS = ['Ashen', 'Hollow-Eyed', 'Weeping', 'Feral', 'Grafted', 'Pale', 'Scarred', 'Starving', 'Twice-Born', 'Rotting', 'Silent', 'Hungering', 'Split', 'Blind', 'Cinder'];
const BUILD_NOUN: Record<string, string> = { predator: 'Stalker', parasite: 'Leech', bastion: 'Bulwark' };
const LINES = ['Vesk', 'Morrow', 'Kael', 'Ossian', 'Thule', 'Varn', 'Sable', 'Ixen', 'Corvid', 'Harrow'];

function rivalName(l: LineageState, faction: string, towerName: string): string {
  if (towerName === 'The Progenitor') return towerName;
  const rng = makeRng((l.seed ^ (l.match * 0x2545f491)) >>> 0);
  const line = rng.pick(LINES);
  if (towerName.startsWith('Boss:')) return `Matriarch of the ${line} Line`;
  return `${rng.pick(EPITHETS)} ${BUILD_NOUN[faction] ?? 'Specimen'} of ${line}`;
}

export interface MatchReport {
  won: boolean;
  scars: string[];
  reward: number;
  ended: 'complete' | 'dead' | null;
}

export const lineageReward = (match: number, won: boolean) => (won ? 15 + 3 * match : 0);
export const LINEAGE_COMPLETE_BONUS = 200;

/**
 * Scars from one match. Every rejected graft kills the slot it was in (while at least 3 slots remain;
 * otherwise it costs 2 max HP instead). A loss costs 4 max HP; a win that ends at a third of max HP or less
 * costs 2.
 */
export function scarsFrom(l: LineageState, won: boolean, hpLeft: number, rejectedSlots: SlotId[]): { maxHp: number; lostSlots: SlotId[]; scars: string[] } {
  let maxHp = l.maxHp;
  const lostSlots = [...l.lostSlots];
  const scars: string[] = [];
  const total = defaultConfig.slots.length;
  for (const slot of rejectedSlots) {
    if (lostSlots.includes(slot)) continue;
    if (total - lostSlots.length - 1 >= MIN_SLOTS) {
      lostSlots.push(slot);
      scars.push(`Necrotic socket: the ${SLOT_LABEL[slot]} slot is gone (a graft was rejected there).`);
    } else {
      maxHp -= 2;
      scars.push('Torn tissue: −2 max HP (a graft was rejected, and no slot can be spared).');
    }
  }
  if (!won) {
    maxHp -= LOSS_SCAR;
    scars.push(`Deep scar: −${LOSS_SCAR} max HP (the match was lost).`);
  } else if (hpLeft <= Math.floor(l.maxHp / 3)) {
    maxHp -= 2;
    scars.push(`Near death: −2 max HP (won with only ${hpLeft} HP left).`);
  }
  return { maxHp, lostSlots, scars };
}

/** Three mutations to choose from after a win (Regrowth only while a slot is missing). */
export function mutationOffer(l: LineageState, lostSlots: SlotId[]): string[] {
  const rng = makeRng((l.seed ^ (l.match * 0x9e3779b9)) >>> 0);
  const pool = MUTATIONS.filter((m) => !m.hidden).filter((m) => !l.mutations.includes(m.id) || m.lineage).filter((m) => m.id !== 'regrowth' || lostSlots.length > 0).map((m) => m.id);
  const out: string[] = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(rng.float() * pool.length), 1)[0]);
  return out;
}

/** Apply a finished match: scars, record, next match or the end of the lineage, and the biomass earned. */
export function applyLineageMatch(l: LineageState, s: GameState): { lineage: LineageState; report: MatchReport } {
  const me = s.players[0];
  const won = s.result?.winner === 0;
  const rejected = me.discard.filter((d) => d.why === 'rejected' && d.slot).map((d) => d.slot!) as SlotId[];
  const sc = scarsFrom(l, won, me.hp, rejected);
  const wins = l.wins + (won ? 1 : 0);
  const losses = l.losses + (won ? 0 : 1);
  const dead = sc.maxHp < MIN_MAX_HP || losses >= MAX_LOSSES;
  const complete = !dead && l.match >= LINEAGE_MATCHES;
  const status = dead ? 'dead' : complete ? 'complete' : 'active';
  const reward = lineageReward(l.match, won) + (complete ? LINEAGE_COMPLETE_BONUS : 0);
  const next: LineageState = {
    ...l,
    maxHp: sc.maxHp,
    lostSlots: sc.lostSlots,
    wins,
    losses,
    match: status === 'active' ? l.match + 1 : l.match,
    history: [...l.history, { match: l.match, won, scars: sc.scars }],
    offer: won && status === 'active' ? mutationOffer(l, sc.lostSlots) : null,
    status,
  };
  return { lineage: next, report: { won, scars: sc.scars, reward, ended: status === 'active' ? null : status } };
}

/** Take one of the offered mutations (campaign ones apply at once). */
export function chooseMutation(l: LineageState, id: string): LineageState {
  if (!l.offer?.includes(id)) return l;
  const m = MUTATION_MAP[id];
  const history = l.history.map((h, i) => (i === l.history.length - 1 ? { ...h, mutation: id } : h));
  if (m.lineage?.maxHp) return { ...l, offer: null, history, maxHp: Math.min(BASE_HP + 8, l.maxHp + m.lineage.maxHp), mutations: [...l.mutations, id] };
  if (m.lineage?.restoreSlot) return { ...l, offer: null, history, lostSlots: l.lostSlots.slice(0, -1), mutations: [...l.mutations, id] };
  return { ...l, offer: null, history, mutations: [...l.mutations, id] };
}

/** Mutations that can be passed to the next Specimen (the campaign-only ones can't). */
export const inheritable = (l: LineageState) => l.mutations.filter((id) => !MUTATION_MAP[id]?.lineage);
