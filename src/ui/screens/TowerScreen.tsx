import { useMemo, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import type { MatchSetup } from '../../engine';
import { deckProblems, floorMatch, loadProgress, replayableUpTo, TOWER_FLOORS } from '../modes';
import { activeSave } from '../storage';
import { BiomassBadge, BiomassIcon } from './GameModes';

export interface TowerOutcome {
  floor: number;
  won: boolean;
  reward: number;
  cleared: boolean;
  replay?: boolean;
  /** The floor just cleared was a checkpoint (revealed only after the fact). */
  checkpoint?: boolean;
}

const WINDOW_ABOVE = 2;
const WINDOW_BELOW = 2;

/** One storey of the tower: a stone block with its number and reward, lit windows once cleared. */
function Storey({ floor, state, selected, onClick }: { floor: number; state: 'cleared' | 'current' | 'locked'; selected: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-pressed={selected}
      aria-label={`Floor ${floor}${state === 'cleared' ? ', cleared: replay it' : state === 'current' ? ', next floor' : ', sealed'}`}
      className={`relative flex h-16 w-full items-center gap-3 border-x-4 border-t-2 px-3 text-left transition phone:h-10 ${
        state === 'current'
          ? 'border-accent/70 bg-[linear-gradient(90deg,#1c2b25,#23372f,#1c2b25)]'
          : state === 'cleared'
            ? 'border-stone-600/70 bg-[linear-gradient(90deg,#1a1f1d,#222a26,#1a1f1d)] hover:brightness-125'
            : 'border-stone-700/60 bg-[linear-gradient(90deg,#121614,#171c1a,#121614)]'
      } ${selected ? 'ring-2 ring-inset ring-accent' : ''}`}
    >
      {/* Masonry lines. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent_0_15px,rgba(0,0,0,0.35)_15px_16px),repeating-linear-gradient(90deg,transparent_0_31px,rgba(0,0,0,0.25)_31px_32px)] opacity-60" />
      {/* Arched windows: lit on cleared floors, glowing on the next one, dark when sealed. */}
      <span aria-hidden className="relative flex gap-1.5">
        {[0, 1].map((k) => (
          <span key={k} className={`h-7 w-3.5 rounded-t-full border phone:h-5 phone:w-2.5 ${state === 'cleared' ? 'border-amber-300/50 bg-amber-300/60 shadow-[0_0_8px_rgba(252,211,77,0.5)]' : state === 'current' ? 'border-accent/60 bg-accent/30' : 'border-stone-600/60 bg-black/60'}`} />
        ))}
      </span>
      <span className="relative min-w-0 flex-1">
        <span className={`block font-display text-lg font-bold leading-none phone:text-base ${state === 'locked' ? 'text-mute' : state === 'current' ? 'text-accent' : 'text-ink'}`}>Floor {floor}</span>
        <span className="mt-0.5 block text-[11px] text-ink2">{state === 'cleared' ? 'Cleared · replay' : state === 'current' ? 'Next' : 'Sealed'}</span>
      </span>
      {state === 'current' && <span aria-hidden className="turn-glow pointer-events-none absolute inset-0" />}
    </button>
  );
}

/** The Tower: a window of storeys around where you are. What waits on each floor is a surprise. */
export function TowerScreen({ onBack, onCollection, onFight, last }: { onBack: () => void; onCollection: () => void; onFight: (setup: MatchSetup, floor: number, replay: boolean) => void; last?: TowerOutcome | null }) {
  const [p] = useState(() => loadProgress()!); // read once: nothing on this screen changes it
  const t = p.tower;
  const maxReplay = replayableUpTo(t);
  const [pick, setPick] = useState(t.floor); // the floor to fight: the next one, or a cleared one to replay
  const replay = pick < t.floor;
  const setup = useMemo(() => floorMatch(pick, t.runSeed, p.deck, activeSave()?.meta.name ?? 'You'), [pick, t.runSeed, p.deck]);
  const problems = deckProblems(p);
  const hi = Math.min(TOWER_FLOORS, t.floor + WINDOW_ABOVE);
  const lo = Math.max(1, t.floor - WINDOW_BELOW);
  const floors = Array.from({ length: hi - lo + 1 }, (_, i) => hi - i);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 p-3 pb-0">
      <ScreenHeader title="The Tower" sub={`Best floor ${t.best} · clears ${t.clears}`} onBack={onBack} backLabel="Back to Game Modes" right={<BiomassBadge n={p.biomass} />} />

      {last && (
        <section className={`pop rounded-xl border-2 p-3 text-center ${last.won ? 'border-emerald-400 bg-emerald-950/30' : 'border-red-500/70 bg-red-950/25'}`} aria-live="polite">
          <div className="font-display text-lg font-bold">{last.cleared ? 'Tower cleared!' : last.won ? `Floor ${last.floor} ${last.replay ? 'replayed' : 'cleared'}` : `Defeated on floor ${last.floor}`}</div>
          <div className="text-sm text-ink2">
            {last.won ? (
              <>
                +<BiomassIcon /> {last.reward} biomass
                {last.cleared ? '. A new run starts from floor 1.' : last.checkpoint ? '. Checkpoint reached: a loss now only sends you back here.' : ''}
              </>
            ) : last.replay ? (
              'Losing a replay costs nothing. Your climb is unchanged.'
            ) : (
              `Back to floor ${t.floor}.`
            )}
          </div>
        </section>
      )}

      {/* The tower: a spire (or the unknown above), a window of storeys, and the ground (or more floors below). */}
      <section className="flex flex-col items-center" aria-label="Tower">
        {hi === TOWER_FLOORS ? (
          <svg viewBox="0 0 200 70" className="w-3/4 phone:w-1/3" aria-hidden>
            <path d="M100 2 L150 68 H50 Z" fill="#1d2422" stroke="#a78bfa" strokeOpacity="0.5" strokeWidth="2" />
            <circle cx="100" cy="44" r="7" fill="#e879f9" opacity="0.6" />
          </svg>
        ) : (
          <div className="flex h-12 w-[88%] items-end justify-center phone:h-6 border-x-4 border-stone-700/40 bg-[linear-gradient(0deg,#121614,transparent)] pb-1.5 text-[11px] tracking-[0.3em] text-mute">
            {TOWER_FLOORS - hi} MORE ABOVE
          </div>
        )}
        <div className="w-[88%] overflow-hidden rounded-sm shadow-[0_0_40px_-10px_rgba(123,224,176,0.25)]">
          {floors.map((f) => {
            const state = f < t.floor ? 'cleared' : f === t.floor ? 'current' : 'locked';
            return <Storey key={f} floor={f} state={state} selected={pick === f} onClick={state === 'locked' ? undefined : () => setPick(f)} />;
          })}
        </div>
        {lo === 1 ? (
          <div aria-hidden className="h-4 w-full rounded-sm bg-[linear-gradient(180deg,#2a2f2c,#121614)]" />
        ) : (
          <div className="flex h-9 w-[88%] items-start justify-center phone:h-6 border-x-4 border-stone-700/40 bg-[linear-gradient(180deg,#121614,transparent)] pt-1.5 text-[11px] tracking-[0.3em] text-mute">{lo - 1} BELOW</div>
        )}
      </section>

      {/* Replay any cleared floor, including ones out of view. */}
      {maxReplay >= 1 && (
        <section className="lab-panel flex items-center gap-2 rounded-xl border border-line p-2.5 text-sm">
          <span className="text-xs text-ink2">
            Replay a cleared floor
            <span className="block text-[10px] text-mute">pays less than the first clear; losing costs nothing</span>
          </span>
          <button onClick={() => setPick((v) => Math.max(1, Math.min(v, maxReplay + 1) - 1))} disabled={pick <= 1} className="ml-auto h-8 w-8 rounded-md bg-panel2 font-bold disabled:opacity-30" aria-label="Lower floor">
            −
          </button>
          <span className="w-10 text-center font-display font-bold">{replay ? pick : '—'}</span>
          <button onClick={() => setPick((v) => (v >= maxReplay ? t.floor : v + 1))} disabled={!replay} className="h-8 w-8 rounded-md bg-panel2 font-bold disabled:opacity-30" aria-label="Higher floor">
            +
          </button>
        </section>
      )}

      {problems.length > 0 && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-950/25 p-2 text-xs text-amber-200">
          Your deck isn't ready: {problems[0]}{' '}
          <button onClick={onCollection} className="underline">
            Fix it
          </button>
        </p>
      )}

      <div className="sticky bottom-0 z-10 -mx-3 mt-auto flex gap-2 border-t border-line bg-bg/90 px-3 pt-2.5 backdrop-blur" style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
        <button onClick={onCollection} className="rounded-xl bg-panel2 px-4 py-3 text-sm font-semibold">
          Deck
        </button>
        <button onClick={() => onFight(setup, pick, replay)} disabled={problems.length > 0} className="flex-1 rounded-xl bg-accent px-4 py-3 font-display font-bold text-black disabled:opacity-40">
          {replay ? `Replay floor ${pick}` : `Climb to floor ${pick}`}
        </button>
      </div>
    </div>
  );
}
