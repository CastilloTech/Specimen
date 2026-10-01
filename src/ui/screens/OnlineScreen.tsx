import { useEffect, useMemo, useRef, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { ChipArt } from '../components/Emblem';
import { useAttention, useNow } from '../components/OnlineBits';
import { FACTION_META, PLAYER_COLORS, WORLD_FACTION_META } from '../meta';
import { onlineSummary } from '../multiplayer';
import { BEST_OF, codeFrom, createRoom, lastRoom, OnlineConn, ROOM_CODE, roomLink } from '../online';
import { deckOf, myDefaults } from '../picks';
import { buzz, play } from '../sfx';
import { loadSeries } from '../storage';

/**
 * Online play with a friend: create a room and share its 5-letter code (or link), or type a friend's code.
 * You bring your default Specimen and deck (the ones Quick match uses; change them in Custom match or Decks).
 * A room plays a best-of-3; it starts as soon as both players are in, with a moment to see who you're facing.
 */
export function OnlineScreen({ onBack, onStart, initialCode }: { onBack: () => void; onStart: (conn: OnlineConn) => void; initialCode?: string }) {
  const [me] = useState(myDefaults);
  const [code, setCode] = useState(initialCode ?? '');
  const [conn, setConn] = useState<OnlineConn | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [found, setFound] = useState<OnlineConn | null>(null);
  const [rejoin] = useState(lastRoom);
  const [, rerender] = useState(0);
  const started = useRef(false);
  const since = useRef(0);
  const player = { name: me.name, faction: me.faction, worldFaction: me.worldFaction, chip: me.chip, loadout: me.loadout, deck: deckOf(me) };
  const record = useMemo(() => onlineSummary(loadSeries()), []);

  // Follow the connection: when the server sends the first view, the opponent is here. A fresh series gets a
  // short "versus" moment first; rejoining a game in progress goes straight back to the board.
  useEffect(() => {
    if (!conn) return;
    const off = conn.subscribe(() => {
      if (conn.view && !started.current) {
        started.current = true;
        const fresh = conn.view.state.phase === 'mulligan' && conn.view.series.game === 1 && conn.view.state.round <= 1;
        if (!fresh) return onStart(conn);
        play('found');
        buzz([30, 40, 30]);
        setFound(conn);
        setTimeout(() => onStart(conn), 1700);
      } else rerender((x) => x + 1);
    });
    return () => {
      off();
      if (!started.current) conn.close();
    };
  }, [conn, onStart]);

  const enter = (c: string) => {
    setErr(null);
    since.current = Date.now();
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
  // Typing (or pasting) a whole code joins: no extra tap.
  const onType = (text: string) => {
    const c = codeFrom(text);
    setCode(c);
    if (ROOM_CODE.test(c) && !conn) enter(c);
  };

  const share = async () => {
    const url = roomLink(code);
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await nav.share({ title: 'Specimen', text: `Play me in Specimen: best of ${BEST_OF}. Room ${code}`, url });
        return;
      } catch {
        /* closed the share sheet: fall back to copying */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setErr('Copy failed: share the code instead.');
    }
  };
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the code is on screen to read out */
    }
  };
  const status = conn?.status;
  const waiting = !!conn && (status === 'waiting' || status === 'connecting');
  const now = useNow(1000, waiting);
  const waited = Math.max(0, Math.floor((now - since.current) / 1000));
  // You went to send the link: the tab blinks when they arrive.
  useAttention(!!found, 'Opponent found · Specimen', 'found');

  if (found?.view) {
    const v = found.view;
    const opp = v.state.players[1 - v.seat];
    const mine = v.state.players[v.seat];
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 overflow-hidden p-4 phone:gap-3" role="status" aria-live="assertive">
        <div className="lab-label">Opponent found · best of {BEST_OF}</div>
        <div className="flex w-full max-w-2xl items-center justify-center gap-4 phone:gap-2">
          {[mine, opp].map((p, i) => (
            <div key={p.id} className={`${i === 0 ? 'vs-left' : 'vs-right'} flex min-w-0 flex-1 flex-col items-center gap-2 text-center`}>
              <span className="flex -space-x-3">
                <ChipArt id={p.faction} size={64} className="phone:h-12! phone:w-12!" />
                <ChipArt id={p.worldFaction} size={64} className="phone:h-12! phone:w-12!" />
              </span>
              <span className="max-w-full truncate font-display text-2xl font-extrabold phone:text-lg" style={{ color: PLAYER_COLORS[p.id] }}>
                {p.name}
              </span>
              <span className="text-xs text-ink2">
                <span style={{ color: FACTION_META[p.faction].color }}>{FACTION_META[p.faction].name}</span> / <span style={{ color: WORLD_FACTION_META[p.worldFaction].color }}>{WORLD_FACTION_META[p.worldFaction].name}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="vs-mid font-display text-5xl font-extrabold text-accent phone:text-3xl">VS</div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 p-3">
      <ScreenHeader title="Play online" sub={`With a friend · best of ${BEST_OF}`} onBack={onBack} />

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
        {record.series > 0 && (
          <div className="shrink-0 text-right" title="Your online series record (Saves → Multiplayer)">
            <div className="font-display text-lg font-bold leading-none">
              {record.won}–{record.lost}
            </div>
            <div className="text-[10px] text-mute">series</div>
          </div>
        )}
      </section>

      {!conn ? (
        <>
          {rejoin && (
            <button onClick={() => enter(rejoin)} className="turn-glow rounded-xl border-2 border-accent px-4 py-2.5 font-display font-bold text-accent">
              Rejoin room {rejoin} ▶
            </button>
          )}
          <button onClick={host} disabled={busy} data-primary className="rounded-xl bg-accent px-4 py-3 font-display font-bold text-black disabled:opacity-50">
            {busy ? 'Creating a room…' : 'Create a room'}
          </button>
          <div className="text-center text-xs text-mute">or type (or paste) a friend's code</div>
          <input
            value={code}
            onChange={(e) => onType(e.target.value)}
            onPaste={(e) => {
              e.preventDefault();
              onType(e.clipboardData.getData('text'));
            }}
            placeholder="ABCDE"
            maxLength={60}
            aria-label="Room code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border border-line bg-black/30 px-3 py-2.5 text-center font-display text-2xl tracking-[0.4em] uppercase"
          />
        </>
      ) : (
        <section className="lab-panel flex flex-col items-center gap-3 rounded-xl border-2 border-accent/60 p-4 text-center" aria-live="polite">
          {waiting && (
            <div className="relative grid h-24 w-24 place-items-center" aria-hidden>
              <span className="radar-ping absolute inset-0 rounded-full border-2 border-accent/70" />
              <span className="radar-ping radar-ping-2 absolute inset-0 rounded-full border-2 border-accent/70" />
              <span className="flex -space-x-2">
                <ChipArt id={me.faction} size={34} />
                <ChipArt id={me.worldFaction} size={34} />
              </span>
            </div>
          )}
          <div className="lab-label">Room code</div>
          <button onClick={copyCode} className="font-display text-4xl font-extrabold tracking-[0.35em] text-accent" title="Copy the code">
            {conn.code}
          </button>
          {waiting ? (
            <>
              <p className="text-sm text-ink2">
                {status === 'connecting' ? 'Connecting to the room…' : 'Waiting for your opponent. Send them the code or the link: the match starts the moment they join.'}
              </p>
              <button onClick={share} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-black">
                {copied ? 'Link copied ✓' : 'Send invite link'}
              </button>
              {status === 'waiting' && <span className="text-[11px] tabular-nums text-mute">waiting {waited < 60 ? `${waited}s` : `${Math.floor(waited / 60)}m ${waited % 60}s`} · you'll hear it when they arrive</span>}
            </>
          ) : status === 'reconnecting' ? (
            <p className="text-sm text-amber-200">Connection lost: retrying…</p>
          ) : null}
          <button
            onClick={() => {
              conn.leave();
              setConn(null);
              setCode('');
            }}
            className="text-xs text-mute underline"
          >
            Cancel
          </button>
        </section>
      )}
      {(err || conn?.error) && <p className="rounded-lg border border-red-500/40 bg-red-950/30 p-2 text-xs text-red-200">{err ?? conn?.error}</p>}
      <p className="mt-auto text-[11px] leading-snug text-mute">
        Each room plays a best of {BEST_OF}: the first to win two games takes the series, and you can rematch in the same room. The match runs on the server, which shows each player only what they may see. If your connection drops you rejoin your seat automatically; a player away for 3 minutes forfeits the series.
      </p>
    </div>
  );
}
