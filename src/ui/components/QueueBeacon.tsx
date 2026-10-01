import { useEffect } from 'react';
import { JOIN_WINDOW_MS, matchmaker, useMatchmaker } from '../matchmaker';
import type { Incoming } from '../matchmaker';
import { buzz, play } from '../sfx';
import { useAttention, useNow } from './OnlineBits';
import { ProfileCard } from './ProfileCard';

/**
 * The lounge, reaching you wherever you are in the game:
 * - a challenge (Yes / No, with its clock) or a friend request pops up, except while a game is being played;
 * - away from the lounge while still searching (tuning a deck, say), a pill says the search goes on, and when a
 *   stranger is found a call-up offers to join;
 * - the lounge's short notices ("Report sent", "Ben said no this time").
 * `where`: on the lounge screen, in an online match, or anywhere else.
 */
export function QueueBeacon({ where, onJoin }: { where: 'lounge' | 'match' | 'away'; onJoin: () => void }) {
  const mm = useMatchmaker();
  const away = where === 'away';
  const found = away && mm.status === 'matched' ? mm.found : null;
  const now = useNow(1000, (away && (mm.status === 'searching' || !!found || !!mm.outgoing)) || mm.incoming.length > 0);
  const left = found ? Math.max(0, Math.ceil((found.at + JOIN_WINDOW_MS - now) / 1000)) : 0;
  const prompts = !mm.quiet;

  // A challenge you said yes to from elsewhere: straight to the match, no second question.
  useEffect(() => {
    if (found?.via === 'challenge') onJoin();
  }, [found, onJoin]);
  useEffect(() => {
    if (!found || found.via === 'challenge') return;
    play('found');
    buzz([30, 40, 30, 40, 30]);
  }, [found]);
  // Too late: the room gives up on you, and the other player goes back to the queue.
  useEffect(() => {
    if (found && found.via === 'queue' && left === 0) matchmaker.decline();
  }, [found, left]);
  const firstIncoming = prompts ? mm.incoming[0] : undefined;
  useEffect(() => {
    if (!firstIncoming) return;
    play('found');
    buzz([20, 30, 20]);
  }, [firstIncoming?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useAttention(!!found || !!firstIncoming, firstIncoming ? `${firstIncoming.from.name} challenges you · Specimen` : 'Opponent found · Specimen', 'found');
  // Notices fade after a few seconds.
  useEffect(() => {
    if (!mm.toast) return;
    const t = setTimeout(() => matchmaker.clearToast(), 4000);
    return () => clearTimeout(t);
  }, [mm.toast]);

  const s = mm.since ? Math.max(0, Math.floor((now - mm.since) / 1000)) : 0;
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-2 z-[80] flex flex-col items-center gap-2 px-2">
        {prompts && mm.incoming.map((c) => <ChallengeCard key={c.id} c={c} now={now} />)}
        {prompts &&
          mm.friendReqs.map((f) => (
            <div key={f.id} className="pop pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-xl border border-sky-400/60 bg-panel p-2.5 shadow-2xl" role="alertdialog" aria-label={`${f.name} wants to be friends`}>
              <ProfileCard p={f} className="flex-1" tag={<span className="text-[10px] font-semibold text-sky-300">wants to be friends</span>} />
              <button onClick={() => matchmaker.answerFriend(f, false)} className="shrink-0 rounded-lg border border-line px-2 py-1.5 text-xs text-ink2">
                No thanks
              </button>
              <button onClick={() => matchmaker.answerFriend(f, true)} className="shrink-0 rounded-lg bg-sky-400 px-3 py-1.5 text-xs font-bold text-black">
                Accept
              </button>
            </div>
          ))}
        {found && found.via === 'queue' && (
          <div className="pop turn-glow pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border-2 border-accent bg-panel p-3 shadow-2xl" role="alertdialog" aria-label="Opponent found">
            <div className="min-w-0 flex-1">
              {found.profile ? <ProfileCard p={found.profile} tag={<span className="text-[10px] font-semibold text-accent">found</span>} /> : <div className="font-display text-sm font-bold text-accent">Opponent found: {found.opponent}</div>}
              <div className="mt-0.5 text-[11px] text-ink2">Join now, or the match is called off in {left}s.</div>
            </div>
            <button onClick={() => matchmaker.decline()} className="shrink-0 rounded-lg border border-line px-2 py-2 text-xs text-ink2">
              Not now
            </button>
            <button onClick={onJoin} autoFocus className="shrink-0 rounded-lg bg-accent px-3 py-2 font-display text-sm font-bold text-black">
              Join ▶
            </button>
          </div>
        )}
        {mm.toast && (
          <div className={`pop pointer-events-auto rounded-full border bg-black/90 px-3 py-1.5 text-xs font-semibold shadow-lg ${mm.toast.kind === 'error' ? 'border-amber-400/60 text-amber-100' : 'border-accent/60 text-ink'}`} role="status" onClick={() => matchmaker.clearToast()}>
            {mm.toast.text}
          </div>
        )}
      </div>
      {away && !found && (mm.status === 'searching' || mm.outgoing) && (
        <div className="pointer-events-none fixed bottom-2 left-2 z-[70]" role="status">
          <span className="pointer-events-auto flex items-center gap-2 rounded-full border border-accent/60 bg-black/85 py-1 pl-3 pr-1 text-[11px] font-semibold text-accent shadow-lg">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            {mm.outgoing ? `Waiting for an answer · ${Math.max(0, Math.ceil((mm.outgoing.until - now) / 1000))}s` : `Searching for an opponent · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}
            <button onClick={() => (mm.outgoing ? matchmaker.withdraw() : matchmaker.cancel())} className="rounded-full px-1.5 text-mute hover:text-ink" aria-label={mm.outgoing ? 'Withdraw the challenge' : 'Stop searching'}>
              ✕
            </button>
          </span>
        </div>
      )}
    </>
  );
}

function ChallengeCard({ c, now }: { c: Incoming; now: number }) {
  const left = Math.max(0, Math.ceil((c.until - now) / 1000));
  useEffect(() => {
    if (left === 0) matchmaker.expireIncoming(c.id);
  }, [left, c.id]);
  return (
    <div className="pop turn-glow pointer-events-auto w-full max-w-md rounded-xl border-2 border-accent bg-panel p-3 shadow-2xl" role="alertdialog" aria-label={`${c.from.name} challenges you`}>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">Challenge · best of 3</div>
      <ProfileCard p={c.from} />
      <div className="mt-2 flex items-center gap-2">
        <span className="flex-1 text-[11px] tabular-nums text-mute">answer in {left}s</span>
        <button onClick={() => matchmaker.answer(c.id, false)} className="rounded-lg border border-line px-3 py-2 text-sm text-ink2">
          No
        </button>
        <button onClick={() => matchmaker.answer(c.id, true)} autoFocus className="rounded-lg bg-accent px-4 py-2 font-display text-sm font-bold text-black">
          Yes, play ▶
        </button>
      </div>
    </div>
  );
}
