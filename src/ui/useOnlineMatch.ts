import { useCallback, useEffect, useReducer } from 'react';
import { pendingPlayers } from '../engine';
import type { Action, MatchSetup, PlayerId } from '../engine';
import type { OnlineConn } from './online';
import type { TimerView } from './useMatch';

/**
 * The online match, shaped like useMatch so the same match screen plays it: the state is whatever view the
 * server last sent, your moves go to the server, and you act only when the server says it's your decision.
 * Turn time is the server's (a generous backstop); its deadline comes along so the screen can warn near the end.
 */
export function useOnlineMatch(conn: OnlineConn) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => conn.subscribe(rerender), [conn]);
  const view = conn.view!;
  const me: PlayerId = view.seat;
  const state = view.state;
  const dispatch = useCallback((a: Action) => conn.send(a), [conn]);
  const actor = state.phase !== 'over' && pendingPlayers(state).includes(me) ? me : undefined;
  // Until the end the real setup (with the seed) stays on the server; the match screen only needs its shape.
  const setup: MatchSetup = view.setup ?? { seed: [...`${conn.code}${view.series.n}${view.series.game}`].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) >>> 0, players: [] as unknown as MatchSetup['players'] };
  return {
    state,
    dispatch,
    error: conn.error,
    actor,
    timer: null as TimerView | null,
    hurry: () => {},
    botActing: false,
    me,
    setup,
    status: conn.status,
    opponentConnected: view.opponentConnected,
    opponentLeft: view.opponentLeft,
    opponentId: view.opponentId,
    queue: view.queue,
    series: view.series,
    deadlineAt: view.deadlineAt,
    nextAt: view.nextAt,
    emote: conn.emote,
  };
}
