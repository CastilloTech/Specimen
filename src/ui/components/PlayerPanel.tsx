import { computeStats, evoNum, findNode } from '../../engine';
import type { GameState, PlayerId, Stance } from '../../engine';
import { FACTION_META, STANCE_META, WORLD_FACTION_META } from '../meta';
import { EvolvedBadge } from './Evolution';
import { EnergyPips, EvolutionBars, HpBar, StrainMeter } from './Meters';

export function LoadoutChips({ loadout, stances = [] }: { loadout: string[]; stances?: Stance[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {stances.length > 0 && (
        <span className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-ink2" title="Recent stances, oldest to newest (public once revealed)">
          {stances.map((s) => STANCE_META[s].glyph).join(' ')}
        </span>
      )}
      {loadout.map((id) => {
        const n = findNode(id);
        return (
          <span key={id} title={n?.text} className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-ink2">
            {n?.name ?? id}
          </span>
        );
      })}
    </div>
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
            {p.bleed > 0 && (
              <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-red-300" title={`Bleeding: 1 damage at the start of each of the next ${p.bleed} round(s).`}>
                BLEED {p.bleed}
              </span>
            )}
            {p.numb > 0 && (
              <span className="rounded bg-violet-950/60 px-1.5 py-0.5 text-violet-300" title={`Numb: Protocols cannot be played for ${p.numb} more round(s).`}>
                NUMB {p.numb}
              </span>
            )}
            {p.fever > 0 && (
              <span className="rounded bg-orange-950/60 px-1.5 py-0.5 text-orange-300" title={`Fever: grafts cost ${state.config.status.feverCostIncrease} more Energy for ${p.fever} more round(s).`}>
                FEVER {p.fever}
              </span>
            )}
          </div>
        </div>
        <div className="col-span-2">
          {p.evolution ? <EvolvedBadge state={state} player={player} /> : <EvolutionBars state={state} player={player} />}
        </div>
        <div className="col-span-2">
          <LoadoutChips loadout={p.loadout} stances={recent} />
        </div>
      </div>
    </section>
  );
}
