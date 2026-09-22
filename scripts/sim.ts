// Headless bot-vs-bot simulator.
//   npm run sim -- --matches 1000
// Options:
//   --matches N     number of matches (default 1000)
//   --seed S        base seed (default 1); match i uses seed S+i
//   --jobs J        parallel worker processes (default: min(cpus, 6)); results do not depend on J
//   --policy P      loadout policy: "random" (default) or "adaptive" (biased toward nodes that have been winning)
//   --json FILE     also write the raw aggregate numbers to FILE
//   --config X      what-if overrides merged over config.json for this run. X is inline JSON such as
//                   '{"specimen":{"hp":40}}' or the path of a .json file containing the same.
//   --force-evolution first|second|none   everyone evolves into that form right after round 1 (or never),
//                   to measure each form's raw strength without win/evolve selection bias.
//   --force-round N  with --force-evolution: everyone evolves at the Strain check of round N (default 1).
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defaultConfig, FACTIONS, makeRng, playBotMatch, STANCES, STARTER_DECKS, treeRows } from '../src/engine';
import type { Config, DeepPartial, Faction, Stance } from '../src/engine';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const N = parseInt(arg('matches', '1000'), 10);
const BASE_SEED = parseInt(arg('seed', '1'), 10);
const POLICY = arg('policy', 'random');
const JOBS = Math.max(1, Math.min(parseInt(arg('jobs', String(Math.min(cpus().length, 6))), 10), N));
const JSON_OUT = arg('json', '');
// What-if overrides for one run, e.g. --config '{"specimen":{"hp":40}}' (deep-merged over config.json)
const CONFIG_JSON = arg('config', '');
// The value may be inline JSON or a path to a .json file (inline JSON gets its quotes mangled by some Windows shells).
const BASE_OVERRIDE: DeepPartial<Config> | undefined = CONFIG_JSON ? JSON.parse(CONFIG_JSON.trim().startsWith('{') ? CONFIG_JSON : readFileSync(CONFIG_JSON, 'utf8')) : undefined;

// --force-evolution first|second|none: every player evolves into that form (or never evolves) right after
// round 1. This isolates how strong each form is, free of the "you only reach it if you are already winning" bias.
const FORCE = arg('force-evolution', '');
const FORCE_ROUND = Math.max(1, parseInt(arg('force-round', '1'), 10)); // the Strain check of this round is when everyone evolves
function forcedEvolutions(): DeepPartial<Config> | undefined {
  if (!FORCE) return undefined;
  const evo = JSON.parse(JSON.stringify(defaultConfig.evolutions)) as Record<string, { condition: { metric: string; target: number } }[]>;
  for (const f of Object.keys(evo)) {
    evo[f].forEach((d, i) => {
      const wanted = FORCE === 'first' ? i === 0 : FORCE === 'second' ? i === 1 : false;
      d.condition = { ...d.condition, metric: 'round', target: wanted ? FORCE_ROUND : 999999 };
    });
  }
  return { evolutions: evo } as unknown as DeepPartial<Config>;
}
const CONFIG_OVERRIDE: DeepPartial<Config> | undefined = FORCE ? { ...(BASE_OVERRIDE ?? {}), ...forcedEvolutions() } : BASE_OVERRIDE;

// ---------- Aggregates (plain JSON so they can cross process boundaries) ----------
interface Cell {
  games: number;
  wins: number;
  draws: number;
}
interface NodeStat {
  faction: string;
  row: string;
  picks: number;
  games: number;
  score: number;
}
interface ScoreCell {
  n: number;
  score: number;
}
interface EvoNodeCell {
  games: number;
  score: number;
  evolved: number;
}
interface Agg {
  n: number;
  matchup: Record<string, Record<string, Cell>>;
  evo: Record<string, Record<string, number>>;
  /** faction -> evolution id ('none' if it never evolved) -> games and score of those players */
  evoScore: Record<string, Record<string, ScoreCell>>;
  /** faction -> Evolution-row node id -> games, score, and how often that player evolved */
  evoNode: Record<string, Record<string, EvoNodeCell>>;
  evoGames: Record<string, number>;
  stanceCount: Record<string, Record<Stance, number>>;
  nodeStats: Record<string, NodeStat>;
  totalRounds: number;
  rejectionGames: number;
  koGames: number;
  draws: number;
  lenHist: Record<number, number>;
}

