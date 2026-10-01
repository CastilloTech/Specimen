import { CARDS, CARD_MAP, CHIPS, chipsFor, defaultConfig, FACTIONS, WORLD_FACTIONS } from '../engine';
import type { CardDef, Faction, WorldFactionId } from '../engine';
import type { MatchRecord } from './storage';
import { ENGINE_META } from './meta';

// Achievements are derived entirely from a save's match history, so they also count matches played
// before achievements existed, and need no storage of their own.

export interface Achievement {
  id: string;
  /** Set on Faction achievements: the Build / World Faction they belong to. */
  faction?: Faction | WorldFactionId;
  name: string;
  text: string;
  icon: string;
  /** Progress toward the goal over the whole history, as [have, need]. */
  progress: (rs: MatchRecord[]) => [number, number];
}

const wins = (rs: MatchRecord[]) => rs.filter((r) => r.result === 'win');
const anyMatch = (pred: (r: MatchRecord) => boolean) => (rs: MatchRecord[]): [number, number] => [rs.some(pred) ? 1 : 0, 1];
const distinct = (rs: MatchRecord[], key: (r: MatchRecord) => string, pool: string[]): [number, number] => [pool.filter((k) => rs.some((r) => key(r) === k)).length, pool.length];
const distinctMany = (rs: MatchRecord[], keys: (r: MatchRecord) => string[], pool: string[]): [number, number] => {
  const seen = new Set(rs.flatMap(keys));
  return [pool.filter((k) => seen.has(k)).length, pool.length];
};
function bestStreak(rs: MatchRecord[]): number {
  let best = 0;
  let run = 0;
  for (const r of rs) {
    run = r.result === 'win' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}
const EVOLUTION_IDS = Object.values(defaultConfig.evolutions as Record<string, { id: string }[]>).flat().map((d) => d.id);
const COMBOS = FACTIONS.flatMap((f) => WORLD_FACTIONS.map((w) => `${f}/${w}`));
const LAST_ROUND = defaultConfig.match.maxRounds;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'firstWin', name: 'First Specimen', icon: '⚗', text: 'Win your first match.', progress: (rs) => [Math.min(1, wins(rs).length), 1] },
  { id: 'ko', name: 'Knockout', icon: '✕', text: "Win by bringing the opponent's Specimen to 0 HP.", progress: anyMatch((r) => r.result === 'win' && r.ko === true) },
  { id: 'speed', name: 'Rapid Rejection', icon: '»', text: 'Win by round 5.', progress: anyMatch((r) => r.result === 'win' && r.rounds <= 5) },
  { id: 'photo', name: 'Photo Finish', icon: '⧗', text: `Win on HP after round ${LAST_ROUND} by 2 HP or less.`, progress: anyMatch((r) => r.result === 'win' && r.ko === false && r.me.hpLeft - r.opp.hpLeft <= 2) },
  { id: 'comeback', name: 'Comeback Specimen', icon: '↺', text: `Win after falling ${defaultConfig.match.catchUpHpGap}+ damage behind.`, progress: anyMatch((r) => r.comeback === true) },
  { id: 'untouchable', name: 'Untouchable', icon: '◇', text: 'Win while taking 12 damage or less.', progress: anyMatch((r) => r.result === 'win' && r.me.taken <= 12) },
  { id: 'overkill', name: 'Overkill', icon: '✹', text: 'Deal 50+ damage in one match.', progress: anyMatch((r) => r.me.dealt >= 50) },
  { id: 'wall', name: 'Living Wall', icon: '⛨', text: 'Block 30+ damage in one match.', progress: anyMatch((r) => r.me.blocked >= 30) },
  { id: 'redline', name: 'Redline', icon: '☣', text: `Win after peaking at ${defaultConfig.strain.threshold - 1}+ Strain without a single rejection.`, progress: anyMatch((r) => r.result === 'win' && r.me.maxStrain >= defaultConfig.strain.threshold - 1 && r.me.rejections === 0) },
  { id: 'breaker', name: 'Graft Breaker', icon: '⬢', text: "Destroy 3 of the opponent's grafts through Integrity in one match.", progress: anyMatch((r) => (r.me.graftsKilled ?? 0) >= 3) },
  { id: 'mind', name: 'Mind Games', icon: '◈', text: 'Win 5+ stance clashes in one match.', progress: anyMatch((r) => (r.me.stanceWon ?? 0) >= 5) },
  { id: 'earlyEvo', name: 'Early Bloomer', icon: '✦', text: 'Evolve by round 3.', progress: anyMatch((r) => r.me.evolvedRound != null && r.me.evolvedRound <= 3) },
  { id: 'evolutionist', name: 'Evolutionist', icon: '⟁', text: 'Evolve into all 6 forms (across matches).', progress: (rs) => distinct(rs, (r) => r.me.evolution ?? '', EVOLUTION_IDS) },
  { id: 'builds', name: 'Three Bodies', icon: '♞', text: 'Win with each Build.', progress: (rs) => distinct(wins(rs), (r) => r.me.faction, [...FACTIONS]) },
  { id: 'worlds', name: 'World Tour', icon: '◎', text: 'Win with each World Faction.', progress: (rs) => distinct(wins(rs), (r) => r.me.worldFaction, [...WORLD_FACTIONS]) },
  { id: 'chips', name: 'Chip Collector', icon: '▦', text: 'Win with every Chip.', progress: (rs) => distinct(wins(rs), (r) => r.me.chip, CHIPS.map((c) => c.id)) },
  { id: 'combos', name: 'Full Spectrum', icon: '✺', text: 'Win with all 12 Build and World Faction combinations.', progress: (rs) => distinct(wins(rs), (r) => `${r.me.faction}/${r.me.worldFaction}`, COMBOS) },
  { id: 'engineer', name: 'Engineer', icon: '⚙', text: 'Fire engine payoffs 10+ times in one match.', progress: anyMatch((r) => (r.me.engineFires ?? 0) >= 10) },
  { id: 'chainReaction', name: 'Chain Reaction', icon: '⛭', text: 'Fire 3 different engines in one match.', progress: anyMatch((r) => Object.values(r.me.engineFiresBy ?? {}).filter((n) => (n ?? 0) > 0).length >= 3) },
  { id: 'mechanic', name: 'Master Mechanic', icon: '⚒', text: `Fire all ${Object.keys(ENGINE_META).length} engines (across matches).`, progress: (rs) => distinctMany(rs, (r) => Object.keys(r.me.engineFiresBy ?? {}).filter((k) => (r.me.engineFiresBy![k] ?? 0) > 0), Object.keys(ENGINE_META)) },
  { id: 'streak3', name: 'Hot Streak', icon: '▲', text: 'Win 3 matches in a row.', progress: (rs) => [Math.min(3, bestStreak(rs)), 3] },
  { id: 'streak5', name: 'Apex Specimen', icon: '♛', text: 'Win 5 matches in a row.', progress: (rs) => [Math.min(5, bestStreak(rs)), 5] },
  { id: 'veteran', name: 'Lab Regular', icon: '⌬', text: 'Finish 25 matches.', progress: (rs) => [Math.min(25, rs.length), 25] },
  { id: 'centurion', name: 'Head Researcher', icon: '⚜', text: 'Finish 100 matches.', progress: (rs) => [Math.min(100, rs.length), 100] },
];

