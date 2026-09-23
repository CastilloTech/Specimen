// Balance audit beyond faction matchups: per-card usage, first-mover advantage, snowballing,
// stance outcomes, draws and the value of playing grafts face-down.
//   npm run audit -- --matches 6000
import { readFileSync } from 'node:fs';
import { botAction, canBeDormant, cardOf, chipRows, chipsFor, createMatch, makeRng, pendingPlayers, reduce, starterCopies, starterDeck, WORLD_FACTIONS } from '../src/engine';
import type { Action, Faction, GameState, PlayerId, Stance, WorldFactionId } from '../src/engine';

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const N = parseInt(arg('matches', '6000'), 10);
const ONLY = process.argv.includes('--only-facedown');
const NO_FACEDOWN = process.argv.includes('--no-facedown');
const FACTIONS: Faction[] = ['predator', 'parasite', 'bastion'];
const STANCES: Stance[] = ['aggress', 'adapt', 'fortify'];
const rng = makeRng(777);

// bot: the bot's own choice; never: strip face-down; always: every graft; early: only in rounds 1-2; cheap: only grafts costing 2 or less;
// smart / smart3: cheap grafts in rounds 1-2 / 1-3
type FaceDownPolicy = 'bot' | 'never' | 'always' | 'early' | 'cheap' | 'smart' | 'smart3';
const CONFIG_ARG = arg('config', '');
const OVERRIDE = CONFIG_ARG ? JSON.parse(CONFIG_ARG.trim().startsWith('{') ? CONFIG_ARG : readFileSync(CONFIG_ARG, 'utf8')) : undefined;
/** Play one bot-vs-bot match; the policy overrides how a side chooses face-down for grafts. */
function play(g: number, fa: Faction, fb: Faction, policy: [FaceDownPolicy, FaceDownPolicy], onStep?: (prev: GameState, next: GameState) => void): GameState {
  const wa = WORLD_FACTIONS[g % WORLD_FACTIONS.length];
  const wb = WORLD_FACTIONS[(g + 1) % WORLD_FACTIONS.length];
  const load = (wf: WorldFactionId) => {
    const chip = rng.pick(chipsFor(wf)).id;
    return { chip, loadout: chipRows(chip).map((r) => rng.pick(r.nodes).id) };
  };
  const la = load(wa);
  const lb = load(wb);
  let s = createMatch({
    seed: 5000 + g,
    config: OVERRIDE,
    players: [
      { name: 'A', faction: fa, worldFaction: wa, chip: la.chip, deck: starterDeck(fa, wa), loadout: la.loadout },
      { name: 'B', faction: fb, worldFaction: wb, chip: lb.chip, deck: starterDeck(fb, wb), loadout: lb.loadout },
    ],
  });
  const r = [makeRng(g * 2 + 11), makeRng(g * 2 + 12)];
  while (s.phase !== 'over') {
    const [p] = pendingPlayers(s);
    let a: Action = botAction(s, p, r[p]);
    if (a.type === 'PLAY_CARD' && policy[p] !== 'bot') {
      const def = cardOf(s.players[p].hand.find((c) => c.uid === (a as { uid: string }).uid)!.cardId);
      const want = policy[p] === 'always' || (policy[p] === 'early' && s.round <= 2) || (policy[p] === 'cheap' && def.cost <= 2) || (policy[p] === 'smart' && s.round <= 2 && def.cost <= 2) || (policy[p] === 'smart3' && s.round <= 3 && def.cost <= 2);
      if (def.type === 'graft') a = { ...a, faceDown: want && canBeDormant(def) ? true : undefined };
    }
    const prev = s;
    s = reduce(s, a);
    if (s.lastError) throw new Error(s.lastError);
    onStep?.(prev, s);
  }
  return s;
}

