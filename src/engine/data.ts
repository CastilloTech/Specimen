import cardsJson from '../data/cards.json';
import configJson from '../data/config.json';
import decksJson from '../data/decks.json';
import treesJson from '../data/trees.json';
import type { CardDef, Config, DeepPartial, Faction, TreeNode } from './types';

export const defaultConfig: Config = configJson as Config;
export const CARDS: CardDef[] = cardsJson as unknown as CardDef[];
export const CARD_MAP: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.id, c]));
export const STARTER_DECKS = decksJson as unknown as Record<Faction, string[]>;

export function cardOf(id: string): CardDef {
  const c = CARD_MAP[id];
  if (!c) throw new Error(`Unknown card id: ${id}`);
  return c;
}

export interface TreeRow {
  id: string;
  name: string;
  nodes: TreeNode[];
}

const ROWS = treesJson.rows as { id: string; name: string }[];

export function treeRows(faction: Faction): TreeRow[] {
  const f = (treesJson.factions as unknown as Record<string, Record<string, TreeNode[]>>)[faction];
  const shared = treesJson.shared as unknown as Record<string, TreeNode[]>;
  return ROWS.map((r) => ({ ...r, nodes: f[r.id] ?? shared[r.id] ?? [] }));
}

const NODE_MAP: Record<string, TreeNode> = {};
for (const f of Object.values(treesJson.factions as unknown as Record<string, Record<string, TreeNode[]>>))
  for (const nodes of Object.values(f)) for (const n of nodes) NODE_MAP[n.id] = n;
for (const nodes of Object.values(treesJson.shared as unknown as Record<string, TreeNode[]>)) for (const n of nodes) NODE_MAP[n.id] = n;

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