// ---------- Faction achievements and Mastery Signatures ----------
// Five per Build and per World Faction, counting only matches played with it, and meant to take a long
// commitment: completing all five of one unlocks that faction's Mastery Signature card for the deck builder.

type Id = Faction | WorldFactionId;
const isBuild = (f: Id): f is Faction => (FACTIONS as readonly string[]).includes(f);
const playedAs = (f: Id) => (r: MatchRecord) => (isBuild(f) ? r.me.faction === f : r.me.worldFaction === f);
const NAMES: Record<Id, string> = { predator: 'Predator', parasite: 'Parasite', bastion: 'Bastion', corrosion: 'Corrosion', aegis: 'Aegis', miasma: 'Miasma', hollow: 'Hollow' };
const FORMS = defaultConfig.evolutions as Record<string, { id: string; name: string }[]>;
const count = (rs: MatchRecord[], pred: (r: MatchRecord) => boolean, need: number): [number, number] => [Math.min(need, rs.filter(pred).length), need];
/** `per` wins in each of `keys` (progress capped per key, so every key has to be done). */
const eachTimes = (rs: MatchRecord[], key: (r: MatchRecord) => string, keys: string[], per: number): [number, number] => [keys.reduce((n, k) => n + Math.min(per, wins(rs).filter((r) => key(r) === k).length), 0), keys.length * per];

