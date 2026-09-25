import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { evolutionBoosts, evolutionDefs, evolutionProgress } from '../../engine';
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
  // The parent hands a fresh onDismiss every render (and the match re-renders every timer tick), so keep it
  // in a ref: otherwise the 3 s auto-dismiss restarts on each render and the banner never leaves on its own.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const t = setTimeout(() => dismissRef.current(), 3500);
    return () => clearTimeout(t);
  }, []);
  const p = state.players[event.player];
  const def = evolutionDefs(state, p).find((d) => d.id === event.id);
  const boosts = evolutionBoosts(state, p, event.id);
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

/**
 * Both forms with their condition, live progress and boosts: opened by tapping the evolution block on the
 * phone board, where there is no room (and no hover) for the condition text.
 */
export function EvolutionSheet({ state, player, onClose }: { state: GameState; player: PlayerId; onClose: () => void }) {
  const p = state.players[player];
  const progress = evolutionProgress(state, player);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 phone:items-center" onClick={onClose}>
      <div className="pop w-full max-w-md rounded-t-2xl border border-line bg-bg p-3 phone:max-h-[92dvh] phone:overflow-y-auto phone:rounded-2xl" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${p.name}'s evolutions`}>
        <div className="mb-2 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLAYER_COLORS[player] }} />
          <span className="font-display text-base font-bold">{p.name}'s evolutions</span>
          <button onClick={onClose} className="ml-auto rounded-md border border-line px-2.5 py-1 text-xs text-ink2">
            Close
          </button>
        </div>
        <p className="mb-2 text-[11px] text-mute">Meet a form's condition to be offered it at the Strain check. Evolving is permanent and one per match.</p>
        <ul className="space-y-2">
          {evolutionDefs(state, p).map((d) => {
            const pr = progress.find((x) => x.id === d.id)!;
            const locked = p.evolution !== null && !pr.active;
            const pct = Math.min(100, (pr.current / pr.target) * 100);
            return (
              <li key={d.id} className={`rounded-xl border p-2.5 ${pr.active ? 'border-accent bg-accent/10' : 'border-line'} ${locked ? 'opacity-50' : ''}`}>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-sm font-bold" style={{ color: FACTION_META[p.faction].color }}>
                    {d.name}
                  </span>
                  <span className={`ml-auto text-[11px] font-semibold ${pr.active ? 'text-accent' : pr.met ? 'text-emerald-300' : 'text-mute'}`}>{pr.active ? 'EVOLVED' : locked ? 'locked' : pr.met ? 'condition met' : `${Math.min(pr.current, pr.target)}/${pr.target}`}</span>
                </div>
                <div className="mt-1 text-[12px] text-ink">
                  <span className="text-mute">Condition: </span>
                  {pr.target} {pr.label}
                </div>
                {!pr.active && (
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-black/50">
                    <div className={`h-full ${pr.met ? 'bg-accent evo-ready' : 'bg-violet-400'}`} style={{ width: `${pct}%` }} />
                  </div>
                )}
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-ink2">
                  {evolutionBoosts(state, p, d.id).map((b) => (
                    <li key={b}>
                      <span className="text-accent">▲</span> {b}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
