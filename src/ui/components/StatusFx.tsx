import { useEffect, useRef, useState } from 'react';
import type { GameState, PlayerId } from '../../engine';

// Status effects made visible: a persistent aura on the afflicted Specimen's tank while a status lasts,
// icon badges with rounds left, and a short animated callout when a status lands, ticks, is purged or wears off.

export type StatusKind = 'bleed' | 'numb' | 'fever';
export const STATUS_META: Record<StatusKind, { name: string; color: string; verb: string; text: (n: number, s: GameState) => string }> = {
  bleed: { name: 'Bleed', color: '#ef4444', verb: 'BLEEDING', text: (n, s) => `${s.config.status.bleedDamage} damage at the start of each round, ${n} more round(s).` },
  numb: { name: 'Numb', color: '#a78bfa', verb: 'NUMBED', text: (n) => `Can't play Protocols for ${n} more round(s).` },
  fever: { name: 'Fever', color: '#fb923c', verb: 'FEVER', text: (n, s) => `Grafts cost ${s.config.status.feverCostIncrease} more Energy for ${n} more round(s).` },
};

export function StatusIcon({ kind, className = 'h-3 w-3' }: { kind: StatusKind | 'purge' | 'necrosis'; className?: string }) {
  switch (kind) {
    case 'bleed':
      return (
        <svg viewBox="0 0 12 12" className={className} aria-hidden>
          <path d="M6 1 C6 1 2.5 5.5 2.5 7.8 A3.5 3.5 0 0 0 9.5 7.8 C9.5 5.5 6 1 6 1 Z" fill="currentColor" />
        </svg>
      );
    case 'numb':
      return (
        <svg viewBox="0 0 12 12" className={className} aria-hidden>
          <path d="M7 0.8 L2.5 6.8 H5.6 L4.6 11.2 L9.5 4.9 H6.3 Z" fill="currentColor" />
        </svg>
      );
    case 'fever':
      return (
        <svg viewBox="0 0 12 12" className={className} aria-hidden>
          <path d="M6 0.8 C6.5 3 9.6 4.2 9.6 7.4 A3.6 3.6 0 0 1 2.4 7.4 C2.4 5.6 3.6 4.9 4 3.6 C4.6 4.8 5.2 5 5.4 5 C5.4 3.6 5.2 2.2 6 0.8 Z" fill="currentColor" />
        </svg>
      );
    case 'necrosis':
      return (
        <svg viewBox="0 0 12 12" className={className} aria-hidden>
          <path d="M6 1 A4.3 4.3 0 0 0 1.7 5.3 C1.7 7 2.6 7.8 3.4 8.2 V10.4 H8.6 V8.2 C9.4 7.8 10.3 7 10.3 5.3 A4.3 4.3 0 0 0 6 1 Z" fill="currentColor" />
          <circle cx="4.3" cy="5.6" r="1.1" fill="#000" />
          <circle cx="7.7" cy="5.6" r="1.1" fill="#000" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 12 12" className={className} aria-hidden>
          <path d="M6 1 L7.2 4.8 L11 6 L7.2 7.2 L6 11 L4.8 7.2 L1 6 L4.8 4.8 Z" fill="currentColor" />
        </svg>
      );
  }
}

export interface StatusEvent {
  key: number;
  player: PlayerId;
  kind: StatusKind | 'purge' | 'tick' | 'expired';
  status?: StatusKind;
  label: string;
}

const EVENT_MS = 1700;
let statusKey = 0;

/** Newly applied / ticking / purged / expired statuses, from the log and a diff of the status counters. */
export function useStatusEvents(state: GameState): StatusEvent[] {
  const seen = useRef(state.log.length);
  const prev = useRef(state.players.map((p) => ({ bleed: p.bleed, numb: p.numb, fever: p.fever })));
  const [events, setEvents] = useState<StatusEvent[]>([]);
  useEffect(() => {
    const fresh = state.log.slice(seen.current);
    seen.current = state.log.length;
    const found: StatusEvent[] = [];
    const purged = new Set<PlayerId>();
    for (const l of fresh) {
      if (l.player === null) continue;
      const p = l.player;
      if (/ is bleeding for /.test(l.text)) found.push({ key: ++statusKey, player: p, kind: 'bleed', status: 'bleed', label: `BLEEDING · ${state.players[p].bleed}` });
      else if (/ is numbed /.test(l.text)) found.push({ key: ++statusKey, player: p, kind: 'numb', status: 'numb', label: `NUMBED · ${state.players[p].numb}` });
      else if (/\(Fever\)\.$/.test(l.text)) found.push({ key: ++statusKey, player: p, kind: 'fever', status: 'fever', label: `FEVER · ${state.players[p].fever}` });
      else if (/statuses are purged/.test(l.text)) {
        purged.add(p);
        found.push({ key: ++statusKey, player: p, kind: 'purge', label: 'PURGED' });
      } else {
        const tick = / takes (\d+) damage \(Bleed\)/.exec(l.text);
        if (tick) found.push({ key: ++statusKey, player: p, kind: 'tick', status: 'bleed', label: `−${tick[1]}` });
      }
    }
    // Natural expiry (counter ran out without a purge).
    state.players.forEach((pl, i) => {
      const was = prev.current[i];
      for (const st of ['bleed', 'numb', 'fever'] as StatusKind[]) {
        if (was[st] > 0 && pl[st] === 0 && !purged.has(pl.id)) found.push({ key: ++statusKey, player: pl.id, kind: 'expired', status: st, label: `${STATUS_META[st].name} wore off` });
      }
    });
    prev.current = state.players.map((p) => ({ bleed: p.bleed, numb: p.numb, fever: p.fever }));
    if (!found.length) return;
    setEvents((cur) => [...cur, ...found]);
    const keys = new Set(found.map((e) => e.key));
    setTimeout(() => setEvents((cur) => cur.filter((e) => !keys.has(e.key))), EVENT_MS);
  }, [state.log, state.players]);
  return events;
}

