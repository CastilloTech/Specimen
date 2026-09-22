import { useEffect, useRef, useState } from 'react';
import { evolutionBoosts, evolutionDefs, evolutionNotes, evolutionProgress } from '../../engine';
import type { GameState, PlayerId } from '../../engine';
import { FACTION_META, PLAYER_COLORS } from '../meta';

export interface EvoEvent {
  key: string;
  player: PlayerId;
  id: string;
  round: number;
}

/** Emits an event whenever either Specimen evolves, so the screen can announce it to both players. */
export function useEvolutionEvents(state: GameState): [EvoEvent[], (key: string) => void] {
  const prev = useRef<(string | null)[]>(state.players.map((p) => p.evolution));
  const [events, setEvents] = useState<EvoEvent[]>([]);
  const a = state.players[0].evolution;
  const b = state.players[1].evolution;
  useEffect(() => {
    const now = [a, b];
    const fresh: EvoEvent[] = [];
    now.forEach((id, i) => {
      if (id && id !== prev.current[i]) fresh.push({ key: `${i}:${id}:${state.round}`, player: i as PlayerId, id, round: state.round });
    });
    prev.current = now;
    if (fresh.length) setEvents((e) => [...e, ...fresh]);
  }, [a, b, state.round]);
  return [events, (key) => setEvents((e) => e.filter((x) => x.key !== key))];
}

/** Big, obvious announcement: who evolved, into what, and exactly what it gives them. */
export function EvolutionBanners({ state, events, me, onDismiss }: { state: GameState; events: EvoEvent[]; me: PlayerId; onDismiss: (key: string) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-40 flex flex-col items-center gap-2 px-2" aria-live="polite">
      {events.slice(-2).map((e) => (
        <Banner key={e.key} state={state} event={e} me={me} onDismiss={() => onDismiss(e.key)} />
      ))}
    </div>
  );
}

function Banner({ state, event, me, onDismiss }: { state: GameState; event: EvoEvent; me: PlayerId; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 14000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  const p = state.players[event.player];
  const def = evolutionDefs(state, p).find((d) => d.id === event.id);
  const boosts = evolutionBoosts(state, p, event.id);
  const notes = evolutionNotes(p);
  const color = FACTION_META[p.faction].color;
  const who = event.player === me ? 'YOU EVOLVED' : `${p.name.toUpperCase()} EVOLVED`;
  return (
    <div className="evo-banner pointer-events-none w-full max-w-md rounded-2xl border-2 bg-panel p-3 shadow-2xl" style={{ borderColor: color }} role="status">
      <div className="flex items-start gap-2">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: PLAYER_COLORS[event.player] }} />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-mute">
            {who} · round {event.round}
          </div>
          <div className="text-2xl font-extrabold leading-tight" style={{ color }}>
            {def?.name ?? event.id}
          </div>
          {def && <div className="text-[11px] text-ink2">Condition met: {def.condition.label}.</div>}
        </div>
        <button onClick={onDismiss} className="pointer-events-auto rounded-md border border-line px-2 py-0.5 text-xs text-ink2 hover:border-mute" aria-label="Dismiss">
          ✕
        </button>
      </div>
      {boosts.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-lg bg-black/30 p-2 text-xs">
          {boosts.map((b) => (
            <li key={b} className="flex gap-1.5">
              <span className="text-accent">▲</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && <div className="mt-1.5 space-y-0.5 text-[10px] text-mute">{notes.map((n) => <div key={n}>{n}</div>)}</div>}
    </div>
  );
}

/** Persistent line on a player's panel once they have evolved: the form and what it gives. */
export function EvolvedBadge({ state, player }: { state: GameState; player: PlayerId }) {
  const p = state.players[player];
  if (!p.evolution) return null;
  const def = evolutionDefs(state, p).find((d) => d.id === p.evolution);
  const boosts = evolutionBoosts(state, p, p.evolution);
  return (
    <div className="evo-glow rounded-lg border border-accent/60 bg-accent/10 px-2 py-1 text-[11px] leading-snug" title={def?.text}>
      <span className="font-bold text-accent">★ {def?.name ?? p.evolution}</span>
      <span className="text-ink2"> · {boosts.join(' · ')}</span>
    </div>
  );
}

/** Both forms a Specimen can take, with their conditions and boosts (used before the match and on the choose prompt). */
export function FormList({ state, player, only }: { state: GameState; player: PlayerId; only?: string[] }) {
  const p = state.players[player];
  const progress = evolutionProgress(state, player);
  return (
    <ul className="space-y-1.5">
      {evolutionDefs(state, p)
        .filter((d) => !only || only.includes(d.id))
        .map((d) => {
          const pr = progress.find((x) => x.id === d.id);
          const boosts = evolutionBoosts(state, p, d.id);
          return (
            <li key={d.id} className="rounded-lg bg-black/25 p-1.5 text-xs">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-bold text-accent">{d.name}</span>
                {pr && (
                  <span className="text-[10px] text-mute">
                    needs {pr.target} · {pr.label}
                  </span>
                )}
              </div>
              <div className="text-ink2">{boosts.join(' · ')}</div>
            </li>
          );
        })}
    </ul>
  );
}
