import { describe, expect, it } from 'vitest';
import { cardOf, createMatch, playBotMatch, reduce } from '../src/engine';
import { TUTORIAL_BOT_HP, tutorialSetup } from '../src/ui/tutorial';

describe('Tutorial match', () => {
  it('deals the stacked opening hand in order, with cheap grafts, against a weaker bot', () => {
    const setup = tutorialSetup('You');
    const s = createMatch(setup);
    expect(s.players[0].hand.map((c) => c.cardId)).toEqual(setup.players[0].deck.slice(0, 5));
    expect(s.players[0].hand.filter((c) => cardOf(c.cardId).type === 'graft' && cardOf(c.cardId).cost <= s.config.energy.min).length).toBeGreaterThanOrEqual(2);
    expect(s.players[1].maxHp).toBe(TUTORIAL_BOT_HP);
    expect(s.players[1].hp).toBe(TUTORIAL_BOT_HP);
    // The next card drawn is the sixth in the list.
    expect(s.players[0].deck.at(-1)!.cardId).toBe(setup.players[0].deck[5]);
  });

  it('is the same deal every time, and a mulligan still reshuffles', () => {
    const a = createMatch(tutorialSetup('You'));
    const b = createMatch(tutorialSetup('You'));
    expect(a.players[0].hand).toEqual(b.players[0].hand);
    const m = reduce(a, { type: 'MULLIGAN', player: 0, mulligan: true });
    expect(m.lastError).toBeNull();
    expect(m.players[0].hand).toHaveLength(5);
  });

  it('plays through to a result', () => {
    const setup = tutorialSetup('You');
    const s = playBotMatch({ ...setup, players: [{ ...setup.players[0], isBot: true }, setup.players[1]] });
    expect(s.phase).toBe('over');
  });
});
