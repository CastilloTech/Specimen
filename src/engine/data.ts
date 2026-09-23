import cardsJson from '../data/cards.json';
import chipsJson from '../data/chips.json';
import configJson from '../data/config.json';
import decksJson from '../data/decks.json';
import type { CardDef, ChipDef, Config, DeepPartial, Faction, TreeNode, WorldFactionId } from './types';
import { FACTIONS } from './types';

export const defaultConfig: Config = configJson as Config;
export const CARDS: CardDef[] = cardsJson as unknown as CardDef[];
export const CARD_MAP: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.id, c]));

export function cardOf(id: string): CardDef {
  const c = CARD_MAP[id];
  if (!c) throw new Error(`Unknown card id: ${id}`);
  return c;
}

// ---------- Starter decks: a Build seed + a World Faction seed + a shared Tech seed. ----------
interface DecksJson {
  build: Record<Faction, string[]>;
  world: Record<WorldFactionId, string[]>;
  tech: string[];
}
const DECKS = decksJson as unknown as DecksJson;

/** The default deck for a Build x World Faction pairing (used to seed the deck builder and quick-start setup). */
export function starterDeck(faction: Faction, worldFaction: WorldFactionId): string[] {
  return [...DECKS.build[faction], ...DECKS.world[worldFaction], ...DECKS.tech];
}

/** How many copies of a card its own seed (Build, World Faction, or the shared Tech list) carries -
 * independent of which pairing was used, since each seed is self-contained. Balance-audit tooling only. */
export function starterCopies(id: string): number {
  const c = CARD_MAP[id];
  if (!c) return 0;
  if (c.faction === 'tech') return DECKS.tech.filter((x) => x === id).length;
  if ((FACTIONS as readonly string[]).includes(c.faction)) return DECKS.build[c.faction as Faction].filter((x) => x === id).length;
  return DECKS.world[c.faction as WorldFactionId].filter((x) => x === id).length;
}

// ---------- Chips: the only source of skill nodes. Builds carry no tree of their own. ----------
const CHIPS_BY_WORLD_FACTION = chipsJson as unknown as Record<WorldFactionId, ChipDef[]>;
export const CHIPS: ChipDef[] = Object.values(CHIPS_BY_WORLD_FACTION).flat();
export const CHIP_MAP: Record<string, ChipDef> = Object.fromEntries(CHIPS.map((c) => [c.id, c]));

export function chipOf(id: string): ChipDef | undefined {
  return CHIP_MAP[id];
}

export function chipsFor(worldFaction: WorldFactionId): ChipDef[] {
  return CHIPS_BY_WORLD_FACTION[worldFaction] ?? [];
}

export function chipRows(chipId: string) {
  return chipOf(chipId)?.tree ?? [];
}

export const NODE_MAP: Record<string, TreeNode> = {};
for (const chip of CHIPS) for (const row of chip.tree) for (const n of row.nodes) NODE_MAP[n.id] = n;

export function findNode(id: string): TreeNode | undefined {
  return NODE_MAP[id];
}

export function mergeConfig(base: Config, patch?: DeepPartial<Config>): Config {
  if (!patch) return base;
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  const walk = (dst: Record<string, unknown>, src: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') walk(dst[k] as Record<string, unknown>, v as Record<string, unknown>);
      else dst[k] = v;
    }
  };
  walk(out, patch as Record<string, unknown>);
  return out as unknown as Config;
}

/** What waking a graft on purpose after a round asleep gives, per faction (`config.dormant.ambush`). */
export interface AmbushDef {
  attack?: number;
  armor?: number;
  heal?: number;
  oppStrain?: number;
  draw?: number;
}

export function ambushOf(config: Config, faction: Faction): AmbushDef {
  return (config.dormant.ambush as Record<string, AmbushDef>)[faction] ?? {};
}

/** The Ambush as one readable phrase, e.g. "+4 attack" or "+2 attack and the opponent gains 2 Strain". */
export function ambushText(config: Config, faction: Faction): string {
  const a = ambushOf(config, faction);
  const parts: string[] = [];
  if (a.attack) parts.push(`+${a.attack} attack`);
  if (a.armor) parts.push(`+${a.armor} armor`);
  if (a.heal) parts.push(`heal ${a.heal}`);
  if (a.oppStrain) parts.push(`the opponent gains ${a.oppStrain} Strain`);
  if (a.draw) parts.push(`draw ${a.draw}`);
  return parts.length ? parts.join(' and ') : 'nothing';
}
