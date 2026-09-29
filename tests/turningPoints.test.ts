import { describe, expect, it } from 'vitest';
import { chipRows, chipsFor, playBotMatch, replay, starterDeck } from '../src/engine';
import type { Faction, MatchSetup, WorldFactionId } from '../src/engine';
import { turningPoints } from '../src/ui/turningPoints';

const spec = (name: string, f: Faction, w: WorldFactionId) => {
  const chip = chipsFor(w)[0].id;
  return { name, faction: f, worldFaction: w, chip, loadout: chipRows(chip).map((r) => r.nodes[0].id), deck: starterDeck(f, w), isBot: true };
};
const setupFor = (seed: number): MatchSetup => ({ seed, players: [spec('You', (['predator', 'parasite', 'bastion'] as const)[seed % 3], (['corrosion', 'aegis', 'miasma', 'hollow'] as const)[seed % 4]), spec('Bot', (['bastion', 'predator', 'parasite'] as const)[seed % 3], (['hollow', 'miasma', 'corrosion', 'aegis'] as const)[seed % 4])] });

describe('turning points', () => {
  it('pick at most three real moments, in match order, each pointing at a replay step where it has happened', () => {
    let total = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const setup = setupFor(seed);
      const end = playBotMatch(setup);
      const pts = turningPoints(setup, end, 0);
      expect(pts.length).toBeLessThanOrEqual(3);
      total += pts.length;
      for (let k = 1; k < pts.length; k++) expect(pts[k].round * 1000 + pts[k].step).toBeGreaterThanOrEqual(pts[k - 1].round * 1000 + pts[k - 1].step);
      for (const t of pts) {
        expect(t.title).toMatch(/^Rounds? \d/);
        expect(t.step).toBeGreaterThan(0);
        expect(t.step).toBeLessThanOrEqual(end.history.length);
        // At that step the round it talks about has been reached.
        expect(replay(setup, end.history.slice(0, t.step)).round).toBeGreaterThanOrEqual(t.round);
      }
    }
    expect(total).toBeGreaterThan(40); // most matches have some
  }, 30000);
});
