import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { botAction, createMatch, makeRng, pendingPlayers, reduce } from '../engine';
import type { Action, GameState, MatchSetup, PlayerId } from '../engine';

export interface TimerView {
  left: number;
  limit: number;
  reserve: [number, number];
  usingReserve: boolean;
}

/** What happens when a player runs out of time. Logged like any other action, so replays stay exact. */
export function timeoutAction(s: GameState, p: PlayerId): Action {
  switch (s.phase) {
    case 'mulligan':
      return { type: 'MULLIGAN', player: p, mulligan: false };
    case 'stance':
      return { type: 'AUTO_STANCE', player: p };
    case 'feint':
      return { type: 'FEINT', player: p, stance: null };
    case 'evolve':
      return { type: 'CHOOSE_EVOLUTION', player: p, id: s.players[p].evolutionOptions[0] };
    default:
      return s.window ? { type: 'DECLINE_REACTION', player: p } : { type: 'PASS', player: p };
  }
}

export function useMatch(setup: MatchSetup, timersOn: boolean, pausedRef: MutableRefObject<boolean>) {
  const [state, setState] = useState<GameState>(() => createMatch(setup));
  const ref = useRef(state);
  const rngs = useRef([makeRng(setup.seed ^ 0x51ed270b), makeRng(setup.seed ^ 0x2f6b1c8d)]).current;
  const [error, setError] = useState<string | null>(null);
  const cfg = state.config;

  const dispatch = useCallback((a: Action) => {
    const next = reduce(ref.current, a);
    if (next.lastError) {
      setError(next.lastError);
      return;
    }
    setError(null);
    ref.current = next;
    setState(next);
  }, []);

  const pend = pendingPlayers(state);
  const botP = pend.find((p) => state.players[p].isBot);
  const actor = pend.find((p) => !state.players[p].isBot);

  // Bot moves, with a small delay so the log is readable.
  useEffect(() => {
    if (state.phase === 'over' || botP === undefined) return;
    const t = setTimeout(() => dispatch(botAction(ref.current, botP, rngs[botP])), state.phase === 'actions' ? cfg.bot.actionDelayMs : 250);
    return () => clearTimeout(t);
  }, [state, botP, dispatch, rngs, cfg.bot.actionDelayMs]);

  // Timers: 10s per stance; 90s for the opening mulligan decision (no reserve used);
  // 30s per other decision plus a 30s reserve bank per player per match.
  const limit = state.phase === 'stance' ? cfg.timers.stanceSeconds : state.phase === 'mulligan' ? cfg.timers.mulliganSeconds : cfg.timers.actionSeconds;
  const useReserve = state.phase !== 'stance' && state.phase !== 'mulligan';
  const key = `${state.phase}|${state.round}|${state.history.length}|${actor}`;
  const [left, setLeft] = useState(limit);
  const [reserve, setReserve] = useState<[number, number]>([cfg.timers.reserveSeconds, cfg.timers.reserveSeconds]);
  const leftRef = useRef(limit);
  const reserveRef = useRef(reserve);

  useEffect(() => {
    leftRef.current = limit;
    setLeft(limit);
  }, [key, limit]);

  useEffect(() => {
    if (!timersOn || actor === undefined || state.phase === 'over') return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      if (leftRef.current > 0) {
        leftRef.current -= 1;
        setLeft(leftRef.current);
      } else if (useReserve && reserveRef.current[actor] > 0) {
        const r: [number, number] = [...reserveRef.current];
        r[actor] -= 1;
        reserveRef.current = r;
        setReserve(r);
      } else dispatch(timeoutAction(ref.current, actor));
    }, 1000);
    return () => clearInterval(id);
  }, [timersOn, actor, key, useReserve, state.phase, dispatch, pausedRef]);

  const timer: TimerView | null = timersOn && actor !== undefined ? { left, limit, reserve, usingReserve: left <= 0 && useReserve } : null;
  return { state, dispatch, error, actor, timer };
}
