import { useEffect, useMemo, useState } from 'react';
import { cardOf, createMatch, reduce } from '../../engine';
import type { Action, GameState, PlayerId } from '../../engine';
import { CardDetail } from '../components/CardDetail';
import { CardView } from '../components/CardView';
import { LogPanel } from '../components/LogPanel';
import { PlayerPanel, PlayerPanelCompact } from '../components/PlayerPanel';
import { PHONE_LANDSCAPE, useMediaQuery } from '../useMediaQuery';
import { PlaysStrip, PlaySheet } from '../components/Plays';
import { ScreenHeader } from '../components/ScreenHeader';
import { Specimen } from '../components/Specimen';
import { PLAYER_COLORS } from '../meta';
import { useMatchSounds } from '../sfx';
import type { SavedReplay } from '../storage';
import { saveReplay } from '../storage';
import { replayLink, shareOrCopy } from '../share';
import type { PlayRecord } from '../../engine';

// The replay viewer: rebuild every state of a finished match from its seed and actions, then step through it
// (or let it play) with the same board, tanks and effects as the live match.

interface Built {
  states: GameState[];
  /** The replay stopped early: it was recorded on an older version of the rules or cards. */
  broken: boolean;
}

function build(r: SavedReplay): Built {
  try {
    const states = [createMatch(r.setup)];
    for (const a of r.actions) {
      const next = reduce(states[states.length - 1], a);
      if (next.lastError) return { states, broken: true };
      states.push(next);
    }
    return { states, broken: false };
  } catch {
    return { states: [], broken: true };
  }
}

const SPEEDS = [1, 2, 4] as const;
const STEP_MS = 900;

/** One line for an action that left nothing in the log (hidden choices like stance picks). */
function quietText(prev: GameState, a: Action): string {
  const who = prev.players[a.player].name;
  switch (a.type) {
    case 'MULLIGAN':
      return a.mulligan ? `${who} mulligans.` : `${who} keeps their hand.`;
    case 'PICK_STANCE':
    case 'AUTO_STANCE':
      return `${who} locks in a stance.`;
    case 'PASS':
      return `${who} passes.`;
    default:
      return `${who} acts.`;
  }
}

