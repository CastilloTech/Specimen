import type { MatchSetup } from '../engine';
import { waveMatch } from './breach';
import { lineageMatch } from './lineage';
import { deckProblems, floorMatch } from './modes';
import type { Progress } from './modes';

// Straight back into play: what each Game Mode's next match is (when it can start without a stop on its own
// screen), and what "Continue" on the menu picks up.

export type ModeKind = 'tower' | 'lineage' | 'breach';

export interface PlayTarget {
  kind: ModeKind;
  label: string;
  /** The match to start, or null when the mode's own screen has something to do first (a mutation, a deck fix). */
  setup: MatchSetup | null;
}

export function modeTarget(p: Progress, kind: ModeKind, name: string): PlayTarget | null {
  const deckOk = deckProblems(p).length === 0;
  if (kind === 'tower') return { kind, label: `Tower floor ${p.tower.floor}`, setup: deckOk ? floorMatch(p.tower.floor, p.tower.runSeed, p.deck, name) : null };
  if (kind === 'lineage') {
    const l = p.lineage;
    if (!l || l.status !== 'active') return null;
    return { kind, label: `Lineage match ${l.match}`, setup: l.offer ? null : lineageMatch(l, name) };
  }
  const b = p.breach;
  if (!b || b.over) return null;
  return { kind, label: `Breach wave ${b.wave}`, setup: waveMatch(b, name) };
}

/** The menu's Continue: a Lineage run in progress first, then a Breach run, then the Tower once you've started climbing. */
export function continueTarget(p: Progress | null, name: string): PlayTarget | null {
  if (!p) return null;
  const lineage = modeTarget(p, 'lineage', name);
  if (lineage) return lineage;
  const breach = modeTarget(p, 'breach', name);
  if (breach) return breach;
  if (p.tower.floor > 1 || p.tower.best > 0) return modeTarget(p, 'tower', name);
  return null;
}
