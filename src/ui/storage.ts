import type { Faction, Stance, WorldFactionId } from '../engine';

// Everything here is a per-browser convenience: reads/writes are wrapped so a blocked
// or full localStorage never breaks the app.

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ---------- Settings: keybinds only ----------
export type KeyAction = 'aggress' | 'adapt' | 'fortify' | 'pass' | 'hold' | 'cycle' | 'wake' | 'keep' | 'mulligan' | 'noResponse' | 'help';

export const KEY_ACTIONS: { id: KeyAction; label: string; hint: string; def: string }[] = [
  { id: 'aggress', label: 'Aggress', hint: 'Stance pick (also takes the 1st evolution option)', def: 'a' },
  { id: 'adapt', label: 'Adapt', hint: 'Stance pick (also takes the 2nd evolution option)', def: 'd' },
  { id: 'fortify', label: 'Fortify', hint: 'Stance pick', def: 'f' },
  { id: 'pass', label: 'Pass', hint: 'End your turn', def: 'p' },
  { id: 'hold', label: 'Hold', hint: 'No Clash damage this round for armor and Strain relief', def: 'h' },
  { id: 'cycle', label: 'Cycle', hint: 'Toggle Cycle mode, then pick a card', def: 'c' },
  { id: 'wake', label: 'Wake graft', hint: 'Wake your first sleeping face-down graft', def: 'w' },
  { id: 'keep', label: 'Keep / hold off', hint: 'Keep the opening hand; hold off evolving; keep your stance on a Feint', def: 'k' },
  { id: 'mulligan', label: 'Mulligan', hint: 'Redraw the opening hand', def: 'm' },
  { id: 'noResponse', label: 'No response', hint: 'Decline to answer a play with a Protocol', def: 'n' },
  { id: 'help', label: 'Rules help', hint: 'Show or hide the quick rules', def: '?' },
];

export type Keybinds = Record<KeyAction, string>;
export interface Settings {
  keybinds: Keybinds;
}

export const defaultKeybinds = (): Keybinds => Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.def])) as Keybinds;
export const defaultSettings = (): Settings => ({ keybinds: defaultKeybinds() });
export const loadSettings = (): Settings => {
  const saved = read<Partial<Settings>>('specimen.settings', {});
  return { keybinds: { ...defaultKeybinds(), ...(saved.keybinds ?? {}) } };
};
export const saveSettings = (s: Settings) => write('specimen.settings', s);

/** How a key is shown to the player. */
export const keyLabel = (k: string) => (k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k);

// ---------- Save slots ----------
export const SAVE_SLOTS = 3;
export interface SaveMeta {
  name: string;
  created: number;
}
interface SaveIndex {
  active: number | null;
  slots: (SaveMeta | null)[];
}

const emptyIndex = (): SaveIndex => ({ active: null, slots: Array<SaveMeta | null>(SAVE_SLOTS).fill(null) });
export function loadSaveIndex(): SaveIndex {
  const idx = read<SaveIndex>('specimen.saves', emptyIndex());
  const slots = Array.from({ length: SAVE_SLOTS }, (_, i) => idx.slots?.[i] ?? null);
  const active = idx.active !== null && slots[idx.active] ? idx.active : null;
  return { active, slots };
}
const writeIndex = (idx: SaveIndex) => write('specimen.saves', idx);

export function activeSave(): { slot: number; meta: SaveMeta } | null {
  const idx = loadSaveIndex();
  return idx.active === null ? null : { slot: idx.active, meta: idx.slots[idx.active]! };
}

export function createSave(slot: number, name: string): void {
  const idx = loadSaveIndex();
  idx.slots[slot] = { name: name.trim().slice(0, 16) || `Player ${slot + 1}`, created: Date.now() };
  idx.active = slot;
  writeIndex(idx);
}
export function renameSave(slot: number, name: string): void {
  const idx = loadSaveIndex();
  const meta = idx.slots[slot];
  if (!meta) return;
  meta.name = name.trim().slice(0, 16) || meta.name;
  writeIndex(idx);
}
export function setActiveSave(slot: number | null): void {
  const idx = loadSaveIndex();
  idx.active = slot !== null && idx.slots[slot] ? slot : null;
  writeIndex(idx);
}
export function deleteSave(slot: number): void {
  const idx = loadSaveIndex();
  idx.slots[slot] = null;
  if (idx.active === slot) idx.active = null;
  writeIndex(idx);
  for (const k of ['decks', 'chipLoadouts', 'lastSetup.bot', 'matches']) remove(`specimen.save${slot}.${k}`);
}

/** Per-save data lives under that save's own keys; with no save loaded it uses the unsaved (guest) keys. */
const scoped = (key: string, slot: number | null | undefined = loadSaveIndex().active) => (slot === null ? `specimen.${key}` : `specimen.save${slot}.${key}`);

// ---------- Decks and loadouts (per save) ----------
export interface SavedDeck {
  id: string;
  name: string;
  faction: Faction;
  worldFaction: WorldFactionId;
  cards: string[];
}

export const loadDecks = (slot?: number | null): SavedDeck[] => read<SavedDeck[]>(scoped('decks', slot), []);
export const saveDecks = (d: SavedDeck[]) => write(scoped('decks'), d);

// Last match-setup picks: your default Build / World Faction / Chip / deck, and the last opponent.
export interface LastPlayerPick {
  name: string;
  faction: Faction;
  worldFaction: WorldFactionId;
  chip: string;
  deckId: string;
}
export const loadLastSetup = (slot?: number | null): LastPlayerPick[] | null => read<LastPlayerPick[] | null>(scoped('lastSetup.bot', slot), null);
export const saveLastSetup = (picks: LastPlayerPick[]) => write(scoped('lastSetup.bot'), picks);

// Chip ids are globally unique across World Factions, so one flat dict (no nesting) is enough.
export const loadChipLoadouts = (): Partial<Record<string, string[]>> => read(scoped('chipLoadouts'), {});
export function saveChipLoadout(chipId: string, loadout: string[]): void {
  write(scoped('chipLoadouts'), { ...loadChipLoadouts(), [chipId]: loadout });
}

// ---------- Match history (per save; only kept while a save is loaded) ----------
export interface MatchSide {
  faction: Faction;
  worldFaction: WorldFactionId;
  chip: string;
  evolution: string | null;
}
export interface MatchRecord {
  at: number;
  result: 'win' | 'loss' | 'draw';
  reason: string;
  rounds: number;
  me: MatchSide & {
    loadout: string[];
    dealt: number;
    taken: number;
    blocked: number;
    rejections: number;
    maxStrain: number;
    vented: number;
    hpLeft: number;
    stances: Stance[];
    // Added later: optional so older saved matches still load.
    graftsPlayed?: number;
    cardsPlayed?: number;
    hpHealed?: number;
    graftsLost?: number;
    graftsKilled?: number;
    burned?: number;
    stanceWon?: number;
    stanceLost?: number;
    stanceTied?: number;
    evolvedRound?: number | null;
  };
  opp: MatchSide & { hpLeft: number };
  ko?: boolean;
  comeback?: boolean;
}
const MAX_RECORDS = 300;
export function loadMatches(slot: number | null = loadSaveIndex().active): MatchRecord[] {
  return slot === null ? [] : read<MatchRecord[]>(scoped('matches', slot), []);
}
export function recordMatch(rec: MatchRecord): void {
  const slot = loadSaveIndex().active;
  if (slot === null) return;
  write(scoped('matches', slot), [...loadMatches(slot), rec].slice(-MAX_RECORDS));
}
