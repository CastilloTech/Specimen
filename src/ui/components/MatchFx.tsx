import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { GameState, PlayerId } from '../../engine';

// Match-level moments made visible: heals and Ambushes on a tank, the round (and Meltdown) title card, the
// end-of-match finisher, and cards arriving in the hand.

let fxKey = 0;

// ---------- Heals and Ambushes (read from the log) ----------

export interface LogFx {
  key: number;
  kind: 'heal' | 'ambush';
  amount?: number;
  text?: string;
  /** Position in this batch, to stagger several at once. */
  i: number;
}

const LOG_FX_MS = { heal: 1500, ambush: 1800 };

export function useLogFx(state: GameState, player: PlayerId): LogFx[] {
  const seen = useRef(state.log.length);
  const [events, setEvents] = useState<LogFx[]>([]);
  useEffect(() => {
    if (state.log.length < seen.current) {
      seen.current = state.log.length; // a rematch started a fresh log
      return;
    }
    const fresh = state.log.slice(seen.current);
    seen.current = state.log.length;
    const name = state.players[player].name;
    const found: LogFx[] = [];
    for (const l of fresh) {
      if (l.player !== player) continue;
      if (l.kind === 'heal' && (l.amount ?? 0) > 0) found.push({ key: ++fxKey, kind: 'heal', amount: l.amount, i: found.length });
      else if (l.text.startsWith('AMBUSH:')) {
        const what = l.text.slice(`AMBUSH: ${name} `.length).replace(/ this round\.$/, '');
        found.push({ key: ++fxKey, kind: 'ambush', text: what, i: found.length });
      }
    }
    if (!found.length) return;
    setEvents((cur) => [...cur, ...found]);
    for (const e of found) setTimeout(() => setEvents((cur) => cur.filter((x) => x.key !== e.key)), LOG_FX_MS[e.kind] + e.i * 150);
  }, [state.log, state.players, player]);
  return events;
}

/** Heal and Ambush effects over one tank. */
export function TankLogFx({ events }: { events: LogFx[] }) {
  return (
    <>
      {events.map((e) =>
        e.kind === 'heal' ? (
          <div key={e.key} className="pointer-events-none absolute inset-0 z-30" data-match-fx="heal" style={{ '--i': `${e.i * 0.15}s` } as CSSProperties}>
            <div className="heal-glow absolute inset-0 rounded-[26px]" />
            {[24, 44, 64, 80].map((x, j) => (
              <span key={x} className="heal-cross absolute bottom-[18%] font-display text-lg font-bold text-emerald-300 drop-shadow-[0_0_6px_rgba(52,211,153,0.9)]" style={{ left: `${x}%`, '--i': `${e.i * 0.15 + j * 0.1}s` } as CSSProperties}>
                +
              </span>
            ))}
            <span className="strain-rise absolute left-1/2 top-[48%] whitespace-nowrap font-display text-3xl font-bold text-emerald-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]" style={{ animationDelay: `${e.i * 0.15}s` }}>
              +{e.amount} HP
            </span>
          </div>
        ) : (
          <div key={e.key} className="pointer-events-none absolute inset-0 z-30 grid place-items-center" data-match-fx="ambush">
            <span className="status-purge-ring absolute h-28 w-28 rounded-full border-4 border-amber-400" />
            <span className="status-slam flex flex-col items-center rounded-lg border-2 border-amber-400 bg-black/85 px-3 py-1 shadow-[0_0_22px_rgba(251,191,36,0.8)]">
              <span className="font-display text-xl font-bold tracking-[0.2em] text-amber-300">⚡ AMBUSH!</span>
              {e.text && <span className="max-w-[180px] text-center text-[10px] font-semibold leading-tight text-amber-100">{e.text}</span>}
            </span>
          </div>
        ),
      )}
    </>
  );
}

// ---------- Round title card ----------

