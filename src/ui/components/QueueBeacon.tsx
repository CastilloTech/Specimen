import { useEffect } from 'react';
import { JOIN_WINDOW_MS, matchmaker, useMatchmaker } from '../matchmaker';
import { buzz, play } from '../sfx';
import { useAttention, useNow } from './OnlineBits';

/**
 * Away from the online screen while still in the queue (playing a bot while you wait): a small pill says the
 * search goes on, and when a stranger is found a call-up offers to join (the bot game is left behind).
 */
export function QueueBeacon({ show, onJoin }: { show: boolean; onJoin: () => void }) {
  const mm = useMatchmaker();
  const found = show && mm.status === 'matched' ? mm.found : null;
  const now = useNow(1000, show && (mm.status === 'searching' || !!found));
  const left = found ? Math.max(0, Math.ceil((found.at + JOIN_WINDOW_MS - now) / 1000)) : 0;
  useEffect(() => {
    if (!found) return;
    play('found');
    buzz([30, 40, 30, 40, 30]);
  }, [found]);
  // Too late: the room gives up on you, and the other player goes back to the queue.
  useEffect(() => {
    if (found && left === 0) matchmaker.decline();
  }, [found, left]);
  useAttention(!!found, 'Opponent found · Specimen', 'found');

  if (found)
    return (
      <div className="fixed inset-x-0 top-2 z-[80] flex justify-center px-2" role="alertdialog" aria-label="Opponent found">
        <div className="pop turn-glow flex w-full max-w-md items-center gap-3 rounded-xl border-2 border-accent bg-panel p-3 shadow-2xl">
          <div className="min-w-0 flex-1">
            <div className="font-display text-sm font-bold text-accent">Opponent found: {found.opponent}</div>
            <div className="text-[11px] text-ink2">Join now, or the match is called off in {left}s.</div>
          </div>
          <button onClick={() => matchmaker.decline()} className="shrink-0 rounded-lg border border-line px-2 py-2 text-xs text-ink2">
            Not now
          </button>
          <button onClick={onJoin} autoFocus className="shrink-0 rounded-lg bg-accent px-3 py-2 font-display text-sm font-bold text-black">
            Join ▶
          </button>
        </div>
      </div>
    );
  if (!show || mm.status !== 'searching' || !mm.since) return null;
  const s = Math.max(0, Math.floor((now - mm.since) / 1000));
  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-[70]" role="status">
      <span className="pointer-events-auto flex items-center gap-2 rounded-full border border-accent/60 bg-black/85 py-1 pl-3 pr-1 text-[11px] font-semibold text-accent shadow-lg">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        Searching for an opponent · {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
        <button onClick={() => matchmaker.cancel()} className="rounded-full px-1.5 text-mute hover:text-ink" aria-label="Stop searching">
          ✕
        </button>
      </span>
    </div>
  );
}
