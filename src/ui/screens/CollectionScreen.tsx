import { useMemo, useState } from 'react';
import { CARD_MAP, CARDS, chipRows, chipsFor, defaultConfig, FACTIONS, findNode, WORLD_FACTIONS } from '../../engine';
import type { CardDef, Faction, WorldFactionId } from '../../engine';
import { CardDetail } from '../components/CardDetail';
import { CardView } from '../components/CardView';
import { Collapsible } from '../components/Collapsible';
import { ChipArt, Emblem } from '../components/Emblem';
import { LoadoutPicker } from '../components/LoadoutPicker';
import { Pills } from '../components/Pills';
import { FACTION_META, WORLD_FACTION_META } from '../meta';
import { craft, craftable, craftCost, deckProblems, loadProgress, maxOwned, saveProgress } from '../modes';
import type { Progress } from '../modes';
import { useMediaQuery } from '../useMediaQuery';
import { BiomassBadge, BiomassIcon } from './GameModes';

const D = defaultConfig.deck;
const ORDER = ['graft', 'serum', 'toxin', 'sabotage', 'protocol'];
const sortCards = (a: CardDef, b: CardDef) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.cost - b.cost || a.name.localeCompare(b.name);

/** Your Game Modes deck, built only from cards you own, and crafting. */
export function CollectionScreen({ onBack }: { onBack: () => void }) {
  const [p, setP] = useState<Progress>(() => loadProgress()!);
  const [pool, setPool] = useState<'build' | 'world' | 'tech'>('build');
  const [viewing, setViewing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const wide = useMediaQuery('(min-width: 1024px)');
  const update = (next: Progress) => {
    saveProgress(next);
    setP(next);
  };
  const d = p.deck;
  const counts = useMemo(() => d.cards.reduce<Record<string, number>>((m, id) => ((m[id] = (m[id] ?? 0) + 1), m), {}), [d.cards]);
  const problems = deckProblems(p);
  const setDeck = (patch: Partial<Progress['deck']>) => update({ ...p, deck: { ...d, ...patch } });
  const change = (id: string, delta: number) => {
    const n = counts[id] ?? 0;
    if (delta > 0 && (n >= (p.owned[id] ?? 0) || n >= maxOwned(CARD_MAP[id]) || d.cards.length >= D.size)) return;
    if (delta < 0 && n === 0) return;
    const cards = [...d.cards];
    if (delta > 0) cards.push(id);
    else cards.splice(cards.lastIndexOf(id), 1);
    setDeck({ cards });
  };
  const doCraft = (id: string) => {
    const r = craft(p, id);
    if (typeof r === 'string') setMsg(r);
    else {
      setMsg(`Crafted ${CARD_MAP[id].name}.`);
      update(r);
    }
  };
  // Switching Build / World Faction keeps the cards that still fit (the rest leave the deck).
  const switchBuild = (f: Faction) => setDeck({ faction: f, cards: d.cards.filter((id) => CARD_MAP[id].faction !== d.faction) });
  const switchWorld = (w: WorldFactionId) => {
    const chip = chipsFor(w).find((c) => p.chips.includes(c.id))?.id ?? chipsFor(w)[0].id;
    setDeck({ worldFaction: w, chip, loadout: chipRows(chip).map((r) => r.nodes[0].id), cards: d.cards.filter((id) => CARD_MAP[id].faction !== d.worldFaction) });
  };
  const poolFaction = pool === 'build' ? d.faction : pool === 'world' ? d.worldFaction : 'tech';
  const cards = CARDS.filter((c) => c.faction === poolFaction && !c.mastery).sort(sortCards);
  const inPool = (f: string) => d.cards.filter((id) => CARD_MAP[id].faction === f).length;
  const tabs = [
    { id: 'build' as const, label: FACTION_META[d.faction].name, color: FACTION_META[d.faction].color, badge: `${inPool(d.faction)} · min ${D.minBuild}`, ok: inPool(d.faction) >= D.minBuild, emblem: d.faction },
    { id: 'world' as const, label: WORLD_FACTION_META[d.worldFaction].name, color: WORLD_FACTION_META[d.worldFaction].color, badge: `${inPool(d.worldFaction)} · min ${D.minWorldFaction}`, ok: inPool(d.worldFaction) >= D.minWorldFaction, emblem: d.worldFaction },
    { id: 'tech' as const, label: 'Tech', color: '#8a948f', badge: `${inPool('tech')} · max ${D.maxTech}`, ok: inPool('tech') <= D.maxTech, emblem: 'tech' },
  ];
  const chips = chipsFor(d.worldFaction).filter((c) => p.chips.includes(c.id));

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-3 p-3 pb-0">
      <header className="flex items-center gap-2">
        <button onClick={onBack} className="rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink2 hover:border-mute" aria-label="Back to Game Modes">
          ←
        </button>
        <h1 className="font-display text-xl font-bold">Collection</h1>
        <span className="ml-auto">
          <BiomassBadge n={p.biomass} />
        </span>
      </header>

      <div className={`grid gap-2 ${p.builds.length + p.worlds.length <= 3 ? 'grid-cols-2' : 'sm:grid-cols-2'}`}>
        <Pills cols={p.builds.length} options={FACTIONS.filter((f) => p.builds.includes(f)).map((f) => ({ id: f, label: FACTION_META[f].name, color: FACTION_META[f].color, icon: <ChipArt id={f} size={28} /> }))} value={d.faction} onChange={switchBuild} />
        <Pills cols={p.worlds.length} options={WORLD_FACTIONS.filter((w) => p.worlds.includes(w)).map((w) => ({ id: w, label: WORLD_FACTION_META[w].name, color: WORLD_FACTION_META[w].color, icon: <ChipArt id={w} size={26} /> }))} value={d.worldFaction} onChange={switchWorld} />
      </div>
      {/* Chip and loadout change rarely: tucked away, with the current picks in the header. */}
      <Collapsible id="collection-chip" defaultOpen={false} title="Chip" meta={`${chipsFor(d.worldFaction).find((c) => c.id === d.chip)?.name ?? ''} · ${d.loadout.map((id) => findNode(id)?.name ?? id).join(' · ')}`} bodyClass="space-y-2">
        <Pills label="Chip" cols={chips.length} options={chips.map((c) => ({ id: c.id, label: c.name, title: c.text }))} value={d.chip} onChange={(chip) => setDeck({ chip, loadout: chipRows(chip).map((r) => r.nodes[0].id) })} hint={chipsFor(d.worldFaction).find((c) => c.id === d.chip)?.text} />
        <LoadoutPicker rows={chipRows(d.chip)} errors={[]} value={d.loadout} onChange={(loadout) => setDeck({ loadout })} />
      </Collapsible>

      <div className="sticky top-0 z-10 -mx-3 border-b border-line bg-bg/90 px-3 py-2 backdrop-blur" role="tablist" aria-label="Card pool">
        <div className="grid grid-cols-3 gap-1.5">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={pool === t.id} onClick={() => setPool(t.id)} className={`flex min-w-0 flex-col items-center rounded-lg border px-1 py-1 leading-tight ${pool === t.id ? 'bg-black/35' : 'border-line'}`} style={pool === t.id ? { borderColor: t.color } : undefined}>
              <span className="flex max-w-full items-center gap-1 truncate text-[13px] font-bold" style={{ color: t.color }}>
                <Emblem id={t.emblem} size={16} />
                <span className="truncate">{t.label}</span>
              </span>
              <span className={`text-[10px] font-semibold ${t.ok ? 'text-emerald-300' : 'text-amber-300'}`}>{t.badge}</span>
            </button>
          ))}
        </div>
      </div>

      {msg && <p className="text-xs text-emerald-300">{msg}</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] justify-items-center gap-x-2 gap-y-4 pb-4 sm:grid-cols-[repeat(auto-fill,minmax(136px,1fr))]">
        {cards.map((c) => {
          const own = p.owned[c.id] ?? 0;
          const n = counts[c.id] ?? 0;
          const canCraft = craftable(p, c) && own < maxOwned(c);
          return (
            <div key={c.id} className="flex flex-col items-center gap-1">
              <div className={own ? '' : 'opacity-50 grayscale'}>
                <CardView def={c} size={wide ? 'md' : 'sm'} count={n || undefined} dim={n === 0} onClick={() => setViewing(c.id)} />
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => change(c.id, -1)} disabled={n === 0} className="h-7 w-8 rounded-md bg-panel2 text-sm font-bold disabled:opacity-30" aria-label={`Remove ${c.name}`}>
                  −
                </button>
                <span className="w-6 text-center text-[11px] text-ink2">{n}</span>
                <button onClick={() => change(c.id, 1)} disabled={n >= own || d.cards.length >= D.size} className="h-7 w-8 rounded-md bg-panel2 text-sm font-bold disabled:opacity-30" aria-label={`Add ${c.name}`}>
                  +
                </button>
              </div>
              {/* Owned copies and crafting on one line. */}
              <div className="flex items-center gap-1.5 text-[10px] text-mute">
                <span title="Copies you own / most a deck can use">own {own}/{maxOwned(c)}</span>
                {canCraft && (
                  <button onClick={() => doCraft(c.id)} disabled={p.biomass < craftCost(c)} className="rounded-md bg-emerald-700 px-1.5 py-0.5 text-[10px] font-bold text-white disabled:opacity-40" aria-label={`Craft ${c.name} for ${craftCost(c)} biomass`}>
                    + <BiomassIcon className="h-3.5 w-3.5" /> {craftCost(c)}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-0 z-20 -mx-3 flex items-center gap-2 border-t border-line bg-bg/95 px-3 pt-2 backdrop-blur" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${problems.length ? 'bg-amber-400' : 'bg-emerald-400'}`} />
        <span className="min-w-0 flex-1">
          <span className="block font-display text-sm font-bold">
            Deck {d.cards.length}/{D.size}
          </span>
          <span className="block truncate text-[10px] text-mute">{problems[0] ?? 'Ready for the Tower'}</span>
        </span>
        <button onClick={onBack} className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-black">
          Done
        </button>
      </div>
      {viewing && CARD_MAP[viewing] && <CardDetail def={CARD_MAP[viewing]} onClose={() => setViewing(null)} />}
    </div>
  );
}
