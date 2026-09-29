import { keepStorage } from './pwa';
import type { Action, BotTier, Faction, MatchSetup, PlayerId, Stance, WorldFactionId } from '../engine';

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
  /** When this save was last exported (a backup file or code). */
  backedUp?: number;
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
  keepStorage();
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
  for (const k of slotKeys(slot)) remove(k);
}

// ---------- Backups: a save as a file or a code ----------
const slotPrefix = (slot: number) => `specimen.save${slot}.`;
function slotKeys(slot: number): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(slotPrefix(slot))) keys.push(k);
    }
  } catch {
    /* storage unavailable */
  }
  return keys;
}

export interface SaveBackup {
  game: 'Specimen';
  kind: 'save';
  v: 1;
  exportedAt: number;
  meta: SaveMeta;
  /** Every per-save key (decks, progress, matches, replays, ...) by its name inside the save. */
  data: Record<string, unknown>;
}

/** Everything a save holds, ready to write to a file or a code. Marks the save as backed up. */
export function exportSave(slot: number): SaveBackup | null {
  keepStorage();
  const idx = loadSaveIndex();
  const meta = idx.slots[slot];
  if (!meta) return null;
  const data: Record<string, unknown> = {};
  for (const k of slotKeys(slot)) data[k.slice(slotPrefix(slot).length)] = read<unknown>(k, null);
  const now = Date.now();
  idx.slots[slot] = { ...meta, backedUp: now };
  writeIndex(idx);
  return { game: 'Specimen', kind: 'save', v: 1, exportedAt: now, meta: { name: meta.name, created: meta.created }, data };
}

/** Check that something is a Specimen save backup (from a file or a code); throws a readable error if not. */
export function parseBackup(x: unknown): SaveBackup {
  const b = x as Partial<SaveBackup> | null;
  if (!b || typeof b !== 'object' || b.game !== 'Specimen' || b.kind !== 'save') throw new Error("That isn't a Specimen save.");
  if (b.v !== 1) throw new Error('This save comes from a newer version of the game.');
  if (!b.meta || typeof b.meta.name !== 'string' || !b.data || typeof b.data !== 'object') throw new Error('The save is damaged.');
  const keys = Object.keys(b.data);
  if (keys.length > 64 || keys.some((k) => !/^[A-Za-z][A-Za-z0-9.]{0,40}$/.test(k))) throw new Error('The save is damaged.');
  return { game: 'Specimen', kind: 'save', v: 1, exportedAt: Number(b.exportedAt) || Date.now(), meta: { name: b.meta.name.slice(0, 16) || 'Imported', created: Number(b.meta.created) || Date.now() }, data: b.data };
}

/** Put a backup into a slot (replacing whatever was there) and load it. Throws if storage is full. */
export function importSave(slot: number, b: SaveBackup): void {
  for (const k of slotKeys(slot)) remove(k);
  try {
    for (const [k, v] of Object.entries(b.data)) localStorage.setItem(slotPrefix(slot) + k, JSON.stringify(v));
  } catch {
    for (const k of slotKeys(slot)) remove(k);
    throw new Error("There isn't enough storage space on this device for that save.");
  }
  const idx = loadSaveIndex();
  idx.slots[slot] = { name: b.meta.name, created: b.meta.created, backedUp: b.exportedAt };
  idx.active = slot;
  writeIndex(idx);
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
  /** The bot's difficulty (opponent pick only). */
  ai?: BotTier;
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
/** How one card fared in one match (all counts; absent = 0). */
export interface CardUse {
  played: number;
  rejected?: number;
  /** Destroyed (Integrity 0), severed or necrosed. */
  lost?: number;
  negated?: number;
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
    numbDealt?: number;
    feverDealt?: number;
    necrosisDealt?: number;
    energyDrained?: number;
    /** Engine payoffs fired, in total and per engine (added later). */
    engineFires?: number;
    engineFiresBy?: Partial<Record<string, number>>;
    /** The 20 card ids you brought, and per card id how it fared (added later; absent in older records). */
    deck?: string[];
    cards?: Record<string, CardUse>;
  };
  /** `name`: the opponent's name (added later), which is how the Archive knows you met Z or the Unregistered Handler. */
  opp: MatchSide & { hpLeft: number; name?: string };
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

// ---------- Game Modes progression (per save; nothing without a loaded save) ----------
export function loadSaveData<T>(key: string): T | null {
  const slot = loadSaveIndex().active;
  return slot === null ? null : read<T | null>(scoped(key, slot), null);
}
export function saveSaveData(key: string, value: unknown): void {
  const slot = loadSaveIndex().active;
  if (slot !== null) write(scoped(key, slot), value);
}

// ---------- Replays (per save) ----------
// A replay is just the match setup (seed included) and every action taken: the engine is deterministic, so
// running the actions again rebuilds every moment of the match.
export interface SavedReplay {
  id: string;
  at: number;
  /** Which player is "you". */
  me: PlayerId;
  names: [string, string];
  result: 'win' | 'loss' | 'draw';
  rounds: number;
  /** Where it was played, e.g. "Quick match" or "Tower floor 12". */
  label?: string;
  setup: MatchSetup;
  actions: Action[];
}
export const MAX_REPLAYS = 10;

export const loadReplays = (): SavedReplay[] => read<SavedReplay[]>(scoped('replays'), []);

/** Keep a replay (newest first). If storage is full, the oldest replays make room. */
export function saveReplay(r: SavedReplay): void {
  let list = [r, ...loadReplays().filter((x) => x.id !== r.id)].slice(0, MAX_REPLAYS);
  const key = scoped('replays');
  while (list.length) {
    try {
      localStorage.setItem(key, JSON.stringify(list));
      return;
    } catch {
      list = list.slice(0, -1);
    }
  }
}
export const deleteReplay = (id: string) => write(scoped('replays'), loadReplays().filter((x) => x.id !== id));
