import biomassArt from '../../assets/biomass.webp';
import { dailyChallenge, dailyReward, dayKey, liveStreak, todayRecord } from '../daily';
import { play } from '../sfx';
import { ScreenHeader } from '../components/ScreenHeader';
import { useState } from 'react';
import { chipsFor, FACTIONS, WORLD_FACTIONS } from '../../engine';
import type { Faction, WorldFactionId } from '../../engine';
import { ChipPicker } from '../components/ChipPicker';
import { Collapsible } from '../components/Collapsible';
import { ChipArt } from '../components/Emblem';
import { Pills } from '../components/Pills';
import { FACTION_META, WORLD_FACTION_META } from '../meta';
import { COSTS, deckProblems, loadProgress, saveProgress, startProgress, TOWER_FLOORS, unlock } from '../modes';
import type { Progress } from '../modes';
import { activeSave } from '../storage';
import { LINEAGE_MATCHES } from '../lineage';

/** Biomass, the Game Modes currency: its round emblem. */
export function BiomassIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return <img src={biomassArt} alt="" aria-hidden draggable={false} className={`inline-block shrink-0 select-none rounded-full align-[-3px] ${className}`} />;
}

export function BiomassBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/50 bg-emerald-950/40 px-2.5 py-0.5 font-display text-sm font-bold text-emerald-200" title="Biomass: earned by winning, spent on crafting and unlocks">
      <BiomassIcon className="h-5 w-5" />
      {n}
    </span>
  );
}

/** The daily challenge, featured above the modes: today's twist and whether it's beaten. */
function DailyCard({ p, onOpen }: { p: Progress; onOpen: () => void }) {
  const key = dayKey();
  const d = dailyChallenge(key, '');
  const rec = todayRecord(p, key);
  const streak = liveStreak(p, key);
  return (
    <button onClick={onOpen} className="lab-panel relative flex items-center gap-3 overflow-hidden rounded-xl border-2 border-amber-400/60 p-3 text-left transition hover:-translate-y-0.5" aria-label="Daily challenge">
      <div className="flex shrink-0 -space-x-2">
        <ChipArt id={d.you.faction} size={34} />
        <ChipArt id={d.opponent.faction} size={34} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-display text-lg font-bold text-amber-300">Daily challenge</span>
          {rec.won ? <span className="rounded-full bg-emerald-500/20 px-2 text-[11px] font-bold text-emerald-300">✓ Beaten</span> : <span className="rounded-full bg-amber-400/20 px-2 text-[11px] font-bold text-amber-200">New</span>}
        </div>
        <div className="truncate text-xs text-ink2">
          {FACTION_META[d.you.faction].name}/{WORLD_FACTION_META[d.you.worldFaction].name} vs {FACTION_META[d.opponent.faction].name}/{WORLD_FACTION_META[d.opponent.worldFaction].name} · Twist: <b className="text-amber-200">{d.twist.name}</b>
        </div>
        <div className="text-[11px] text-mute">
          {rec.won ? `Best: won with ${rec.bestHp} HP` : <>First win pays <BiomassIcon /> {dailyReward(streak + 1)}</>} · 🔥 {streak}-day streak
        </div>
      </div>
      <span className="font-display text-lg text-amber-300">›</span>
    </button>
  );
}

/** First visit: pick the Build, World Faction and Chip you start with. */
function StartPicker({ onStart }: { onStart: (p: Progress) => void }) {
  const [f, setF] = useState<Faction>('predator');
  const [w, setW] = useState<WorldFactionId>('corrosion');
  const [chip, setChip] = useState(chipsFor('corrosion')[0].id);
  return (
    <section className="lab-panel space-y-3 rounded-xl border border-accent/60 p-4">
      <h2 className="font-display text-lg font-bold">Choose your starting Specimen</h2>
      <p className="text-xs text-ink2">You start with its starter deck (no Signatures) and one Chip. Win Game Mode matches for biomass to craft cards and unlock more Chips, Builds and World Factions. This progress belongs to your save; Vs Bot and Quick match stay fully open.</p>
      <Pills label="Build" cols={3} options={FACTIONS.map((x) => ({ id: x, label: FACTION_META[x].name, color: FACTION_META[x].color, icon: <ChipArt id={x} size={34} /> }))} value={f} onChange={setF} hint={FACTION_META[f].tagline} />
      <Pills
        label="World Faction"
        cols={4}
        options={WORLD_FACTIONS.map((x) => ({ id: x, label: WORLD_FACTION_META[x].name, color: WORLD_FACTION_META[x].color, icon: <ChipArt id={x} size={30} /> }))}
        value={w}
        onChange={(x) => {
          setW(x);
          setChip(chipsFor(x)[0].id);
        }}
        hint={WORLD_FACTION_META[w].tagline}
      />
      <ChipPicker worldFaction={w} value={chip} onChange={setChip} />
      <button onClick={() => onStart(startProgress(f, w, chip))} className="w-full rounded-xl bg-accent px-4 py-3 font-display font-bold text-black">
        Start with {FACTION_META[f].name} / {WORLD_FACTION_META[w].name}
      </button>
    </section>
  );
}

