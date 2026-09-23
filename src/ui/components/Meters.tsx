import { evolutionProgress, stableMax } from '../../engine';
import type { GameState, PlayerId } from '../../engine';

export function HpBar({ hp, max }: { hp: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const color = pct > 50 ? 'from-emerald-600 to-emerald-400' : pct > 25 ? 'from-amber-600 to-amber-400' : 'from-red-700 to-red-500';
  return (
    <div className="relative h-5 w-full overflow-hidden rounded-md border border-black/60 bg-black/60" role="meter" aria-label="HP" aria-valuenow={hp} aria-valuemin={0} aria-valuemax={max}>
      <div className={`h-full bg-linear-to-r ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0_9%,rgba(0,0,0,0.25)_9%_10%)]" />
      <div className="absolute inset-0 grid place-items-center font-display text-[12px] font-bold tracking-wide text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
        HP {hp} / {max}
      </div>
    </div>
  );
}

/** Segmented Strain meter with zone colors: Stable / Overclocked / Rejection. */
export function StrainMeter({ state, player }: { state: GameState; player: PlayerId }) {
  const p = state.players[player];
  const T = state.config.strain.threshold;
  const sMax = stableMax(state, p);
  const total = T + 3;
  const zoneClass = (i: number) => (i <= sMax ? 'bg-stable' : i <= T ? 'bg-oc' : 'bg-rej');
  const zone = p.strain <= sMax ? 'Stable' : p.strain <= T ? 'Overclocked' : 'REJECTION';
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-ink2">Strain {p.strain}</span>
        <span className={p.strain <= sMax ? 'text-emerald-300' : p.strain <= T ? 'text-amber-300' : 'font-bold text-red-400'}>{zone}</span>
      </div>
      <div className="mt-0.5 flex gap-[2px]" role="meter" aria-label="Strain" aria-valuenow={p.strain} aria-valuemin={0} aria-valuemax={total}>
        {Array.from({ length: total }, (_, k) => k + 1).map((i) => (
          <div key={i} className={`h-3 flex-1 rounded-[2px] ${zoneClass(i)} ${i <= p.strain ? '' : 'opacity-20'}`} title={`${i}`} />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-mute">
        <span>0–{sMax} stable</span>
        <span>
          {sMax + 1}–{T} overclock
        </span>
        <span>{T + 1}+ reject</span>
      </div>
    </div>
  );
}

export function EnergyPips({ energy, round, cap }: { energy: number; round: number; cap: number }) {
  const max = Math.max(Math.min(round, cap), energy);
  return (
    <div className="flex items-center gap-1" title={`Energy ${energy}`}>
      <span className="text-[11px] font-semibold text-ink2">Energy</span>
      <div className="flex gap-[3px]">
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={`h-3 w-3 rounded-full border ${i < energy ? 'border-sky-300 bg-sky-400' : 'border-line bg-transparent'}`} />
        ))}
      </div>
      <span className="text-[11px] font-bold">{energy}</span>
    </div>
  );
}

export function EvolutionBars({ state, player }: { state: GameState; player: PlayerId }) {
  const prog = evolutionProgress(state, player);
  const evolved = state.players[player].evolution;
  return (
    <div className="space-y-1">
      {prog.map((e) => {
        const pct = Math.min(100, (e.current / e.target) * 100);
        const locked = evolved !== null && !e.active;
        return (
          <div key={e.id} className={locked ? 'opacity-40' : ''} title={e.text}>
            <div className="flex justify-between text-[10px]">
              <span className={`font-semibold ${e.active ? 'text-accent' : 'text-ink2'}`}>
                {e.name}
                {e.active && ' — EVOLVED'}
              </span>
              <span className="text-mute">
                {Math.min(e.current, e.target)}/{e.target} {e.label}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-black/50">
              <div className={`h-full ${e.active || e.met ? 'bg-accent' : 'bg-violet-400'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
