import { budgetOf, CARD_MAP, CARDS, chipRows, chipsFor, defaultConfig, FACTIONS, makeRng, starterDeck, validateDeck, validateLoadout, WORLD_FACTIONS } from '../engine';
import type { DailyRecord, DailyStreak } from './daily';
import type { BotTier, CardDef, Config, DeepPartial, Faction, MatchSetup, PlayerSetup, WorldFactionId } from '../engine';
import { loadSaveData, saveSaveData } from './storage';
import type { LineageState } from './lineage';
import type { BreachRun } from './breach';
import { OPERATIVE_NAME, Z_NAME } from './lore';

// Game Modes progression, kept per save: you start with one Build + World Faction starter deck (no
// Signatures) and one Chip, win matches for biomass, and spend it on crafting cards and unlocking more
// Chips, Builds and World Factions. The first mode is the Tower. Everything here is plain data + functions.

export interface ModeDeck {
  faction: Faction;
  worldFaction: WorldFactionId;
  chip: string;
  loadout: string[];
  cards: string[];
}

export interface TowerState {
  /** The next floor to fight (1..TOWER_FLOORS). */
  floor: number;
  /** Where a loss sends you back to: the floor after the last checkpoint you cleared. */
  checkpoint: number;
  best: number;
  clears: number;
  runSeed: number;
}

export interface Progress {
  biomass: number;
  /** Copies owned per card id. */
  owned: Record<string, number>;
  builds: Faction[];
  worlds: WorldFactionId[];
  chips: string[];
  deck: ModeDeck;
  tower: TowerState;
  /** Biomass earned in total (for the header). */
  earned: number;
  /** The Lineage campaign in progress (or just ended), and the mutation passed down to the next one. */
  lineage?: LineageState | null;
  heritage?: string | null;
  lineagesCompleted?: number;
  /** Containment Breach: the run in progress (or just ended) and the best score. */
  breach?: BreachRun | null;
  breachBest?: number;
  /** The daily challenge: today's attempts and best, and the run of consecutive days won. */
  daily?: DailyRecord;
  dailyStreak?: DailyStreak;
}

export const TOWER_FLOORS = 50;
export const COSTS = { chip: 150, build: 400, world: 400, signature: 200 };
const D = defaultConfig.deck;
const tally = (ids: string[]) => ids.reduce<Record<string, number>>((m, id) => ((m[id] = (m[id] ?? 0) + 1), m), {});
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

// ---------- Starter sets ----------

/** A Build or World Faction's starter cards with its Signature swapped for a second copy of a common card. */
export function starterSet(f: Faction | WorldFactionId): string[] {
  const isBuild = (FACTIONS as readonly string[]).includes(f);
  const deck = isBuild ? starterDeck(f as Faction, 'corrosion').slice(0, D.minBuild) : starterDeck('predator', f as WorldFactionId).slice(D.minBuild, D.minBuild + D.minWorldFaction);
  const out = deck.filter((id) => !CARD_MAP[id].signature);
  const counts = tally(out);
  // Top up with the cheapest commons of that pool that are not yet at 2 copies.
  const fill = CARDS.filter((c) => c.faction === f && !c.signature && !c.mastery).sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  while (out.length < deck.length) {
    const c = fill.find((x) => (counts[x.id] ?? 0) < D.maxCopies)!;
    out.push(c.id);
    counts[c.id] = (counts[c.id] ?? 0) + 1;
  }
  return out;
}
const TECH_STARTER = starterDeck('predator', 'corrosion').slice(D.minBuild + D.minWorldFaction);

export function startProgress(faction: Faction, worldFaction: WorldFactionId, chip: string): Progress {
  const cards = [...starterSet(faction), ...starterSet(worldFaction), ...TECH_STARTER];
  return {
    biomass: 0,
    earned: 0,
    owned: tally(cards),
    builds: [faction],
    worlds: [worldFaction],
    chips: [chip],
    deck: { faction, worldFaction, chip, loadout: chipRows(chip).map((r) => r.nodes[0].id), cards },
    tower: { floor: 1, checkpoint: 1, best: 0, clears: 0, runSeed: newSeed() },
  };
}

export const loadProgress = () => loadSaveData<Progress>('progress');
export const saveProgress = (p: Progress) => saveSaveData('progress', p);

// ---------- Crafting and unlocks ----------

export const maxOwned = (c: CardDef) => (c.signature ? D.signatureCopies : D.maxCopies);
export const craftCost = (c: CardDef) => (c.signature ? COSTS.signature : 25 + 12 * c.cost);
/** Mastery Signatures come from Faction achievements, not biomass. */
export const craftable = (p: Progress, c: CardDef) => !c.mastery && (c.faction === 'tech' || (p.builds as string[]).includes(c.faction) || (p.worlds as string[]).includes(c.faction));

export function craft(p: Progress, id: string): Progress | string {
  const c = CARD_MAP[id];
  if (!c || !craftable(p, c)) return 'That card is not available to craft.';
  if ((p.owned[id] ?? 0) >= maxOwned(c)) return 'You already own the most copies a deck can use.';
  if (p.biomass < craftCost(c)) return 'Not enough biomass.';
  return { ...p, biomass: p.biomass - craftCost(c), owned: { ...p.owned, [id]: (p.owned[id] ?? 0) + 1 } };
}

