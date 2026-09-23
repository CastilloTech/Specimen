// What a given viewer is allowed to see. Face-down (Dormant) grafts expose only their
// slot and Strain to the opponent. The UI and the bot both read boards through here.
import type { AttachedGraft, GameState, PlayerId, PlayRecord, SlotId } from './types';

export interface PublicGraft {
  uid: string;
  slot: SlotId;
  strain: number;
  faceDown: boolean;
  /** Undefined when hidden from this viewer. */
  cardId?: string;
  poisoned: number;
  disabled: number;
  roundsSurvived: number;
  integrity: number;
}

export function publicGraft(g: AttachedGraft, viewerIsOwner: boolean): PublicGraft {
  const hidden = g.faceDown && !viewerIsOwner;
  return {
    uid: g.uid,
    slot: g.slot,
    strain: g.strain,
    faceDown: g.faceDown,
    cardId: hidden ? undefined : g.cardId,
    poisoned: hidden ? 0 : g.poisoned,
    disabled: hidden ? 0 : g.disabled,
    roundsSurvived: g.roundsSurvived,
    integrity: g.integrity,
  };
}

/** A play as `viewer` may see it: a face-down graft played by the opponent has no name yet. */
export function publicPlay(rec: PlayRecord, viewer: PlayerId): PlayRecord {
  if (rec.faceDown && rec.player !== viewer) return { ...rec, cardId: undefined };
  return rec;
}

export function visibleGrafts(s: GameState, viewer: PlayerId, owner: PlayerId): PublicGraft[] {
  return s.players[owner].grafts.map((g) => publicGraft(g, viewer === owner));
}
