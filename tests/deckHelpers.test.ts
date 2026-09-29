import { describe, expect, it } from 'vitest';
import { CARD_MAP, defaultConfig, FACTIONS, starterDeck, validateDeck, WORLD_FACTIONS } from '../src/engine';
import { autoFill, deckStats } from '../src/ui/deckHelpers';

const flat = (c: Record<string, number>) => Object.entries(c).flatMap(([id, n]) => Array<string>(n).fill(id));

describe('deck helpers', () => {
  it('stats add up: curve, types and slots cover every card', () => {
    const deck = starterDeck('predator', 'corrosion');
    const s = deckStats(deck);
    expect(s.size).toBe(deck.length);
    expect(s.curve.reduce((a, b) => a + b, 0)).toBe(deck.length);
    expect(Object.values(s.types).reduce((a, b) => a + b, 0)).toBe(deck.length);
    expect(Object.values(s.slots).reduce((a, b) => a + b, 0)).toBe(s.grafts);
  });

  it('warns about a deck of only expensive cards with no grafts', () => {
    const pricey = Object.values(CARD_MAP).filter((c) => c.faction === 'bastion' && c.type !== 'graft' && c.cost >= 3).map((c) => c.id);
    const deck = Array.from({ length: 10 }, (_, i) => pricey[i % pricey.length]);
    const w = deckStats(deck).warnings.join(' ');
    expect(w).toMatch(/Few cheap cards/);
    expect(w).toMatch(/Few grafts/);
  });

  it('auto-fill completes any start (even empty) to a legal deck for every Build and World Faction', () => {
    for (const f of FACTIONS)
      for (const w of WORLD_FACTIONS) {
        const full = flat(autoFill(f, w, {}, (c) => !c.mastery));
        expect(full).toHaveLength(defaultConfig.deck.size);
        expect(validateDeck(f, w, full), `${f}/${w}`).toEqual([]);
        expect(Object.values(deckStats(full).slots), `${f}/${w} slot coverage`).not.toContain(0);
      }
  });

  it('auto-fill keeps what you chose and only adds; in a collection it uses only owned copies', () => {
    const start = { pred_maw_crown: 2 };
    const out = autoFill('predator', 'corrosion', start);
    expect(out.pred_maw_crown).toBe(2);
    const owned = (id: string) => (id.startsWith('pred_') || id.startsWith('cor_') ? 1 : 0);
    const col = autoFill('predator', 'corrosion', {}, (c) => !c.mastery, (c) => owned(c.id));
    for (const [id, n] of Object.entries(col)) expect(n).toBeLessThanOrEqual(owned(id));
  });
});
