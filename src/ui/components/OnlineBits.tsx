import { useEffect, useRef, useState } from 'react';
import type { PlayerId } from '../../engine';
import { PLAYER_COLORS } from '../meta';
import type { EmoteEvent, EmoteId, SeriesView } from '../online';
import { EMOTES } from '../online';
import { buzz, play } from '../sfx';

// The small pieces that make an online match feel like playing a person: reactions, the series score, the
// clock near the end of a decision, and a nudge when it's your move while the tab is in the background.

export const EMOTE_LABEL: Record<EmoteId, string> = { gg: 'Good game', nice: 'Nice play!', wow: 'Whoa!', think: 'Hmm…', oops: 'Oops', grr: 'Grrr' };
export const EMOTE_ICON: Record<EmoteId, string> = { gg: '🤝', nice: '👏', wow: '😮', think: '🤔', oops: '😅', grr: '😤' };

const MUTE_KEY = 'specimen.emotesMuted';
const readMuted = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
};

/** The time now, updated every `every` ms while `active`. */
export function useNow(every = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every, active]);
  return now;
}

/**
 * While `active` and the tab is in the background, the tab title says so (blinking) and a sound plays once,
 * so a player who went to send the invite link, or looked away during the opponent's turn, comes back in time.
 */
export function useAttention(active: boolean, title: string, sound: 'found' | 'ready' = 'ready') {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const base = document.title;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!document.hidden || id) return;
      play(sound);
      let on = false;
      id = setInterval(() => {
        on = !on;
        document.title = on ? title : base;
      }, 900);
      document.title = title;
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = null;
      document.title = base;
    };
    const onVis = () => (document.hidden ? start() : stop());
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [active, title, sound]);
}