// ---- 1. one big pass: cards, first mover, snowball, stances, draws ----
type CardAcc = { deck: number; playedGames: number; wins: number; roundSum: number; plays: number };
const cards: Record<string, CardAcc> = {};
const factionGames: Record<string, { n: number; wins: number }> = {};
let firstMover = [0, 0]; // [first mover won, first mover lost]
let firstMoverTie = [0, 0]; // the same, only when the round-1 stances tied (a pure coin flip)
let snow = { lead: [0, 0], comeback: 0, leadN: 0 };
const stanceNet: Record<string, { n: number; sum: number }> = {};
const draws: Record<string, [number, number]> = {};

for (let g = 0; g < (ONLY ? 0 : N); g++) {
  const fa = FACTIONS[g % 3];
  const fb = FACTIONS[Math.floor(g / 3) % 3];
  let first: PlayerId | null = null;
  let tiedRound1 = false;
  const hpAtStart: number[] = [0, 0];
  let hpAfter3: [number, number] | null = null;
  const s = play(g, fa, fb, ['bot', 'bot'], (prev, next) => {
    if ((prev.phase === 'stance' || prev.phase === 'feint') && next.phase === 'actions' && next.round === 1) {
      first = next.turn;
      tiedRound1 = next.players[0].stance === next.players[1].stance;
    }
    if (prev.phase !== 'actions' && next.phase === 'actions') prev.players.forEach((_, i) => (hpAtStart[i] = next.players[i].hp));
    if (prev.phase === 'actions' && next.phase !== 'actions') {
      // stance outcome: net HP swing this round for each side, given (own stance, opponent stance)
      for (const i of [0, 1] as PlayerId[]) {
        const me = prev.players[i].stance;
        const op = prev.players[1 - i].stance;
        if (!me || !op) continue;
        const net = next.players[i].hp - hpAtStart[i] - (next.players[1 - i].hp - hpAtStart[1 - i]);
        const k = `${me}|${op}`;
        (stanceNet[k] ??= { n: 0, sum: 0 }).n++;
        stanceNet[k].sum += net;
      }
      if (prev.round === 3 && !hpAfter3) hpAfter3 = [next.players[0].hp, next.players[1].hp];
    }
  });
  const w = s.result!.winner;
  const key = [fa, fb].sort().join('|');
  (draws[key] ??= [0, 0])[w === null ? 0 : 1]++;
  if (first !== null && w !== null) {
    firstMover[w === first ? 0 : 1]++;
    if (tiedRound1) firstMoverTie[w === first ? 0 : 1]++;
  }
  if (hpAfter3 && w !== null && s.round > 3) {
    const diff = hpAfter3[0] - hpAfter3[1];
    if (Math.abs(diff) >= 6) {
      const leader = diff > 0 ? 0 : 1;
      snow.leadN++;
      snow.lead[w === leader ? 0 : 1]++;
    }
  }
  for (const i of [0, 1] as PlayerId[]) {
    const f = s.players[i].faction;
    const fg = (factionGames[f] ??= { n: 0, wins: 0 });
    fg.n++;
    const score = w === null ? 0.5 : w === i ? 1 : 0;
    fg.wins += score;
    const seen = new Set<string>();
    for (const rec of s.plays) {
      if (rec.player !== i || !rec.cardId || rec.kind === 'cycle' || rec.negated) continue;
      const c = (cards[`${f}:${rec.cardId}`] ??= { deck: 0, playedGames: 0, wins: 0, roundSum: 0, plays: 0 });
      c.plays++;
      c.roundSum += rec.round;
      if (!seen.has(rec.cardId)) {
        seen.add(rec.cardId);
        c.playedGames++;
        c.wins += score;
      }
    }
  }
}

