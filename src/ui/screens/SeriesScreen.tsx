import { useEffect, useMemo, useState } from 'react';
import type { GameState, PlayerId } from '../../engine';
import { ChipArt } from '../components/Emblem';
import { EmoteBar, SeriesPips, useAttention } from '../components/OnlineBits';
import { FACTION_META, PLAYER_COLORS, WORLD_FACTION_META } from '../meta';
import { rivalLine } from '../multiplayer';
import type { EmoteEvent, EmoteId, OnlineStatus, SeriesView } from '../online';
import { buzz, play } from '../sfx';
import { loadSeries } from '../storage';
import { block, deviceId, isBlocked, isFriend, keepSearching } from '../device';
import { matchmaker } from '../matchmaker';
import { useNow } from '../components/OnlineBits';
import { ProfileCard } from '../components/ProfileCard';
import type { Profile } from '../matchmaker';
import { SERVER_URL } from '../online';

/**
 * The end of a best-of-3: who took it, game by game, where you stand against this person overall, then the
 * goodbye: GG and Rematch side by side (both tap Rematch and game 1 starts in the same room), Add friend, or
 * Find another (straight back into the queue; on its own after a few seconds with "keep searching" on).
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
  onFindAnother,
  stranger,
  opponentId,
  oppProfile,
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
  /** Back into the lounge's queue at once. */
  onFindAnother: () => void;
  /** A stranger from the lounge: Block and Report are offered. */
  stranger?: { id: string; code: string } | null;
  /** The opponent's public id (for Add friend). */
  opponentId?: string | null;
  oppProfile?: Profile | null;
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

      <Goodbye me={me} oppName={oppName} emote={emote} onEmote={onEmote} canRematch={canRematch} iWant={iWant} theyWant={theyWant} opponentConnected={opponentConnected} onRematch={onRematch} opponentId={opponentId ?? null} oppProfile={oppProfile ?? null} />

      <section className="flex flex-col gap-2" aria-live="polite">
        <NextUp paused={iWant || theyWant} onFindAnother={onFindAnother} />
        {!canRematch ? (
          <p className="rounded-lg border border-line bg-black/30 p-2 text-center text-sm text-ink2">{names[opp]} left the room.</p>
        ) : null}
        <div className="flex gap-2">
          <button onClick={onMenu} className="rounded-xl bg-panel2 px-4 py-3 text-sm font-semibold">
            Menu
          </button>
          <button onClick={onNewRoom} className="rounded-xl border border-line px-3 py-3 text-sm text-ink2">
            Lounge
          </button>
          <button onClick={onFindAnother} className="flex-1 rounded-xl border-2 border-accent px-4 py-3 font-display text-base font-bold text-accent">
            Find another ▶
          </button>
        </div>
      </section>
      {stranger && <StrangerTools id={stranger.id} code={stranger.code} name={oppName} onBlocked={onNewRoom} />}
      {canRematch && <EmoteBar me={me} latest={emote} onSend={onEmote} names={names} place="top" />}
    </div>
  );
}

const REASONS = ['Offensive name', 'Left or stalled on purpose', 'Something else'] as const;