// Feat targets are set from bot-vs-bot measurements so each takes roughly 30-40 matches as that faction on
// average (Parasite heals rarely, so its bar is low; Corrosion kills grafts often, so it needs many).
const FEATS: Record<Id, { name: string; icon: string; text: string; progress: (mine: MatchRecord[]) => [number, number] }> = {
  predator: { name: 'Blood Frenzy', icon: '✹', text: 'Deal 45+ damage in a win as Predator, 5 times.', progress: (m) => count(m, (r) => r.result === 'win' && r.me.dealt >= 45, 5) },
  parasite: { name: 'Gorged Host', icon: '✚', text: 'Heal 6+ HP in one match as Parasite, 5 times.', progress: (m) => count(m, (r) => (r.me.hpHealed ?? 0) >= 6, 5) },
  bastion: { name: 'Immovable', icon: '⛨', text: 'Block 40+ damage in a win as Bastion, 5 times.', progress: (m) => count(m, (r) => r.result === 'win' && r.me.blocked >= 40, 5) },
  corrosion: { name: 'Acid Bath', icon: '⬢', text: "Destroy 3+ of the opponent's grafts through Integrity in one match as Corrosion, 10 times.", progress: (m) => count(m, (r) => (r.me.graftsKilled ?? 0) >= 3, 10) },
  aegis: { name: 'Pristine', icon: '◇', text: 'Win 10 matches as Aegis without losing a graft to Integrity damage.', progress: (m) => count(m, (r) => r.result === 'win' && r.me.graftsLost === 0, 10) },
  miasma: { name: 'Suffocation', icon: '☁', text: 'Win a match as Miasma in which you numbed the opponent twice and gave them Fever twice, 8 times.', progress: (m) => count(m, (r) => r.result === 'win' && (r.me.numbDealt ?? 0) >= 2 && (r.me.feverDealt ?? 0) >= 2, 8) },
  hollow: { name: 'Emptied Vessel', icon: '◌', text: 'Win a match as Hollow in which you drained 5+ Energy and necrosed a slot, 5 times.', progress: (m) => count(m, (r) => r.result === 'win' && (r.me.energyDrained ?? 0) >= 5 && (r.me.necrosisDealt ?? 0) >= 1, 5) },
};

function factionSet(f: Id): Achievement[] {
  const mine = (rs: MatchRecord[]) => rs.filter(playedAs(f));
  const name = NAMES[f];
  const winsAs = (need: number) => (rs: MatchRecord[]): [number, number] => [Math.min(need, wins(mine(rs)).length), need];
  const mastery: Achievement = isBuild(f)
    ? { id: `${f}.forms`, faction: f, name: `${name} Metamorphosis`, icon: '⟁', text: `Win 3 matches in each ${name} form (${FORMS[f].map((d) => d.name).join(' and ')}).`, progress: (rs) => eachTimes(mine(rs), (r) => r.me.evolution ?? '', FORMS[f].map((d) => d.id), 3) }
    : { id: `${f}.chips`, faction: f, name: `${name} Engineer`, icon: '▦', text: `Win 3 matches with each of ${name}'s 3 Chips.`, progress: (rs) => eachTimes(mine(rs), (r) => r.me.chip, chipsFor(f as WorldFactionId).map((c) => c.id), 3) };
  const spectrum: Achievement = isBuild(f)
    ? { id: `${f}.spectrum`, faction: f, name: `${name} Everywhere`, icon: '✺', text: `Win as ${name} with every World Faction.`, progress: (rs) => distinct(wins(mine(rs)), (r) => r.me.worldFaction, [...WORLD_FACTIONS]) }
    : { id: `${f}.spectrum`, faction: f, name: `${name} Everywhere`, icon: '✺', text: `Win as ${name} with every Build.`, progress: (rs) => distinct(wins(mine(rs)), (r) => r.me.faction, [...FACTIONS]) };
  const feat = FEATS[f];
  return [
    { id: `${f}.wins`, faction: f, name: `${name} Adept`, icon: '♞', text: `Win 10 matches as ${name}.`, progress: winsAs(10) },
    { id: `${f}.champion`, faction: f, name: `${name} Champion`, icon: '♛', text: `Win 30 matches as ${name}.`, progress: winsAs(30) },
    mastery,
    spectrum,
    { id: `${f}.feat`, faction: f, name: feat.name, icon: feat.icon, text: feat.text, progress: (rs) => feat.progress(mine(rs)) },
  ];
}

