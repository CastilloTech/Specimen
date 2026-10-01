// What a given viewer is allowed to see. Face-down (Dormant) grafts expose only their
// slot and Strain to the opponent. The UI and the bot both read boards through here.
import type { Action, AttachedGraft, DiscardEntry, GameState, PlayerId, PlayRecord, SlotId } from './types';
import { HIDDEN_CARD_ID } from './data';

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

/** A discard pile as `viewer` may see it: the opponent sees everything except which card was cycled. */
export function publicDiscard(s: GameState, owner: PlayerId, viewer: PlayerId): (Omit<DiscardEntry, 'cardId'> & { cardId?: string })[] {
  return s.players[owner].discard.map((d) => (d.why === 'cycled' && owner !== viewer ? { ...d, cardId: undefined } : d));
}

export function visibleGrafts(s: GameState, viewer: PlayerId, owner: PlayerId): PublicGraft[] {
  return s.players[owner].grafts.map((g) => publicGraft(g, viewer === owner));
}

/**
 * The match as one player may see it, for online play: the server sends each player this, never the full
 * state. Hidden: the opponent's hand (and their cycled cards), both decks' order, the opponent's face-down
 * grafts, the opponent's stance until both are revealed, their unrevealed stance picks in the history, and the
 * random-number state (from which draws could be predicted). Counts, public plays and the log stay as they are.
 */
export function redactFor(s: GameState, viewer: PlayerId): GameState {
  const opp = (1 - viewer) as PlayerId;
  const hide = <T extends { uid: string }>(c: T) => ({ ...c, cardId: HIDDEN_CARD_ID });
  const stanceSecret = s.phase === 'stance';
  const players = s.players.map((p) => {
    const mine = p.id === viewer;
    return {
      ...p,
      hand: mine ? p.hand : p.hand.map(hide),
      deck: p.deck.map(hide),
      grafts: mine ? p.grafts : p.grafts.map((g: AttachedGraft) => (g.faceDown ? { ...g, cardId: HIDDEN_CARD_ID } : g)),
      discard: mine ? p.discard : p.discard.map((d) => (d.why === 'cycled' ? { ...d, cardId: HIDDEN_CARD_ID } : d)),
      stance: !mine && stanceSecret ? null : p.stance,
    };
  }) as GameState['players'];
  const history = s.history.map((a: Action) => (a.player === opp && (a.type === 'PICK_STANCE' || a.type === 'FEINT') ? ({ ...a, stance: null } as unknown as Action) : a));
  return { ...s, seed: 0, rng: 0, players, history, plays: s.plays.map((r) => publicPlay(r, viewer)) };
}
