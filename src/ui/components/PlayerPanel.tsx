import { computeStats, condOk, evolutionProgress, evoNum, findNode, stableMax } from '../../engine';
import type { GameState, PlayerId, Stance } from '../../engine';
import { FACTION_META, STANCE_META, WORLD_FACTION_META } from '../meta';
import { EvolvedBadge } from './Evolution';
import { EnergyPips, EvolutionBars, HpBar, HpFlash, HpGhost, StrainMeter } from './Meters';
import { STATUS_META, StatusIcon, statusCount } from './StatusFx';
import { StrainDelta, strainSegFx, useChange } from './StrainFx';

/**
 * A player's picked Chip nodes. Given the match (`state` + `player`), nodes with a condition show whether it
 * currently holds (◆ lit / ◇ idle) and flash when they switch on.
 */
export function LoadoutChips({ loadout, stances = [], state, player }: { loadout: string[]; stances?: Stance[]; state?: GameState; player?: PlayerId }) {
  return (
    <div className="flex flex-wrap gap-1">
      {stances.length > 0 && (
        <span className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-ink2" title="Recent stances, oldest to newest (public once revealed)">
          {stances.map((s) => STANCE_META[s].glyph).join(' ')}
        </span>
      )}
      {loadout.map((id) => {
        const n = findNode(id);
        const gated = !!n?.cond && !!state && player !== undefined;
        const on = gated && condOk(state!, state!.players[player!], n!.cond);
        return (
          <span
            key={`${id}:${on}`}
            title={gated ? `${n!.text} (${on ? 'active now' : 'condition not met right now'})` : n?.text}
            className={`rounded border px-1.5 py-0.5 text-[10px] ${on ? 'node-on border-accent/70 bg-accent/15 text-accent' : 'border-transparent bg-black/40 text-ink2'}`}
          >
            {gated && <span className={on ? '' : 'text-mute'}>{on ? '◆ ' : '◇ '}</span>}
            {n?.name ?? id}
          </span>
        );
      })}
    </div>
  );
}