/** Unlocking a Build or World Faction also grants its starter set (so a deck can be built with it), and a
 * World Faction comes with its first Chip. */
export function unlock(p: Progress, kind: 'build' | 'world' | 'chip', id: string): Progress | string {
  const cost = COSTS[kind];
  if (p.biomass < cost) return 'Not enough biomass.';
  const grant = (ids: string[]) => {
    const owned = { ...p.owned };
    for (const [k, n] of Object.entries(tally(ids))) owned[k] = Math.max(owned[k] ?? 0, n);
    return owned;
  };
  if (kind === 'build') {
    if (p.builds.includes(id as Faction)) return 'Already unlocked.';
    return { ...p, biomass: p.biomass - cost, builds: [...p.builds, id as Faction], owned: grant(starterSet(id as Faction)) };
  }
  if (kind === 'world') {
    if (p.worlds.includes(id as WorldFactionId)) return 'Already unlocked.';
    const first = chipsFor(id as WorldFactionId)[0].id;
    return { ...p, biomass: p.biomass - cost, worlds: [...p.worlds, id as WorldFactionId], chips: p.chips.includes(first) ? p.chips : [...p.chips, first], owned: grant(starterSet(id as WorldFactionId)) };
  }
  const chip = p.worlds.flatMap((w) => chipsFor(w)).find((c) => c.id === id);
  if (!chip) return 'Unlock its World Faction first.';
  if (p.chips.includes(id)) return 'Already unlocked.';
  return { ...p, biomass: p.biomass - cost, chips: [...p.chips, id] };
}

/** Why the mode deck can't be used right now (empty when it can). */
export function deckProblems(p: Progress): string[] {
  const d = p.deck;
  const out = [...validateDeck(d.faction, d.worldFaction, d.cards), ...validateLoadout(d.chip, d.loadout)];
  if (!p.builds.includes(d.faction)) out.push('That Build is locked.');
  if (!p.worlds.includes(d.worldFaction)) out.push('That World Faction is locked.');
  if (!p.chips.includes(d.chip)) out.push('That Chip is locked.');
  for (const [id, n] of Object.entries(tally(d.cards))) if (n > (p.owned[id] ?? 0)) out.push(`You own ${p.owned[id] ?? 0} of ${CARD_MAP[id]?.name ?? id}, the deck uses ${n}.`);
  return out;
}

// ---------- The Tower ----------

export interface FloorInfo {
  floor: number;
  tier: BotTier;
  boss: 'faction' | 'final' | null;
  checkpoint: boolean;
  /** Floors 41-50: the bot starts evolved, Meltdown starts at round 5, you vent less. */
  twists: boolean;
  reward: number;
}

export function floorInfo(floor: number): FloorInfo {
  const boss = floor === TOWER_FLOORS ? 'final' : floor % 10 === 0 ? 'faction' : null;
  const tier: BotTier = floor <= 10 ? 'basic' : floor <= 25 ? 'reader' : 'search';
  const reward = floor === TOWER_FLOORS ? 500 : (10 + 2 * floor) * (boss ? 3 : 1);
  return { floor, tier, boss, checkpoint: floor % 5 === 0, twists: floor >= 41, reward };
}

export const TIER_TEXT: Record<BotTier, string> = {
  basic: 'Basic heuristic bot',
  reader: 'Reads your stance history, plays around your Toxins, bluffs with face-down grafts',
  search: 'Search bot: simulates its options several moves ahead (Monte Carlo tree search)',
};

const efficiency = (c: CardDef) => {
  const r = budgetOf(c, defaultConfig);
  return r.total - r.target;
};

/** The final boss's deck: the strongest cards from every pool, with a sane curve and slot coverage. */
export function finalBossDeck(): string[] {
  const pool = CARDS.filter((c) => c.faction !== 'tech' || c.type === 'protocol').sort((a, b) => efficiency(b) - efficiency(a) || b.cost - a.cost);
  const out: string[] = [];
  const take = (c: CardDef) => out.push(c.id); // one copy each: variety over consistency
  // Two strong grafts for each slot type, then the best of everything else, at most 6 four-cost cards.
  for (const slot of ['Head', 'Limb', 'Organ', 'Nerve']) pool.filter((c) => c.type === 'graft' && c.slot === slot).slice(0, 2).forEach(take);
  for (const c of pool) {
    if (out.length >= 22) break;
    if (out.includes(c.id)) continue;
    if (c.cost >= 4 && out.filter((id) => CARD_MAP[id].cost >= 4).length >= 6) continue;
    take(c);
  }
  return out;
}

/** The opponent (and any rule twists) for a floor. Deterministic for a run's seed. */
/** Floors where the Unregistered Handler waits instead of a random rival (22 and 38 are also Lineage matches). */
export const OPERATIVE_FLOORS = [22, 38, 47];

