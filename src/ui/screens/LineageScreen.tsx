import { useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { defaultConfig, MUTATION_MAP, SLOT_LABEL } from '../../engine';
import type { MatchSetup, SlotId } from '../../engine';
import { ChipArt } from '../components/Emblem';
import { Creature } from '../components/Specimen';
import { chooseMutation, inheritable, LINEAGE_COMPLETE_BONUS, LINEAGE_MATCHES, lineageMatch, MAX_LOSSES, MIN_MAX_HP, startLineage } from '../lineage';
import type { MatchReport } from '../lineage';
import { FACTION_META, WORLD_FACTION_META } from '../meta';
import { deckProblems, loadProgress, saveProgress } from '../modes';
import type { Progress } from '../modes';
import { activeSave } from '../storage';
import { BiomassBadge, BiomassIcon } from './GameModes';

const BASE_HP = defaultConfig.specimen.hp;
const ALL_SLOTS = defaultConfig.slots as SlotId[];

function MutationTile({ id, onPick, selected }: { id: string; onPick?: () => void; selected?: boolean }) {
  const m = MUTATION_MAP[id];
  const Tag = onPick ? 'button' : 'div';
  return (
    <Tag
      {...(onPick ? { type: 'button' as const, onClick: onPick, 'aria-pressed': selected } : {})}
      className={`rounded-lg border p-2 text-left ${selected ? 'border-accent bg-accent/10' : 'border-fuchsia-400/40 bg-fuchsia-950/20'} ${onPick ? 'transition hover:border-accent' : ''}`}
    >
      <div className="font-display text-sm font-bold text-fuchsia-200">✦ {m?.name ?? id}</div>
      <div className="text-[11px] leading-snug text-ink2">{m?.text}</div>
    </Tag>
  );
}

/** The Specimen as it stands: max HP (scarred portion hatched), slots (lost ones dead), mutations. */
function SpecimenSheet({ p }: { p: Progress }) {
  const l = p.lineage!;
  const pct = (l.maxHp / BASE_HP) * 100;
  return (
    <section className="lab-panel space-y-3 rounded-xl border border-line p-3" aria-label="Your Specimen">
      <div className="flex items-center gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-accent/30">
          <Creature />
          {l.lostSlots.length > 0 && <div className="absolute inset-0 bg-red-900/25" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-bold leading-tight">{l.name}</div>
          <div className="flex items-center gap-1 text-xs">
            <ChipArt id={l.deck.faction} size={18} />
            <span style={{ color: FACTION_META[l.deck.faction].color }}>{FACTION_META[l.deck.faction].name}</span>
            <span className="text-mute">/</span>
            <ChipArt id={l.deck.worldFaction} size={18} />
            <span style={{ color: WORLD_FACTION_META[l.deck.worldFaction].color }}>{WORLD_FACTION_META[l.deck.worldFaction].name}</span>
          </div>
          <div className="mt-1 text-[11px] text-mute">
            Losses {l.losses}/{MAX_LOSSES} · dies below {MIN_MAX_HP} max HP
          </div>
        </div>
      </div>
      <div>
        <div className="mb-0.5 flex justify-between text-[11px]">
          <span className="text-ink2">Max HP</span>
          <span className="font-display font-bold">
            {l.maxHp}
            <span className="text-mute">/{BASE_HP}</span>
          </span>
        </div>
        <div className="relative h-3 overflow-hidden rounded bg-[repeating-linear-gradient(-45deg,#3b1a1a_0_4px,#1d1010_4px_8px)]" title="The hatched part is scarred away for good">
          <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, pct)}%` }} />
          <div className="absolute inset-y-0 border-l-2 border-red-400" style={{ left: `${(MIN_MAX_HP / BASE_HP) * 100}%` }} title={`Below ${MIN_MAX_HP} the Specimen dies`} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Graft slots">
        {ALL_SLOTS.map((sl) => {
          const lost = l.lostSlots.includes(sl);
          return (
            <span key={sl} className={`rounded-full border px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider ${lost ? 'border-red-500/60 bg-red-950/40 text-red-300 line-through' : 'border-cyan-200/40 text-cyan-100'}`} title={lost ? 'Lost to a rejection' : 'Graft slot'}>
              {SLOT_LABEL[sl]}
            </span>
          );
        })}
      </div>
      {l.mutations.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {l.mutations.map((id) => (
            <MutationTile key={id} id={id} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Lineage: one Specimen, ten matches, permanent scars and mutations. */
export function LineageScreen({ onBack, onCollection, onFight, report }: { onBack: () => void; onCollection: () => void; onFight: (setup: MatchSetup) => void; report?: MatchReport | null }) {
  const [p, setP] = useState<Progress>(() => loadProgress()!);
  const [heir, setHeir] = useState<string | null>(null);
  const update = (next: Progress) => {
    saveProgress(next);
    setP(next);
  };
  const l = p.lineage;
  const name = activeSave()?.meta.name ?? 'You';
  const problems = deckProblems(p);

  const begin = () => {
    const count = (p.lineagesCompleted ?? 0) + 1;
    update({ ...p, heritage: heir, lineagesCompleted: count, lineage: startLineage(p, `${name}'s Specimen #${count}`, heir) });
    setHeir(null);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 p-3 pb-0">
      <ScreenHeader title="Lineage" sub={`One Specimen · ${LINEAGE_MATCHES} matches · scars are permanent`} onBack={onBack} backLabel="Back to Game Modes" right={<BiomassBadge n={p.biomass} />} />

      {report && (
        <section className={`pop rounded-xl border-2 p-3 ${report.won ? 'border-emerald-400 bg-emerald-950/30' : 'border-red-500/70 bg-red-950/25'}`} aria-live="polite">
          <div className="text-center font-display text-lg font-bold">{report.ended === 'complete' ? 'Lineage complete!' : report.ended === 'dead' ? 'Your Specimen has died' : report.won ? 'Victory' : 'Defeat'}</div>
          {report.reward > 0 && (
            <div className="text-center text-sm text-ink2">
              +<BiomassIcon /> {report.reward} biomass{report.ended === 'complete' ? ` (including the ${LINEAGE_COMPLETE_BONUS} completion bonus)` : ''}
            </div>
          )}
          {report.scars.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-red-200">
              {report.scars.map((sc) => (
                <li key={sc}>✕ {sc}</li>
              ))}
            </ul>
          )}
          {report.won && report.scars.length === 0 && !report.ended && <div className="mt-1 text-center text-xs text-emerald-300">A clean win: no new scars.</div>}
        </section>
      )}

      {!l || l.status !== 'active' ? (
        <section className="lab-panel space-y-3 rounded-xl border border-accent/50 p-4">
          {l && (
            <div className="rounded-lg bg-black/25 p-2.5 text-xs">
              <div className="font-display text-sm font-bold">{l.status === 'complete' ? `${l.name} completed the lineage` : `${l.name} died in match ${l.match}`}</div>
              <div className="text-ink2">
                {l.wins} wins, {l.losses} losses, {l.mutations.length} mutations, ended at {l.maxHp} max HP{l.lostSlots.length ? ` with ${l.lostSlots.length} lost slot(s)` : ''}.
              </div>
            </div>
          )}
          <h2 className="font-display text-lg font-bold">{l ? 'Begin a new lineage' : 'Begin your first lineage'}</h2>
          <ul className="list-disc space-y-1 pl-5 text-xs text-ink2">
            <li>One Specimen plays up to {LINEAGE_MATCHES} matches with your current Game Modes deck, fixed for the whole lineage.</li>
            <li>
              <b className="text-red-300">Scars are permanent:</b> a loss costs 4 max HP, a win at a third of your HP or less costs 2, and every rejected graft kills the slot it was in.
            </li>
            <li>
              <b className="text-fuchsia-300">Every win offers a permanent mutation</b> (choose 1 of 3).
            </li>
            <li>
              It dies at {MAX_LOSSES} losses or below {MIN_MAX_HP} max HP. Each win pays biomass; finishing all {LINEAGE_MATCHES} pays a {LINEAGE_COMPLETE_BONUS} bonus.
            </li>
            <li>When a lineage ends, one of its mutations can be passed down to the next Specimen.</li>
          </ul>
          {l && inheritable(l).length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mute">Pass one mutation down (optional)</div>
              <div className="grid gap-1.5">
                {inheritable(l).map((id) => (
                  <MutationTile key={id} id={id} selected={heir === id} onPick={() => setHeir(heir === id ? null : id)} />
                ))}
              </div>
            </div>
          )}
          {problems.length > 0 && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-950/25 p-2 text-xs text-amber-200">
              Your Game Modes deck isn't ready: {problems[0]}{' '}
              <button onClick={onCollection} className="underline">
                Fix it
              </button>
            </p>
          )}
          <button onClick={begin} disabled={problems.length > 0} className="w-full rounded-xl bg-accent px-4 py-3 font-display font-bold text-black disabled:opacity-40">
            Begin with {FACTION_META[p.deck.faction].name} / {WORLD_FACTION_META[p.deck.worldFaction].name}
          </button>
        </section>
      ) : (
        <>
          <SpecimenSheet p={p} />
          {/* The ten matches. */}
          <section className="lab-panel rounded-xl border border-line p-3" aria-label="Campaign">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-mute">Campaign</div>
            <ol className="flex gap-1">
              {Array.from({ length: LINEAGE_MATCHES }, (_, i) => {
                const h = l.history[i];
                const here = i + 1 === l.match;
                return (
                  <li
                    key={i}
                    className={`flex h-8 flex-1 items-center justify-center rounded-md border font-display text-xs font-bold ${h ? (h.won ? 'border-emerald-500/60 bg-emerald-950/40 text-emerald-300' : 'border-red-500/60 bg-red-950/40 text-red-300') : here ? 'turn-glow border-accent text-accent' : 'border-line text-mute'}`}
                    aria-label={`Match ${i + 1}${h ? (h.won ? ': won' : ': lost') : here ? ': next' : ''}`}
                  >
                    {h ? (h.won ? '✓' : '✕') : i + 1}
                  </li>
                );
              })}
            </ol>
          </section>
          {l.offer && (
            <section className="lab-panel space-y-2 rounded-xl border-2 border-fuchsia-400/60 p-3" aria-label="Choose a mutation">
              <div className="font-display text-base font-bold text-fuchsia-200">Choose a permanent mutation</div>
              <div className="grid gap-1.5">
                {l.offer.map((id) => (
                  <MutationTile key={id} id={id} onPick={() => update({ ...p, lineage: chooseMutation(l, id) })} />
                ))}
              </div>
            </section>
          )}
          {l.history.some((h) => h.scars.length) && (
            <details className="rounded-xl border border-line p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-ink2">Scar record</summary>
              <ul className="mt-2 space-y-1">
                {l.history.flatMap((h) =>
                  h.scars.map((sc, k) => (
                    <li key={`${h.match}-${k}`} className="text-red-200">
                      <span className="text-mute">Match {h.match}: </span>
                      {sc}
                    </li>
                  )),
                )}
              </ul>
            </details>
          )}
        </>
      )}

      {l && l.status === 'active' && (
        <div className="sticky bottom-0 z-10 -mx-3 mt-auto flex gap-2 border-t border-line bg-bg/90 px-3 pt-2.5 backdrop-blur" style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
          <button onClick={() => onFight(lineageMatch(l, name))} disabled={!!l.offer} className="flex-1 rounded-xl bg-accent px-4 py-3 font-display font-bold text-black disabled:opacity-40">
            {l.offer ? 'Choose a mutation first' : `Match ${l.match} of ${LINEAGE_MATCHES}`}
          </button>
        </div>
      )}
    </div>
  );
}
