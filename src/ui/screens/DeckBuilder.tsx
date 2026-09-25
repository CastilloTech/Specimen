import { useMemo, useState } from 'react';
import { CARD_MAP, CARDS, chipRows, chipsFor, defaultConfig, FACTIONS, starterDeck, validateDeck, validateLoadout, WORLD_FACTIONS } from '../../engine';
import type { CardDef, Faction, WorldFactionId } from '../../engine';
import { CardDetail } from '../components/CardDetail';
import { CardView } from '../components/CardView';
import { ChipPicker } from '../components/ChipPicker';
import { ChipArt, Emblem } from '../components/Emblem';
import { LoadoutPicker } from '../components/LoadoutPicker';
import { Pills } from '../components/Pills';
import { FACTION_META, TYPE_META, WORLD_FACTION_META } from '../meta';
import type { SavedDeck } from '../storage';
import { activeSave, loadChipLoadouts, loadDecks, saveChipLoadout, saveDecks } from '../storage';
import { useMediaQuery } from '../useMediaQuery';

const D = defaultConfig.deck;
const TYPE_ORDER = ['graft', 'serum', 'toxin', 'sabotage', 'protocol'] as const;
const byTypeThenCost = (a: CardDef, b: CardDef) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.cost - b.cost || a.name.localeCompare(b.name);

type Pool = 'build' | 'world' | 'tech';

function tally(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = (out[id] ?? 0) + 1;
  return out;
}
const sameDeck = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] ?? 0) === (b[k] ?? 0));
};