function Unlocks({ p, onChange }: { p: Progress; onChange: (p: Progress) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const tryUnlock = (kind: 'build' | 'world' | 'chip', id: string) => {
    const r = unlock(p, kind, id);
    if (typeof r === 'string') setMsg(r);
    else {
      play('craft');
      setMsg(null);
      onChange(r);
    }
  };
  const tile = (id: string, name: string, color: string, owned: boolean, cost: number, onBuy: () => void, art?: string) => (
    <div key={id} className={`flex min-w-0 flex-col items-center gap-1 rounded-lg border p-2 text-center sm:flex-row sm:text-left ${owned ? 'border-accent/40 bg-accent/5' : 'border-line bg-black/20'}`}>
      {art && <ChipArt id={art as Faction} size={30} className={owned ? '' : 'opacity-50 saturate-50'} />}
      <span className="w-full min-w-0 truncate text-[13px] font-semibold sm:w-auto sm:flex-1" style={{ color }}>
        {name}
      </span>
      {owned ? (
        <span className="text-xs text-accent">✓</span>
      ) : (
        <button onClick={onBuy} disabled={p.biomass < cost} className="shrink-0 rounded-md bg-emerald-700 px-2 py-1 text-xs font-bold text-white disabled:opacity-40">
          <BiomassIcon /> {cost}
        </button>
      )}
    </div>
  );
  return (
    <Collapsible id="modes-unlocks" defaultOpen={false} title="Unlocks" meta={`${p.builds.length + p.worlds.length + p.chips.length} unlocked`} bodyClass="space-y-3">
      {msg && <p className="text-xs text-amber-300">{msg}</p>}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mute">Builds · <BiomassIcon /> {COSTS.build} (includes its starter cards)</div>
        <div className="grid grid-cols-3 gap-1.5">{FACTIONS.map((f) => tile(f, FACTION_META[f].name, FACTION_META[f].color, p.builds.includes(f), COSTS.build, () => tryUnlock('build', f), f))}</div>
      </div>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mute">World Factions · <BiomassIcon /> {COSTS.world} (includes its starter cards and first Chip)</div>
        <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">{WORLD_FACTIONS.map((w) => tile(w, WORLD_FACTION_META[w].name, WORLD_FACTION_META[w].color, p.worlds.includes(w), COSTS.world, () => tryUnlock('world', w), w))}</div>
      </div>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mute">Chips · <BiomassIcon /> {COSTS.chip} (for your unlocked World Factions)</div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">{p.worlds.flatMap((w) => chipsFor(w).map((c) => tile(c.id, c.name, WORLD_FACTION_META[w].color, p.chips.includes(c.id), COSTS.chip, () => tryUnlock('chip', c.id))))}</div>
      </div>
    </Collapsible>
  );
}

export function GameModes({ onBack, onTower, onLineage, onBreach, onDaily, onCollection, onSaves }: { onBack: () => void; onTower: () => void; onLineage: () => void; onBreach: () => void; onDaily: () => void; onCollection: () => void; onSaves: () => void }) {
  const save = activeSave();
  const [p, setP] = useState<Progress | null>(loadProgress);
  const update = (next: Progress) => {
    saveProgress(next);
    setP(next);
  };
  const problems = p ? deckProblems(p) : [];
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-3 p-3">
      <ScreenHeader title="Game Modes" sub="Daily · Tower · Lineage · Containment Breach" onBack={onBack} backLabel="Back to menu" right={p ? <BiomassBadge n={p.biomass} /> : undefined} />
      {!save ? (
        <section className="lab-panel space-y-3 rounded-xl border border-line p-4 text-sm text-ink2">
          <p>Game Modes progress (biomass, your collection, unlocks and Tower floors) is kept in a save.</p>
          <button onClick={onSaves} className="rounded-xl bg-accent px-4 py-2.5 font-display font-bold text-black">
            Create or load a save
          </button>
        </section>
      ) : !p ? (
        <StartPicker onStart={update} />
      ) : (
        <>
          <DailyCard p={p} onOpen={onDaily} />
          <div className="grid gap-3 lg:grid-cols-3">
          <button onClick={onTower} className="lab-panel relative flex flex-col overflow-hidden rounded-xl border border-accent/60 p-3.5 text-left transition hover:-translate-y-0.5">
            <div className="lab-label">Mode 1</div>
            <div className="font-display text-2xl font-bold text-accent">The Tower</div>
            <p className="mt-1 mb-2 text-xs text-ink2">
              {TOWER_FLOORS} floors, each harder than the last. What waits on each one, and what it pays, is a surprise; cleared floors can be replayed for less.
            </p>
            <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>
                Next floor: <b className="text-accent">{p.tower.floor}</b>
              </span>
              <span>
                Best: <b>{p.tower.best}</b>
              </span>
              <span>
                Clears: <b>{p.tower.clears}</b>
              </span>
            </div>
            <span className="absolute right-4 top-4 font-display text-lg text-accent">›</span>
          </button>
          <button onClick={onLineage} className="lab-panel relative flex flex-col overflow-hidden rounded-xl border border-fuchsia-400/50 p-3.5 text-left transition hover:-translate-y-0.5">
            <div className="lab-label">Mode 2</div>
            <div className="font-display text-2xl font-bold text-fuchsia-300">Lineage</div>
            <p className="mt-1 mb-2 text-xs text-ink2">One Specimen across a {LINEAGE_MATCHES}-match campaign. Losses and rejections leave permanent scars; every win adds a permanent mutation.</p>
            <div className="mt-auto text-xs">
              {p.lineage?.status === 'active' ? (
                <span>
                  In progress: match <b className="text-fuchsia-300">{p.lineage.match}</b> of {LINEAGE_MATCHES} · {p.lineage.maxHp} max HP · {p.lineage.mutations.length} mutation(s)
                </span>
              ) : (
                <span className="text-mute">No Specimen in progress</span>
              )}
            </div>
            <span className="absolute right-4 top-4 font-display text-lg text-fuchsia-300">›</span>
          </button>
          <button onClick={onBreach} className="lab-panel relative flex flex-col overflow-hidden rounded-xl border border-red-500/50 p-3.5 text-left transition hover:-translate-y-0.5">
            <div aria-hidden className="hazard absolute inset-x-0 top-0 h-1.5 opacity-70" />
            <div className="lab-label mt-1">Mode 3</div>
            <div className="font-display text-2xl font-bold text-red-300">Containment Breach</div>
            <p className="mt-1 mb-2 text-xs text-ink2">Escaped Specimens attack in endless waves. HP and Strain carry over between waves; your score is waves survived.</p>
            <div className="mt-auto text-xs">
              {p.breach && !p.breach.over ? (
                <span>
                  In progress: wave <b className="text-red-300">{p.breach.wave}</b> · {p.breach.hp} HP · {p.breach.strain} Strain
                </span>
              ) : (
                <span className="text-mute">Best: {p.breachBest ?? 0} waves</span>
              )}
            </div>
            <span className="absolute right-4 top-4 font-display text-lg text-red-300">›</span>
          </button>
          </div>
          <button onClick={onCollection} className="lab-panel rounded-xl border border-line p-4 text-left transition hover:border-accent">
            <div className="flex items-center gap-3">
              <ChipArt id={p.deck.faction} size={40} />
              <ChipArt id={p.deck.worldFaction} size={40} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-base font-bold">Collection &amp; deck</div>
                <div className="text-xs text-ink2">
                  {Object.values(p.owned).reduce((a, b) => a + b, 0)} cards owned · craft with biomass · {problems.length ? <span className="text-amber-300">deck needs attention</span> : <span className="text-emerald-300">deck ready</span>}
                </div>
              </div>
              <span className="font-display text-lg text-accent">›</span>
            </div>
          </button>
          <Unlocks p={p} onChange={update} />
        </>
      )}
    </div>
  );
}
