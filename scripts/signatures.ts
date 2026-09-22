// Signature check: the causal value of each faction's one-of signature card, measured as the faction's score with it vs the same deck
// with it swapped for a weak card, on the same seeds and loadouts.   npm run signatures -- 6000 [faction]
import { playBotMatch, STARTER_DECKS, treeRows, makeRng } from '../src/engine';
import type { MatchSetup } from '../src/engine';

const F = ['predator', 'parasite', 'bastion'] as const;
const SIG: Record<string, string> = { predator: 'pred_apex_maw', parasite: 'para_queen_cyst', bastion: 'bast_bulwark_heart' };
const SWAP: Record<string, string> = { predator: 'pred_twitch_nerve', parasite: 'para_gnawing_larva', bastion: 'bast_scale_patch' };
const N = parseInt(process.argv[2] ?? '6000', 10);
const only = process.argv[3];
const rng = makeRng(11);
for (const f of F) {
  if (only && only !== f) continue;
  const others = F.filter((x) => x !== f);
  let a = 0;
  let b = 0;
  let n = 0;
  for (let g = 0; g < N; g++) {
    const o = others[g % 2];
    const load = (x: (typeof F)[number]) => treeRows(x).map((r) => rng.pick(r.nodes).id);
    const la = load(f);
    const lo = load(o);
    for (const variant of ['with', 'without'] as const) {
      const deck = variant === 'with' ? STARTER_DECKS[f] : STARTER_DECKS[f].map((c) => (c === SIG[f] ? SWAP[f] : c));
      const flip = g % 4 >= 2;
      const me = flip ? 1 : 0;
      const mine = { name: 'F', faction: f, deck, loadout: la };
      const theirs = { name: 'O', faction: o, deck: STARTER_DECKS[o], loadout: lo };
      const players = (flip ? [theirs, mine] : [mine, theirs]) as MatchSetup['players'];
      const s = playBotMatch({ seed: 700000 + g, players });
      const w = s.result!.winner;
      const score = w === null ? 0.5 : w === me ? 1 : 0;
      if (variant === 'with') a += score;
      else b += score;
    }
    n++;
  }
  console.log(`${f.padEnd(9)} ${SIG[f].padEnd(20)} with ${((100 * a) / n).toFixed(1)}%  without ${((100 * b) / n).toFixed(1)}%  signature worth ${((100 * (a - b)) / n).toFixed(1)} points (n=${n})`);
}
