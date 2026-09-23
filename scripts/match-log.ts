// npm run log -- --a predator --b bastion --seed 5   -> print one bot-vs-bot match as plain-English log
import { chipRows, chipsFor, makeRng, playBotMatch, starterDeck } from '../src/engine';
import type { Faction, WorldFactionId } from '../src/engine';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const a = arg('a', 'predator') as Faction;
const b = arg('b', 'bastion') as Faction;
const wa = arg('wa', 'corrosion') as WorldFactionId;
const wb = arg('wb', 'aegis') as WorldFactionId;
const seed = parseInt(arg('seed', '1'), 10);
const rng = makeRng(seed);
const load = (wf: WorldFactionId) => {
  const chip = rng.pick(chipsFor(wf)).id;
  return { chip, loadout: chipRows(chip).map((r) => rng.pick(r.nodes).id) };
};
const la = load(wa);
const lb = load(wb);
const s = playBotMatch({
  seed,
  players: [
    { name: 'A-' + a, faction: a, worldFaction: wa, chip: la.chip, deck: starterDeck(a, wa), loadout: la.loadout, isBot: true },
    { name: 'B-' + b, faction: b, worldFaction: wb, chip: lb.chip, deck: starterDeck(b, wb), loadout: lb.loadout, isBot: true },
  ],
});
console.log(`Loadouts: ${s.players[0].loadout.join(', ')}  |  ${s.players[1].loadout.join(', ')}`);
for (const e of s.log) console.log(`${e.kind === 'round' ? '\n' : '  '}${e.text}`);
console.log(`\nResult: ${JSON.stringify(s.result)}`);
