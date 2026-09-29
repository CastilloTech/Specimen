import { CARDS, chipRows, chipsFor, defaultConfig, FACTIONS, makeRng, WORLD_FACTIONS } from '../engine';
import type { GameState, MatchSetup, PlayerSetup } from '../engine';
import type { ModeDeck } from './modes';

// Containment Breach: endless waves of escaped Specimens (20 HP, a few grafts and nothing else). Your HP and Strain carry
// from wave to wave: between waves you heal a share of your max HP and vent only a little, so the Strain you build up
// has to be managed across the whole run. The score is the number of waves survived.

const BASE_HP = defaultConfig.specimen.hp;
/** After each wave your Specimen heals this share of its max HP. */
export const BETWEEN_HEAL_PCT = 0.25;
export const betweenHeal = (maxHp = BASE_HP) => Math.round(maxHp * BETWEEN_HEAL_PCT);
export const BETWEEN_VENT = 2;
/** Carried Strain is capped here so a run can't start a wave already doomed to reject twice. */
const CARRY_CAP = defaultConfig.strain.threshold + 1;

export interface BreachRun {
  /** The next wave (1-based); waves survived = wave - 1. */
  wave: number;
  hp: number;
  strain: number;
  seed: number;
  earned: number;
  deck: ModeDeck;
  over: boolean;
}

export interface BreachRecord {
  best: number;
  runs: number;
}

export const ESCAPEE_HP = 20;
export const BREACH_WAVES_GOAL = 50;
export const waveReward = (wave: number) => 5 + 2 * wave;

export function startBreach(deck: ModeDeck): BreachRun {
  return { wave: 1, hp: BASE_HP, strain: 0, seed: Math.floor(Math.random() * 2 ** 31), earned: 0, deck: { ...deck, cards: [...deck.cards], loadout: [...deck.loadout] }, over: false };
}

/** How strong a wave's grafts can be: the Energy-cost cap rises every 20 waves, and a third graft grows likelier. */
export function waveStrength(wave: number): { maxCost: number; grafts: number; chanceOfThird: number } {
  const maxCost = Math.min(4, 1 + Math.floor((wave - 1) / 20));
  return { maxCost, grafts: 2, chanceOfThird: Math.min(0.6, (wave - 1) / 60) };
}

/**
 * The next wave: an escaped Specimen with ${ESCAPEE_HP} HP and 2-3 grafts already attached, and no other cards
 * (no hand, no deck), played by the basic bot. Your Specimen carries its HP and Strain in.
 */
export function waveMatch(run: BreachRun, playerName: string): MatchSetup {
  const w = run.wave;
  const rng = makeRng((run.seed ^ (w * 0x85ebca6b)) >>> 0);
  const faction = rng.pick([...FACTIONS]);
  const worldFaction = rng.pick([...WORLD_FACTIONS]);
  const chip = rng.pick(chipsFor(worldFaction)).id;
  const st = waveStrength(w);
  const count = st.grafts + (rng.float() < st.chanceOfThird ? 1 : 0);
  // Distinct slot types, drawn from its own two pools within the wave's cost cap.
  const pool = CARDS.filter((c) => c.type === 'graft' && !c.mastery && (c.faction === faction || c.faction === worldFaction) && c.cost <= st.maxCost);
  const grafts: string[] = [];
  const used: Record<string, number> = {};
  const shuffled = pool.map((c) => ({ c, k: rng.float() })).sort((x, y) => x.k - y.k).map((x) => x.c);
  for (const c of shuffled) {
    if (grafts.length >= count) break;
    // Limb has two sockets; every other slot type only one.
    if ((used[c.slot!] ?? 0) >= (c.slot === 'Limb' ? 2 : 1)) continue;
    used[c.slot!] = (used[c.slot!] ?? 0) + 1;
    grafts.push(c.id);
  }
  const bot: PlayerSetup = {
    name: `Escapee ${w}`,
    faction,
    worldFaction,
    chip,
    loadout: chipRows(chip).map((r) => rng.pick(r.nodes).id),
    deck: [],
    unrestricted: true,
    startGrafts: grafts,
    isBot: true,
    ai: 'basic',
    maxHp: ESCAPEE_HP,
  };
  const d = run.deck;
  const you: PlayerSetup = { name: playerName, faction: d.faction, worldFaction: d.worldFaction, chip: d.chip, loadout: d.loadout, deck: d.cards, startHp: run.hp, startStrain: run.strain };
  return { seed: Math.floor(Math.random() * 2 ** 31), players: [you, bot] };
}

/** After a wave: survive (carry HP and Strain over, with a little healing and venting) or the run ends. */
export function afterWave(run: BreachRun, s: GameState): { run: BreachRun; survived: boolean; reward: number } {
  const me = s.players[0];
  const survived = s.result?.winner === 0;
  if (!survived) return { run: { ...run, over: true }, survived, reward: 0 };
  const reward = waveReward(run.wave);
  return {
    run: { ...run, wave: run.wave + 1, hp: Math.min(me.maxHp, me.hp + betweenHeal(me.maxHp)), strain: Math.min(CARRY_CAP, Math.max(0, me.strain - BETWEEN_VENT)), earned: run.earned + reward },
    survived,
    reward,
  };
}

export const wavesSurvived = (run: BreachRun) => run.wave - 1;