function emptyAgg(): Agg {
  const a: Agg = { n: 0, matchup: {}, evo: {}, evoScore: {}, evoNode: {}, evoGames: {}, stanceCount: {}, nodeStats: {}, totalRounds: 0, rejectionGames: 0, koGames: 0, draws: 0, lenHist: {} };
  for (const f of FACTIONS) {
    a.evoScore[f] = {};
    a.evoNode[f] = {};
    for (const n of treeRows(f).find((r) => r.id === 'evolution')!.nodes) a.evoNode[f][n.id] = { games: 0, score: 0, evolved: 0 };
    a.matchup[f] = {};
    for (const g of FACTIONS) a.matchup[f][g] = { games: 0, wins: 0, draws: 0 };
    a.evo[f] = {};
    a.evoGames[f] = 0;
    a.stanceCount[f] = { aggress: 0, adapt: 0, fortify: 0 };
    for (const row of treeRows(f)) for (const n of row.nodes) if (!a.nodeStats[n.id]) a.nodeStats[n.id] = { faction: row.id === 'evolution' ? 'all' : f, row: row.id, picks: 0, games: 0, score: 0 };
  }
  return a;
}

function mergeInto(a: Agg, b: Agg): void {
  a.n += b.n;
  a.totalRounds += b.totalRounds;
  a.rejectionGames += b.rejectionGames;
  a.koGames += b.koGames;
  a.draws += b.draws;
  for (const [k, v] of Object.entries(b.lenHist)) a.lenHist[+k] = (a.lenHist[+k] ?? 0) + v;
  for (const f of FACTIONS) {
    for (const g of FACTIONS) for (const k of ['games', 'wins', 'draws'] as const) a.matchup[f][g][k] += b.matchup[f][g][k];
    for (const [k, v] of Object.entries(b.evo[f])) a.evo[f][k] = (a.evo[f][k] ?? 0) + v;
    for (const [k, v] of Object.entries(b.evoScore[f])) {
      const c = (a.evoScore[f][k] ??= { n: 0, score: 0 });
      c.n += v.n;
      c.score += v.score;
    }
    for (const [k, v] of Object.entries(b.evoNode[f])) for (const q of ['games', 'score', 'evolved'] as const) a.evoNode[f][k][q] += v[q];
    a.evoGames[f] += b.evoGames[f];
    for (const st of STANCES) a.stanceCount[f][st] += b.stanceCount[f][st];
  }
  for (const id of Object.keys(b.nodeStats)) for (const k of ['picks', 'games', 'score'] as const) a.nodeStats[id][k] += b.nodeStats[id][k];
}

// ---------- One slice of matches ----------
function runSlice(from: number, to: number): Agg {
  const agg = emptyAgg();
  const pairs: [Faction, Faction][] = FACTIONS.flatMap((a) => FACTIONS.map((b) => [a, b] as [Faction, Faction]));

  const pickLoadout = (f: Faction, rng: ReturnType<typeof makeRng>): string[] =>
    treeRows(f).map((row) => {
      if (POLICY !== 'adaptive') return rng.pick(row.nodes).id;
      const w = row.nodes.map((n) => {
        const st = agg.nodeStats[n.id];
        return Math.exp(6 * ((st.score + 5) / (st.games + 10) - 0.5)); // shrunk toward 0.5
      });
      let x = rng.float() * w.reduce((s, v) => s + v, 0);
      for (let i = 0; i < w.length; i++) {
        x -= w[i];
        if (x <= 0) return row.nodes[i].id;
      }
      return row.nodes[row.nodes.length - 1].id;
    });

  for (let i = from; i < to; i++) {
    const [f0, f1] = pairs[i % pairs.length];
    const rng = makeRng((BASE_SEED + i) * 7919 + 13);
    const s = playBotMatch({
      seed: BASE_SEED + i,
      config: CONFIG_OVERRIDE,
      players: [
        { name: 'Bot A', faction: f0, deck: STARTER_DECKS[f0], loadout: pickLoadout(f0, rng), isBot: true },
        { name: 'Bot B', faction: f1, deck: STARTER_DECKS[f1], loadout: pickLoadout(f1, rng), isBot: true },
      ],
    });
    const w = s.result!.winner;
    agg.n++;
    agg.totalRounds += s.round;
    agg.lenHist[s.round] = (agg.lenHist[s.round] ?? 0) + 1;
    if (s.players.some((p) => p.stats.rejectionsSuffered > 0)) agg.rejectionGames++;
    if (s.players.some((p) => p.hp <= 0)) agg.koGames++;
    if (w === null) agg.draws++;
    for (const p of s.players) {
      const c = agg.matchup[p.faction][s.players[p.id === 0 ? 1 : 0].faction];
      c.games++;
      if (w === p.id) c.wins++;
      else if (w === null) c.draws++;
      const score = w === p.id ? 1 : w === null ? 0.5 : 0;
      agg.evoGames[p.faction]++;
      const key = p.evolution ?? 'none';
      agg.evo[p.faction][key] = (agg.evo[p.faction][key] ?? 0) + 1;
      const es = (agg.evoScore[p.faction][key] ??= { n: 0, score: 0 });
      es.n++;
      es.score += score;
      for (const id of p.loadout) {
        const en = agg.evoNode[p.faction][id];
        if (en) {
          en.games++;
          en.score += score;
          if (p.evolution) en.evolved++;
        }
      }
      for (const st of p.stanceHistory) agg.stanceCount[p.faction][st]++;
      for (const id of p.loadout) {
        const ns = agg.nodeStats[id];
        ns.picks++;
        ns.games++;
        ns.score += score;
      }
    }
  }
  return agg;
}

