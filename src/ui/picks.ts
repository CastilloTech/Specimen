import { chipRows, chipsFor, FACTIONS, makeRng, starterDeck, validateLoadout, WORLD_FACTIONS } from '../engine';
import type { BotTier, Faction, MatchSetup, WorldFactionId } from '../engine';
import { activeSave, loadChipLoadouts, loadDecks, loadLastSetup } from './storage';
import type { LastPlayerPick } from './storage';

// Picks shared by Custom match and Quick match: difficulties, remembered defaults, random opponents. Kept
// out of the Setup screen so the menu's Quick match doesn't need to load that screen.

export interface PlayerCfg {
  name: string;
  faction: Faction;
  worldFaction: WorldFactionId;
  chip: string;
  deckId: string; // 'starter' or a saved deck id
  loadout: string[];
  /** Bot difficulty (the opponent only). */
  ai?: BotTier;
}

/** The three bot difficulties, from the Tower's three bot tiers. */
export const DIFFICULTY: { id: BotTier; label: string; hint: string; color: string }[] = [
  { id: 'basic', label: 'Normal', hint: 'Plays solid, simple heuristics. Good for learning the cards.', color: '#6ee7b7' },
  { id: 'reader', label: 'Hard', hint: 'Reads your stance habits, holds Toxins for your big turns, bluffs with face-down grafts.', color: '#fbbf24' },
  { id: 'search', label: 'Expert', hint: 'Simulates its options many moves ahead before every decision (Monte Carlo search).', color: '#f87171' },
];
export const tierOk = (t: unknown): t is BotTier => DIFFICULTY.some((d) => d.id === t);

export const defaultChip = (wf: WorldFactionId) => chipsFor(wf)[0].id;
// A saved loadout can go stale if the chip's own nodes changed since it was saved (localStorage
// persists across data updates); fall back to the chip's default nodes rather than surface invalid ids.
export const defaultLoadout = (chipId: string) => {
  const saved = loadChipLoadouts()[chipId];
  if (saved && validateLoadout(chipId, saved).length === 0) return saved;
  return chipRows(chipId).map((r) => r.nodes[0].id);
};
export const randomLoadout = (chipId: string) => {
  const rng = makeRng(Math.floor(Math.random() * 2 ** 31));
  return chipRows(chipId).map((r) => rng.pick(r.nodes).id);
};

/** A random Build, World Faction, Chip and loadout: the bot's "surprise me" opponent. */
export function randomCfg(name: string): PlayerCfg {
  const rng = makeRng(Math.floor(Math.random() * 2 ** 31));
  const faction = rng.pick([...FACTIONS]);
  const worldFaction = rng.pick([...WORLD_FACTIONS]);
  const chip = rng.pick(chipsFor(worldFaction)).id;
  return { name, faction, worldFaction, chip, deckId: 'starter', loadout: randomLoadout(chip) };
}

/** Restore a remembered pick if it still fits today's data (chip in that World Faction, deck still saved). */
export function fromPick(pick: LastPlayerPick | undefined, isBot: boolean): PlayerCfg | null {
  if (!pick || !FACTIONS.includes(pick.faction) || !WORLD_FACTIONS.includes(pick.worldFaction)) return null;
  const chip = chipsFor(pick.worldFaction).some((c) => c.id === pick.chip) ? pick.chip : defaultChip(pick.worldFaction);
  const deckOk = pick.deckId === 'starter' || loadDecks().some((d) => d.id === pick.deckId && d.faction === pick.faction && d.worldFaction === pick.worldFaction);
  return { name: pick.name, faction: pick.faction, worldFaction: pick.worldFaction, chip, deckId: deckOk ? pick.deckId : 'starter', loadout: isBot ? randomLoadout(chip) : defaultLoadout(chip), ai: isBot && tierOk(pick.ai) ? pick.ai : undefined };
}

export const deckOf = (c: PlayerCfg) => (c.deckId === 'starter' ? starterDeck(c.faction, c.worldFaction) : (loadDecks().find((d) => d.id === c.deckId)?.cards ?? starterDeck(c.faction, c.worldFaction)));
export const toPick = ({ name, faction, worldFaction, chip, deckId, ai }: PlayerCfg): LastPlayerPick => ({ name, faction, worldFaction, chip, deckId, ...(ai ? { ai } : {}) });

/** The loaded save's player name, or a plain default without a save. */
export const playerName = () => activeSave()?.meta.name ?? 'Player 1';

/** Your defaults (the loaded save's last picks), named after the save. */
export function myDefaults(): PlayerCfg {
  const cfg = fromPick(loadLastSetup()?.[0], false) ?? makeDefaultCfg('Player 1', 'predator', 'corrosion', false);
  return { ...cfg, name: playerName() };
}

/** The difficulty last picked in Custom match (Normal until then). */
export const lastDifficulty = (): BotTier => {
  const ai = loadLastSetup()?.[1]?.ai;
  return tierOk(ai) ? ai : 'basic';
};

/** Quick match: your default picks against a random bot build at your last difficulty, no setup screen. */
export function quickBotSetup(): MatchSetup {
  const me = myDefaults();
  const bot = randomCfg('Bot');
  const ai = lastDifficulty();
  return {
    seed: Math.floor(Math.random() * 2 ** 31),
    players: [
      { name: me.name, faction: me.faction, worldFaction: me.worldFaction, chip: me.chip, deck: deckOf(me), loadout: me.loadout },
      { name: bot.name, faction: bot.faction, worldFaction: bot.worldFaction, chip: bot.chip, deck: deckOf(bot), loadout: bot.loadout, isBot: true, ai },
    ],
  };
}

export function makeDefaultCfg(name: string, faction: Faction, worldFaction: WorldFactionId, isBot: boolean): PlayerCfg {
  const chip = defaultChip(worldFaction);
  return { name, faction, worldFaction, chip, deckId: 'starter', loadout: isBot ? randomLoadout(chip) : defaultLoadout(chip) };
}