export function ReplayScreen({ replay, onBack, shared, startAt = 0 }: { replay: SavedReplay; onBack: () => void; /** Opened from someone's link. */ shared?: boolean; /** Open at this step (a turning point). */ startAt?: number }) {
  const [note, setNote] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const share = async () => {
    const url = await replayLink(replay);
    const res = await shareOrCopy({ title: 'Specimen replay', text: `${replay.names[replay.me]} vs ${replay.names[1 - replay.me]} (${replay.result}) — watch the match:`, url });
    setNote(res === 'copied' ? 'Link copied: anyone who opens it watches this match.' : res === 'shared' ? null : "Couldn't share from this browser.");
  };
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3500);
    return () => clearTimeout(t);
  }, [note]);
  const { states, broken } = useMemo(() => build(replay), [replay]);
  const last = states.length - 1;
  const [i, setI] = useState(startAt);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [reveal, setReveal] = useState(true);
  const [viewCard, setViewCard] = useState<string | null>(null);
  const [playSheet, setPlaySheet] = useState<PlayRecord | null>(null);
  const phone = useMediaQuery(PHONE_LANDSCAPE);
  const me = replay.me;
  const opp = (1 - me) as PlayerId;
  const state = states[Math.min(i, last)];
  useMatchSounds(state ?? states[0], me, !!state);

  // The first state of each round, for jumping round by round.
  const roundStarts = useMemo(() => states.flatMap((s, k) => (k > 0 && s.round !== states[k - 1].round ? [k] : [])), [states]);

  // Playback: steps that did a lot (a Clash, a new round) hold a little longer.
  useEffect(() => {
    if (!playing) return;
    if (i >= last) return setPlaying(false);
    const added = states[i + 1].log.length - states[i].log.length;
    const t = setTimeout(() => setI((v) => Math.min(last, v + 1)), (STEP_MS * (added > 3 ? 1.8 : 1)) / speed);
    return () => clearTimeout(t);
  }, [playing, i, last, speed, states]);

  const step = (d: number) => {
    setPlaying(false);
    setI((v) => Math.max(0, Math.min(last, v + d)));
  };
  const prevRound = () => {
    setPlaying(false);
    setI((v) => [...roundStarts].reverse().find((k) => k < v) ?? 0);
  };
  const nextRound = () => {
    setPlaying(false);
    setI((v) => roundStarts.find((k) => k > v) ?? last);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewCard || playSheet) return;
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowUp' || e.key === 'PageDown') nextRound();
      else if (e.key === 'ArrowDown' || e.key === 'PageUp') prevRound();
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => (i >= last ? (setI(0), true) : !p));
      } else return;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const date = new Date(replay.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const resultText = replay.result === 'win' ? 'Win' : replay.result === 'loss' ? 'Loss' : 'Draw';
  const shareBtns = (
    <>
      {shared && (
        <button
          onClick={() => {
            saveReplay({ ...replay, id: `${Date.now()}-kept` });
            setKept(true);
          }}
          disabled={kept}
          className="shrink-0 rounded-lg border border-line px-2 py-1.5 text-xs font-semibold text-ink2 disabled:opacity-50"
          title="Add it to your Replays on the Saves screen"
        >
          {kept ? '✓ Kept' : 'Keep'}
        </button>
      )}
      <button onClick={() => void share()} className="shrink-0 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-bold text-black" title="Share a link that opens this replay">
        ↗ Share
      </button>
    </>
  );
  const toast = note && (
    <div className="coach-pop fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-lg border border-accent/60 bg-panel px-3 py-1.5 text-xs shadow-lg" role="status">
      {note}
    </div>
  );
  const header = <ScreenHeader title={shared ? 'Shared replay' : 'Replay'} sub={`${replay.names[me]} vs ${replay.names[opp]} · ${resultText} · ${replay.label ? `${replay.label} · ` : ''}${date}`} onBack={onBack} backLabel="Back" right={shareBtns} />;

  if (!state)
    return (
      <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-3 p-3">
        {header}
        <p className="rounded-xl border border-line p-4 text-sm text-ink2">This replay can't be rebuilt: it was recorded on an older version of the cards or rules.</p>
      </div>
    );

  // What this step did: its new log lines, or a plain line for a hidden choice.
  const prev = i > 0 ? states[i - 1] : null;
  const fresh = prev ? state.log.slice(prev.log.length).filter((l) => l.kind !== 'round') : [];
  const caption = !prev ? 'The match begins.' : fresh.length ? fresh.map((l) => l.text).join(' ') : quietText(prev, replay.actions[i - 1]);
  const view = (p: PlayerId) => (reveal ? p : me);

  const scrubber = <input type="range" min={0} max={last} value={i} onChange={(e) => (setPlaying(false), setI(Number(e.target.value)))} className="w-full min-w-0 accent-[var(--color-accent)]" aria-label="Replay position" />;
  const controls = (compact: boolean) => (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Replay controls">
      <Btn compact={compact} onClick={prevRound} label="Previous round" text="⏮" />
      <Btn compact={compact} onClick={() => step(-1)} label="Step back" text="◀" />
      <button
        onClick={() => (i >= last ? (setI(0), setPlaying(true)) : setPlaying((p) => !p))}
        className={`grid place-items-center rounded-lg bg-accent font-display font-bold text-black ${compact ? 'h-8 w-11 text-base' : 'h-10 w-14 text-lg'}`}
        aria-label={playing ? 'Pause' : i >= last ? 'Replay from the start' : 'Play'}
      >
        {playing ? '❚❚' : i >= last ? '↺' : '▶'}
      </button>
      <Btn compact={compact} onClick={() => step(1)} label="Step forward" text="▶" />
      <Btn compact={compact} onClick={nextRound} label="Next round" text="⏭" />
    </div>
  );
  const speeds = (
    <div className="flex shrink-0 rounded-lg border border-line p-0.5 text-xs" role="radiogroup" aria-label="Speed">
      {SPEEDS.map((sp) => (
        <button key={sp} role="radio" aria-checked={speed === sp} onClick={() => setSpeed(sp)} className={`rounded-md px-2 py-1 font-bold ${speed === sp ? 'bg-accent text-black' : 'text-ink2'}`}>
          {sp}×
        </button>
      ))}
    </div>
  );
  const revealBtn = (
    <button onClick={() => setReveal((v) => !v)} aria-pressed={reveal} className={`shrink-0 rounded-lg border px-2 py-1.5 text-xs font-semibold ${reveal ? 'border-accent text-accent' : 'border-line text-ink2'}`} title="Show both hands and every face-down graft">
      {reveal ? '👁 Hidden info' : '👁 Your view'}
    </button>
  );
  const sheets = (
    <>
      {viewCard && <CardDetail def={cardOf(viewCard)} onClose={() => setViewCard(null)} />}
      {playSheet && <PlaySheet state={state} viewer={me} rec={playSheet} onClose={() => setPlaySheet(null)} />}
    </>
  );

  // Phone landscape: the match's own compact board, with a two-line caption and the transport under it.
  if (phone)
    return (
      <div className="fixed inset-0 flex flex-col gap-1 overflow-hidden p-1" style={{ paddingLeft: 'max(4px, env(safe-area-inset-left))', paddingRight: 'max(4px, env(safe-area-inset-right))', paddingBottom: 'max(4px, env(safe-area-inset-bottom))' }}>
        <header className="lab-panel flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-1.5">
          <button onClick={onBack} className="rounded border border-line px-1.5 text-xs text-ink2" aria-label="Back">
            ←
          </button>
          <span className="font-display text-[12px] font-bold text-accent">REPLAY</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink2">
            {state.round > 0 ? `Round ${state.round}` : 'Start'} · {replay.names[me]} vs {replay.names[opp]} · {resultText}
          </span>
          {revealBtn}
          {shareBtns}
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-1">
          <PlayerPanelCompact state={state} player={me} viewer={view(me)} color={PLAYER_COLORS[me]} active={false} />
          <section className="relative flex h-full min-h-0 items-center gap-1" aria-label="Arena">
            <div className="relative h-full">
              <Specimen state={state} player={me} viewer={view(me)} flip fill color={PLAYER_COLORS[me]} />
            </div>
            <span className="font-display text-[9px] font-bold text-mute [writing-mode:vertical-rl]">VS</span>
            <div className="relative h-full">
              <Specimen state={state} player={opp} viewer={view(opp)} fill color={PLAYER_COLORS[opp]} />
            </div>
          </section>
          <PlayerPanelCompact state={state} player={opp} viewer={view(opp)} color={PLAYER_COLORS[opp]} active={false} />
        </div>
        <div className="line-clamp-2 shrink-0 rounded-md bg-black/35 px-2 py-0.5 text-center text-[11px] leading-snug text-ink" aria-live="polite" data-testid="replay-caption">
          {caption}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {controls(true)}
          {scrubber}
          <span className="shrink-0 text-[10px] tabular-nums text-mute">
            {i}/{last}
          </span>
          {speeds}
        </div>
        {sheets}
        {toast}
      </div>
    );

  const hand = (p: PlayerId) => (
    <div className="flex items-center gap-1.5 overflow-x-auto px-1 pb-1 pt-2">
      <span className="lab-label shrink-0" style={{ color: PLAYER_COLORS[p] }}>
        Hand
      </span>
      {state.players[p].hand.map((c) => (
        <CardView key={c.uid} def={cardOf(c.cardId)} size="xs" onClick={() => setViewCard(c.cardId)} />
      ))}
      {state.players[p].hand.length === 0 && <span className="text-[11px] text-mute">empty</span>}
    </div>
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-2 p-3 pb-0">
      {header}
      {broken && <div className="rounded-lg border border-amber-500/50 bg-amber-950/30 px-3 py-1.5 text-xs text-amber-200">This replay stops early: it was recorded on an older version of the cards or rules.</div>}

      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[250px_minmax(0,1fr)_250px] lg:items-start">
        <div className="lg:order-3">
          <PlayerPanel state={state} player={opp} viewer={view(opp)} color={PLAYER_COLORS[opp]} active={false} />
        </div>
        <section className="relative rounded-xl border border-line bg-[radial-gradient(ellipse_at_50%_40%,rgba(123,224,176,0.06),transparent_65%)] px-1.5 py-2 lg:order-2" aria-label="Arena">
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <span className="lab-label truncate" style={{ color: PLAYER_COLORS[me] }}>
              {state.players[me].name}
            </span>
            <span className="font-display text-sm font-bold text-accent">{state.round > 0 ? `Round ${state.round}` : 'Start'}</span>
            <span className="lab-label truncate" style={{ color: PLAYER_COLORS[opp] }}>
              {state.players[opp].name}
            </span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
            <Specimen state={state} player={me} viewer={view(me)} flip color={PLAYER_COLORS[me]} />
            <span className="font-display text-[11px] font-bold tracking-widest text-mute">VS</span>
            <Specimen state={state} player={opp} viewer={view(opp)} color={PLAYER_COLORS[opp]} />
          </div>
          <div className="mx-1 mt-1.5 min-h-[2.5rem] rounded-lg bg-black/35 px-3 py-1.5 text-center text-xs text-ink" aria-live="polite" data-testid="replay-caption">
            {caption}
          </div>
          <PlaysStrip state={state} viewer={me} onOpen={setPlaySheet} />
          {reveal && (
            <div className="mt-1 grid gap-0.5 border-t border-line/60 sm:grid-cols-2">
              {hand(me)}
              {hand(opp)}
            </div>
          )}
        </section>
        <div className="flex flex-col gap-2 lg:order-1">
          <PlayerPanel state={state} player={me} viewer={view(me)} color={PLAYER_COLORS[me]} active={false} />
          <LogPanel log={state.log} className="hidden h-64 lg:block" />
        </div>
      </div>

      {/* Transport: always on screen. */}
      <div className="sticky bottom-0 z-[45] -mx-3 mt-auto border-t border-line bg-bg/92 px-3 pt-2 backdrop-blur" style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
        {scrubber}
        <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
          {controls(false)}
          <div className="flex items-center gap-1.5 sm:ml-auto">
            {speeds}
            {revealBtn}
          </div>
        </div>
        <div className="mt-1 text-center text-[10px] text-mute">
          Step {i} / {last} · ← → step · ↑ ↓ round · space play
        </div>
      </div>
      {sheets}
      {toast}
    </div>
  );
}

function Btn({ onClick, label, text, compact }: { onClick: () => void; label: string; text: string; compact?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={`grid place-items-center rounded-lg border border-line text-ink2 hover:border-mute ${compact ? 'h-8 w-8 text-sm' : 'h-10 w-10'}`}>
      {text}
    </button>
  );
}