function DeckTab() {
  const [faction, setFaction] = useState<Faction>('predator');
  const [worldFaction, setWorldFaction] = useState<WorldFactionId>('corrosion');
  const [counts, setCounts] = useState<Record<string, number>>(() => tally(starterDeck('predator', 'corrosion')));
  const [clean, setClean] = useState<Record<string, number>>(counts); // last loaded / saved / starter state
  const [name, setName] = useState('My deck');
  const [saved, setSaved] = useState<SavedDeck[]>(loadDecks);
  const [pool, setPool] = useState<Pool>('build');
  const [sheet, setSheet] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null); // card id open in the full view
  const wide = useMediaQuery('(min-width: 1024px)');

  const deck = useMemo(() => Object.entries(counts).flatMap(([id, n]) => Array<string>(n).fill(id)), [counts]);
  const errors = validateDeck(faction, worldFaction, deck);
  const total = deck.length;
  const countOf = (f: string) => deck.filter((id) => CARD_MAP[id]?.faction === f).length;
  const buildCount = countOf(faction);
  const worldCount = countOf(worldFaction);
  const techCount = countOf('tech');
  const dirty = !sameDeck(counts, clean);

  const poolFaction = pool === 'build' ? faction : pool === 'world' ? worldFaction : 'tech';
  const cards = CARDS.filter((c) => c.faction === poolFaction).sort(byTypeThenCost);

  const change = (id: string, delta: number) => setCounts((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + delta) }));
  const reset = (next: Record<string, number>) => {
    setCounts(next);
    setClean(next);
  };
  /** Switching identity replaces the deck with that pair's starter deck: ask first if there are unsaved edits. */
  const guard = () => !dirty || window.confirm('Switching replaces your unsaved changes with the starter deck. Continue?');
  const switchFaction = (f: Faction) => {
    if (f === faction || !guard()) return;
    setFaction(f);
    reset(tally(starterDeck(f, worldFaction)));
    setName(`My ${FACTION_META[f].name} deck`);
  };
  const switchWorldFaction = (wf: WorldFactionId) => {
    if (wf === worldFaction || !guard()) return;
    setWorldFaction(wf);
    reset(tally(starterDeck(faction, wf)));
  };
  const persist = (next: SavedDeck[]) => {
    setSaved(next);
    saveDecks(next);
  };
  const save = () => {
    const existing = saved.find((d) => d.name === name.trim() && d.faction === faction && d.worldFaction === worldFaction);
    const entry: SavedDeck = { id: existing?.id ?? `d${Date.now()}`, name: name.trim(), faction, worldFaction, cards: deck };
    persist(existing ? saved.map((d) => (d.id === existing.id ? entry : d)) : [...saved, entry]);
    setClean(counts);
    setFlash(existing ? 'Deck updated' : 'Deck saved');
    setTimeout(() => setFlash(null), 1600);
  };

  const poolTabs = [
    { id: 'build' as const, label: FACTION_META[faction].name, color: FACTION_META[faction].color, badge: `${buildCount} · min ${D.minBuild}`, ok: buildCount >= D.minBuild },
    { id: 'world' as const, label: WORLD_FACTION_META[worldFaction].name, color: WORLD_FACTION_META[worldFaction].color, badge: `${worldCount} · min ${D.minWorldFaction}`, ok: worldCount >= D.minWorldFaction },
    { id: 'tech' as const, label: 'Tech', color: '#8a948f', badge: `${techCount} · max ${D.maxTech}`, ok: techCount <= D.maxTech },
  ];

  const deckPanel = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={28} aria-label="Deck name" className="min-w-0 flex-1 rounded-lg border border-line bg-black/30 px-2 py-1.5 text-sm font-semibold" />
        <button onClick={() => (!dirty || window.confirm('Reset to the starter deck?')) && reset(tally(starterDeck(faction, worldFaction)))} className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink2 hover:border-mute" title="Replace with the starter deck">
          Starter
        </button>
      </div>
      {errors.length > 0 ? (
        <ul className="rounded-lg border border-amber-500/40 bg-amber-950/25 p-2 text-[11px] text-amber-200" role="alert">
          {errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg bg-emerald-950/40 px-2 py-1.5 text-[11px] text-emerald-300">Valid deck · {D.maxCopies} copies max, {D.signatureCopies} of a Signature ★</div>
      )}
      <ul className="divide-y divide-line/60 rounded-lg border border-line" aria-label="Cards in this deck">
        {deck.length === 0 && <li className="p-2 text-xs text-mute">Empty. Use + under a card to add it.</li>}
        {Object.entries(counts)
          .filter(([, n]) => n > 0)
          .map(([id, n]) => ({ c: CARD_MAP[id], n }))
          .filter((x) => x.c)
          .sort((a, b) => byTypeThenCost(a.c, b.c))
          .map(({ c, n }) => {
            const max = c.signature ? D.signatureCopies : D.maxCopies;
            return (
              <li key={c.id} className="flex items-center gap-2 px-2 py-1 text-xs">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sky-600 text-[10px] font-bold text-white">{c.cost}</span>
                <button onClick={() => setViewing(c.id)} className="min-w-0 flex-1 truncate text-left font-semibold hover:underline" title="Show the full card">
                  {c.signature && <span className="text-amber-300">★</span>}
                  {c.name}
                </button>
                <span className="shrink-0 text-[10px]" style={{ color: TYPE_META[c.type].color }}>
                  {TYPE_META[c.type].label}
                </span>
                <button onClick={() => change(c.id, -1)} className="h-7 w-7 shrink-0 rounded-md bg-panel2 font-bold" aria-label={`Remove ${c.name}`}>
                  −
                </button>
                <span className="w-5 shrink-0 text-center font-bold">{n}</span>
                <button onClick={() => change(c.id, 1)} disabled={n >= max || total >= D.size} className="h-7 w-7 shrink-0 rounded-md bg-panel2 font-bold disabled:opacity-30" aria-label={`Add ${c.name}`}>
                  +
                </button>
              </li>
            );
          })}
      </ul>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mute">Saved decks</div>
        <ul className="space-y-1">
          {saved.length === 0 && <li className="text-[11px] text-mute">None yet.</li>}
          {saved.map((d) => (
            <li key={d.id} className="flex items-center gap-1.5 rounded-lg bg-black/30 px-2 py-1 text-xs">
              <Emblem id={d.faction} size={16} />
              <Emblem id={d.worldFaction} size={16} />
              <span className="min-w-0 flex-1 truncate font-semibold" style={{ color: FACTION_META[d.faction].color }}>
                {d.name}
                <span className="font-normal text-mute">
                  {' '}
                  · {FACTION_META[d.faction].name}/{WORLD_FACTION_META[d.worldFaction].name}
                </span>
              </span>
              <button
                className="rounded-md bg-panel2 px-2 py-1"
                onClick={() => {
                  if (dirty && !window.confirm('Load this deck and drop your unsaved changes?')) return;
                  setFaction(d.faction);
                  setWorldFaction(d.worldFaction);
                  reset(tally(d.cards));
                  setName(d.name);
                  setSheet(false);
                }}
              >
                Load
              </button>
              <button className="rounded-md bg-panel2 px-2 py-1 text-red-300" onClick={() => window.confirm(`Delete "${d.name}"?`) && persist(saved.filter((x) => x.id !== d.id))} aria-label={`Delete ${d.name}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-4">
      <div className="min-w-0">
        <div className="space-y-2">
          <Pills cols={3} options={FACTIONS.map((f) => ({ id: f, label: FACTION_META[f].name, color: FACTION_META[f].color, title: FACTION_META[f].tagline, icon: <ChipArt id={f} size={30} /> }))} value={faction} onChange={switchFaction} />
          <Pills cols={4} options={WORLD_FACTIONS.map((wf) => ({ id: wf, label: WORLD_FACTION_META[wf].name, color: WORLD_FACTION_META[wf].color, title: WORLD_FACTION_META[wf].tagline, icon: <ChipArt id={wf} size={26} /> }))} value={worldFaction} onChange={switchWorldFaction} />
        </div>

        {/* The three card pools, each with its deck rule as a live counter. */}
        <div className="sticky top-0 z-10 -mx-3 mt-3 border-b border-line bg-bg/90 px-3 py-2 backdrop-blur" role="tablist" aria-label="Card pool">
          <div className="grid grid-cols-3 gap-1.5">
            {poolTabs.map((t) => {
              const on = pool === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setPool(t.id)}
                  className={`flex min-w-0 flex-col items-center rounded-lg border px-1 py-1 leading-tight ${on ? 'bg-black/35' : 'border-line'}`}
                  style={on ? { borderColor: t.color } : undefined}
                >
                  <span className="flex max-w-full items-center gap-1 truncate text-[13px] font-bold" style={{ color: t.color }}>
                    <Emblem id={t.id === 'build' ? faction : t.id === 'world' ? worldFaction : 'tech'} size={16} />
                    <span className="truncate">{t.label}</span>
                  </span>
                  <span className={`text-[10px] font-semibold ${t.ok ? 'text-emerald-300' : 'text-amber-300'}`}>{t.badge}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] justify-items-center gap-x-2 gap-y-4 pb-4 pt-4 sm:grid-cols-[repeat(auto-fill,minmax(136px,1fr))]">
          {cards.map((c) => {
            const n = counts[c.id] ?? 0;
            const max = c.signature ? D.signatureCopies : D.maxCopies;
            const full = n >= max || total >= D.size;
            return (
              <div key={c.id} className="flex flex-col items-center gap-1">
                <CardView def={c} size={wide ? 'md' : 'sm'} count={n || undefined} dim={n === 0} onClick={() => setViewing(c.id)} />
                <div className="flex items-center gap-1">
                  <button onClick={() => change(c.id, -1)} disabled={n === 0} className="h-7 w-8 rounded-md bg-panel2 text-sm font-bold disabled:opacity-30" aria-label={`Remove ${c.name}`}>
                    −
                  </button>
                  <span className="w-8 text-center text-[11px] text-ink2">
                    {n}/{max}
                  </span>
                  <button onClick={() => change(c.id, 1)} disabled={full} className="h-7 w-8 rounded-md bg-panel2 text-sm font-bold disabled:opacity-30" aria-label={`Add ${c.name}`}>
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Desktop: the deck is always visible on the right. */}
      {wide && (
        <aside className="lab-panel sticky top-2 h-fit max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-xl border border-line p-3">
          <div className="mb-3 flex items-center gap-2">
            <span className="font-display text-base font-bold">
              Deck · {total}/{D.size}
            </span>
            <button onClick={save} disabled={errors.length > 0 || !name.trim()} className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-bold text-black disabled:opacity-40">
              Save
            </button>
          </div>
          {deckPanel}
        </aside>
      )}

      {/* Phone / tablet: a sticky bar with the count and Save; the deck opens as a sheet. */}
      {!wide && (
        <div className="sticky bottom-0 z-20 -mx-3 flex items-center gap-2 border-t border-line bg-bg/95 px-3 pt-2 backdrop-blur" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
          <button onClick={() => setSheet(true)} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line px-3 py-2 text-left phone:py-1" aria-label="Show deck list">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${errors.length ? 'bg-amber-400' : 'bg-emerald-400'}`} />
            <span className="min-w-0 flex-1">
              <span className="block font-display text-sm font-bold">
                {total}/{D.size} cards
              </span>
              <span className="block truncate text-[10px] text-mute">{errors.length ? errors[0] : dirty ? 'Valid · unsaved changes' : 'Valid'}</span>
            </span>
            <span className="shrink-0 text-xs text-ink2">Deck ▴</span>
          </button>
          <button onClick={save} disabled={errors.length > 0 || !name.trim()} className="shrink-0 rounded-xl bg-accent px-4 py-3 text-sm font-bold text-black disabled:opacity-40 phone:py-2">
            Save
          </button>
        </div>
      )}
      {sheet && !wide && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/60" onClick={() => setSheet(false)}>
          <div className="pop max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-line bg-bg p-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Deck">
            <div className="mb-2 flex items-center">
              <span className="font-display text-base font-bold">
                Deck · {total}/{D.size}
              </span>
              <button onClick={() => setSheet(false)} className="ml-auto rounded-md border border-line px-2.5 py-1 text-xs text-ink2">
                Close
              </button>
            </div>
            {deckPanel}
          </div>
        </div>
      )}
      {viewing && CARD_MAP[viewing] && (() => {
        // Browse the open pool (or the deck list, for a card opened from it).
        const list = cards.some((c) => c.id === viewing) ? cards.map((c) => c.id) : Object.keys(counts).filter((id) => counts[id] > 0);
        const i = list.indexOf(viewing);
        const c = CARD_MAP[viewing];
        const n = counts[c.id] ?? 0;
        const max = c.signature ? D.signatureCopies : D.maxCopies;
        return (
          <CardDetail def={c} onClose={() => setViewing(null)} onPrev={i > 0 ? () => setViewing(list[i - 1]) : undefined} onNext={i >= 0 && i < list.length - 1 ? () => setViewing(list[i + 1]) : undefined}>
            <div className="flex items-center gap-2">
              <button onClick={() => change(c.id, -1)} disabled={n === 0} className="h-11 flex-1 rounded-xl bg-panel2 text-lg font-bold disabled:opacity-30" aria-label={`Remove ${c.name}`}>
                −
              </button>
              <span className="w-20 text-center text-sm">
                <span className="font-display text-xl font-bold">{n}</span>
                <span className="text-mute">/{max}</span>
                <span className="block text-[10px] text-mute">in deck · {total}/{D.size}</span>
              </span>
              <button onClick={() => change(c.id, 1)} disabled={n >= max || total >= D.size} className="h-11 flex-1 rounded-xl bg-accent text-lg font-bold text-black disabled:opacity-30" aria-label={`Add ${c.name}`}>
                +
              </button>
            </div>
          </CardDetail>
        );
      })()}
      {flash && <div className="pop fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-bold text-white shadow-xl">{flash}</div>}
    </div>
  );
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
    <div className="max-w-2xl space-y-3">
      <Pills label="World Faction" cols={4} options={WORLD_FACTIONS.map((wf) => ({ id: wf, label: WORLD_FACTION_META[wf].name, color: WORLD_FACTION_META[wf].color, icon: <ChipArt id={wf} size={30} /> }))} value={worldFaction} onChange={switchWorldFaction} hint={WORLD_FACTION_META[worldFaction].tagline} />
      <ChipPicker worldFaction={worldFaction} value={chip} onChange={setChip} />
      <LoadoutPicker rows={chipRows(chip)} errors={validateLoadout(chip, value)} value={value} onChange={update} />
      <p className="text-[11px] text-mute">Saved automatically; used as your default loadout for this Chip in match setup.</p>
    </div>
  );
}

export function DeckBuilder({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'deck' | 'tree'>('deck');
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col p-3 pb-0">
      <header className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className="rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink2 hover:border-mute" aria-label="Back to menu">
          ←
        </button>
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold leading-tight">Decks &amp; Chips</h1>
          <div className="truncate text-[10px] text-mute">{activeSave() ? `Saving to ${activeSave()!.meta.name}` : 'No save loaded: kept on this device'}</div>
        </div>
        <div className="ml-auto flex shrink-0 rounded-lg border border-line p-0.5 text-sm" role="tablist">
          {(['deck', 'tree'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 ${tab === t ? 'bg-accent font-bold text-black' : 'text-ink2'}`}>
              {t === 'deck' ? 'Deck' : 'Chips'}
            </button>
          ))}
        </div>
      </header>
      <div className="flex-1">{tab === 'deck' ? <DeckTab /> : <LoadoutTab />}</div>
    </div>
  );
}