// ---------- Report ----------
function report(a: Agg, secs: string): void {
  const pct = (x: number, d = 1) => (x * 100).toFixed(d) + '%';
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  const padR = (s: string | number, n: number) => String(s).padEnd(n);
  const line = '='.repeat(78);
  const band = [0.45, 0.55];

  console.log(`\nSPECIMEN SIMULATION  |  ${a.n} matches  |  seed ${BASE_SEED}  |  loadout policy: ${POLICY}  |  ${secs}s`);
  console.log(line);

  console.log('\n1. FACTION MATCHUPS  (row faction vs column faction; score = wins + 0.5 x draws)');
  console.log(padR('', 10) + FACTIONS.map((f) => pad(f, 22)).join(''));
  let worst = 0.5;
  let allInBand = true;
  for (const f of FACTIONS) {
    let row = padR(f, 10);
    for (const g of FACTIONS) {
      const c = a.matchup[f][g];
      const score = c.games ? (c.wins + c.draws * 0.5) / c.games : 0;
      if (f !== g && c.games) {
        if (Math.abs(score - 0.5) > Math.abs(worst - 0.5)) worst = score;
        if (score < band[0] || score > band[1]) allInBand = false;
      }
      row += pad(c.games ? `${pct(score)} (${pct(c.wins / c.games, 0)}W ${pct(c.draws / c.games, 0)}D)` : '-', 22);
    }
    console.log(row);
  }
  console.log(`   Cross-faction matchups within 45-55%: ${allInBand ? 'YES' : 'NO'}  (most lopsided: ${pct(worst)})`);
  console.log('   Overall faction score:');
  for (const f of FACTIONS) {
    let g = 0;
    let sc = 0;
    for (const h of FACTIONS) {
      g += a.matchup[f][h].games;
      sc += a.matchup[f][h].wins + a.matchup[f][h].draws * 0.5;
    }
    console.log(`     ${padR(f, 10)} ${pct(sc / g)}  (${g} games)`);
  }

  console.log('\n2. MATCH LENGTH');
  console.log(`   Average: ${(a.totalRounds / a.n).toFixed(2)} rounds   |   ended by KO: ${pct(a.koGames / a.n)}   |   draws: ${pct(a.draws / a.n)}`);
  console.log('   Rounds histogram: ' + Object.keys(a.lenHist).map(Number).sort((x, y) => x - y).map((r) => `${r}: ${pct(a.lenHist[r] / a.n, 0)}`).join('  '));

  console.log('\n3. REJECTIONS');
  console.log(`   Games with at least one rejection: ${pct(a.rejectionGames / a.n)}`);

  console.log("\n4. EVOLUTION SPLIT (share of each faction's appearances)");
  for (const f of FACTIONS) {
    const defs = (defaultConfig.evolutions as Record<string, { id: string; name: string }[]>)[f];
    const parts = defs.map((d) => `${d.name} ${pct((a.evo[f][d.id] ?? 0) / a.evoGames[f])}`);
    parts.push(`none ${pct((a.evo[f].none ?? 0) / a.evoGames[f])}`);
    console.log(`   ${padR(f, 10)} ${parts.join('  |  ')}`);
  }

  console.log('\n5. STANCE PICK RATES');
  for (const f of FACTIONS) {
    const tot = STANCES.reduce((n, st) => n + a.stanceCount[f][st], 0) || 1;
    console.log(`   ${padR(f, 10)} ${STANCES.map((st) => `${st} ${pct(a.stanceCount[f][st] / tot)}`).join('   ')}`);
  }

  console.log("\n6. SKILL-TREE NODES (pick rate = share of that faction's appearances; win rate = score of players who took it)");
  const rows = treeRows('predator').map((r) => r.id);
  for (const f of FACTIONS) {
    console.log(`   ${f.toUpperCase()}`);
    for (const rowId of rows) {
      if (rowId === 'evolution') continue;
      for (const n of treeRows(f).find((r) => r.id === rowId)!.nodes) {
        const st = a.nodeStats[n.id];
        console.log(`     ${padR(rowId, 10)} ${padR(n.name, 18)} pick ${pad(pct(st.picks / (a.evoGames[f] || 1)), 6)}   win ${pad(st.games ? pct(st.score / st.games) : '-', 6)}   (n=${st.picks})`);
      }
    }
  }
  console.log('   EVOLUTION ROW (all factions)');
  for (const n of treeRows('predator').find((r) => r.id === 'evolution')!.nodes) {
    const st = a.nodeStats[n.id];
    console.log(`     ${padR('evolution', 10)} ${padR(n.name, 18)} pick ${pad(pct(st.picks / (2 * a.n)), 6)}   win ${pad(st.games ? pct(st.score / st.games) : '-', 6)}   (n=${st.picks})`);
  }

  console.log('\n7. EVOLUTIONS AND THE EVOLUTION ROW, PER FACTION');
  console.log('   "reached" = share of that faction\'s games that ended in the form; "win" = score of those players.');
  for (const f of FACTIONS) {
    const defs = (defaultConfig.evolutions as Record<string, { id: string; name: string }[]>)[f];
    console.log(`   ${f.toUpperCase()}`);
    for (const d of [...defs, { id: 'none', name: 'no evolution' }]) {
      const c = a.evoScore[f][d.id];
      console.log(`     form  ${padR(d.name, 18)} reached ${pad(pct((c?.n ?? 0) / a.evoGames[f]), 6)}   win ${pad(c?.n ? pct(c.score / c.n) : '-', 6)}`);
    }
    for (const n of treeRows(f).find((r) => r.id === 'evolution')!.nodes) {
      const c = a.evoNode[f][n.id];
      console.log(`     node  ${padR(n.name, 18)} win ${pad(c.games ? pct(c.score / c.games) : '-', 6)}   evolved ${pad(c.games ? pct(c.evolved / c.games) : '-', 6)}   (n=${c.games})`);
    }
  }
  console.log('');
}

