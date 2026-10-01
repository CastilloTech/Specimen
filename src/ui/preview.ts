import { CARD_MAP, reduce, zoneOf } from '../engine';
import type { Action, GameState, PlayerId, Zone } from '../engine';
import { previewClash } from '../engine/rules';
import { other } from '../engine';

// "What happens if…": the coming Clash as things stand, and the same after a card you are about to play, so
// the numbers are on screen instead of in your head. Both run on throwaway copies of the match.

export interface ClashPreview {
  /** HP you would take off them, and they off you. */
  deal: number;
  take: number;
}

export function clashPreview(s: GameState, me: PlayerId): ClashPreview | null {
  if (s.phase !== 'actions' || s.players.some((p) => !p.stance)) return null;
  const [lost0, lost1] = previewClash(s);
  const lost = [lost0, lost1];
  return { deal: lost[other(me)], take: lost[me] };
}

export interface PlayPreview {
  strain: [number, number];
  zone: Zone;
  energy: [number, number];
  clash: { before: ClashPreview; after: ClashPreview } | null;
  /** Enemy grafts it would destroy. */
  kills: string[];
  /** Your own grafts it would cost you (rejected, replaced). */
  losses: string[];
}

/** The match right after this play, with any reaction declined (it is a guess: they may answer it). */
export function simulatePlay(s: GameState, action: Action): GameState | null {
  let n = reduce(s, action);
  if (n.lastError) return null;
  for (let guard = 0; n.window && guard < 4; guard++) {
    n = reduce(n, { type: 'DECLINE_REACTION', player: n.window.reactor });
    if (n.lastError) return null;
  }
  return n;
}

/** `before`: the Clash preview of `s` when the caller already has it (saves working it out twice). */
export function playPreview(s: GameState, me: PlayerId, action: Action, before: ClashPreview | null = clashPreview(s, me)): PlayPreview | null {
  const n = simulatePlay(s, action);
  if (!n) return null;
  const was = s.players[me];
  const now = n.players[me];
  const gone = (a: GameState['players'][number], b: GameState['players'][number]) => a.grafts.filter((g) => !b.grafts.some((x) => x.uid === g.uid)).map((g) => (g.faceDown && a.id !== me ? 'a face-down graft' : (CARD_MAP[g.cardId]?.name ?? 'a graft')));
  const after = clashPreview(n, me);
  return {
    strain: [was.strain, now.strain],
    zone: zoneOf(n, now),
    energy: [was.energy, now.energy],
    clash: before && after ? { before, after } : null,
    kills: gone(s.players[other(me)], n.players[other(me)]),
    losses: gone(was, now),
  };
}
