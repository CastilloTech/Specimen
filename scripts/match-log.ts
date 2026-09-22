// npm run log -- --a predator --b bastion --seed 5   -> print one bot-vs-bot match as plain-English log
import { playBotMatch, STARTER_DECKS, treeRows, makeRng } from '../src/engine';
import type { Faction } from '../src/engine';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const a = arg('a', 'predator') as Faction;
const b = arg('b', 'bastion') as Faction;
const seed = parseInt(arg('seed', '1'), 10);
const rng = makeRng(seed);
const loadout = (f: Faction) => treeRows(f).map((r) => rng.pick(r.nodes).id);
const s = playBotMatch({
  seed,
  players: [
    { name: 'A-' + a, faction: a, deck: STARTER_DECKS[a], loadout: loadout(a), isBot: true },
    { name: 'B-' + b, faction: b, deck: STARTER_DECKS[b], loadout: loadout(b), isBot: true },
  ],
});
console.log(`Loadouts: ${s.players[0].loadout.join(', ')}  |  ${s.players[1].loadout.join(', ')}`);
for (const e of s.log) console.log(`${e.kind === 'round' ? '\n' : '  '}${e.text}`);
console.log(`\nResult: ${JSON.stringify(s.result)}`);