// ---------- Entry points ----------
if (process.env.SIM_CHILD) {
  const from = parseInt(arg('from', '0'), 10);
  const to = parseInt(arg('to', '0'), 10);
  process.send!(runSlice(from, to));
  process.exit(0);
} else {
  const t0 = Date.now();
  const total = emptyAgg();
  const finish = () => {
    report(total, ((Date.now() - t0) / 1000).toFixed(1));
    if (JSON_OUT) {
      writeFileSync(JSON_OUT, JSON.stringify({ seed: BASE_SEED, policy: POLICY, ...total }, null, 2));
      console.log(`Raw numbers written to ${JSON_OUT}`);
    }
  };
  if (JOBS === 1) {
    mergeInto(total, runSlice(0, N));
    finish();
  } else {
    let pending = JOBS;
    for (let j = 0; j < JOBS; j++) {
      const from = Math.floor((N * j) / JOBS);
      const to = Math.floor((N * (j + 1)) / JOBS);
      const child = fork(fileURLToPath(import.meta.url), ['--seed', String(BASE_SEED), '--policy', POLICY, '--from', String(from), '--to', String(to), ...(CONFIG_JSON ? ['--config', CONFIG_JSON] : []), ...(FORCE ? ['--force-evolution', FORCE, '--force-round', String(FORCE_ROUND)] : [])], {
        execArgv: process.execArgv,
        env: { ...process.env, SIM_CHILD: '1' },
      });
      child.once('message', (m) => {
        mergeInto(total, m as Agg);
        if (--pending === 0) finish();
      });
      child.once('error', (e) => {
        console.error(e);
        process.exit(1);
      });
    }
  }
}