if (!ONLY) {
console.log(`BALANCE AUDIT  |  ${N} bot matches, all 9 pairings, random loadouts\n`);
console.log('1. FIRST MOVER (who acts first in round 1)');
console.log(`   first mover wins ${((100 * firstMover[0]) / (firstMover[0] + firstMover[1])).toFixed(1)}% of decided games; when round-1 stances tied (coin flip) ${((100 * firstMoverTie[0]) / (firstMoverTie[0] + firstMoverTie[1])).toFixed(1)}% (${firstMoverTie[0] + firstMoverTie[1]} games)`);

console.log('\n2. SNOWBALL (a lead of 6+ HP after round 3 among games that go on)');
console.log(`   ${snow.leadN} games; the leader wins ${((100 * snow.lead[0]) / snow.leadN).toFixed(1)}%`);

console.log('\n3. DRAWS (simultaneous KO) by pairing');
for (const [k, [d, o]] of Object.entries(draws)) console.log(`   ${k.padEnd(20)} ${((100 * d) / (d + o)).toFixed(1)}%`);

console.log('\n4. STANCES: mean net HP swing per round for the row stance (own damage taken minus dealt; positive = good for the row)');
console.log('   row \\ opp     ' + STANCES.map((s) => s.padEnd(9)).join(''));
for (const me of STANCES) {
  const cells = STANCES.map((op) => {
    const a = stanceNet[`${me}|${op}`];
    return a ? (a.sum / a.n).toFixed(2).padEnd(9) : '-'.padEnd(9);
  });
  const tot = STANCES.reduce((x, op) => x + (stanceNet[`${me}|${op}`]?.sum ?? 0), 0);
  const cnt = STANCES.reduce((x, op) => x + (stanceNet[`${me}|${op}`]?.n ?? 0), 0);
  console.log(`   ${me.padEnd(13)} ${cells.join('')}  avg ${(tot / cnt).toFixed(2)}`);
}

console.log('\n5. CARDS: share of the faction\'s games where it was played at least once, average round, and the score of those games vs the faction average');
for (const f of FACTIONS) {
  const base = factionGames[f].wins / factionGames[f].n;
  console.log(`   ${f.toUpperCase()} (faction average ${(100 * base).toFixed(1)}%)`);
  // Every id ever recorded under this Build's games (their own Build cards, whichever World Faction cards they were paired
  // with that game, and Tech), not just one fixed deck - the pairing varies game to game now.
  const ids = [...new Set(Object.keys(cards).filter((k) => k.startsWith(`${f}:`)).map((k) => k.slice(f.length + 1)))];
  const rows = ids.map((id) => ({ id, c: cards[`${f}:${id}`] ?? { deck: 0, playedGames: 0, wins: 0, roundSum: 0, plays: 0 } })).sort((x, y) => y.c.wins / (y.c.playedGames || 1) - x.c.wins / (x.c.playedGames || 1));
  for (const { id, c } of rows) {
    const games = factionGames[f].n;
    const copies = starterCopies(id);
    if (!copies) continue;
    console.log(`     ${cardOf(id).name.padEnd(22)} x${copies}  cost ${cardOf(id).cost}  played in ${((100 * c.playedGames) / games).toFixed(0).padStart(3)}% of games  avg round ${(c.roundSum / (c.plays || 1)).toFixed(1)}  score ${c.playedGames ? ((100 * c.wins) / c.playedGames).toFixed(1) : '-'}%`);
  }
}

}
// ---- 2. value of face-down ----
if (!NO_FACEDOWN) {
if (ONLY) console.log(`FACE-DOWN STUDY  |  config override: ${CONFIG_ARG || 'none'}`);
console.log('\n6. FACE-DOWN: one side follows a policy, the other never plays face-down; same faction both sides, seats swapped (50% = no effect)');
const M = ONLY ? N : Math.max(600, Math.floor(N / 3));
const POLICIES: FaceDownPolicy[] = ['always', 'early', 'cheap', 'smart', 'smart3', 'bot'];
for (const pol of POLICIES) {
  const cells: string[] = [];
  for (const f of FACTIONS) {
    let a = 0;
    let n = 0;
    for (let g = 0; g < M; g++) {
      const flip = g % 2 === 1;
      const s = play(200000 + g, f, f, flip ? ['never', pol] : [pol, 'never']);
      const w = s.result!.winner;
      const polSide = flip ? 1 : 0;
      a += w === null ? 0.5 : w === polSide ? 1 : 0;
      n++;
    }
    cells.push(`${f} ${((100 * a) / n).toFixed(1)}%`);
  }
  console.log(`   ${pol.padEnd(7)} vs never:  ${cells.join('   ')}   (${M} games each)`);
}
}
