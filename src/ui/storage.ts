import { defaultConfig } from '../engine';
import type { Config, DeepPartial, Faction } from '../engine';

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

// ---------- Settings ----------
export interface Settings {
  timers: boolean;
  cycling: boolean;
  dormant: boolean;
  neuralLinks: boolean;
  energyBanking: boolean;
  stanceMomentum: boolean;
  replaceGrafts: boolean;
  confirmPass: boolean;
  keyboard: boolean;
}

export const defaultSettings = (): Settings => ({
  timers: defaultConfig.timers.enabled,
  cycling: defaultConfig.features.cycling,
  dormant: defaultConfig.features.dormant,
  neuralLinks: defaultConfig.features.neuralLinks,
  energyBanking: defaultConfig.features.energyBanking,
  stanceMomentum: defaultConfig.features.stanceMomentum,
  replaceGrafts: defaultConfig.replace.enabled,
  confirmPass: true,
  keyboard: true,
});

export const loadSettings = (): Settings => ({ ...defaultSettings(), ...read<Partial<Settings>>('specimen.settings', {}) });
export const saveSettings = (s: Settings) => write('specimen.settings', s);

export function configPatch(s: Settings): DeepPartial<Config> {
  return { features: { cycling: s.cycling, dormant: s.dormant, neuralLinks: s.neuralLinks, energyBanking: s.energyBanking, stanceMomentum: s.stanceMomentum }, replace: { enabled: s.replaceGrafts } };
}

// ---------- Decks and loadouts ----------
export interface SavedDeck {
  id: string;
  name: string;
  faction: Faction;
  cards: string[];
}

export const loadDecks = (): SavedDeck[] => read<SavedDeck[]>('specimen.decks', []);
export const saveDecks = (d: SavedDeck[]) => write('specimen.decks', d);

export const loadLoadouts = (): Partial<Record<Faction, string[]>> => read('specimen.loadouts', {});
export function saveLoadout(f: Faction, loadout: string[]): void {
  write('specimen.loadouts', { ...loadLoadouts(), [f]: loadout });
}