export const FACTION_IDS: Id[] = [...FACTIONS, ...WORLD_FACTIONS];
export const FACTION_ACHIEVEMENTS: Achievement[] = FACTION_IDS.flatMap(factionSet);
const ALL_ACHIEVEMENTS = [...ACHIEVEMENTS, ...FACTION_ACHIEVEMENTS];

/** The Mastery Signature a faction's achievements unlock. */
export const masteryCard = (f: Id): CardDef | undefined => CARDS.find((c) => c.mastery && c.faction === f);
/** A Build's or World Faction's mastery so far: feats done, and the nearest unfinished one with its progress. */
export function masteryProgress(rs: MatchRecord[], f: Id): { done: number; total: number; next?: { name: string; have: number; need: number } } {
  const feats = FACTION_ACHIEVEMENTS.filter((a) => a.faction === f);
  const open = feats.filter((a) => !done(a, rs)).map((a) => ({ name: a.name, pr: a.progress(rs) }));
  open.sort((x, y) => y.pr[0] / y.pr[1] - x.pr[0] / x.pr[1]);
  const n = open[0];
  return { done: feats.length - open.length, total: feats.length, ...(n ? { next: { name: n.name, have: n.pr[0], need: n.pr[1] } } : {}) };
}
export const masteryDone = (rs: MatchRecord[], f: Id) => FACTION_ACHIEVEMENTS.filter((a) => a.faction === f).every((a) => done(a, rs));
/** Mastery card ids this history has unlocked. */
export function unlockedMastery(rs: MatchRecord[]): Set<string> {
  return new Set(FACTION_IDS.filter((f) => masteryDone(rs, f)).map((f) => masteryCard(f)?.id).filter((x): x is string => !!x));
}
/** Mastery cards the most recent match unlocked. */
export function newlyUnlockedMastery(rs: MatchRecord[]): CardDef[] {
  if (!rs.length) return [];
  const before = unlockedMastery(rs.slice(0, -1));
  return [...unlockedMastery(rs)].filter((id) => !before.has(id)).map((id) => CARD_MAP[id]);
}

export interface AchievementState {
  a: Achievement;
  have: number;
  need: number;
  unlocked: boolean;
  /** When it was first unlocked (the match that completed it), if it is. */
  at: number | null;
}

const done = (a: Achievement, rs: MatchRecord[]) => {
  const [have, need] = a.progress(rs);
  return have >= need;
};

export function achievementStates(rs: MatchRecord[], list: Achievement[] = ACHIEVEMENTS): AchievementState[] {
  return list.map((a) => {
    const [have, need] = a.progress(rs);
    const unlocked = have >= need;
    let at: number | null = null;
    if (unlocked) {
      for (let i = 1; i <= rs.length; i++) {
        if (done(a, rs.slice(0, i))) {
          at = rs[i - 1].at;
          break;
        }
      }
    }
    return { a, have: Math.min(have, need), need, unlocked, at };
  });
}

/** Achievements the most recent match unlocked (unlocked with it, not without it). */
export function newlyUnlocked(rs: MatchRecord[]): Achievement[] {
  if (!rs.length) return [];
  const before = rs.slice(0, -1);
  return ALL_ACHIEVEMENTS.filter((a) => done(a, rs) && !done(a, before));
}
