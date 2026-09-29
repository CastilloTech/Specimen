import { CARD_MAP, chipRows, chipsFor, defaultConfig, FACTIONS, makeRng, MUTATIONS, starterDeck, WORLD_FACTIONS } from '../engine';
import type { BotTier, Config, DeepPartial, Faction, GameState, MatchSetup, PlayerSetup, WorldFactionId } from '../engine';
import type { Progress } from './modes';

// The daily challenge: one fixed match a day, the same for everyone. You play a loaned Specimen (a set
// Build, World Faction, Chip and starter deck) against a set opponent under one rule twist, from the same
// shuffle every attempt. Try as often as you like; the first win of the day pays biomass, and winning on
// consecutive days builds a streak that pays more.

export interface Twist {
  id: string;
  name: string;
  text: string;
}

export const TWISTS: Twist[] = [
  { id: 'evolved', name: 'Head start', text: 'Your opponent starts the match already evolved.' },
  { id: 'meltdown', name: 'Short fuse', text: 'Meltdown begins in round 4 instead of round 7.' },
  { id: 'glass', name: 'Glass cannons', text: 'Both Specimens have only 26 max HP.' },
  { id: 'grafted', name: 'Pre-grown', text: 'Both Specimens start with two grafts from their deck already attached.' },
  { id: 'strained', name: 'Stressed', text: 'You start the match at 3 Strain.' },
  { id: 'mutant', name: 'Mutant', text: 'Your opponent has two permanent mutations.' },
  { id: 'gifted', name: 'Gifted', text: 'You have a mutation, but your opponent has 50 max HP.' },
  { id: 'thinVents', name: 'Thin vents', text: 'Every vent you make is 1 smaller.' },
];

export interface Daily {
  key: string;
  seed: number;
  you: PlayerSetup;
  opponent: PlayerSetup;
  tier: BotTier;
  twist: Twist;
  /** Mutations in play (yours or theirs, for the twist text). */
  mutations: string[];
  config?: DeepPartial<Config>;
}

/** Today's key in local time: YYYY-MM-DD. */
export function dayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The day before a key (for streaks). */
export function prevDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The challenge for a day. Deterministic: the same key always gives the same match. */
export function dailyChallenge(key: string, name: string): Daily {
  const seed = hash(`specimen-daily-${key}`);
  const rng = makeRng(seed);
  const faction = rng.pick([...FACTIONS]);
  const worldFaction = rng.pick([...WORLD_FACTIONS]);
  const oppFaction = rng.pick(FACTIONS.filter((f) => f !== faction));
  const oppWorld = rng.pick(WORLD_FACTIONS.filter((w) => w !== worldFaction));
  const spec = (f: Faction, w: WorldFactionId, n: string, isBot: boolean): PlayerSetup => {
    const chip = rng.pick(chipsFor(w)).id;
    return { name: n, faction: f, worldFaction: w, chip, loadout: chipRows(chip).map((r) => rng.pick(r.nodes).id), deck: starterDeck(f, w), ...(isBot ? { isBot: true } : {}) };
  };
  let you = spec(faction, worldFaction, name, false);
  let opponent = spec(oppFaction, oppWorld, 'Daily Specimen', true);
  // The weekend challenges face the search bot; weekdays the stance reader.
  const [y, m, d] = key.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  const tier: BotTier = weekday === 0 || weekday === 6 ? 'search' : 'reader';
  opponent = { ...opponent, ai: tier };

  const twist = rng.pick(TWISTS);
  const mutationPool = MUTATIONS.filter((x) => !x.hidden && !x.lineage && !x.cond).map((x) => x.id);
  const mutations: string[] = [];
  const takeMutation = () => {
    const id = mutationPool.splice(Math.floor(rng.float() * mutationPool.length), 1)[0];
    mutations.push(id);
    return id;
  };
  const twoGrafts = (deck: string[]) => [...new Set(deck.filter((id) => CARD_MAP[id].type === 'graft' && !CARD_MAP[id].signature))].slice(0, 2);
  let config: DeepPartial<Config> | undefined;
  switch (twist.id) {
    case 'evolved': {
      const forms = (defaultConfig.evolutions as Record<string, { id: string }[]>)[oppFaction];
      opponent = { ...opponent, startEvolution: rng.pick(forms).id };
      break;
    }
    case 'meltdown':
      config = { match: { meltdownFromRound: 4 } };
      break;
    case 'glass':
      you = { ...you, maxHp: 26 };
      opponent = { ...opponent, maxHp: 26 };
      break;
    case 'grafted':
      you = { ...you, startGrafts: twoGrafts(you.deck) };
      opponent = { ...opponent, startGrafts: twoGrafts(opponent.deck) };
      break;
    case 'strained':
      you = { ...you, startStrain: 3 };
      break;
    case 'mutant':
      opponent = { ...opponent, mutations: [takeMutation(), takeMutation()] };
      break;
    case 'gifted':
      you = { ...you, mutations: [takeMutation()] };
      opponent = { ...opponent, maxHp: 50 };
      break;
    case 'thinVents':
      you = { ...you, ventMalus: 1 };
      break;
  }
  return { key, seed, you, opponent, tier, twist, mutations, config };
}

