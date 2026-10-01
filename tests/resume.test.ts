// Getting back into play: what Continue and the mode cards' play buttons start, and unlocks put to use.
import { describe, expect, it } from 'vitest';
import { CARD_MAP, chipsFor, validateDeck } from '../src/engine';
import { startBreach } from '../src/ui/breach';
import { startLineage } from '../src/ui/lineage';
import { applyUnlock, deckProblems, startProgress } from '../src/ui/modes';
import type { Progress } from '../src/ui/modes';
import { continueTarget, modeTarget } from '../src/ui/resume';

const fresh = () => startProgress('predator', 'corrosion', chipsFor('corrosion')[0].id);

describe('Continue', () => {
  it('offers nothing before you have played a mode', () => {
    expect(continueTarget(null, 'You')).toBeNull();
    expect(continueTarget(fresh(), 'You')).toBeNull();
  });

  it('prefers a Lineage run, then a Breach run, then the Tower once climbed', () => {
    const p = fresh();
    const tower = { ...p, tower: { ...p.tower, floor: 4, best: 3 } } as Progress;
    expect(continueTarget(tower, 'You')).toMatchObject({ kind: 'tower', label: 'Tower floor 4' });
    expect(continueTarget(tower, 'You')!.setup!.players[1].name).toBe('Floor 4');
    const breach = { ...tower, breach: startBreach(p.deck) };
    expect(continueTarget(breach, 'You')).toMatchObject({ kind: 'breach', label: 'Breach wave 1' });
    const lineage = { ...breach, lineage: startLineage(p, 'Line') };
    expect(continueTarget(lineage, 'You')).toMatchObject({ kind: 'lineage', label: 'Lineage match 1' });
  });

  it('sends you to the mode screen when it has something for you to do first', () => {
    const p = fresh();
    const offer = { ...p, lineage: { ...startLineage(p, 'Line'), offer: ['m1', 'm2', 'm3'] } };
    expect(modeTarget(offer, 'lineage', 'You')).toMatchObject({ setup: null });
    const broken = { ...p, deck: { ...p.deck, cards: p.deck.cards.slice(0, 10) } };
    expect(deckProblems(broken).length).toBeGreaterThan(0);
    expect(modeTarget(broken, 'tower', 'You')).toMatchObject({ setup: null });
  });
});

describe('Putting an unlock to use', () => {
  it('switching to a new World Faction keeps what fits and fills the rest from your collection', () => {
    const p = fresh();
    // Own Aegis's starter cards and its first Chip, as unlocking it would grant.
    const owned = { ...p.owned };
    for (const id of ['aeg_vital_ward', 'aeg_scaled_plate', 'aeg_bastion_shell', 'aeg_warding_core', 'aeg_mending_carapace', 'aeg_mending_serum', 'aeg_ward_pact', 'aeg_bulwark_protocol']) owned[id] = 2;
    const q = applyUnlock({ ...p, owned, worlds: [...p.worlds, 'aegis'], chips: [...p.chips, chipsFor('aegis')[0].id] }, 'world', 'aegis');
    expect(q.deck.worldFaction).toBe('aegis');
    expect(q.deck.cards.some((id) => CARD_MAP[id].faction === 'corrosion')).toBe(false);
    expect(q.deck.cards.filter((id) => CARD_MAP[id].faction === 'predator').length).toBe(p.deck.cards.filter((id) => CARD_MAP[id].faction === 'predator').length);
    expect(validateDeck(q.deck.faction, q.deck.worldFaction, q.deck.cards)).toEqual([]);
    expect(q.deck.cards.every((id) => q.deck.cards.filter((x) => x === id).length <= (owned[id] ?? 0))).toBe(true);
  });

  it('equipping a Chip sets it with its default loadout', () => {
    const p = fresh();
    const chip = chipsFor('corrosion')[1].id;
    expect(applyUnlock(p, 'chip', chip).deck).toMatchObject({ chip });
  });
});
