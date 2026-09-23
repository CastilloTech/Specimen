// Energy diagnostic: how much Energy is available, spent and stranded, by round and faction.
//   npm run energy -- --matches 3000
import { botAction, cardCost, cardOf, chipRows, chipsFor, graftStrain, createMatch, legalPlays, makeRng, pendingPlayers, reduce, starterDeck, WORLD_FACTIONS } from '../src/engine';
import type { Faction, GameState, PlayerId, WorldFactionId } from '../src/engine';

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const N = parseInt(arg('matches', '3000'), 10);
const FACTIONS: Faction[] = ['predator', 'parasite', 'bastion'];
const rng = makeRng(4242);

type Acc = {
  n: number;
  avail: number; // Energy at the start of the actions phase
  spent: number;
  hand: number; // cards in hand when the phase ends
  legalLeft: number; // rounds ending with unspent Energy AND a legal play (the bot chose to stop)
  broke: number; // rounds where an affordable-in-principle card was too expensive for the Energy left
  emptyHand: number; // rounds ending with no non-Protocol card in hand
  plays: number;
};
const blank = (): Acc => ({ n: 0, avail: 0, spent: 0, hand: 0, legalLeft: 0, broke: 0, emptyHand: 0, plays: 0 });
const byRound: Acc[] = [];
const byFaction: Record<string, Acc> = { predator: blank(), parasite: blank(), bastion: blank() };
const winsBySpend: { hi: [number, number]; lo: [number, number] } = { hi: [0, 0], lo: [0, 0] };
const costHist: Record<number, number> = {};
// Why cards sit in hand at the end of the actions phase, by round: [total cards, no free slot, Strain-blocked, unaffordable, other]
const why: number[][] = [];

for (let g = 0; g < N; g++) {
  const fa = FACTIONS[g % 3];
  const fb = FACTIONS[Math.floor(g / 3) % 3];
  const wa = WORLD_FACTIONS[g % WORLD_FACTIONS.length];
  const wb = WORLD_FACTIONS[(g + 1) % WORLD_FACTIONS.length];
  const load = (wf: WorldFactionId) => {
    const chip = rng.pick(chipsFor(wf)).id;
    return { chip, loadout: chipRows(chip).map((r) => rng.pick(r.nodes).id) };
  };
  const la = load(wa);
  const lb = load(wb);
  let s: GameState = createMatch({
    seed: 1000 + g,
    players: [
      { name: 'A', faction: fa, worldFaction: wa, chip: la.chip, deck: starterDeck(fa, wa), loadout: la.loadout },
      { name: 'B', faction: fb, worldFaction: wb, chip: lb.chip, deck: starterDeck(fb, wb), loadout: lb.loadout },
    ],
  });
  const r = [makeRng(g * 2 + 1), makeRng(g * 2 + 2)];
  const startEnergy: number[] = [0, 0];
  const spentTotal: number[] = [0, 0];
  let prevRound = 0;
  while (s.phase !== 'over') {
    if (s.phase === 'actions' && s.round !== prevRound) {
      prevRound = s.round;
      s.players.forEach((p, i) => (startEnergy[i] = p.energy));
    }
    const [p] = pendingPlayers(s);
    const prev = s;
    s = reduce(s, botAction(s, p, r[p]));
    if (prev.phase === 'actions' && s.phase !== 'actions') {
      for (const i of [0, 1] as PlayerId[]) {
        const pl = prev.players[i];
        const f = pl.faction;
        const a = (byRound[prev.round] ??= blank());
        const spent = startEnergy[i] - pl.energy;
        spentTotal[i] += spent;
        const legal = legalPlays(prev, i).some((x) => x.type === 'PLAY_CARD');
        const broke = pl.hand.some((c) => {
          const d = cardOf(c.cardId);
          return d.type !== 'protocol' && cardCost(prev, pl, d) > pl.energy;
        });
        const nonProto = pl.hand.filter((c) => cardOf(c.cardId).type !== 'protocol').length;
        for (const acc of [a, byFaction[f]]) {
          acc.n++;
          acc.avail += startEnergy[i];
          acc.spent += spent;
          acc.hand += pl.hand.length;
          if (pl.energy > 0 && legal) acc.legalLeft++;
          if (broke) acc.broke++;
          if (!nonProto) acc.emptyHand++;
        }
      }
    }
    if (prev.phase === 'actions' && s.phase !== 'actions') {
      const T = prev.config.strain.threshold;
      for (const i of [0, 1] as PlayerId[]) {
        const pl = prev.players[i];
        const w = (why[prev.round] ??= [0, 0, 0, 0, 0, 0]);
        for (const c of pl.hand) {
          const d = cardOf(c.cardId);
          if (d.type === 'protocol') { w[5]++; continue; }
          w[0]++;
          if (d.type === 'graft') {
            const free = pl.slots.some((sl) => prev.config.slotTypes[sl] === d.slot && !pl.grafts.some((g) => g.slot === sl));
            if (!free) w[1]++;
            else if (cardCost(prev, pl, d) > pl.energy) w[3]++;
            else if (pl.strain + graftStrain(pl, d) > T - prev.config.bot.graftStrainMargin) w[2]++;
            else w[4]++;
          } else if (cardCost(prev, pl, d) > pl.energy) w[3]++;
          else w[4]++;
        }
      }
    }
    if (s.plays.length > prev.plays.length) {
      const rec = s.plays[s.plays.length - 1];
      if (rec.kind === 'play' && rec.cardId) {
        const c = cardOf(rec.cardId).cost;
        costHist[c] = (costHist[c] ?? 0) + 1;
      }
    }
  }
  // Does the player who spent more Energy over the match win more often?
  const w = s.result!.winner;
  if (w !== null && spentTotal[0] !== spentTotal[1]) {
    const hi = spentTotal[0] > spentTotal[1] ? 0 : 1;
    winsBySpend.hi[w === hi ? 0 : 1]++;
  }
}

