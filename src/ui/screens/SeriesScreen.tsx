import { useEffect, useMemo, useState } from 'react';
import type { GameState, PlayerId } from '../../engine';
import { ChipArt } from '../components/Emblem';
import { EmoteBar, SeriesPips, useAttention } from '../components/OnlineBits';
import { FACTION_META, PLAYER_COLORS, WORLD_FACTION_META } from '../meta';
import { rivalLine } from '../multiplayer';
import type { EmoteEvent, EmoteId, OnlineStatus, SeriesView } from '../online';
import { buzz, play } from '../sfx';
import { loadSeries } from '../storage';

/**
 * The end of a best-of-3: who took it, game by game, where you stand against this person overall, and a
 * one-tap rematch in the same room (both tap it and game 1 starts, no new code to share).
 */
export function SeriesScreen({
  series,
  state,
  me,
  status,
  opponentConnected,
  opponentLeft,
  emote,
  kept,
  onRematch,
  onEmote,
  onNewRoom,
  onMenu,
}: {
  series: SeriesView;
  state: GameState;
  me: PlayerId;
  status: OnlineStatus;
  opponentConnected: boolean;
  opponentLeft: boolean;
  emote: EmoteEvent | null;
  /** Whether the series went into a loaded save's stats. */
  kept: boolean | null;
  onRematch: () => void;
  onEmote: (id: EmoteId) => void;
  onNewRoom: () => void;
  onMenu: () => void;
}) {
  const opp = (1 - me) as PlayerId;
  const names: [string, string] = [state.players[0].name, state.players[1].name];
  const won = series.winner === me;
  const tied = series.winner === null;
  const iWant = series.ready[me];
  const theyWant = series.ready[opp];
  const oppName = names[opp];
  const rival = useMemo(() => rivalLine(loadSeries(), oppName), [oppName]);
  const [shown, setShown] = useState(0); // game rows appear one after another

  useEffect(() => {
    play(won ? 'unlock' : tied ? 'draw' : 'lose');
    buzz(won ? [40, 50, 120] : [160]);
    const id = setInterval(() => setShown((n) => n + 1), 220);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // They asked for a rematch: a sound, and the tab blinks if you're elsewhere.
  useEffect(() => {
    if (theyWant && !iWant) play('ready');
  }, [theyWant, iWant]);
  useAttention(theyWant && !iWant, `${names[opp]} wants a rematch`, 'ready');

  const headline = series.forfeit !== null ? (series.forfeit === me ? 'You left the series' : `${names[opp]} left: series yours`) : won ? 'Series won' : tied ? 'Series tied' : 'Series lost';
  const canRematch = !opponentLeft && status !== 'closed';

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-3 p-3 phone:grid phone:h-dvh phone:min-h-0 phone:max-w-4xl phone:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] phone:content-center phone:gap-2 phone:pr-14">
      <section className={`pop lab-panel rounded-2xl border-2 p-4 text-center phone:row-span-2 phone:self-stretch phone:content-center phone:p-2.5 ${won ? 'border-accent' : tied ? 'border-line' : 'border-red-500/50'}`}>
        <div className="lab-label">Best of {series.bestOf}{series.n > 1 ? ` · series ${series.n}` : ''}</div>
        <h1 className={`count-pop mt-1 font-display text-3xl font-extrabold phone:text-2xl ${won ? 'text-accent' : tied ? 'text-ink' : 'text-red-300'}`}>{headline}</h1>
        <div className="mt-3 phone:mt-1.5">
          <SeriesPips series={series} me={me} names={names} big />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs text-ink2 phone:mt-1.5 phone:flex-col phone:gap-1">
          {[me, opp].map((p) => (
            <span key={p} className="flex items-center gap-1.5">
              <span className="flex -space-x-2">
                <ChipArt id={state.players[p].faction} size={26} />
                <ChipArt id={state.players[p].worldFaction} size={26} />
              </span>
              <span>
                <span style={{ color: FACTION_META[state.players[p].faction].color }}>{FACTION_META[state.players[p].faction].name}</span> /{' '}
                <span style={{ color: WORLD_FACTION_META[state.players[p].worldFaction].color }}>{WORLD_FACTION_META[state.players[p].worldFaction].name}</span>
              </span>
            </span>
          ))}
        </div>
      </section>

      <section className="lab-panel rounded-xl border border-line p-3 phone:p-2">
        <div className="lab-label mb-1.5">Game by game</div>
        <ol className="flex flex-col gap-1">
          {series.games.map((g, i) => {
            const mine = g.winner === me;
            const tone = g.winner === null ? 'text-ink2' : mine ? 'text-emerald-300' : 'text-red-300';
            return (
              <li key={i} className={`flex items-center gap-2 rounded-lg bg-black/25 px-2.5 py-1.5 text-sm phone:py-0.5 ${i < shown ? 'row-in' : 'opacity-0'}`}>
                <span className="w-14 shrink-0 font-display text-xs font-bold text-mute">GAME {i + 1}</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.winner === null ? '#666' : PLAYER_COLORS[g.winner] }} />
                <span className={`shrink-0 font-semibold ${tone}`}>{g.winner === null ? 'Draw' : mine ? 'You won' : `${names[g.winner]} won`}</span>
                <span className="min-w-0 flex-1 truncate text-right text-[11px] text-mute">
                  {g.reason} · {g.rounds} rounds
                </span>
              </li>
            );
          })}
        </ol>
        <div className="mt-2 text-[11px] text-ink2">
          {rival && <span className="font-semibold text-sky-200">{rival}. </span>}
          {kept ? 'Saved to your multiplayer stats.' : kept === false ? 'Load a save to keep your online record.' : ''} Replays of each game are in Saves.
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-live="polite">
        {!canRematch ? (
          <p className="rounded-lg border border-line bg-black/30 p-2 text-center text-sm text-ink2">{names[opp]} left the room.</p>
        ) : theyWant && !iWant ? (
          <p className="turn-glow rounded-lg border border-accent bg-accent/10 p-2 text-center font-display text-sm font-bold text-accent">{names[opp]} wants a rematch!</p>
        ) : iWant ? (
          <p className="rounded-lg border border-line bg-black/30 p-2 text-center text-sm text-ink2">
            Rematch asked. Waiting for {names[opp]}
            <span className="animate-pulse">…</span>
            {!opponentConnected && <span className="block text-[11px] text-amber-200">{names[opp]} is offline right now.</span>}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button onClick={onMenu} className="rounded-xl bg-panel2 px-4 py-3 text-sm font-semibold">
            Menu
          </button>
          <button onClick={onNewRoom} className="rounded-xl border border-line px-3 py-3 text-sm text-ink2">
            New room
          </button>
          {canRematch && (
            <button
              onClick={() => {
                play('ready');
                onRematch();
              }}
              disabled={iWant}
              autoFocus
              data-primary
              className={`flex-1 rounded-xl px-4 py-3 font-display text-base font-bold text-black disabled:opacity-60 ${theyWant && !iWant ? 'turn-glow bg-accent' : 'bg-accent'}`}
            >
              {iWant ? 'Rematch asked' : theyWant ? 'Accept rematch ▶' : 'Rematch ▶'}
            </button>
          )}
        </div>
      </section>
      {canRematch && <EmoteBar me={me} latest={emote} onSend={onEmote} names={names} place="top" />}
    </div>
  );
}
