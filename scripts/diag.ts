// Diagnostic: average board state by round for one matchup.  npx tsx scripts/diag.ts --a predator --b parasite --n 300
import { botAction, chipRows, chipsFor, computeStats, createMatch, makeRng, pendingPlayers, reduce, starterDeck } from '../src/engine';
import type { Faction, WorldFactionId } from '../src/engine';

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const A = arg('a', 'predator') as Faction;
const B = arg('b', 'parasite') as Faction;
const WA = arg('wa', 'corrosion') as WorldFactionId;
const WB = arg('wb', 'aegis') as WorldFactionId;
const N = parseInt(arg('n', '300'), 10);
const rng = makeRng(99);
type Acc = { n: number; atk: number; arm: number; grafts: number; strain: number; hp: number; unspent: number };
const acc: Acc[][] = [[], []];
const koRound: number[] = [];
let wins = [0, 0, 0];
for (let g = 0; g < N; g++) {
  const load = (wf: WorldFactionId) => {
    const chip = rng.pick(chipsFor(wf)).id;
    return { chip, loadout: chipRows(chip).map((r) => rng.pick(r.nodes).id) };
  };
  const la = load(WA);
  const lb = load(WB);
  let s = createMatch({
    seed: g + 1,
    players: [
      { name: 'A', faction: A, worldFaction: WA, chip: la.chip, deck: starterDeck(A, WA), loadout: la.loadout },
      { name: 'B', faction: B, worldFaction: WB, chip: lb.chip, deck: starterDeck(B, WB), loadout: lb.loadout },
    ],
  });
  const r = [makeRng(g * 2 + 1), makeRng(g * 2 + 2)];
  while (s.phase !== 'over') {
    const [p] = pendingPlayers(s);
    const prev = s;
    s = reduce(s, botAction(s, p, r[p]));
    if (prev.phase === 'actions' && s.phase !== 'actions') {
      for (const i of [0, 1] as const) {
        const pl = prev.players[i];
        const st = computeStats(prev, pl);
        const a = (acc[i][prev.round] ??= { n: 0, atk: 0, arm: 0, grafts: 0, strain: 0, hp: 0, unspent: 0 });
        a.n++;
        a.atk += st.attack;
        a.arm += st.armor;
        a.grafts += pl.grafts.length;
        a.strain += pl.strain;
        a.hp += pl.hp;
        a.unspent += pl.energy;
      }
    }
  }
  koRound.push(s.round);
  wins[s.result!.winner === null ? 2 : s.result!.winner]++;
}
console.log(`${A} (A) vs ${B} (B): A wins ${wins[0]}, B wins ${wins[1]}, draws ${wins[2]}; avg rounds ${(koRound.reduce((a, b) => a + b, 0) / N).toFixed(2)}`);
for (const i of [0, 1]) {
  console.log(`\n${i === 0 ? A : B}: round | n | atk | armor | grafts | strain | hp | unspent energy`);
  acc[i].forEach((a, round) => {
    if (a) console.log(`  r${round}  n=${String(a.n).padStart(4)}  atk ${(a.atk / a.n).toFixed(1).padStart(5)}  arm ${(a.arm / a.n).toFixed(1).padStart(5)}  grafts ${(a.grafts / a.n).toFixed(1)}  strain ${(a.strain / a.n).toFixed(1).padStart(4)}  hp ${(a.hp / a.n).toFixed(1).padStart(5)}  unspent ${(a.unspent / a.n).toFixed(1)}`);
  });
}
