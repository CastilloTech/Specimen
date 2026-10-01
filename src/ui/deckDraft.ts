import { CARD_MAP, starterDeck } from '../engine';
import type { Faction, WorldFactionId } from '../engine';
import { autoFill } from './deckHelpers';
import { saveDeckDraft } from './session';

const tally = (ids: string[]) => ids.reduce<Record<string, number>>((m, id) => ((m[id] = (m[id] ?? 0) + 1), m), {});

/**
 * Put a just-unlocked card straight onto the deck builder's bench: a deck of its Build or World Faction with
 * the card in it (the rest auto-filled), so "unlocked" leads directly to "try it".
 */
export function startDraftWith(cardId: string, pair?: { faction: Faction; worldFaction: WorldFactionId }): void {
  const c = CARD_MAP[cardId];
  if (!c) return;
  const isBuild = ['predator', 'parasite', 'bastion'].includes(c.faction);
  const faction = (isBuild ? c.faction : (pair?.faction ?? 'predator')) as Faction;
  const worldFaction = (isBuild ? (pair?.worldFaction ?? 'corrosion') : c.faction) as WorldFactionId;
  const counts = autoFill(faction, worldFaction, { [cardId]: 1 });
  saveDeckDraft({ faction, worldFaction, counts, clean: tally(starterDeck(faction, worldFaction)), name: `${c.name} deck` });
}
