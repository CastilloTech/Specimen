// npm run budget            -> print every card's power budget
// npm run budget -- --write -> also rewrite each card's "budgetNote" in src/data/cards.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { budgetNote, budgetOf } from '../src/engine/budget';
import { defaultConfig } from '../src/engine/data';
import type { CardDef } from '../src/engine/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = join(root, 'src/data/cards.json');
const cards: CardDef[] = JSON.parse(readFileSync(path, 'utf8'));
const write = process.argv.includes('--write');

let bad = 0;
for (const c of cards) {
  const r = budgetOf(c, defaultConfig);
  if (!r.ok) bad++;
  console.log(`${r.ok ? ' ok ' : 'WARN'} ${c.id.padEnd(26)} cost ${c.cost} strain ${c.strain}  target ${String(r.target).padStart(5)}  actual ${String(r.total).padStart(5)}  (${r.diff >= 0 ? '+' : ''}${r.diff})`);
  if (write) c.budgetNote = budgetNote(c, defaultConfig);
}
console.log(`\n${cards.length} cards, ${bad} outside +/-${defaultConfig.budget.tolerance} of budget.`);
if (write) {
  // One card per line keeps the file diff-friendly and readable.
  const body = cards.map((c) => '  ' + JSON.stringify(c)).join(',\n');
  writeFileSync(path, `[\n${body}\n]\n`);
  console.log('budgetNote written to src/data/cards.json');
}
