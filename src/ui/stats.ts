import { beats, chipOf, defaultConfig, STANCES } from '../engine';
import type { GameState, PlayerId, Stance } from '../engine';
import { FACTION_META, STANCE_META, WORLD_FACTION_META } from './meta';
import type { MatchRecord } from './storage';

export function matchRecord(s: GameState, me: PlayerId): MatchRecord {
  const p = s.players[me];
  const o = s.players[me === 0 ? 1 : 0];
  const w = s.result?.winner ?? null;
  const result = w === null ? 'draw' : w === me ? 'win' : 'loss';
  let won = 0;
  let lost = 0;
  let tied = 0;
  for (let i = 0; i < Math.min(p.stanceHistory.length, o.stanceHistory.length); i++) {
    const [a, b] = [p.stanceHistory[i], o.stanceHistory[i]];
    if (a === b) tied++;
    else if (beats(a, b)) won++;
    else lost++;
  }
  const depleted = (name: string) => s.log.filter((l) => l.kind === 'wear' && /integrity depleted/.test(l.text) && l.text.includes(`${name}'s`)).length;
  const evolvedAt = s.log.find((l) => l.kind === 'evolve' && l.text.startsWith(`EVOLUTION: ${p.name} evolves`))?.round ?? null;
  const gap = defaultConfig.match.catchUpHpGap;
  return {
    at: Date.now(),
    result,
    reason: s.result?.reason ?? '',
    rounds: s.round,
    ko: s.players.some((pl) => pl.hp <= 0),
    comeback: result === 'win' && s.snapshots.some((sn) => sn.hp[me] <= sn.hp[o.id] - gap),
    me: {
      faction: p.faction,
      worldFaction: p.worldFaction,
      chip: p.chip,
      evolution: p.evolution,
      loadout: [...p.loadout],
      dealt: p.stats.damageDealt,
      taken: p.stats.damageTaken,
      blocked: p.stats.damageBlocked,
      rejections: p.stats.rejectionsSuffered,
      maxStrain: p.stats.maxStrain,
      vented: p.stats.strainVented,
      hpLeft: p.hp,
      stances: [...p.stanceHistory],
      graftsPlayed: p.stats.graftsPlayed,
      cardsPlayed: p.stats.cardsPlayed,
      hpHealed: p.stats.hpHealed,
      graftsLost: depleted(p.name),
      graftsKilled: depleted(o.name),
      burned: s.log.filter((l) => l.text.startsWith(`${p.name}'s hand is full`)).length,
      stanceWon: won,
      stanceLost: lost,
      stanceTied: tied,
      evolvedRound: evolvedAt,
    },
    opp: { faction: o.faction, worldFaction: o.worldFaction, chip: o.chip, evolution: o.evolution, hpLeft: o.hp },
  };
}

export interface Split {
  key: string;
  label: string;
  color: string;
  games: number;
  wins: number;
  rate: number; // score: wins + half draws
}

const score = (rs: MatchRecord[]) => rs.reduce((a, r) => a + (r.result === 'win' ? 1 : r.result === 'draw' ? 0.5 : 0), 0);

function split(rs: MatchRecord[], keyOf: (r: MatchRecord) => string, meta: (key: string) => { name: string; color: string }): Split[] {
  const groups = new Map<string, MatchRecord[]>();
  for (const r of rs) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  return [...groups.entries()]
    .map(([key, g]) => ({ key, label: meta(key).name, color: meta(key).color, games: g.length, wins: g.filter((r) => r.result === 'win').length, rate: score(g) / g.length }))
    .sort((a, b) => b.games - a.games || b.rate - a.rate);
}

const EVOLUTION_NAME: Record<string, string> = Object.fromEntries(
  Object.values(defaultConfig.evolutions as Record<string, { id: string; name: string }[]>)
    .flat()
    .map((d) => [d.id, d.name]),
);
const factionMeta = (k: string) => FACTION_META[k as keyof typeof FACTION_META] ?? { name: k, color: '#b3c4ba' };
const worldMeta = (k: string) => WORLD_FACTION_META[k as keyof typeof WORLD_FACTION_META] ?? { name: k, color: '#b3c4ba' };
const NEUTRAL = '#7be0b0';

export interface StanceUse {
  stance: Stance;
  share: number;
}

