import lore from '../data/lore.json';
import { WORLD_FACTIONS } from '../engine';
import type { WorldFactionId } from '../engine';
import type { MatchRecord } from './storage';
import type { Progress } from './modes';
import { activeSave, loadSaveData, saveSaveData } from './storage';

// The story is never told outright: it lives in flavour text on cards, Chips and evolutions, in recovered
// records (the Archive) unlocked by playing, and in a few lines spoken by named opponents in the Tower and
// Lineage. Each source is biased; the truth sits in the gaps between them.

export type LoreSource = 'program' | 'corrosion' | 'aegis' | 'miasma' | 'hollow' | 'handler' | 'operative' | 'z' | 'unknown';

export type Unlock =
  | { kind: 'start' }
  | { kind: 'matches' | 'wins' | 'engines' | 'forms' | 'tower' | 'lineage'; n: number }
  | { kind: 'winBuild' | 'winWorld' | 'engine'; id: string }
  | { kind: 'evolve'; id?: string }
  | { kind: 'lineageComplete' }
  | { kind: 'met'; name: string; n: number }
  | { kind: 'beat'; name: string }
  | { kind: 'all'; ids: string[] };

export interface Fragment {
  id: string;
  source: LoreSource;
  title: string;
  /** A vague hint at where it turns up, shown while it is still missing. */
  where: string;
  /** May hold "{clue}": filled in from `clues` by the save's recruiter (see recruiterOf). */
  text: string;
  clues?: Record<string, string>;
  unlock: Unlock;
}

export interface EncounterLines {
  before: string;
  win: string;
  loss: string;
}

export const CARD_FLAVOR: Record<string, string> = lore.cards;
export const CHIP_FLAVOR: Record<string, string> = lore.chips;
export const EVOLUTION_FLAVOR: Record<string, string> = lore.evolutions;
export const FRAGMENTS: Fragment[] = lore.fragments as Fragment[];
const ENCOUNTERS: Record<string, EncounterLines[]> = lore.encounters;

/** The final boss of the Tower and of every Lineage. */
export const Z_NAME = 'Z';
/** The Hollow handler who is not on any roster. */
export const OPERATIVE_NAME = 'Unregistered Handler';

export const SOURCE_META: Record<LoreSource, { name: string; color: string }> = {
  program: { name: 'The Program', color: '#9aa7a1' },
  corrosion: { name: 'Corrosion', color: '#8fbf4a' },
  aegis: { name: 'Aegis', color: '#c9c9c9' },
  miasma: { name: 'Miasma', color: '#7a6bd6' },
  hollow: { name: 'Hollow', color: '#a79cc0' },
  handler: { name: 'Handlers', color: '#d9a55b' },
  operative: { name: 'Unregistered', color: '#6f7d88' },
  z: { name: 'Z', color: '#e8b04a' },
  unknown: { name: 'Unsigned', color: '#b7c4bf' },
};

/** Lineage rivals are named "<epithet> <Build noun> of <line>" or "Matriarch of the <line> Line". */
const LINEAGE_RIVAL = /( of [A-Z][a-z]+$|^Matriarch of the )/;

/**
 * Which World Faction recruited this save's handler. Never shown: it only changes a few clues in the records,
 * so each save has its own answer to work out. Fixed by the save's creation time.
 */
export function recruiterOf(created: number | null | undefined): WorldFactionId {
  const n = Math.abs(Math.floor(created ?? 0));
  const h = (Math.imul(n ^ (n >>> 16), 0x45d9f3b) ^ Math.imul(Math.floor(n / 4294967296), 0x27d4eb2d)) >>> 0;
  return WORLD_FACTIONS[h % WORLD_FACTIONS.length];
}
export const currentRecruiter = (): WorldFactionId => recruiterOf(activeSave()?.meta.created);

/** A record's text, with its clue filled in for this recruiter. */
export function fragmentText(f: Fragment, recruiter: WorldFactionId): string {
  return f.clues ? f.text.replace('{clue}', f.clues[recruiter] ?? '') : f.text;
}

/** Which fragments this save has recovered, from its match history and Game Modes progress. */
export function unlockedFragments(rs: MatchRecord[], p: Progress | null): Set<string> {
  const wins = rs.filter((r) => r.result === 'win');
  const fired = new Set(rs.flatMap((r) => Object.entries(r.me.engineFiresBy ?? {}).filter(([, n]) => (n ?? 0) > 0).map(([k]) => k)));
  const forms = new Set(rs.map((r) => r.me.evolution).filter(Boolean));
  const met = (name: string) => rs.filter((r) => r.opp.name === name).length;
  // Only Lineage names its rivals after bloodlines (Z and the Unregistered Handler also wait in the Tower).
  const lineageMatches = rs.filter((r) => LINEAGE_RIVAL.test(r.opp.name ?? '')).length;
  const out = new Set<string>();
  const ok = (u: Unlock): boolean => {
    switch (u.kind) {
      case 'start':
        return true;
      case 'matches':
        return rs.length >= u.n;
      case 'wins':
        return wins.length >= u.n;
      case 'winBuild':
        return wins.some((r) => r.me.faction === u.id);
      case 'winWorld':
        return wins.some((r) => r.me.worldFaction === u.id);
      case 'engine':
        return fired.has(u.id);
      case 'engines':
        return fired.size >= u.n;
      case 'evolve':
        return u.id ? forms.has(u.id) : forms.size > 0;
      case 'forms':
        return forms.size >= u.n;
      case 'tower':
        return (p?.tower.best ?? 0) >= u.n;
      case 'lineage':
        return lineageMatches >= u.n;
      case 'lineageComplete':
        return (p?.lineagesCompleted ?? 0) > 0;
      case 'met':
        return met(u.name) >= u.n;
      case 'beat':
        return wins.some((r) => r.opp.name === u.name);
      case 'all':
        return u.ids.every((id) => out.has(id));
    }
  };
  // "all" fragments depend on others: settle in a few passes (the chains are short).
  for (let pass = 0; pass < 4; pass++) for (const f of FRAGMENTS) if (!out.has(f.id) && ok(f.unlock)) out.add(f.id);
  return out;
}

/** Fragments already opened in the Archive (per save). */
export const loadSeenLore = (): Set<string> => new Set(loadSaveData<string[]>('loreSeen') ?? []);
export function markLoreSeen(ids: Iterable<string>): void {
  const seen = loadSeenLore();
  for (const id of ids) seen.add(id);
  saveSaveData('loreSeen', [...seen]);
}
/** Recovered but not yet read (0 without a save: nothing read could be remembered). */
export const unreadLore = (rs: MatchRecord[], p: Progress | null): number => {
  if (!activeSave()) return 0;
  const seen = loadSeenLore();
  return [...unlockedFragments(rs, p)].filter((id) => !seen.has(id)).length;
};

/**
 * What a named opponent says. `met` is how many earlier matches you have played against them: the n-th
 * meeting uses the n-th set of lines (the last set repeats).
 */
export function encounterLines(name: string, met: number, worldFaction?: string): EncounterLines | null {
  // Faction bosses (Tower) and bloodline Matriarchs (Lineage) speak for their World Faction.
  const boss = /^Boss: |^Matriarch of the /.test(name) && worldFaction ? ENCOUNTERS[`boss:${worldFaction}`] : undefined;
  const list = ENCOUNTERS[name] ?? boss;
  if (!list?.length) return null;
  return list[Math.min(met, list.length - 1)];
}
export const metBefore = (rs: MatchRecord[], name: string) => rs.filter((r) => r.opp.name === name).length;