/** Persistent aura on a Specimen's tank for each active status (drawn inside the tank, under the slots). */
export function StatusAura({ state, player }: { state: GameState; player: PlayerId }) {
  const p = state.players[player];
  return (
    <>
      {p.fever > 0 && <div className="status-fever pointer-events-none absolute inset-0 rounded-[inherit]" />}
      {p.numb > 0 && <div className="status-numb pointer-events-none absolute inset-0 rounded-[inherit]" />}
      {p.bleed > 0 && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-red-900/45 to-transparent" />
          {[14, 33, 58, 77, 90].map((left, i) => (
            <span key={left} className="status-drip absolute top-0 h-2 w-1.5 rounded-b-full bg-red-500/85" style={{ left: `${left}%`, animationDelay: `${i * 0.55}s` }} />
          ))}
        </div>
      )}
    </>
  );
}

/** Icon badges (with rounds left) in a tank's top corner. */
export function StatusBadges({ state, player, side }: { state: GameState; player: PlayerId; side: 'left' | 'right' }) {
  const p = state.players[player];
  const active = (['bleed', 'numb', 'fever'] as StatusKind[]).filter((k) => p[k] > 0);
  if (!active.length) return null;
  return (
    <div className={`pointer-events-auto absolute top-1.5 z-20 flex flex-col gap-1 ${side === 'left' ? 'left-1.5' : 'right-1.5'}`}>
      {active.map((k) => (
        <span
          key={k}
          className="status-badge flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-display text-[10px] font-bold leading-none text-white shadow-lg"
          style={{ background: `${STATUS_META[k].color}cc`, borderColor: STATUS_META[k].color, boxShadow: `0 0 10px ${STATUS_META[k].color}99` }}
          title={`${STATUS_META[k].name}: ${STATUS_META[k].text(p[k], state)}`}
        >
          <StatusIcon kind={k} className="h-3 w-3" />
          {p[k]}
        </span>
      ))}
    </div>
  );
}

/** The animated callouts over one Specimen's tank. */
export function StatusCallouts({ events, player }: { events: StatusEvent[]; player: PlayerId }) {
  const mine = events.filter((e) => e.player === player);
  if (!mine.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-1">
      {mine.slice(-3).map((e, i) => {
        const color = e.status ? STATUS_META[e.status].color : '#7be0b0';
        if (e.kind === 'tick') {
          return (
            <span key={e.key} className="status-tick absolute left-1/2 top-[18%] flex items-center gap-0.5 font-display text-2xl font-bold text-red-400 drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]">
              <StatusIcon kind="bleed" className="h-4 w-4" />
              {e.label}
            </span>
          );
        }
        if (e.kind === 'expired') {
          return (
            <span key={e.key} className="status-expire rounded-full bg-black/75 px-2 py-0.5 text-[11px] font-semibold text-ink2" style={{ animationDelay: `${i * 0.1}s` }}>
              {e.label}
            </span>
          );
        }
        if (e.kind === 'purge') {
          return (
            <span key={e.key} className="relative grid place-items-center">
              <span className="status-purge-ring absolute h-24 w-24 rounded-full border-4 border-accent" />
              <span className="status-slam flex items-center gap-1 rounded-lg border-2 border-accent bg-black/80 px-3 py-1 font-display text-lg font-bold tracking-widest text-accent">
                <StatusIcon kind="purge" className="h-4 w-4" />
                {e.label}
              </span>
            </span>
          );
        }
        return (
          <span
            key={e.key}
            className="status-slam flex items-center gap-1.5 rounded-lg border-2 bg-black/80 px-3 py-1 font-display text-lg font-bold tracking-widest"
            style={{ color, borderColor: color, boxShadow: `0 0 18px ${color}aa`, animationDelay: `${i * 0.12}s` }}
          >
            <StatusIcon kind={e.status!} className="h-5 w-5" />
            {e.label}
          </span>
        );
      })}
    </div>
  );
}