/** A sweeping ROUND N title when a new round starts; the first Meltdown round gets hazard tape and a warning. */
export function RoundBanner({ state }: { state: GameState }) {
  const prev = useRef(state.round);
  const [ev, setEv] = useState<{ key: number; round: number; meltdown: boolean; final: boolean } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = state.round;
    if (state.round <= before || state.phase === 'over' || state.round < 1) return;
    const e = { key: ++fxKey, round: state.round, meltdown: state.round === state.config.match.meltdownFromRound, final: state.round === state.config.match.maxRounds };
    setEv(e);
    const t = setTimeout(() => setEv((x) => (x?.key === e.key ? null : x)), e.meltdown ? 2600 : 1700);
    return () => clearTimeout(t);
  }, [state.round, state.phase, state.config.match.meltdownFromRound, state.config.match.maxRounds]);
  if (!ev) return null;
  return (
    <div key={ev.key} className="pointer-events-none fixed inset-0 z-[45] grid place-items-center overflow-hidden" aria-live="polite" data-match-fx="round">
      <div className={`round-band relative flex w-full flex-col items-center py-3 ${ev.meltdown ? 'round-meltdown bg-black/85' : 'bg-black/70'}`}>
        {ev.meltdown && (
          <>
            <div className="hazard hazard-slide-l absolute inset-x-0 top-0 h-2.5" />
            <div className="hazard hazard-slide-r absolute inset-x-0 bottom-0 h-2.5" />
          </>
        )}
        <span className="round-title font-display text-4xl font-extrabold tracking-[0.25em] text-ink phone:text-3xl">
          {ev.final ? 'FINAL ROUND' : `ROUND ${ev.round}`}
          {!ev.final && <span className="text-xl text-mute"> / {state.config.match.maxRounds}</span>}
        </span>
        {ev.meltdown && (
          <span className="round-sub mt-1 font-display text-sm font-bold tracking-[0.3em] text-amber-300">
            ☢ MELTDOWN · +{state.config.match.meltdownStrain} Strain to both Specimens every round
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- End of match ----------

/** VICTORY / DEFEAT / DRAW slammed over the board when the match ends (the results button stays usable). */
export function MatchEndOverlay({ state, me }: { state: GameState; me: PlayerId }) {
  const over = state.phase === 'over';
  const was = useRef(over);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const before = was.current;
    was.current = over;
    if (!over || before) return;
    // Let the final Clash play out first, then slam the result in.
    const on = setTimeout(() => setShow(true), 1100);
    const off = setTimeout(() => setShow(false), 1100 + 3400);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [over]);
  if (!show || !state.result) return null;
  const w = state.result.winner;
  const [word, color] = w === null ? ['DRAW', '#e5e7eb'] : w === me ? ['VICTORY', '#7be0b0'] : ['DEFEAT', '#f87171'];
  return (
    <div className="end-veil pointer-events-none fixed inset-0 z-[46] grid place-items-center" aria-live="assertive" data-match-fx="end">
      <div className="relative flex flex-col items-center">
        {w === me && (
          <svg viewBox="-50 -50 100 100" className="end-rays absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2" aria-hidden>
            {Array.from({ length: 16 }, (_, i) => (
              <rect key={i} x="-1.5" y="-50" width="3" height="30" rx="1.5" fill={color} opacity={i % 2 ? 0.35 : 0.6} transform={`rotate(${i * 22.5})`} />
            ))}
          </svg>
        )}
        <span className="end-word relative font-display text-6xl font-extrabold tracking-[0.2em] phone:text-5xl" style={{ color, textShadow: `0 0 28px ${color}, 0 4px 0 #000` }}>
          {word}
        </span>
        <span className="end-sub relative mt-2 rounded-full bg-black/70 px-3 py-1 text-sm text-ink2">{state.result.reason}</span>
      </div>
    </div>
  );
}

/** A heartbeat trace that flatlines across a KO'd Specimen's tank. */
export function Flatline() {
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-[4%] top-[40%] z-30 h-[20%] w-[92%]" aria-hidden data-match-fx="flatline">
      <polyline className="flatline" pathLength={100} points="0,20 14,20 18,8 22,32 26,20 38,20 42,4 46,36 50,20 100,20" stroke="#f87171" strokeWidth="2" fill="none" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 3px #ef4444)' }} />
    </svg>
  );
}

// ---------- Hand ----------

/**
 * Cards that just arrived in the hand (drawn, or dealt once the board first shows), each with its position
 * among the new ones so they can fan in one after another. Ids seen while `active` is false are not tracked.
 */
export function useArrivals(ids: string[], active: boolean): Map<string, number> {
  const prev = useRef<Set<string> | null>(null);
  const [arrived, setArrived] = useState<Map<string, number>>(new Map());
  const joined = ids.join(',');
  useEffect(() => {
    if (!active) return;
    const before = prev.current ?? new Set<string>();
    const fresh = ids.filter((id) => !before.has(id));
    prev.current = new Set(ids);
    if (!fresh.length) return;
    setArrived(new Map(fresh.map((id, i) => [id, i])));
    const t = setTimeout(() => setArrived(new Map()), 700 + fresh.length * 90);
    return () => clearTimeout(t);
    // `joined` stands in for `ids` (a fresh array every render).
  }, [joined, active]);
  return arrived;
}
