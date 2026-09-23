import { useMemo, useState } from 'react';
import { CARDS, chipRows, chipsFor, defaultConfig, FACTIONS, starterDeck, validateDeck, validateLoadout, WORLD_FACTIONS } from '../../engine';
import type { CardType, Faction, WorldFactionId } from '../../engine';
import { CardView } from '../components/CardView';
import { ChipPicker } from '../components/ChipPicker';
import { LoadoutPicker } from '../components/LoadoutPicker';
import { FACTION_META, TYPE_META, WORLD_FACTION_META } from '../meta';
import type { SavedDeck } from '../storage';
import { activeSave, loadChipLoadouts, loadDecks, saveChipLoadout, saveDecks } from '../storage';

const D = defaultConfig.deck;

function DeckTab() {
  const [faction, setFaction] = useState<Faction>('predator');
  const [worldFaction, setWorldFaction] = useState<WorldFactionId>('corrosion');
  const [counts, setCounts] = useState<Record<string, number>>(() => tally(starterDeck('predator', 'corrosion')));
  const [name, setName] = useState('My deck');
  const [saved, setSaved] = useState<SavedDeck[]>(loadDecks);
  const [filter, setFilter] = useState<CardType | 'all'>('all');

  const deck = useMemo(() => Object.entries(counts).flatMap(([id, n]) => Array<string>(n).fill(id)), [counts]);
  const errors = validateDeck(faction, worldFaction, deck);
  const total = deck.length;
  const buildCount = deck.filter((id) => CARDS.find((c) => c.id === id)?.faction === faction).length;
  const worldCount = deck.filter((id) => CARDS.find((c) => c.id === id)?.faction === worldFaction).length;
  const techCount = deck.filter((id) => CARDS.find((c) => c.id === id)?.faction === 'tech').length;
  const pool = CARDS.filter((c) => (c.faction === faction || c.faction === worldFaction || c.faction === 'tech') && (filter === 'all' || c.type === filter));

  const change = (id: string, delta: number) => setCounts((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + delta) }));
  const switchFaction = (f: Faction) => {
    setFaction(f);
    setCounts(tally(starterDeck(f, worldFaction)));
    setName(`My ${FACTION_META[f].name} deck`);
  };
  const switchWorldFaction = (wf: WorldFactionId) => {
    setWorldFaction(wf);
    setCounts(tally(starterDeck(faction, wf)));
  };
  const persist = (next: SavedDeck[]) => {
    setSaved(next);
    saveDecks(next);
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        <div className="mb-2 flex flex-wrap gap-2">
          {FACTIONS.map((f) => (
            <button key={f} onClick={() => switchFaction(f)} aria-pressed={faction === f} className={`rounded-lg border px-3 py-1.5 text-sm font-bold ${faction === f ? 'bg-black/30' : 'border-line'}`} style={{ color: FACTION_META[f].color, borderColor: faction === f ? FACTION_META[f].color : undefined }}>
              {FACTION_META[f].name}
            </button>
          ))}
          {WORLD_FACTIONS.map((wf) => (
            <button key={wf} onClick={() => switchWorldFaction(wf)} aria-pressed={worldFaction === wf} className={`rounded-lg border px-3 py-1.5 text-sm font-bold ${worldFaction === wf ? 'bg-black/30' : 'border-line'}`} style={{ color: WORLD_FACTION_META[wf].color, borderColor: worldFaction === wf ? WORLD_FACTION_META[wf].color : undefined }}>
              {WORLD_FACTION_META[wf].name}
            </button>
          ))}
          <select value={filter} onChange={(e) => setFilter(e.target.value as CardType | 'all')} className="ml-auto rounded-md border border-line bg-black/30 px-2 text-xs" aria-label="Filter by type">
            <option value="all">All types</option>
            {(Object.keys(TYPE_META) as CardType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_META[t].label}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-1 text-[11px] text-mute">Click a card to add a copy; use − to remove one.</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-2 gap-y-4 pt-2">
          {pool.map((c) => {
            const n = counts[c.id] ?? 0;
            const max = c.signature ? D.signatureCopies : D.maxCopies;
            return (
              <div key={c.id} className="flex flex-col items-center gap-1">
                <CardView def={c} count={n || undefined} dim={n === 0} onClick={() => n < max && total < D.size && change(c.id, 1)} />
                <div className="flex items-center gap-2">
                  <button onClick={() => change(c.id, -1)} disabled={n === 0} className="h-7 w-7 rounded-md bg-panel2 font-bold disabled:opacity-30" aria-label={`Remove ${c.name}`}>
                    −
                  </button>
                  <span className="w-8 text-center text-xs text-ink2">
                    {n}/{max}
                  </span>
                  <button onClick={() => change(c.id, 1)} disabled={n >= max || total >= D.size} className="h-7 w-7 rounded-md bg-panel2 font-bold disabled:opacity-30" aria-label={`Add ${c.name}`}>
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <aside className="h-fit rounded-xl border border-line bg-panel p-3 lg:sticky lg:top-2">
        <div className="text-sm font-bold">Deck rules</div>
        <ul className="mt-1 space-y-0.5 text-xs">
          <li className={total === D.size ? 'text-emerald-300' : 'text-amber-300'}>
            Total {total}/{D.size}
          </li>
          <li className={buildCount >= D.minBuild ? 'text-emerald-300' : 'text-amber-300'}>
            {FACTION_META[faction].name} cards {buildCount} (min {D.minBuild})
          </li>
          <li className={worldCount >= D.minWorldFaction ? 'text-emerald-300' : 'text-amber-300'}>
            {WORLD_FACTION_META[worldFaction].name} cards {worldCount} (min {D.minWorldFaction})
          </li>
          <li className={techCount <= D.maxTech ? 'text-emerald-300' : 'text-amber-300'}>
            Tech cards {techCount} (max {D.maxTech})
          </li>
          <li className="text-mute">
            Max {D.maxCopies} copies each; {D.signatureCopies} of a Signature.
          </li>
        </ul>
        {errors.length > 0 && (
          <ul className="mt-2 rounded-lg border border-red-500/40 bg-red-950/30 p-2 text-[11px] text-red-300" role="alert">
            {errors.map((e) => (
              <li key={e}>• {e}</li>
            ))}
          </ul>
        )}
        {errors.length === 0 && <div className="mt-2 rounded-lg bg-emerald-950/40 p-2 text-[11px] text-emerald-300">Valid deck.</div>}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={28} aria-label="Deck name" className="mt-3 w-full rounded-md border border-line bg-black/30 px-2 py-1.5 text-sm" />
        <div className="mt-2 flex gap-2">
          <button
            disabled={errors.length > 0 || !name.trim()}
            onClick={() => persist([...saved, { id: `d${Date.now()}`, name: name.trim(), faction, worldFaction, cards: deck }])}
            className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-black disabled:opacity-40"
          >
            Save deck
          </button>
          <button onClick={() => setCounts(tally(starterDeck(faction, worldFaction)))} className="rounded-lg bg-panel2 px-3 py-2 text-sm font-semibold">
            Starter
          </button>
        </div>
        <div className="mt-3 text-xs font-bold">Saved decks</div>
        <ul className="mt-1 space-y-1">
          {saved.length === 0 && <li className="text-[11px] text-mute">None yet.</li>}
          {saved.map((d) => (
            <li key={d.id} className="flex items-center gap-1 rounded-md bg-black/30 px-2 py-1 text-xs">
              <span className="flex-1 truncate" style={{ color: FACTION_META[d.faction].color }}>
                {d.name}
              </span>
              <button
                className="rounded bg-panel2 px-2 py-0.5"
                onClick={() => {
                  setFaction(d.faction);
                  setWorldFaction(d.worldFaction);
                  setCounts(tally(d.cards));
                  setName(d.name);
                }}
              >
                Load
              </button>
              <button className="rounded bg-panel2 px-2 py-0.5 text-red-300" onClick={() => window.confirm(`Delete "${d.name}"?`) && persist(saved.filter((x) => x.id !== d.id))}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function tally(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = (out[id] ?? 0) + 1;
  return out;
}

function LoadoutTab() {
  const [worldFaction, setWorldFaction] = useState<WorldFactionId>('corrosion');
  const [chip, setChip] = useState<string>(() => chipsFor('corrosion')[0].id);
  const [loadouts, setLoadouts] = useState(loadChipLoadouts);
  const saved = loadouts[chip];
  // A saved loadout can go stale if the chip's own nodes changed since it was saved.
  const value = saved && validateLoadout(chip, saved).length === 0 ? saved : chipRows(chip).map((r) => r.nodes[0].id);
  const update = (l: string[]) => {
    setLoadouts((cur) => ({ ...cur, [chip]: l }));
    saveChipLoadout(chip, l);
  };
  const switchWorldFaction = (wf: WorldFactionId) => {
    setWorldFaction(wf);
    setChip(chipsFor(wf)[0].id);
  };
  return (
    <div className="max-w-3xl">
      <div className="mb-3 flex gap-2">
        {WORLD_FACTIONS.map((wf) => (
          <button key={wf} onClick={() => switchWorldFaction(wf)} aria-pressed={worldFaction === wf} className={`rounded-lg border px-3 py-1.5 text-sm font-bold ${worldFaction === wf ? 'bg-black/30' : 'border-line'}`} style={{ color: WORLD_FACTION_META[wf].color, borderColor: worldFaction === wf ? WORLD_FACTION_META[wf].color : undefined }}>
            {WORLD_FACTION_META[wf].name}
          </button>
        ))}
      </div>
      <p className="mb-2 text-xs text-ink2">Pick a Chip, then exactly one node in each of its rows. Your choice is saved automatically and used as the default in match setup.</p>
      <div className="mb-3">
        <ChipPicker worldFaction={worldFaction} value={chip} onChange={setChip} />
      </div>
      <LoadoutPicker rows={chipRows(chip)} errors={validateLoadout(chip, value)} value={value} onChange={update} />
    </div>
  );
}

export function DeckBuilder({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'deck' | 'tree'>('deck');
  return (
    <div className="mx-auto min-h-dvh max-w-6xl p-3">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className="rounded-md border border-line px-3 py-1.5 text-sm text-ink2 hover:border-mute">
          ← Menu
        </button>
        <div>
          <h1 className="font-display text-xl font-bold leading-tight">Decks &amp; Chips</h1>
          <div className="text-[11px] text-mute">{activeSave() ? `Saving to ${activeSave()!.meta.name}` : 'No save loaded: kept as unsaved defaults on this device'}</div>
        </div>
        <div className="ml-auto flex rounded-lg border border-line p-0.5 text-sm">
          {(['deck', 'tree'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={`rounded-md px-3 py-1 ${tab === t ? 'bg-accent font-bold text-black' : 'text-ink2'}`}>
              {t === 'deck' ? 'Deck' : 'Chip tree'}
            </button>
          ))}
        </div>
      </div>
      {tab === 'deck' ? <DeckTab /> : <LoadoutTab />}
    </div>
  );
}