const row = (label: string, a: Acc) =>
  `${label.padEnd(10)} n=${String(a.n).padStart(6)}  avail ${(a.avail / a.n).toFixed(2)}  spent ${(a.spent / a.n).toFixed(2)} (${((100 * a.spent) / a.avail).toFixed(0)}%)  hand ${(a.hand / a.n).toFixed(1)}  stopped-with-play ${((100 * a.legalLeft) / a.n).toFixed(0)}%  too-expensive ${((100 * a.broke) / a.n).toFixed(0)}%  no-cards ${((100 * a.emptyHand) / a.n).toFixed(0)}%`;
console.log(`ENERGY DIAGNOSTIC  |  ${N} bot matches, random loadouts\n`);
console.log('By round (both players):');
byRound.forEach((a, i) => a && console.log('  ' + row(`round ${i}`, a)));
console.log('\nBy faction:');
for (const f of FACTIONS) console.log('  ' + row(f, byFaction[f]));
console.log('\nWhy non-Protocol cards are still in hand when the round ends (share of those cards):');
why.forEach((w, i) => {
  if (!w || !w[0]) return;
  const pct = (x: number) => `${((100 * x) / w[0]).toFixed(0)}%`.padStart(4);
  console.log(`  round ${i}  non-Protocol cards per player ${(w[0] / (byRound[i]?.n ?? 1)).toFixed(1)} | graft with no free slot ${pct(w[1])} | graft blocked by Strain margin ${pct(w[2])} | too expensive ${pct(w[3])} | held by choice (serums, toxins, sabotage) ${pct(w[4])}`);
});
const total = Object.values(costHist).reduce((x, y) => x + y, 0);
console.log('\nCost of every card played: ' + Object.entries(costHist).map(([c, n]) => `${c}: ${((100 * n) / total).toFixed(0)}%`).join('  '));
const [hw, hl] = winsBySpend.hi;
console.log(`\nThe player who spent more Energy over the match won ${((100 * hw) / (hw + hl)).toFixed(1)}% of decided games (${hw + hl} games).`);
console.log('"stopped-with-play" = ended the round with Energy left and a legal card play available (the bot chose not to). "too-expensive" = a card in hand costs more than the Energy left.');