/** Reactions: a button that opens six quick emotes, and the bubbles both players' emotes appear in. */
/** `place`: a floating button bottom-right (default), top-right, or `inline` where it is rendered (a phone's header). */
export function EmoteBar({ me, latest, onSend, names, place = 'bottom' }: { me: PlayerId; latest: EmoteEvent | null; onSend: (id: EmoteId) => void; names: [string, string]; place?: 'bottom' | 'top' | 'inline' }) {
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(readMuted);
  const [bubbles, setBubbles] = useState<EmoteEvent[]>([]);
  const [cool, setCool] = useState(false);
  const seen = useRef<number>(latest?.at ?? 0);
  useEffect(() => {
    if (!latest || latest.at <= seen.current) return;
    seen.current = latest.at;
    if (latest.seat !== me && muted) return;
    setBubbles((b) => [...b.filter((x) => x.seat !== latest.seat), latest]);
    if (latest.seat !== me) {
      play('emote');
      buzz(12);
    }
    const t = setTimeout(() => setBubbles((b) => b.filter((x) => x !== latest)), 2600);
    return () => clearTimeout(t);
  }, [latest, me, muted]);
  const send = (id: EmoteId) => {
    setOpen(false);
    if (cool) return;
    onSend(id);
    setCool(true);
    setTimeout(() => setCool(false), 2500);
  };
  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* not remembered */
    }
  };
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-14 z-[56] flex justify-between px-4 phone:top-10" aria-live="polite">
        {[me, (1 - me) as PlayerId].map((seat) => {
          const b = bubbles.find((x) => x.seat === seat);
          return (
            <div key={seat} className="w-[45%]" style={{ textAlign: seat === me ? 'left' : 'right' }}>
              {b && (
                <span key={b.at} className="emote-bubble inline-flex items-center gap-1.5 rounded-2xl border-2 bg-black/90 px-3 py-1.5 text-sm font-bold text-ink shadow-xl" style={{ borderColor: PLAYER_COLORS[seat] }}>
                  <span className="text-lg leading-none">{EMOTE_ICON[b.id]}</span>
                  <span className="hidden text-[10px] font-semibold text-mute sm:inline">{names[seat]}:</span>
                  {EMOTE_LABEL[b.id]}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className={place === 'inline' ? 'relative shrink-0' : `fixed z-[57] right-3 ${place === 'top' ? 'top-3' : 'bottom-3'}`} style={place === 'bottom' ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}>
        {open && (
          <div className={`pop absolute right-0 z-[60] ${place === 'bottom' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} grid w-48 grid-cols-3 gap-1 rounded-xl border border-line bg-panel p-1.5 shadow-xl`} role="menu" aria-label="Send a reaction">
            {EMOTES.map((id) => (
              <button key={id} onClick={() => send(id)} role="menuitem" className="flex flex-col items-center rounded-lg px-1 py-1.5 text-[10px] font-semibold text-ink2 hover:bg-white/10" title={EMOTE_LABEL[id]}>
                <span className="text-xl leading-none">{EMOTE_ICON[id]}</span>
                {EMOTE_LABEL[id]}
              </button>
            ))}
            <button onClick={toggleMute} className="col-span-3 mt-0.5 rounded-md border border-line px-1 py-1 text-[10px] text-mute hover:text-ink2">
              {muted ? `Show ${names[1 - me]}'s reactions` : `Mute ${names[1 - me]}'s reactions`}
            </button>
          </div>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={cool}
          className={`grid place-items-center border border-line transition hover:border-accent disabled:opacity-50 ${place === 'inline' ? 'rounded px-1 text-[13px] leading-[18px] text-ink2' : 'h-11 w-11 rounded-full bg-panel/95 text-xl shadow-lg'}`}
          aria-label="Send a reaction"
          aria-expanded={open}
          title="Send a reaction"
        >
          💬
        </button>
      </div>
    </>
  );
}

/** The series score as pips: filled for each win, one row per player. */
export function SeriesPips({ series, me, names, big, tiny }: { series: SeriesView; me: PlayerId; names: [string, string]; big?: boolean; tiny?: boolean }) {
  const need = Math.ceil(series.bestOf / 2);
  const row = (p: PlayerId) => (
    <div className={`flex items-center gap-1.5 ${p === me ? '' : 'flex-row-reverse'}`}>
      {!tiny && (
        <span className={`truncate font-semibold ${big ? 'max-w-[9rem] text-sm' : 'max-w-[5rem] text-[11px]'}`} style={{ color: PLAYER_COLORS[p] }}>
          {p === me ? 'You' : names[p]}
        </span>
      )}
      <span className="flex gap-1">
        {Array.from({ length: need }, (_, i) => {
          const on = i < series.wins[p];
          return <span key={`${i}-${on}`} className={`${on ? 'pip-fill' : ''} inline-block rounded-full border-2 ${big ? 'h-4 w-4' : 'h-2.5 w-2.5'}`} style={{ borderColor: PLAYER_COLORS[p], background: on ? PLAYER_COLORS[p] : 'transparent' }} />;
        })}
      </span>
    </div>
  );
  return (
    <div className={`flex items-center justify-center ${big ? 'gap-4' : 'gap-2'}`} aria-label={`Series: you ${series.wins[me]}, ${names[1 - me]} ${series.wins[1 - me]}`}>
      {row(me)}
      <span className={`font-display font-bold text-mute ${big ? 'text-base' : 'text-[10px]'}`}>
        {big ? `${series.wins[me]} – ${series.wins[1 - me]}` : `G${series.game}`}
      </span>
      {row((1 - me) as PlayerId)}
    </div>
  );
}

/** What the next game means: "Match point", "Decider", or just its number. */
export function stakesOf(series: SeriesView, me: PlayerId, oppName: string): string {
  const need = Math.ceil(series.bestOf / 2);
  const mp = series.wins[me] === need - 1;
  const op = series.wins[1 - me] === need - 1;
  if (mp && op) return 'Decider: winner takes the series';
  if (mp) return 'Match point: win and the series is yours';
  if (op) return `${oppName} is on match point`;
  return `Best of ${series.bestOf}: first to ${need}`;
}

/** The decision clock, shown only in its last half minute (the server moves for you when it runs out). */
export function DeadlineChip({ deadlineAt, mine, name, compact }: { deadlineAt: number | null; mine: boolean; name: string; compact?: boolean }) {
  const now = useNow(500, deadlineAt !== null);
  if (deadlineAt === null) return null;
  const left = Math.ceil((deadlineAt - now) / 1000);
  if (left > 30 || left < 0) return null;
  return (
    <span
      className={`shrink-0 rounded font-display font-bold tabular-nums ${compact ? 'px-1 text-[10px]' : 'px-1.5 py-0.5 text-xs'} ${mine ? (left <= 10 ? 'animate-pulse bg-red-600 text-white' : 'bg-amber-400 text-black') : 'border border-line text-ink2'}`}
      title={mine ? 'When the clock runs out, the server makes a safe move for you.' : `If ${name} doesn't decide in time, the server moves for them.`}
      role="timer"
    >
      ⏱ {mine ? '' : `${name} `}
      {left}s
    </span>
  );
}

/** "GAME 2" across the board as each game after the first begins (and "Rematch · Game 1"). */
export function GameBanner({ series, me, oppName }: { series: SeriesView; me: PlayerId; oppName: string }) {
  const [show, setShow] = useState(series.game > 1 || series.n > 1);
  useEffect(() => {
    if (!show) return;
    play('round');
    const t = setTimeout(() => setShow(false), 2000);
    return () => clearTimeout(t);
  }, [show]);
  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-1/3 z-[58] flex justify-center" role="status">
      <div className="game-banner w-full border-y-2 border-accent/70 bg-black/85 py-3 text-center shadow-2xl">
        <div className="font-display text-3xl font-extrabold uppercase text-accent phone:text-2xl">{series.n > 1 && series.game === 1 ? 'Rematch · ' : ''}Game {series.game}</div>
        <div className="mt-0.5 text-xs font-semibold text-ink2">
          You {series.wins[me]} – {series.wins[1 - me]} {oppName} · {stakesOf(series, me, oppName)}
        </div>
      </div>
    </div>
  );
}
