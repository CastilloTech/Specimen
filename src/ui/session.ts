import { useEffect, useState } from 'react';
import type { Faction, WorldFactionId } from '../engine';

// Remembering where you were for the rest of the session (sessionStorage: gone when the tab closes): a
// screen's tab and filters, its scroll position, and the deck builder's work in progress.

function read<T>(key: string): T | null {
  try {
    const v = sessionStorage.getItem(key);
    return v === null ? null : (JSON.parse(v) as T);
  } catch {
    return null;
  }
}
function write(key: string, v: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* not remembered this time */
  }
}

/** useState that survives leaving the screen and coming back (for this session). */
export function useSessionState<T>(key: string, init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void] {
  const [v, setV] = useState<T>(() => read<T>(`specimen.ui.${key}`) ?? (typeof init === 'function' ? (init as () => T)() : init));
  useEffect(() => write(`specimen.ui.${key}`, v), [key, v]);
  return [v, setV];
}

/** Puts the page back at the scroll position it had when you left it. */
export function useScrollMemory(key: string): void {
  useEffect(() => {
    const k = `specimen.scroll.${key}`;
    const y = read<number>(k);
    if (y) requestAnimationFrame(() => window.scrollTo(0, y));
    const save = () => write(k, window.scrollY);
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      save();
      window.removeEventListener('scroll', save);
    };
  }, [key]);
}

/** The deck builder's work in progress, kept across screens (testing a deck, a detour to the menu). */
export interface DeckDraft {
  faction: Faction;
  worldFaction: WorldFactionId;
  counts: Record<string, number>;
  /** The last loaded / saved / starter state (for "unsaved changes"). */
  clean: Record<string, number>;
  name: string;
}
const DRAFT = 'specimen.deckDraft';
export const loadDeckDraft = () => read<DeckDraft>(DRAFT);
export const saveDeckDraft = (d: DeckDraft) => write(DRAFT, d);
