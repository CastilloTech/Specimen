import { useEffect, useRef, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { ChipArt } from '../components/Emblem';
import { FACTION_META, WORLD_FACTION_META } from '../meta';
import { createRoom, normalizeCode, OnlineConn, ROOM_CODE, roomLink } from '../online';
import { deckOf, myDefaults } from '../picks';

/**
 * Online play with a friend: create a room and share its 5-letter code (or link), or type a friend's code.
 * You bring your default Specimen and deck (the ones Quick match uses; change them in Custom match or Decks).
 * The match starts as soon as both players are in.
 */
export function OnlineScreen({ onBack, onStart, initialCode }: { onBack: () => void; onStart: (conn: OnlineConn) => void; initialCode?: string }) {
  const [me] = useState(myDefaults);
  const [code, setCode] = useState(initialCode ?? '');
  const [conn, setConn] = useState<OnlineConn | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [, rerender] = useState(0);
  const started = useRef(false);
  const player = { name: me.name, faction: me.faction, worldFaction: me.worldFaction, chip: me.chip, loadout: me.loadout, deck: deckOf(me) };

  // Follow the connection: once the server sends the first view, the match screen takes over.
  useEffect(() => {
    if (!conn) return;
    const off = conn.subscribe(() => {
      if (conn.view && !started.current) {
        started.current = true;
        onStart(conn);
      } else rerender((x) => x + 1);
    });
    return () => {
      off();
      if (!started.current) conn.close();
    };
  }, [conn, onStart]);

  const enter = (c: string) => {
    setErr(null);
    setConn(new OnlineConn(c, player));
  };
  const host = async () => {
    setBusy(true);
    setErr(null);
    try {
      const c = await createRoom();
      setCode(c);
      enter(c);
    } catch (e) {
      setErr(`Couldn't reach the match server. ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  // Opened from a room link: join straight away.
  useEffect(() => {
    if (initialCode && ROOM_CODE.test(initialCode)) enter(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(roomLink(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setErr('Copy failed: share the code instead.');
    }
  };
  const status = conn?.status;
  const waiting = conn && (status === 'waiting' || status === 'connecting');

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 p-3">
      <ScreenHeader title="Play online" sub="With a friend, by room code" onBack={onBack} />

      <section className="lab-panel flex items-center gap-3 rounded-xl border border-line p-3">
        <div className="flex shrink-0 -space-x-2">
          <ChipArt id={me.faction} size={36} />
          <ChipArt id={me.worldFaction} size={36} />
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-display font-bold">{me.name}</div>
          <div className="truncate text-xs text-ink2">
            <span style={{ color: FACTION_META[me.faction].color }}>{FACTION_META[me.faction].name}</span> / <span style={{ color: WORLD_FACTION_META[me.worldFaction].color }}>{WORLD_FACTION_META[me.worldFaction].name}</span> · {me.deckId === 'starter' ? 'starter deck' : 'your saved deck'}
          </div>
          <div className="text-[11px] text-mute">Your default Specimen: change it in Custom match.</div>
        </div>
      </section>

      {!conn ? (
        <>
          <button onClick={host} disabled={busy} data-primary className="rounded-xl bg-accent px-4 py-3 font-display font-bold text-black disabled:opacity-50">
            {busy ? 'Creating a room…' : 'Create a room'}
          </button>
          <div className="text-center text-xs text-mute">or join a friend's room</div>
          <div className="flex gap-2">
            <input value={code} onChange={(e) => setCode(normalizeCode(e.target.value))} placeholder="ABCDE" maxLength={5} aria-label="Room code" className="min-w-0 flex-1 rounded-xl border border-line bg-black/30 px-3 py-2.5 text-center font-display text-xl tracking-[0.4em] uppercase" />
            <button onClick={() => enter(code)} disabled={!ROOM_CODE.test(code)} className="shrink-0 rounded-xl border border-accent/60 px-4 py-2.5 font-semibold text-accent disabled:opacity-40">
              Join
            </button>
          </div>
        </>
      ) : (
        <section className="lab-panel flex flex-col items-center gap-3 rounded-xl border-2 border-accent/60 p-4 text-center" aria-live="polite">
          <div className="lab-label">Room code</div>
          <div className="font-display text-4xl font-extrabold tracking-[0.35em] text-accent">{conn.code}</div>
          {waiting ? (
            <>
              <p className="text-sm text-ink2">{status === 'connecting' ? 'Connecting to the room…' : 'Waiting for your opponent. Send them the code or the link.'}</p>
              <button onClick={copyLink} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold">
                {copied ? 'Link copied' : 'Copy invite link'}
              </button>
            </>
          ) : status === 'reconnecting' ? (
            <p className="text-sm text-amber-200">Connection lost: retrying…</p>
          ) : null}
          <button
            onClick={() => {
              conn.close();
              setConn(null);
            }}
            className="text-xs text-mute underline"
          >
            Cancel
          </button>
        </section>
      )}
      {(err || conn?.error) && <p className="rounded-lg border border-red-500/40 bg-red-950/30 p-2 text-xs text-red-200">{err ?? conn?.error}</p>}
      <p className="mt-auto text-[11px] leading-snug text-mute">
        The match runs on the server, which shows each player only what they may see. If your connection drops you rejoin your seat automatically; a player away for 3 minutes forfeits.
      </p>
    </div>
  );
}