export function floorMatch(floor: number, runSeed: number, me: ModeDeck, name: string): MatchSetup {
  const info = floorInfo(floor);
  const rng = makeRng((runSeed ^ (floor * 2654435761)) >>> 0);
  let faction = rng.pick([...FACTIONS]);
  let worldFaction = rng.pick([...WORLD_FACTIONS]);
  let chip = rng.pick(chipsFor(worldFaction)).id;
  let loadout = chipRows(chip).map((r) => rng.pick(r.nodes).id);
  let deck: string[];
  let botName: string;
  if (info.boss === 'final') {
    deck = finalBossDeck();
    botName = Z_NAME;
  } else if (OPERATIVE_FLOORS.includes(floor)) {
    // The Unregistered Handler: a Hollow operative on nobody's roster, shadowing your climb.
    faction = 'parasite';
    worldFaction = 'hollow';
    chip = 'nullField';
    loadout = chipRows(chip).map((r) => r.nodes[r.nodes.length - 1].id);
    // Early floors keep their softer decks (no Signatures), so she is no harder than the floor.
    deck = floor <= 25 ? [...starterSet(faction), ...starterSet(worldFaction), ...TECH_STARTER] : starterDeck(faction, worldFaction);
    botName = OPERATIVE_NAME;
  } else if (info.boss === 'faction') {
    // A Faction Boss: its full starter deck with its Signatures, plus both Mastery Signatures in place of
    // two of its cheapest commons.
    const base = starterDeck(faction, worldFaction);
    const masters = CARDS.filter((c) => c.mastery && (c.faction === faction || c.faction === worldFaction)).map((c) => c.id);
    const cheapest = [...base.keys()].filter((i) => !CARD_MAP[base[i]].signature).sort((a, b) => CARD_MAP[base[a]].cost - CARD_MAP[base[b]].cost);
    const swap = new Map<number, string>();
    masters.forEach((m) => {
      const fac = CARD_MAP[m].faction;
      const i = cheapest.find((j) => !swap.has(j) && CARD_MAP[base[j]].faction === fac);
      if (i !== undefined) swap.set(i, m);
    });
    deck = base.map((id, i) => swap.get(i) ?? id);
    botName = `Boss: ${cap(faction)} / ${cap(worldFaction)}`;
  } else {
    deck = floor <= 25 ? [...starterSet(faction), ...starterSet(worldFaction), ...TECH_STARTER] : starterDeck(faction, worldFaction);
    botName = `Floor ${floor}`;
  }
  const forms = (defaultConfig.evolutions as Record<string, { id: string }[]>)[faction];
  const bot: PlayerSetup = {
    name: botName,
    faction,
    worldFaction,
    chip,
    loadout,
    deck,
    isBot: true,
    ai: info.boss === 'final' ? 'search' : info.tier,
    ...(info.twists ? { startEvolution: rng.pick(forms).id } : {}),
    ...(info.boss === 'final' ? { unrestricted: true } : {}),
  };
  const you: PlayerSetup = { name, faction: me.faction, worldFaction: me.worldFaction, chip: me.chip, loadout: me.loadout, deck: me.cards, ...(info.twists ? { ventMalus: 1 } : {}) };
  const config: DeepPartial<Config> | undefined = info.twists ? { match: { meltdownFromRound: 5 } } : undefined;
  return { seed: newSeed(), players: [you, bot], ...(config ? { config } : {}) };
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Replaying a floor you have already cleared pays a quarter of its reward and never moves you. */
export const replayReward = (floor: number) => Math.max(1, Math.round(floorInfo(floor).reward / 4));
/** The highest floor you can replay: everything you've cleared (in any run). */
export const replayableUpTo = (t: TowerState) => Math.max(t.best, t.floor - 1);

export function replayResult(p: Progress, floor: number, won: boolean): { progress: Progress; reward: number } {
  const reward = won ? replayReward(floor) : 0;
  return { progress: { ...p, biomass: p.biomass + reward, earned: p.earned + reward }, reward };
}

/** Apply a Tower match result: biomass on a win, the next floor (or back to the checkpoint on a loss). A floor
 * pays in full the first time it is cleared in this save; clearing it again (climbing back after a checkpoint,
 * or in a later run) pays the replay rate, so the Tower can't be farmed. */
export function towerResult(p: Progress, floor: number, won: boolean): { progress: Progress; reward: number; cleared: boolean } {
  const t = p.tower;
  if (!won) return { progress: { ...p, tower: { ...t, floor: t.checkpoint } }, reward: 0, cleared: false };
  const info = floorInfo(floor);
  const reward = floor > t.best ? info.reward : replayReward(floor);
  const cleared = floor >= TOWER_FLOORS;
  const tower: TowerState = cleared
    ? { floor: 1, checkpoint: 1, best: TOWER_FLOORS, clears: t.clears + 1, runSeed: newSeed() }
    : { ...t, floor: floor + 1, checkpoint: info.checkpoint ? floor + 1 : t.checkpoint, best: Math.max(t.best, floor) };
  return { progress: { ...p, biomass: p.biomass + reward, earned: p.earned + reward, tower }, reward, cleared };
}