/** After a series with a stranger: never be matched with them again, or report them for review. */
function StrangerTools({ id, code, name, onBlocked }: { id: string; code: string; name: string; onBlocked: () => void }) {
  const [blocked, setBlocked] = useState(() => isBlocked(id));
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const report = async (reason: string) => {
    setReporting(false);
    setReported(true);
    await fetch(`${SERVER_URL}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: deviceId(), target: id, code, reason, name }) }).catch(() => {});
  };
  return (
    <section className="flex flex-col items-center gap-1.5 text-xs">
      <div className="flex gap-3 text-mute">
        {blocked ? (
          <span>{name} is blocked: you won't be matched again.</span>
        ) : (
          <button
            onClick={() => {
              if (!window.confirm(`Block ${name}? You'll never be matched with them again, and this series ends here.`)) return;
              block(id, name);
              matchmaker.refreshBlocked();
              setBlocked(true);
              onBlocked();
            }}
            className="underline hover:text-ink2"
          >
            Block {name}
          </button>
        )}
        {reported ? <span>Report sent. Thank you.</span> : (
          <button onClick={() => setReporting((r) => !r)} className="underline hover:text-ink2" aria-expanded={reporting}>
            Report
          </button>
        )}
      </div>
      {reporting && (
        <div className="pop flex flex-wrap justify-center gap-1.5" role="group" aria-label={`Report ${name} for`}>
          {REASONS.map((r) => (
            <button key={r} onClick={() => void report(r)} className="rounded-lg border border-line px-2.5 py-1 text-ink2 hover:border-red-400/60 hover:text-red-200">
              {r}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** The goodbye: GG and Rematch side by side, each showing what the other player did; and Add friend. */
function Goodbye({ me, oppName, emote, onEmote, canRematch, iWant, theyWant, opponentConnected, onRematch, opponentId, oppProfile }: { me: PlayerId; oppName: string; emote: EmoteEvent | null; onEmote: (id: EmoteId) => void; canRematch: boolean; iWant: boolean; theyWant: boolean; opponentConnected: boolean; onRematch: () => void; opponentId: string | null; oppProfile: Profile | null }) {
  const [mountedAt] = useState(() => Date.now());
  const [saidGG, setSaidGG] = useState(false);
  const [asked, setAsked] = useState(false);
  const theyGG = !!emote && emote.seat !== me && emote.id === 'gg' && emote.at >= mountedAt;
  const [theySaidGG, setTheySaidGG] = useState(false);
  useEffect(() => {
    if (theyGG) setTheySaidGG(true);
  }, [theyGG]);
  const friend = isFriend(opponentId);
  return (
    <section className="flex flex-col gap-2">
      {oppProfile && <ProfileCard p={oppProfile} className="rounded-xl bg-black/25 px-3 py-2" />}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <button
            onClick={() => {
              onEmote('gg');
              setSaidGG(true);
            }}
            disabled={saidGG || !canRematch}
            className="rounded-xl border border-line bg-panel2 px-3 py-3 font-display text-base font-bold disabled:opacity-60"
          >
            🤝 {saidGG ? 'GG sent' : 'GG'}
          </button>
          <span className={`min-h-4 text-center text-[11px] ${theySaidGG ? 'font-semibold text-accent' : 'text-mute'}`}>{theySaidGG ? `${oppName}: GG` : ''}</span>
        </div>
        <div className="flex flex-col gap-1">
          {canRematch ? (
            <button
              onClick={() => {
                play('ready');
                onRematch();
              }}
              disabled={iWant}
              autoFocus
              data-primary
              className={`rounded-xl px-3 py-3 font-display text-base font-bold text-black disabled:opacity-60 ${theyWant && !iWant ? 'turn-glow bg-accent' : 'bg-accent'}`}
            >
              {iWant ? 'Rematch asked' : theyWant ? 'Accept rematch ▶' : 'Rematch?'}
            </button>
          ) : (
            <span className="rounded-xl border border-line px-3 py-3 text-center text-sm text-mute">No rematch</span>
          )}
          <span className={`min-h-4 text-center text-[11px] ${theyWant ? 'font-semibold text-accent' : 'text-mute'}`}>
            {theyWant ? `${oppName} wants a rematch` : iWant ? `waiting for ${oppName}…` : ''}
            {iWant && !opponentConnected && <span className="block text-amber-200">{oppName} is offline right now.</span>}
          </span>
        </div>
      </div>
      {opponentId && !friend && (
        <button
          onClick={() => {
            matchmaker.befriend(opponentId);
            setAsked(true);
          }}
          disabled={asked}
          className="self-center rounded-lg border border-sky-400/60 px-3 py-1.5 text-xs font-semibold text-sky-200 disabled:opacity-60"
        >
          {asked ? `Friend request sent to ${oppName}` : `★ Add ${oppName} as a friend`}
        </button>
      )}
      {friend && <span className="self-center text-[11px] text-sky-300">★ {oppName} is your friend</span>}
    </section>
  );
}

/** With "keep searching after each series" on: back into the queue after a few seconds, unless a rematch is in the air. */
function NextUp({ paused, onFindAnother }: { paused: boolean; onFindAnother: () => void }) {
  const [on, setOn] = useState(keepSearching);
  const [from] = useState(() => Date.now());
  const now = useNow(500, on && !paused);
  const left = Math.max(0, 12 - Math.floor((now - from) / 1000));
  useEffect(() => {
    if (on && !paused && left === 0) onFindAnother();
  }, [on, paused, left, onFindAnother]);
  if (!on) return null;
  return (
    <p className="flex items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-2 text-center text-xs text-ink2" role="timer">
      {paused ? (
        'The next search waits while a rematch is asked.'
      ) : (
        <span>
          Finding your next opponent in <b className="tabular-nums text-accent">{left}s</b>
        </span>
      )}
      <button onClick={() => setOn(false)} className="rounded border border-line px-2 py-0.5 text-[11px]">
        Stay here
      </button>
    </p>
  );
}