/** Phone landscape: the same information squeezed into a narrow column beside the tanks. */
export function PlayerPanelCompact({ state, player, color, active }: { state: GameState; player: PlayerId; color: string; active: boolean }) {
  const p = state.players[player];
  const fm = FACTION_META[p.faction];
  const wfm = WORLD_FACTION_META[p.worldFaction];
  const st = computeStats(state, p);
  const T = state.config.strain.threshold;
  const sMax = stableMax(state, p);
  const zone = p.strain <= sMax ? 'text-emerald-300' : p.strain <= T ? 'text-amber-300' : 'text-red-400';
  const prog = evolutionProgress(state, player);
  const hpPct = Math.max(0, Math.min(100, (p.hp / state.config.specimen.hp) * 100));
  const chg = useChange(p.strain);
  const hpChg = useChange(p.hp, 900);
  const enChg = useChange(p.energy);
  return (
    <section className={`lab-panel flex h-full min-h-0 min-w-0 flex-col gap-1 overflow-hidden rounded-lg border p-1.5 ${active ? 'turn-glow border-accent/80' : 'border-line'}`} style={{ borderTop: `2px solid ${color}` }} aria-label={`${p.name} status`}>
      <div className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 flex-1 truncate font-display text-[12px] font-bold leading-none" title={p.name}>
          {p.name}
        </span>
        <span className="shrink-0 text-[9px] text-mute">✋{p.hand.length}</span>
      </div>
      <div className="flex min-w-0 gap-1 text-[8.5px] font-semibold leading-none">
        <span className="truncate" style={{ color: fm.color }}>
          {fm.name}
          {p.evolution ? '★' : ''}
        </span>
        <span className="truncate" style={{ color: wfm.color }}>
          {wfm.name}
        </span>
      </div>
      <div className="relative h-4 overflow-hidden rounded border border-black/60 bg-black/60" role="meter" aria-label="HP" aria-valuenow={p.hp}>
        <HpGhost pct={hpPct} />
        <div className={`relative h-full ${hpPct > 50 ? 'bg-emerald-500' : hpPct > 25 ? 'bg-amber-500' : 'bg-red-600'} transition-all duration-300`} style={{ width: `${hpPct}%` }} />
        <HpFlash chg={hpChg} />
        <span className="absolute inset-0 grid place-items-center font-display text-[10px] font-bold text-white drop-shadow">
          {p.hp}/{state.config.specimen.hp}
        </span>
      </div>
      <div>
        <div className="flex justify-between text-[9px] leading-none">
          <span className="text-ink2">Strain</span>
          <span className={`relative font-bold ${zone}`}>
            <StrainDelta chg={chg} side="left" />
            {p.strain}/{T}
          </span>
        </div>
        <div className="mt-0.5 flex gap-px" aria-label="Strain" role="meter" aria-valuenow={p.strain}>
          {Array.from({ length: T + 2 }, (_, k) => k + 1).map((i) => {
            const fx = strainSegFx(state, player, i, chg);
            return <div key={fx.key} className={`h-1.5 flex-1 rounded-[1px] ${i <= sMax ? 'bg-stable' : i <= T ? 'bg-oc' : 'bg-rej'} ${i <= p.strain ? '' : 'opacity-20'} ${fx.className}`} style={fx.style} />;
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 text-[9px] font-bold leading-none">
        <span key={enChg?.key} className={`rounded bg-sky-900/60 px-1 py-0.5 text-sky-100 ${enChg ? 'energy-bump' : ''}`} title="Energy">
          ◉{p.energy}
        </span>
        <span className="rounded bg-red-900/60 px-1 py-0.5 text-red-100" title="Attack">
          ⚔{st.attack}
        </span>
        <span className="rounded bg-sky-900/60 px-1 py-0.5 text-sky-100" title="Armor">
          ⛨{st.armor}
        </span>
        {p.hold && <span className="rounded bg-amber-900/60 px-1 py-0.5 text-amber-200">HOLD</span>}
        {(['bleed', 'numb', 'fever'] as const)
          .filter((k) => p[k] > 0)
          .map((k) => (
            <span key={k} className="flex items-center gap-0.5 rounded border px-1 py-0.5 text-white" style={{ background: `${STATUS_META[k].color}55`, borderColor: STATUS_META[k].color }} title={`${STATUS_META[k].name}: ${STATUS_META[k].text(p[k], state, p)}`}>
              <StatusIcon kind={k} className="h-2.5 w-2.5" />
              {statusCount(k, p)}
            </span>
          ))}
      </div>
      <div className="mt-auto space-y-0.5">
        {prog.map((e) => {
          const locked = p.evolution !== null && !e.active;
          if (locked) return null;
          return (
            <div key={e.id} title={`${e.name}: ${e.text}`}>
              <div className="flex justify-between gap-1 text-[8.5px] leading-none">
                <span className={`truncate font-semibold ${e.active ? 'text-accent' : 'text-ink2'}`}>{e.name}</span>
                <span className="shrink-0 text-mute">{e.active ? 'evolved' : `${Math.min(e.current, e.target)}/${e.target}`}</span>
              </div>
              {!e.active && (
                <div className="mt-px h-1 overflow-hidden rounded bg-black/50">
                  <div className={`h-full transition-[width] duration-700 ease-out ${e.met ? 'bg-accent evo-ready' : 'bg-violet-400'}`} style={{ width: `${Math.min(100, (e.current / e.target) * 100)}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function PlayerPanel({ state, player, color, active }: { state: GameState; player: PlayerId; color: string; active: boolean }) {
  const p = state.players[player];
  const fm = FACTION_META[p.faction];
  const wfm = WORLD_FACTION_META[p.worldFaction];
  const st = computeStats(state, p);
  const formAtk = evoNum(state, p, 'attack');
  const formArm = evoNum(state, p, 'armor');
  const recent = p.stanceHistory.slice(-4);
  return (
    <section className={`lab-panel rounded-xl border p-2.5 ${active ? 'turn-glow border-accent/80' : 'border-line'}`} style={{ borderLeft: `3px solid ${color}` }} aria-label={`${p.name} status`}>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="min-w-0 flex-1 truncate font-display text-base font-bold leading-none" title={p.name}>
          {p.name}
        </span>
        {active && <span className="rounded bg-accent px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-black">acting</span>}
        {p.isBot && <span className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-mute">bot</span>}
        <span className="shrink-0 text-[10px] text-mute" title={`${p.hand.length} cards in hand, ${p.deck.length} left in deck`}>
          ✋{p.hand.length} · ▤{p.deck.length}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="rounded px-1.5 py-0.5 font-display text-[10px] font-semibold" style={{ background: `${fm.color}2e`, color: fm.color }} title={fm.tagline}>
          {fm.name}
          {p.evolution && ' · evolved'}
        </span>
        <span className="rounded px-1.5 py-0.5 font-display text-[10px] font-semibold" style={{ background: `${wfm.color}2e`, color: wfm.color }} title={wfm.tagline}>
          {wfm.name}
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div className="col-span-2">
          <HpBar hp={p.hp} max={state.config.specimen.hp} />
        </div>
        <StrainMeter state={state} player={player} />
        <div className="flex flex-col justify-between">
          <EnergyPips energy={p.energy} round={state.round} cap={state.config.energy.cap} />
          <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
            <span className="rounded bg-red-900/50 px-1.5 py-0.5 text-red-200" title={formAtk ? `Includes +${formAtk} from your evolved form` : undefined}>
              ATK {st.attack}
              {formAtk > 0 && <span className="text-accent"> ▲</span>}
            </span>
            <span className="rounded bg-sky-900/50 px-1.5 py-0.5 text-sky-200" title={formArm ? `Includes +${formArm} from your evolved form` : undefined}>
              ARM {st.armor}
              {formArm > 0 && <span className="text-accent"> ▲</span>}
            </span>
            {p.hold && (
              <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-amber-200" title="No Clash damage this round; armor and Strain vent already applied above.">
                HOLD
              </span>
            )}
            {(['bleed', 'numb', 'fever'] as const)
              .filter((k) => p[k] > 0)
              .map((k) => (
                <span
                  key={k}
                  className="status-badge flex items-center gap-1 rounded border px-1.5 py-0.5 text-white"
                  style={{ background: `${STATUS_META[k].color}55`, borderColor: STATUS_META[k].color }}
                  title={`${STATUS_META[k].name}: ${STATUS_META[k].text(p[k], state, p)}`}
                >
                  <StatusIcon kind={k} />
                  {STATUS_META[k].name.toUpperCase()} {statusCount(k, p)}
                </span>
              ))}
          </div>
        </div>
        <div className="col-span-2">
          {p.evolution ? <EvolvedBadge state={state} player={player} /> : <EvolutionBars state={state} player={player} />}
        </div>
        <div className="col-span-2">
          <LoadoutChips loadout={p.loadout} stances={recent} state={state} player={player} />
        </div>
      </div>
    </section>
  );
}
