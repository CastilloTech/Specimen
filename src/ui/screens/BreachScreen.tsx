import { useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { defaultConfig } from '../../engine';
import type { MatchSetup } from '../../engine';
import { BETWEEN_HEAL_PCT, BETWEEN_VENT, BREACH_WAVES_GOAL, betweenHeal, ESCAPEE_HP, startBreach, waveMatch, wavesSurvived } from '../breach';
import { deckProblems, loadProgress, saveProgress } from '../modes';
import type { Progress } from '../modes';
import { activeSave } from '../storage';
import { BiomassBadge, BiomassIcon } from './GameModes';

const T = defaultConfig.strain.threshold;
const STABLE = Math.floor(T * defaultConfig.strain.stableMaxRatio);
const HP = defaultConfig.specimen.hp;

export interface WaveOutcome {
  wave: number;
  survived: boolean;
  reward: number;
  newBest: boolean;
}

/** Containment Breach: survive as many waves as you can; HP and Strain carry over. */
export function BreachScreen({ onBack, onCollection, onFight, last }: { onBack: () => void; onCollection: () => void; onFight: (setup: MatchSetup) => void; last?: WaveOutcome | null }) {
  const [p, setP] = useState<Progress>(() => loadProgress()!);
  const update = (next: Progress) => {
    saveProgress(next);
    setP(next);
  };
  const run = p.breach;
  const active = !!run && !run.over;
  const problems = deckProblems(p);
  const zone = !run ? '' : run.strain > T ? 'text-red-300' : run.strain > STABLE ? 'text-amber-300' : 'text-emerald-300';

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 p-3 pb-0">
      <ScreenHeader title="Containment Breach" sub={`Best: ${p.breachBest ?? 0} waves survived`} onBack={onBack} backLabel="Back to Game Modes" right={<BiomassBadge n={p.biomass} />} />

      {last && (
        <section className={`pop rounded-xl border-2 p-3 text-center ${last.survived ? 'border-emerald-400 bg-emerald-950/30' : 'border-red-500/70 bg-red-950/25'}`} aria-live="polite">
          <div className="font-display text-lg font-bold">{last.survived ? `Wave ${last.wave} contained` : `Overrun on wave ${last.wave}`}</div>
          <div className="text-sm text-ink2">
            {last.survived ? (
              <>
                +<BiomassIcon /> {last.reward} biomass. You heal {Math.round(BETWEEN_HEAL_PCT * 100)}% of your max HP ({betweenHeal()}) and vent only {BETWEEN_VENT} Strain before the next wave.
              </>
            ) : (
              <>
                Score: <b className="text-ink">{last.wave - 1}</b> wave{last.wave - 1 === 1 ? '' : 's'} survived{last.newBest ? ' — a new best!' : '.'}
              </>
            )}
          </div>
        </section>
      )}

      {/* The breach: an alarm-lit containment status board. */}
      <section className="lab-panel relative overflow-hidden rounded-xl border-2 border-red-500/50 p-4" aria-label="Containment status">
        <div aria-hidden className="hazard hazard-scroll absolute inset-x-0 top-0 h-2 opacity-80" />
        {/* Back from a wave: the alarm sweeps across the panel. */}
        {last && <div aria-hidden className="alarm-sweep pointer-events-none absolute inset-0" />}
        <div className="mt-1 flex items-baseline justify-between">
          <span className="lab-label text-red-300">{active ? 'Breach in progress' : 'Containment holding'}</span>
          {active && <span className="font-display text-sm text-ink2">Survived: {wavesSurvived(run!)}</span>}
        </div>
        <div className="mt-1 text-center font-display text-5xl font-extrabold tracking-wider text-red-300 drop-shadow-[0_0_14px_rgba(248,113,113,0.5)]">{active ? (
            <>
              WAVE <span key={run!.wave} className="wave-roll">{run!.wave}</span>
            </>
          ) : (
            'STANDBY'
          )}</div>
        {active && (
          <div className="mt-3 space-y-2">
            <div>
              <div className="mb-0.5 flex justify-between text-[11px]">
                <span className="text-ink2">Your HP (carries over)</span>
                <span className="font-display font-bold">
                  {run!.hp}/{HP}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded bg-black/50">
                <div className={`bar-fill h-full ${run!.hp > HP / 2 ? 'bg-emerald-500' : run!.hp > HP / 4 ? 'bg-amber-500' : 'bg-red-600'}`} style={{ width: `${(run!.hp / HP) * 100}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-0.5 flex justify-between text-[11px]">
                <span className="text-ink2">Strain (carries over)</span>
                <span className={`font-display font-bold ${zone}`}>
                  {run!.strain}/{T}
                </span>
              </div>
              <div className="flex gap-[2px]">
                {Array.from({ length: T + 2 }, (_, k) => k + 1).map((i) => (
                  <div key={i} className={`h-3 flex-1 rounded-[2px] ${i <= STABLE ? 'bg-stable' : i <= T ? 'bg-oc' : 'bg-rej'} ${i <= run!.strain ? 'grid-pop' : 'opacity-20'}`} style={{ ['--i' as string]: i } as React.CSSProperties} />
                ))}
              </div>
            </div>
            <div className="text-center text-xs text-ink2">
              Earned this run: <BiomassIcon /> {run!.earned}
            </div>
          </div>
        )}
      </section>

      {!active && (
        <section className="lab-panel space-y-2 rounded-xl border border-line p-3 text-xs text-ink2">
          <div className="font-display text-sm font-bold text-ink">How a breach works</div>
          <ul className="list-disc space-y-1 pl-5">
            <li>Escaped Specimens attack in endless waves: {ESCAPEE_HP} HP each, arriving with 2–3 grafts already attached and no other cards. Their grafts get stronger as the waves climb. Can you hold out to wave {BREACH_WAVES_GOAL}?</li>
            <li>
              <b className="text-amber-200">Your HP and Strain carry over.</b> After each wave you heal {Math.round(BETWEEN_HEAL_PCT * 100)}% of your max HP but vent only {BETWEEN_VENT} Strain, so manage Strain across the whole run.
            </li>
            <li>The run ends on the first wave you don't win. Your score is the number of waves survived; every wave survived pays biomass.</li>
            <li>You fight with your Game Modes deck.</li>
          </ul>
        </section>
      )}

      {problems.length > 0 && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-950/25 p-2 text-xs text-amber-200">
          Your Game Modes deck isn't ready: {problems[0]}{' '}
          <button onClick={onCollection} className="underline">
            Fix it
          </button>
        </p>
      )}

      <div className="sticky bottom-0 z-10 -mx-3 mt-auto flex gap-2 border-t border-line bg-bg/90 px-3 pt-2.5 backdrop-blur" style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
        {active ? (
          <button onClick={() => onFight(waveMatch(run!, activeSave()?.meta.name ?? 'You'))} data-primary className="flex-1 rounded-xl bg-red-500 px-4 py-3 font-display font-bold text-black">
            Hold the line: wave {run!.wave}
          </button>
        ) : (
          <button onClick={() => update({ ...p, breach: startBreach(p.deck) })} disabled={problems.length > 0} className="flex-1 rounded-xl bg-red-500 px-4 py-3 font-display font-bold text-black disabled:opacity-40">
            {run ? 'Start a new breach' : 'Start the breach'}
          </button>
        )}
      </div>
    </div>
  );
}