export function dailySetup(d: Daily): MatchSetup {
  return { seed: d.seed, players: [d.you, d.opponent], ...(d.config ? { config: d.config } : {}) };
}

// ---------- Progress ----------

export interface DailyRecord {
  key: string;
  attempts: number;
  won: boolean;
  /** Best win today: HP left (0 until a win). */
  bestHp: number;
  /** Rounds of that best win. */
  bestRounds?: number;
}
export interface DailyStreak {
  count: number;
  /** The last day won. */
  last: string;
  best: number;
}

export const DAILY_BASE_REWARD = 80;
export const DAILY_STREAK_STEP = 15;
export const DAILY_STREAK_CAP = 7;
/** The first win of the day: more for every consecutive day won (up to a week). */
export const dailyReward = (streak: number) => DAILY_BASE_REWARD + DAILY_STREAK_STEP * (Math.min(streak, DAILY_STREAK_CAP) - 1);

/** Today's record (a fresh one if the stored record is from another day). */
export const todayRecord = (p: Progress, key: string): DailyRecord => (p.daily?.key === key ? p.daily : { key, attempts: 0, won: false, bestHp: 0 });

/** The current streak: still alive if the last win was today or yesterday. */
export function liveStreak(p: Progress, key: string): number {
  const s = p.dailyStreak;
  if (!s) return 0;
  return s.last === key || s.last === prevDay(key) ? s.count : 0;
}

export interface DailyOutcome {
  won: boolean;
  firstWin: boolean;
  reward: number;
  streak: number;
  hp: number;
  newBest: boolean;
}

/** Record an attempt: the first win of the day pays and extends the streak; later wins can set a better score. */
export function applyDaily(p: Progress, key: string, s: GameState): { progress: Progress; outcome: DailyOutcome } {
  const won = s.result?.winner === 0;
  const hp = won ? s.players[0].hp : 0;
  const rec = todayRecord(p, key);
  const firstWin = won && !rec.won;
  const newBest = won && (hp > rec.bestHp || (hp === rec.bestHp && s.round < (rec.bestRounds ?? Infinity)));
  const daily: DailyRecord = { key, attempts: rec.attempts + 1, won: rec.won || won, bestHp: newBest ? hp : rec.bestHp, bestRounds: newBest ? s.round : rec.bestRounds };
  let dailyStreak = p.dailyStreak;
  let reward = 0;
  if (firstWin) {
    const count = liveStreak(p, key) + 1;
    dailyStreak = { count, last: key, best: Math.max(count, p.dailyStreak?.best ?? 0) };
    reward = dailyReward(count);
  }
  const streak = dailyStreak ? liveStreak({ ...p, dailyStreak }, key) : 0;
  return {
    progress: { ...p, daily, dailyStreak, biomass: p.biomass + reward, earned: p.earned + reward },
    outcome: { won, firstWin, reward, streak, hp, newBest },
  };
}
