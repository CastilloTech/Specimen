import { CHIPS, defaultConfig, FACTIONS, WORLD_FACTIONS } from '../engine';
import type { MatchRecord } from './storage';

// Achievements are derived entirely from a save's match history, so they also count matches played
// before achievements existed, and need no storage of their own.

export interface Achievement {
  id: string;
  name: string;
  text: string;
  icon: string;
  /** Progress toward the goal over the whole history, as [have, need]. */
  progress: (rs: MatchRecord[]) => [number, number];
}

const wins = (rs: MatchRecord[]) => rs.filter((r) => r.result === 'win');
const anyMatch = (pred: (r: MatchRecord) => boolean) => (rs: MatchRecord[]): [number, number] => [rs.some(pred) ? 1 : 0, 1];
const distinct = (rs: MatchRecord[], key: (r: MatchRecord) => string, pool: string[]): [number, number] => [pool.filter((k) => rs.some((r) => key(r) === k)).length, pool.length];
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
  { id: 'comeback', name: 'Comeback Specimen', icon: '↺', text: `Win after trailing by ${defaultConfig.match.catchUpHpGap}+ HP.`, progress: anyMatch((r) => r.comeback === true) },
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
  { id: 'streak3', name: 'Hot Streak', icon: '▲', text: 'Win 3 matches in a row.', progress: (rs) => [Math.min(3, bestStreak(rs)), 3] },
  { id: 'streak5', name: 'Apex Specimen', icon: '♛', text: 'Win 5 matches in a row.', progress: (rs) => [Math.min(5, bestStreak(rs)), 5] },
  { id: 'veteran', name: 'Lab Regular', icon: '⌬', text: 'Finish 25 matches.', progress: (rs) => [Math.min(25, rs.length), 25] },
  { id: 'centurion', name: 'Head Researcher', icon: '⚜', text: 'Finish 100 matches.', progress: (rs) => [Math.min(100, rs.length), 100] },
];

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

export function achievementStates(rs: MatchRecord[]): AchievementState[] {
  return ACHIEVEMENTS.map((a) => {
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
  return ACHIEVEMENTS.filter((a) => done(a, rs) && !done(a, before));
}
