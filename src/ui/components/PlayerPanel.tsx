import { computeStats, evoNum, findNode } from '../../engine';
import type { GameState, PlayerId, Stance } from '../../engine';
import { FACTION_META, STANCE_META } from '../meta';
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
  const st = computeStats(state, p);
  const formAtk = evoNum(state, p, 'attack');
  const formArm = evoNum(state, p, 'armor');
  const recent = p.stanceHistory.slice(-4);
  return (
    <section className={`rounded-xl border bg-panel p-2.5 ${active ? 'border-accent/70' : 'border-line'}`} aria-label={`${p.name} status`}>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-sm font-bold">{p.name}</span>
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: `${fm.color}33`, color: fm.color }}>
          {fm.name}
          {p.evolution && ' · evolved'}
        </span>
        {p.isBot && <span className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-mute">bot</span>}
        <span className="ml-auto text-[10px] text-mute">
          hand {p.hand.length} · deck {p.deck.length}
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div className="col-span-2">
          <HpBar hp={p.hp} max={state.config.specimen.hp} />
        </div>
        <StrainMeter state={state} player={player} />
        <div className="flex flex-col justify-between">
          <EnergyPips energy={p.energy} round={state.round} cap={state.config.energy.cap} />
          <div className="flex gap-2 text-[11px] font-bold">
            <span className="rounded bg-red-900/50 px-1.5 py-0.5 text-red-200" title={formAtk ? `Includes +${formAtk} from your evolved form` : undefined}>
              ATK {st.attack}
              {formAtk > 0 && <span className="text-accent"> ▲</span>}
            </span>
            <span className="rounded bg-sky-900/50 px-1.5 py-0.5 text-sky-200" title={formArm ? `Includes +${formArm} from your evolved form` : undefined}>
              ARM {st.armor}
              {formArm > 0 && <span className="text-accent"> ▲</span>}
            </span>
            {p.hold && <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-amber-200">HOLD</span>}
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