export interface Analysis {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  rate: number;
  streak: { kind: 'win' | 'loss' | 'draw'; n: number } | null;
  bestStreak: number;
  recentRate: number | null; // last 10 games
  byBuild: Split[];
  byWorld: Split[];
  byChip: Split[];
  byForm: Split[];
  byCombo: Split[];
  vsBuild: Split[];
  vsWorld: Split[];
  avg: { dealt: number; taken: number; blocked: number; rounds: number; rejections: number; noEvolution: number; peakStrain: number; healed: number | null; cardsPlayed: number | null; graftsLost: number | null; graftsKilled: number | null; burned: number | null; evolvedRound: number | null; hpLeftInWins: number | null };
  koWinShare: number | null; // share of wins that were KOs
  comebacks: number;
  stanceWinRate: number | null; // rounds where your stance beat theirs, out of decided rounds
  stances: StanceUse[];
  tips: string[];
}

/** Mean of a field over the records that have it (older records may not). */
function meanOf(rs: MatchRecord[], f: (r: MatchRecord) => number | null | undefined): number | null {
  const v = rs.map(f).filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

const STANCE_TIP: Record<string, string> = {
  predator: 'Predator hits hardest in Overclock. Pick Fortify when you expect Aggress: half damage and a Strain vent blunts its whole round.',
  parasite: 'Parasite wins slowly by loading Strain onto you. Keep your own Strain low (Fortify, Hold, Cycle to vent) so its pushes do not tip you into rejection.',
  bastion: 'Bastion stacks armor. Adapt ignores armor entirely, so it is your best stance whenever you expect Bastion to Fortify.',
};

export function analyze(rs: MatchRecord[]): Analysis | null {
  if (rs.length === 0) return null;
  const n = rs.length;
  const wins = rs.filter((r) => r.result === 'win').length;
  const losses = rs.filter((r) => r.result === 'loss').length;
  const last = rs[n - 1].result;
  let k = 0;
  for (let i = n - 1; i >= 0 && rs[i].result === last; i--) k++;
  let best = 0;
  let run = 0;
  for (const r of rs) {
    run = r.result === 'win' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const recent = rs.slice(-10);
  const mean = (f: (r: MatchRecord) => number) => rs.reduce((a, r) => a + f(r), 0) / n;
  const winRecs = rs.filter((r) => r.result === 'win');
  const withKo = winRecs.filter((r) => r.ko !== undefined);

  const stanceRecs = rs.filter((r) => r.me.stanceWon !== undefined);
  const sWon = stanceRecs.reduce((a, r) => a + (r.me.stanceWon ?? 0), 0);
  const sLost = stanceRecs.reduce((a, r) => a + (r.me.stanceLost ?? 0), 0);
  const allStances = rs.flatMap((r) => r.me.stances);
  const stances: StanceUse[] = STANCES.map((st) => ({ stance: st, share: allStances.length ? allStances.filter((x) => x === st).length / allStances.length : 0 }));

  const a: Analysis = {
    games: n,
    wins,
    losses,
    draws: n - wins - losses,
    rate: score(rs) / n,
    streak: { kind: last, n: k },
    bestStreak: best,
    recentRate: n >= 10 ? score(recent) / recent.length : null,
    byBuild: split(rs, (r) => r.me.faction, factionMeta),
    byWorld: split(rs, (r) => r.me.worldFaction, worldMeta),
    byChip: split(rs, (r) => r.me.chip, (k2) => ({ name: chipOf(k2)?.name ?? k2, color: worldMeta(chipOf(k2)?.worldFaction ?? '').color })),
    byForm: split(rs, (r) => r.me.evolution ?? 'none', (k2) => ({ name: k2 === 'none' ? 'No evolution' : (EVOLUTION_NAME[k2] ?? k2), color: k2 === 'none' ? '#82958b' : NEUTRAL })),
    byCombo: split(rs, (r) => `${r.me.faction}/${r.me.worldFaction}`, (k2) => {
      const [f, w] = k2.split('/');
      return { name: `${factionMeta(f).name} / ${worldMeta(w).name}`, color: factionMeta(f).color };
    }).slice(0, 6),
    vsBuild: split(rs, (r) => r.opp.faction, factionMeta),
    vsWorld: split(rs, (r) => r.opp.worldFaction, worldMeta),
    avg: {
      dealt: mean((r) => r.me.dealt),
      taken: mean((r) => r.me.taken),
      blocked: mean((r) => r.me.blocked),
      rounds: mean((r) => r.rounds),
      rejections: mean((r) => r.me.rejections),
      noEvolution: rs.filter((r) => !r.me.evolution).length / n,
      peakStrain: mean((r) => r.me.maxStrain),
      healed: meanOf(rs, (r) => r.me.hpHealed),
      cardsPlayed: meanOf(rs, (r) => r.me.cardsPlayed),
      graftsLost: meanOf(rs, (r) => r.me.graftsLost),
      graftsKilled: meanOf(rs, (r) => r.me.graftsKilled),
      burned: meanOf(rs, (r) => r.me.burned),
      evolvedRound: meanOf(rs, (r) => r.me.evolvedRound),
      hpLeftInWins: winRecs.length ? winRecs.reduce((s2, r) => s2 + r.me.hpLeft, 0) / winRecs.length : null,
    },
    koWinShare: withKo.length ? withKo.filter((r) => r.ko).length / withKo.length : null,
    comebacks: rs.filter((r) => r.comeback).length,
    stanceWinRate: sWon + sLost >= 5 ? sWon / (sWon + sLost) : null,
    stances,
    tips: [],
  };

  // Tips: drawn only from what the history actually shows, most useful first.
  const tips: string[] = [];
  const enough = (s: Split) => s.games >= 3;
  const worstVs = a.vsBuild.filter(enough).sort((x, y) => x.rate - y.rate)[0];
  if (worstVs && worstVs.rate < 0.45) tips.push(`Your hardest opponent is ${worstVs.label} (${pct(worstVs.rate)} over ${worstVs.games} games). ${STANCE_TIP[worstVs.key] ?? ''}`);
  if (a.stanceWinRate !== null && a.stanceWinRate < 0.4) tips.push(`You win only ${pct(a.stanceWinRate)} of stance clashes. The bot leans (about half the time) toward the stance that beats your last one, so try the stance that beats that counter: after you Aggress it often Fortifies, and Adapt beats Fortify.`);
  const best2 = a.byBuild.filter(enough).sort((x, y) => y.rate - x.rate)[0];
  const worst = a.byBuild.filter(enough).sort((x, y) => x.rate - y.rate)[0];
  if (best2 && worst && best2.key !== worst.key && best2.rate - worst.rate >= 0.15) tips.push(`You do much better as ${best2.label} (${pct(best2.rate)}) than as ${worst.label} (${pct(worst.rate)}). Lean on ${best2.label}, or practise ${worst.label}'s Strain plan in the Game guide.`);
  const rejRate = rs.filter((r) => r.me.rejections > 0).length / n;
  if (rejRate >= 0.3) tips.push(`You suffered a rejection in ${pct(rejRate)} of games. Past ${defaultConfig.strain.threshold} Strain your highest-Strain graft is ejected: vent with Fortify, Hold or Cycle before the Strain check, and watch Meltdown from round ${defaultConfig.match.meltdownFromRound}.`);
  if (a.avg.graftsLost !== null && a.avg.graftsLost >= 1.5) tips.push(`You lose ${a.avg.graftsLost.toFixed(1)} grafts a match to Integrity damage. Clash wears your toughest graft each time you are hit: armor and Fortify cut the hits, and Aegis cards repair Integrity.`);
  if (a.avg.burned !== null && a.avg.burned >= 0.5) tips.push(`You burn ${a.avg.burned.toFixed(1)} cards a match to the ${defaultConfig.match.maxHand}-card hand limit. Spend Energy every round, and Cycle a card you cannot use rather than letting a draw burn.`);
  if (a.avg.noEvolution >= 0.2) tips.push(`You finished ${pct(a.avg.noEvolution)} of games without evolving. The two bars under your HP show each form's progress: steer toward the closer one; evolving is a large permanent boost.`);
  const lost = rs.filter((r) => r.result === 'loss');
  if (lost.length >= 3) {
    const early = lost.filter((r) => r.rounds <= 5).length / lost.length;
    if (early >= 0.5) tips.push(`Most of your losses end by round 5. Early on, trade Energy for armor and Integrity (sturdy grafts, Fortify against Aggress) rather than racing damage.`);
    const outdamaged = lost.filter((r) => r.me.dealt < r.me.taken * 0.6).length / lost.length;
    if (outdamaged >= 0.5) tips.push(`In most losses you dealt well under the damage you took. Adapt ignores armor and Aggress beats Adapt: read the opponent's last stances (shown under their panel) and counter them.`);
  }
  const top = [...stances].sort((x, y) => y.share - x.share)[0];
  if (allStances.length >= 20 && top.share >= 0.55) tips.push(`You pick ${STANCE_META[top.stance].name} ${pct(top.share)} of the time. The bot leans toward countering your last stance, so a predictable pattern is easy to punish: mix it up.`);
  if (tips.length === 0) tips.push(n < 5 ? 'Play a few more matches and tips based on your games will appear here.' : 'No clear weak spot right now. Try a Build or World Faction you have played least to widen your game.');
  a.tips = tips;
  return a;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
