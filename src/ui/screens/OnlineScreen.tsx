import { useEffect, useMemo, useRef, useState } from 'react';
import type { Faction, WorldFactionId } from '../../engine';
import { ScreenHeader } from '../components/ScreenHeader';
import { ChipArt } from '../components/Emblem';
import { useAttention, useNow } from '../components/OnlineBits';
import { checkName, NAME_MAX } from '../../../server/names';
import { loadBlocked, onlineName, setOnlineName, suggestName, unblock } from '../device';
import { matchmaker, useMatchmaker } from '../matchmaker';
import { FACTION_META, PLAYER_COLORS, WORLD_FACTION_META } from '../meta';
import { onlineSummary } from '../multiplayer';
import { BEST_OF, codeFrom, createRoom, lastRoom, OnlineConn, ROOM_CODE, roomLink } from '../online';
import { deckOf, myDefaults } from '../picks';
import { buzz, play } from '../sfx';
import { activeSave, loadSeries } from '../storage';

/** After this long searching, offer a bot game while the search goes on. */
const BOT_OFFER_MS = 30_000;

const clock = (s: number) => (s < 60 ? `0:${String(s).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

/**
 * Online play. Against a stranger: Find an opponent (the casual queue, under the name you chose for strangers).
 * With a friend: create a room and share its 5-letter code (or link), or type a friend's code (your save's name).
 * You bring your default Specimen and deck (the ones Quick match uses; change them in Custom match or Decks).
 * Every room plays a best of 3, and starts with a moment to see who you're facing.
 */
export function OnlineScreen({ onBack, onStart, initialCode, onBotWait }: { onBack: () => void; onStart: (conn: OnlineConn) => void; initialCode?: string; onBotWait: () => void }) {
  const [me] = useState(myDefaults);
  const [code, setCode] = useState(initialCode ?? '');
  const [conn, setConn] = useState<OnlineConn | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [found, setFound] = useState<OnlineConn | null>(null);
  const [rejoin] = useState(lastRoom);
  const [strangerName, setStrangerName] = useState(onlineName);
  const [naming, setNaming] = useState(false);
  /** The opponent the queue found, while joining their room. */
  const [queueOpp, setQueueOpp] = useState<string | null>(null);
  const [, rerender] = useState(0);
  const started = useRef(false);
  const since = useRef(0);
  const mm = useMatchmaker();
  const player = { name: me.name, faction: me.faction, worldFaction: me.worldFaction, chip: me.chip, loadout: me.loadout, deck: deckOf(me) };
  const record = useMemo(() => onlineSummary(loadSeries()), []);
  // Read inside the room's listener without re-subscribing (which would close a room still being joined).
  const latest = useRef({ queueOpp, strangerName });
  latest.current = { queueOpp, strangerName };

  // The queue's connection stays up while this screen is open (for the live counts).
  useEffect(() => matchmaker.watch(), []);

  // Follow the room: when the server sends the first view, the opponent is here. A fresh series gets a short
  // "versus" moment first; rejoining a game in progress goes straight back to the board. A queue room whose
  // other player never arrived sends you back into the queue, keeping your place.
  useEffect(() => {
    if (!conn) return;
    const off = conn.subscribe(() => {
      if (conn.status === 'noshow') {
        conn.close();
        setConn(null);
        const { queueOpp: who, strangerName: as } = latest.current;
        setNotice(`${who ?? 'Your opponent'} couldn't join right now. You're back in the queue, in the same place.`);
        setQueueOpp(null);
        if (as) matchmaker.find(as, true);
        return;
      }
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

  const enter = (c: string, as = player) => {
    setErr(null);
    setNotice(null);
    since.current = Date.now();
    setConn(new OnlineConn(c, as));
  };
  // The queue found someone: into their room, under your stranger name.
  useEffect(() => {
    if (mm.status !== 'matched' || !mm.found || conn || !strangerName) return;
    const f = mm.found;
    matchmaker.clearFound();
    setQueueOpp(f.opponent);
    enter(f.code, { ...player, name: strangerName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mm.status, mm.found, conn, strangerName]);

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

  const searching = mm.status === 'searching';
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 p-3">
      <ScreenHeader title="Play online" sub={`Best of ${BEST_OF}, against a stranger or a friend`} onBack={onBack} />

      <section className="lab-panel flex items-center gap-3 rounded-xl border border-line p-3">
        <div className="flex shrink-0 -space-x-2">
          <ChipArt id={me.faction} size={36} />
          <ChipArt id={me.worldFaction} size={36} />
        </div>
        <div className="min-w-0 flex-1 text-sm">
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

      {notice && <p className="rounded-lg border border-amber-400/40 bg-amber-950/30 p-2 text-xs text-amber-100">{notice}</p>}

      {conn && queueOpp ? (
        <section className="lab-panel flex flex-col items-center gap-2 rounded-xl border-2 border-accent/60 p-4 text-center" aria-live="polite">
          <div className="lab-label">Opponent found</div>
          <div className="font-display text-2xl font-bold" style={{ color: PLAYER_COLORS[1] }}>
            {queueOpp}
          </div>
          <p className="text-sm text-ink2">{status === 'reconnecting' ? 'Connection lost: retrying…' : 'Joining the match…'}</p>
        </section>
      ) : conn ? (
        <section className="lab-panel flex flex-col items-center gap-3 rounded-xl border-2 border-accent/60 p-4 text-center" aria-live="polite">
          {waiting && <Radar faction={me.faction} worldFaction={me.worldFaction} />}
          <div className="lab-label">Room code</div>
          <button onClick={copyCode} className="font-display text-4xl font-extrabold tracking-[0.35em] text-accent" title="Copy the code">
            {conn.code}
          </button>
          {waiting ? (
            <>
              <p className="text-sm text-ink2">{status === 'connecting' ? 'Connecting to the room…' : 'Waiting for your friend. Send them the code or the link: the match starts the moment they join.'}</p>
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
      ) : searching ? (
        <SearchPanel faction={me.faction} worldFaction={me.worldFaction} name={strangerName ?? ''} onBotWait={onBotWait} />
      ) : (
        <>
          <section className="lab-panel flex flex-col gap-2 rounded-xl border border-line p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-display text-base font-bold">Against a stranger</h2>
              {mm.counts && (
                <span className="text-[11px] text-mute">
                  {mm.counts.searching} searching · {mm.counts.recent} match{mm.counts.recent === 1 ? '' : 'es'} this hour
                </span>
              )}
            </div>
            {!strangerName || naming ? (
              <NamePicker
                initial={strangerName ?? suggestName(activeSave()?.meta.name)}
                onSave={(n) => {
                  setOnlineName(n);
                  setStrangerName(n);
                  setNaming(false);
                }}
                onCancel={strangerName ? () => setNaming(false) : undefined}
              />
            ) : mm.status === 'cooldown' && mm.cooldownUntil ? (
              <Cooldown until={mm.cooldownUntil} />
            ) : (
              <>
                <button
                  onClick={() => {
                    setNotice(null);
                    matchmaker.find(strangerName);
                  }}
                  data-primary
                  className="rounded-xl bg-accent px-4 py-3 font-display font-bold text-black"
                >
                  Find an opponent ▶
                </button>
                <div className="text-center text-[11px] text-mute">
                  Strangers see you as <b className="text-ink2">{strangerName}</b> ·{' '}
                  <button onClick={() => setNaming(true)} className="underline hover:text-ink2">
                    change
                  </button>
                </div>
              </>
            )}
            {mm.error && <p className="text-xs text-red-300">{mm.error}</p>}
          </section>

          <section className="lab-panel flex flex-col gap-2 rounded-xl border border-line p-3">
            <h2 className="font-display text-base font-bold">With a friend</h2>
            {rejoin && (
              <button onClick={() => enter(rejoin)} className="turn-glow rounded-xl border-2 border-accent px-4 py-2.5 font-display font-bold text-accent">
                Rejoin room {rejoin} ▶
              </button>
            )}
            <button onClick={host} disabled={busy} className="rounded-xl border border-accent/70 px-4 py-2.5 font-display font-bold text-accent disabled:opacity-50">
              {busy ? 'Creating a room…' : 'Create a room'}
            </button>
            <input
              value={code}
              onChange={(e) => onType(e.target.value)}
              onPaste={(e) => {
                e.preventDefault();
                onType(e.clipboardData.getData('text'));
              }}
              placeholder="or type a code"
              maxLength={60}
              aria-label="Room code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-line bg-black/30 px-3 py-2 text-center font-display text-xl tracking-[0.3em] uppercase placeholder:text-sm placeholder:tracking-normal placeholder:normal-case"
            />
            <div className="text-center text-[11px] text-mute">Friends see your save's name, {me.name}.</div>
          </section>
          <BlockedList />
        </>
      )}
      {(err || conn?.error) && <p className="rounded-lg border border-red-500/40 bg-red-950/30 p-2 text-xs text-red-200">{err ?? conn?.error}</p>}
      <p className="mt-auto text-[11px] leading-snug text-mute">
        Every match is a best of {BEST_OF}: the first to win two games takes the series. The match runs on the server, which shows each player only what they may see. Strangers can only send quick reactions, never messages. If your connection drops you rejoin your seat automatically; a player away for 3 minutes forfeits the series.
      </p>
    </div>
  );
}

function Radar({ faction, worldFaction }: { faction: Faction; worldFaction: WorldFactionId }) {
  return (
    <div className="relative grid h-24 w-24 place-items-center" aria-hidden>
      <span className="radar-ping absolute inset-0 rounded-full border-2 border-accent/70" />
      <span className="radar-ping radar-ping-2 absolute inset-0 rounded-full border-2 border-accent/70" />
      <span className="flex -space-x-2">
        <ChipArt id={faction} size={34} />
        <ChipArt id={worldFaction} size={34} />
      </span>
    </div>
  );
}

/** Searching the queue: how long, who else is looking, and (after a while) a bot game while you wait. */
function SearchPanel({ faction, worldFaction, name, onBotWait }: { faction: Faction; worldFaction: WorldFactionId; name: string; onBotWait: () => void }) {
  const mm = useMatchmaker();
  const now = useNow(1000);
  const waited = mm.since ? Math.max(0, Math.floor((now - mm.since) / 1000)) : 0;
  const others = Math.max(0, (mm.counts?.searching ?? 1) - 1);
  return (
    <section className="lab-panel flex flex-col items-center gap-2 rounded-xl border-2 border-accent/60 p-4 text-center" aria-live="polite">
      <Radar faction={faction} worldFaction={worldFaction} />
      <div className="font-display text-lg font-bold">Searching for an opponent</div>
      <div className="font-display text-2xl tabular-nums text-accent">{clock(waited)}</div>
      <div className="text-[11px] text-mute">
        as {name} · {others === 0 ? 'nobody else is searching right now' : `${others} other${others === 1 ? '' : 's'} searching`}
        {mm.counts ? ` · ${mm.counts.recent} match${mm.counts.recent === 1 ? '' : 'es'} this hour` : ''}
      </div>
      {waited * 1000 >= BOT_OFFER_MS && (
        <div className="pop mt-1 flex w-full flex-col gap-1.5 rounded-lg border border-line bg-black/25 p-2">
          <p className="text-xs text-ink2">Quiet right now. Play a bot while you wait: you stay in the queue, and we'll call you the moment someone is found.</p>
          <button onClick={onBotWait} className="rounded-lg bg-accent px-3 py-2 text-sm font-bold text-black">
            Play a bot while you wait ▶
          </button>
        </div>
      )}
      <button onClick={() => matchmaker.cancel()} className="mt-1 text-xs text-mute underline">
        Stop searching
      </button>
    </section>
  );
}

/** Choosing the name strangers see: checked as you type (the server checks again). */
function NamePicker({ initial, onSave, onCancel }: { initial: string; onSave: (name: string) => void; onCancel?: () => void }) {
  const [draft, setDraft] = useState(initial);
  const check = checkName(draft);
  const touched = draft.length > 0;
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (check.ok) onSave(check.name);
      }}
    >
      <label className="text-xs text-ink2" htmlFor="online-name">
        Pick the name strangers will see. Your friends still see your save's name.
      </label>
      <div className="flex gap-2">
        <input
          id="online-name"
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, NAME_MAX + 4))}
          autoComplete="off"
          spellCheck={false}
          placeholder="Your online name"
          className="min-w-0 flex-1 rounded-lg border border-line bg-black/30 px-3 py-2 text-sm"
          aria-invalid={touched && !check.ok}
          aria-describedby="online-name-help"
        />
        <button type="submit" disabled={!check.ok} className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-black disabled:opacity-40">
          Save
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="shrink-0 rounded-lg border border-line px-2 py-2 text-xs text-ink2">
            Cancel
          </button>
        )}
      </div>
      <div id="online-name-help" className={`text-[11px] ${touched && !check.ok ? 'text-amber-200' : 'text-mute'}`}>
        {touched && !check.ok ? check.reason : `${NAME_MAX} characters at most: letters, numbers, spaces and _ . ' -`}
      </div>
    </form>
  );
}

function Cooldown({ until }: { until: number }) {
  const now = useNow(1000);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => {
    if (left === 0) matchmaker.clearCooldown();
  }, [left]);
  return (
    <p className="rounded-lg border border-amber-400/40 bg-amber-950/30 p-2 text-center text-xs text-amber-100">
      You left several matches with strangers recently. You can search again in <b className="tabular-nums">{clock(left)}</b>. Friend rooms are open as usual.
    </p>
  );
}

function BlockedList() {
  const [list, setList] = useState(loadBlocked);
  if (!list.length) return null;
  return (
    <details className="lab-panel rounded-xl border border-line px-3 py-2 text-sm">
      <summary className="cursor-pointer text-xs text-ink2">Blocked players ({list.length}): you're never matched with them</summary>
      <ul className="mt-2 flex flex-col gap-1">
        {list.map((b) => (
          <li key={b.id} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{b.name}</span>
            <span className="text-mute">{new Date(b.at).toLocaleDateString()}</span>
            <button
              onClick={() => {
                unblock(b.id);
                setList(loadBlocked());
              }}
              className="rounded border border-line px-2 py-0.5 text-ink2"
            >
              Unblock
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
