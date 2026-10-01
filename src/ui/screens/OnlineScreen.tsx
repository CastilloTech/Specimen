import { useEffect, useMemo, useRef, useState } from 'react';
import type { Faction, WorldFactionId } from '../../engine';
import { ScreenHeader } from '../components/ScreenHeader';
import { ChipArt } from '../components/Emblem';
import { useAttention, useNow } from '../components/OnlineBits';
import { EmblemPicker, ProfileBadge, ProfileCard } from '../components/ProfileCard';
import { checkName, CHAT_MAX, NAME_MAX } from '../../../server/names';
import { alwaysRandomLounge, block, chatHidden, isFriend, keepSearching, loadBlocked, loadEmblem, loadFriends, onlineName, removeFriend, saveEmblem, setAlwaysRandomLounge, setChatHidden, setKeepSearching, setOnlineName, suggestName, unblock } from '../device';
import { IDLE_MS, IDLE_WARN_MS, LOUNGE_SIZE, matchmaker, mentions, myProfile, useMatchmaker } from '../matchmaker';
import type { ChatMsg, FriendOnline, PresenceEntry, Profile } from '../matchmaker';
import { FACTION_META, PLAYER_COLORS, WORLD_FACTION_META } from '../meta';
import { BEST_OF, codeFrom, createRoom, lastRoom, OnlineConn, ROOM_CODE, roomLink } from '../online';
import { ONLINE_DAILY_REWARD, ONLINE_DAILY_TEXT, onlineDailyDone } from '../onlineDaily';
import { deckOf, myDefaults } from '../picks';
import { buzz, play } from '../sfx';
import { activeSave } from '../storage';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const REPORT_REASONS = ['Offensive message or name', 'Harassment', 'Sharing personal info', 'Something else'] as const;

/**
 * The lounge: where online play starts. Everyone in online play is here. You see who's around (with their profile
 * cards), chat, challenge someone directly (they answer yes or no), search the casual queue, or play a friend
 * with a room code. Every match is a best of 3, and starts with a moment to see who you're facing.
 */
export function OnlineScreen({ onBack, onStart, initialCode, onDecks }: { onBack: () => void; onStart: (conn: OnlineConn) => void; initialCode?: string; onDecks: () => void }) {
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
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  /** The opponent the lounge found (queue or challenge), while joining their room. */
  const [queueOpp, setQueueOpp] = useState<string | null>(null);
  const [, rerender] = useState(0);
  const started = useRef(false);
  const since = useRef(0);
  const mm = useMatchmaker();
  const player = { name: me.name, faction: me.faction, worldFaction: me.worldFaction, chip: me.chip, loadout: me.loadout, deck: deckOf(me) };
  // Read inside the room's listener without re-subscribing (which would close a room still being joined).
  const latest = useRef({ queueOpp });
  latest.current = { queueOpp };

  // In the lounge: free to be challenged (and your card reflects your current Specimen). The match screen is
  // fetched now, so a found match goes straight to the versus moment without a loading pause.
  useEffect(() => {
    matchmaker.setPresence('lounge');
    matchmaker.refreshProfile();
    void import('./Match');
  }, []);

  // Follow the room: when the server sends the first view, the opponent is here. A fresh series gets a short
  // "versus" moment first; rejoining a game in progress goes straight back to the board. A lounge room whose
  // other player never arrived sends you back into the queue, keeping your place.
  useEffect(() => {
    if (!conn) return;
    const off = conn.subscribe(() => {
      if (conn.status === 'noshow') {
        conn.close();
        setConn(null);
        const who = latest.current.queueOpp;
        setQueueOpp(null);
        setNotice(`${who ?? 'Your opponent'} couldn't join right now.${conn.wasQueue ? " You're back in the queue, in the same place." : ''}`);
        if (conn.wasQueue) matchmaker.find(true);
        return;
      }
      if (conn.view && !started.current) {
        started.current = true;
        const fresh = conn.view.state.phase === 'mulligan' && conn.view.series.game === 1 && conn.view.state.round <= 1;
        if (!fresh) return onStart(conn);
        play('found');
        buzz([30, 40, 30]);
        setFound(conn);
        setTimeout(() => onStart(conn), 1800);
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
    const k = new OnlineConn(c, as);
    setConn(k);
    return k;
  };
  // The lounge found someone (the queue, or a challenge either way): into their room, under your online name.
  useEffect(() => {
    if (mm.status !== 'matched' || !mm.found || conn || !strangerName) return;
    const f = mm.found;
    matchmaker.clearFound();
    setQueueOpp(f.opponent);
    const k = enter(f.code, { ...player, name: strangerName });
    k.oppProfile = f.profile;
    k.myProfile = myProfile();
    k.wasQueue = f.via === 'queue';
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
  useAttention(!!found, 'Opponent found · Specimen', 'found');

  if (found?.view) return <Versus conn={found} />;

  const here = mm.players.length;
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-3 p-3">
      <ScreenHeader
        title={mm.lounge ? `Lounge ${mm.lounge}` : 'Lounges'}
        sub={!mm.connected ? 'Connecting…' : mm.lounge ? `${here}/${LOUNGE_SIZE} here · ${mm.counts?.searching ?? 0} searching across all lounges` : `${mm.counts?.searching ?? 0} searching · best of ${BEST_OF}`}
        onBack={onBack}
        backLabel="Back to menu"
        right={
          mm.lounge && strangerName && !editing && !conn ? (
            <button onClick={() => setPicking(true)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink2 hover:border-mute">
              Change lounge
            </button>
          ) : undefined
        }
      />

      {notice && <p className="rounded-lg border border-amber-400/40 bg-amber-950/30 p-2 text-xs text-amber-100">{notice}</p>}
      {(err || conn?.error) && <p className="rounded-lg border border-red-500/40 bg-red-950/30 p-2 text-xs text-red-200">{err ?? conn?.error}</p>}

      {conn && queueOpp ? (
        <section className="lab-panel mx-auto flex w-full max-w-md flex-col items-center gap-2 rounded-xl border-2 border-accent/60 p-4 text-center" aria-live="polite">
          <div className="lab-label">Opponent found</div>
          {conn.oppProfile ? <ProfileCard p={conn.oppProfile} size="card" /> : <div className="font-display text-2xl font-bold">{queueOpp}</div>}
          <p className="text-sm text-ink2">{status === 'reconnecting' ? 'Connection lost: retrying…' : 'Joining the match…'}</p>
        </section>
      ) : conn ? (
        <section className="lab-panel mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-xl border-2 border-accent/60 p-4 text-center" aria-live="polite">
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
              {status === 'waiting' && <span className="text-[11px] tabular-nums text-mute">waiting {clock(waited)} · you'll hear it when they arrive</span>}
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
      ) : !strangerName || editing ? (
        <Welcome
          first={!strangerName}
          initialName={strangerName ?? suggestName(activeSave()?.meta.name)}
          onDone={(name, emblem) => {
            setOnlineName(name);
            saveEmblem(emblem);
            setStrangerName(name);
            setEditing(false);
            matchmaker.refreshProfile();
          }}
          onCancel={strangerName ? () => setEditing(false) : undefined}
        />
      ) : !mm.lounge || picking ? (
        <LoungePicker current={mm.lounge} onDone={() => setPicking(false)} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">
          <IdleGuard />
          <div className="flex flex-col gap-3">
            <YourCard onEdit={() => setEditing(true)} />
            <PlayPanel faction={me.faction} worldFaction={me.worldFaction} onDecks={onDecks} />
            <FriendRoom rejoin={rejoin} busy={busy} host={host} code={code} onType={onType} saveName={me.name} enter={enter} />
            <BlockedList />
          </div>
          <LoungePanels />
        </div>
      )}
      <p className="mt-auto text-[11px] leading-snug text-mute">
        Every match is a best of {BEST_OF}: the first to win two games takes the series. The lounge chat is with strangers: be kind, never share personal details, and tap a name to block or report. If your connection drops you rejoin your seat automatically; a player away for 3 minutes forfeits the series.
      </p>
    </div>
  );
}

/**
 * The lounge's inactivity timeout: 10 minutes without a tap or keypress (searching or a challenge out counts as
 * busy) and you leave the lounge, so its seat goes to someone who's there. A minute before, a warning with a
 * countdown asks if you're still there.
 */
function IdleGuard() {
  const mm = useMatchmaker();
  const busy = mm.status === 'searching' || !!mm.outgoing || mm.incoming.length > 0;
  const now = useNow(1000);
  useEffect(() => {
    matchmaker.noteActivity();
    const on = () => matchmaker.noteActivity();
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, on, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, on);
    };
  }, []);
  useEffect(() => {
    if (busy) matchmaker.noteActivity();
  }, [busy, now]);
  const idle = now - mm.lastInput;
  useEffect(() => {
    if (!busy && idle >= IDLE_MS && mm.lounge) {
      const id = mm.lounge;
      matchmaker.leaveLounge();
      matchmaker.toastNow(`You left Lounge ${id} after 10 minutes without activity. Pick a lounge to come back.`);
    }
  }, [busy, idle, mm.lounge]);
  // Warned: the tab title says so too, if you're elsewhere.
  useAttention(!busy && idle >= IDLE_WARN_MS, 'Still there? · Specimen', 'ready');
  if (busy || idle < IDLE_WARN_MS) return null;
  const left = Math.max(0, Math.ceil((IDLE_MS - idle) / 1000));
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[75] flex justify-center px-3" role="alertdialog" aria-label="Still there?">
      <div className="pop pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border-2 border-amber-400/70 bg-panel p-3 shadow-2xl">
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-display font-bold text-amber-200">Still there?</div>
          <div className="text-xs text-ink2">
            You'll leave Lounge {mm.lounge} in <b className="tabular-nums">{left}s</b> so someone else can have your seat.
          </div>
        </div>
        <button onClick={() => matchmaker.noteActivity()} autoFocus className="shrink-0 rounded-lg bg-accent px-3 py-2 font-display text-sm font-bold text-black">
          I'm here
        </button>
      </div>
    </div>
  );
}

/** Friends in online play (and in which lounge), asked over the lounge connection every 20 s while it's open. */
function useFriendsOnline(): Record<string, FriendOnline> {
  const mm = useMatchmaker();
  const connected = mm.connected && !!mm.you;
  useEffect(() => {
    if (!connected) return;
    matchmaker.askFriends();
    const id = setInterval(() => matchmaker.askFriends(), 20_000);
    return () => clearInterval(id);
  }, [connected]);
  return mm.friendsOn;
}

/** Choosing a lounge: a random one with room (the quick way), or any lounge that isn't full. */
function LoungePicker({ current, onDone }: { current: number | null; onDone: () => void }) {
  const mm = useMatchmaker();
  const [always, setAlways] = useState(alwaysRandomLounge);
  const friendsOn = useFriendsOnline();
  const friends = loadFriends();
  // "Always random": straight in, the first time the lounges are shown this visit.
  const auto = useRef(false);
  useEffect(() => {
    if (current === null && always && !auto.current) {
      auto.current = true;
      matchmaker.joinLounge('random');
    }
  }, [current, always]);
  // Switched to another lounge: back to the lounge view.
  const [from] = useState(current);
  useEffect(() => {
    if (from !== null && mm.lounge !== from) onDone();
  }, [mm.lounge, from, onDone]);
  const go = (id: number | 'random') => {
    play('click');
    matchmaker.joinLounge(id);
    if (current !== null && id === current) onDone();
  };
  const friendsIn = (id: number) => friends.filter((f) => friendsOn[f.id]?.lounge === id).map((f) => f.name);
  return (
    <section className="lab-panel mx-auto flex w-full max-w-lg flex-col gap-3 rounded-xl border-2 border-accent/50 p-4" aria-label="Choose a lounge">
      <div>
        <h2 className="font-display text-lg font-bold">{current ? 'Change lounge' : 'Pick a lounge'}</h2>
        <p className="text-xs text-ink2">Each lounge has room for {LOUNGE_SIZE}. Chat and the players list are per lounge; challenges, friends and the random search work across all of them.</p>
      </div>
      <button onClick={() => go('random')} disabled={!mm.connected} data-primary className="rounded-xl bg-accent px-4 py-3 font-display font-bold text-black disabled:opacity-50">
        Random lounge ▶
      </button>
      <ul className="flex flex-col gap-1.5" aria-label="Lounges">
        {mm.lounges.map((l) => {
          const full = l.count >= LOUNGE_SIZE && l.id !== current;
          const fr = friendsIn(l.id);
          return (
            <li key={l.id}>
              <button
                onClick={() => go(l.id)}
                disabled={full || !mm.connected}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition disabled:opacity-40 ${l.id === current ? 'border-accent bg-accent/10' : 'border-line bg-black/25 hover:border-mute'}`}
              >
                <span className="font-display text-sm font-bold">{l.count === 0 ? `Lounge ${l.id} · new` : `Lounge ${l.id}`}</span>
                <span className="flex gap-0.5" aria-hidden>
                  {Array.from({ length: LOUNGE_SIZE }, (_, i) => (
                    <span key={i} className={`h-2 w-1.5 rounded-sm ${i < l.count ? 'bg-accent' : 'bg-white/10'}`} />
                  ))}
                </span>
                <span className="text-[11px] tabular-nums text-mute">
                  {l.count}/{LOUNGE_SIZE}
                </span>
                <span className="min-w-0 flex-1 truncate text-right text-[11px] text-sky-300">{fr.length ? `★ ${fr.join(', ')}` : ''}</span>
                <span className="shrink-0 text-[11px] font-semibold text-ink2">{l.id === current ? 'you are here' : full ? 'full' : 'join ›'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3">
        <label className="flex flex-1 items-center gap-2 text-[11px] text-ink2">
          <input
            type="checkbox"
            checked={always}
            onChange={(e) => {
              setAlways(e.target.checked);
              setAlwaysRandomLounge(e.target.checked);
            }}
          />
          Always go straight to a random lounge
        </label>
        {current !== null && (
          <button onClick={onDone} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink2">
            Stay in Lounge {current}
          </button>
        )}
      </div>
    </section>
  );
}

/** The "versus" moment as a match begins: both profile cards. */
function Versus({ conn }: { conn: OnlineConn }) {
  const v = conn.view!;
  const opp = v.state.players[1 - v.seat];
  const mine = v.state.players[v.seat];
  const prof = (p: typeof mine, given: Profile | null | undefined): Profile => given ?? { name: p.name, emblem: p.faction, faction: p.faction, worldFaction: p.worldFaction, won: 0, lost: 0 };
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 overflow-hidden p-4 phone:gap-3" role="status" aria-live="assertive">
      <div className="lab-label">Opponent found · best of {BEST_OF}</div>
      <div className="flex w-full max-w-2xl items-center justify-center gap-4 phone:gap-2">
        {[
          { p: mine, pr: prof(mine, conn.myProfile) },
          { p: opp, pr: prof(opp, conn.oppProfile) },
        ].map(({ p, pr }, i) => (
          <div key={p.id} className={`${i === 0 ? 'vs-left' : 'vs-right'} flex min-w-0 flex-1 flex-col items-center gap-2 text-center`}>
            <ProfileBadge emblem={pr.emblem} size={56} />
            <span className="flex -space-x-3">
              <ChipArt id={p.faction} size={56} className="phone:h-10! phone:w-10!" />
              <ChipArt id={p.worldFaction} size={56} className="phone:h-10! phone:w-10!" />
            </span>
            <span className="max-w-full truncate font-display text-2xl font-extrabold phone:text-lg" style={{ color: PLAYER_COLORS[p.id] }}>
              {p.name}
            </span>
            <span className="text-xs text-ink2">
              <span style={{ color: FACTION_META[p.faction].color }}>{FACTION_META[p.faction].name}</span> / <span style={{ color: WORLD_FACTION_META[p.worldFaction].color }}>{WORLD_FACTION_META[p.worldFaction].name}</span>
              {(conn.oppProfile || conn.myProfile) && <span className="text-mute"> · {pr.won}–{pr.lost} in series</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="vs-mid font-display text-5xl font-extrabold text-accent phone:text-3xl">VS</div>
    </div>
  );
}

/** The first visit (or editing): your online name and emblem. */
function Welcome({ first, initialName, onDone, onCancel }: { first: boolean; initialName: string; onDone: (name: string, emblem: string) => void; onCancel?: () => void }) {
  const [draft, setDraft] = useState(initialName);
  const [emblem, setEmblem] = useState(() => loadEmblem() ?? myDefaults().faction);
  const check = checkName(draft);
  const touched = draft.length > 0;
  const d = myDefaults();
  return (
    <form
      className="lab-panel mx-auto flex w-full max-w-md flex-col gap-3 rounded-xl border-2 border-accent/50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (check.ok) onDone(check.name, emblem);
      }}
    >
      <div>
        <h2 className="font-display text-lg font-bold">{first ? 'Welcome to the lounge' : 'Your card'}</h2>
        {first && <p className="text-xs text-ink2">Everyone in online play meets here: chat, challenge someone, or search for a match. First, how others will see you.</p>}
      </div>
      <label className="text-xs text-ink2" htmlFor="online-name">
        Your online name (friends with a room code still see your save's name)
      </label>
      <input id="online-name" value={draft} onChange={(e) => setDraft(e.target.value.slice(0, NAME_MAX + 4))} autoComplete="off" spellCheck={false} placeholder="Your online name" className="rounded-lg border border-line bg-black/30 px-3 py-2 text-sm" aria-invalid={touched && !check.ok} aria-describedby="online-name-help" />
      <div id="online-name-help" className={`-mt-2 text-[11px] ${touched && !check.ok ? 'text-amber-200' : 'text-mute'}`}>
        {touched && !check.ok ? check.reason : `${NAME_MAX} characters at most: letters, numbers, spaces and _ . ' -`}
      </div>
      <div className="text-xs text-ink2">Your emblem</div>
      <EmblemPicker value={emblem} onPick={setEmblem} />
      <div className="rounded-lg bg-black/25 p-2">
        <div className="lab-label mb-1">Preview</div>
        <ProfileCard p={{ name: check.ok ? check.name : draft || '…', emblem: emblem as Profile['emblem'], faction: d.faction, worldFaction: d.worldFaction, won: myProfile()?.won ?? 0, lost: myProfile()?.lost ?? 0 }} />
      </div>
      <div className="flex gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-line px-3 py-2 text-sm text-ink2">
            Cancel
          </button>
        )}
        <button type="submit" disabled={!check.ok} className="flex-1 rounded-lg bg-accent px-3 py-2 font-display font-bold text-black disabled:opacity-40">
          {first ? 'Enter the lounge ▶' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function YourCard({ onEdit }: { onEdit: () => void }) {
  const p = myProfile();
  const done = onlineDailyDone();
  if (!p) return null;
  return (
    <section className="lab-panel flex flex-col gap-2 rounded-xl border border-line p-3">
      <div className="flex items-center gap-2">
        <ProfileCard p={p} className="flex-1" />
        <button onClick={onEdit} className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] text-ink2 hover:border-mute">
          Edit
        </button>
      </div>
      <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] ${done ? 'bg-emerald-950/40 text-emerald-200' : 'bg-black/25 text-ink2'}`} title="Resets every day">
        <span aria-hidden>{done ? '✓' : '◎'}</span>
        <span className="flex-1">
          Today: {ONLINE_DAILY_TEXT}
          {activeSave() ? '' : ' (load a save to earn it)'}
        </span>
        <span className="font-semibold text-amber-200">{done ? 'done' : `+${ONLINE_DAILY_REWARD} biomass`}</span>
      </div>
    </section>
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

/** Random search: start it, watch it, and what else you can do meanwhile. */
function PlayPanel({ faction, worldFaction, onDecks }: { faction: Faction; worldFaction: WorldFactionId; onDecks: () => void }) {
  const mm = useMatchmaker();
  const [keep, setKeep] = useState(keepSearching);
  const searching = mm.status === 'searching';
  const now = useNow(1000, searching || !!mm.outgoing);
  const waited = mm.since ? Math.max(0, Math.floor((now - mm.since) / 1000)) : 0;
  const others = Math.max(0, (mm.counts?.searching ?? 1) - 1);
  const target = mm.outgoing ? mm.players.find((p) => p.id === mm.outgoing!.to) : null;
  return (
    <section className={`lab-panel flex flex-col gap-2 rounded-xl border p-3 ${searching ? 'border-2 border-accent/60' : 'border-line'}`} aria-live="polite">
      {mm.outgoing ? (
        <div className="flex flex-col items-center gap-1.5 text-center">
          <div className="text-xs text-ink2">Challenge sent</div>
          {target && <ProfileCard p={target} />}
          <div className="text-[11px] tabular-nums text-mute">waiting for an answer · {Math.max(0, Math.ceil((mm.outgoing.until - now) / 1000))}s</div>
          <button onClick={() => matchmaker.withdraw()} className="text-xs text-mute underline">
            Withdraw
          </button>
        </div>
      ) : mm.status === 'cooldown' && mm.cooldownUntil ? (
        <Cooldown until={mm.cooldownUntil} />
      ) : searching ? (
        <div className="flex flex-col items-center gap-1.5 text-center">
          <Radar faction={faction} worldFaction={worldFaction} />
          <div className="font-display text-base font-bold">Searching for an opponent</div>
          <div className="font-display text-2xl tabular-nums text-accent">{clock(waited)}</div>
          <div className="text-[11px] text-mute">
            {others === 0 ? 'nobody else is searching right now' : `${others} other${others === 1 ? '' : 's'} searching`}
            {mm.counts ? ` · ${mm.counts.recent} match${mm.counts.recent === 1 ? '' : 'es'} this hour` : ''}
          </div>
          <p className="text-[11px] text-ink2">Chat or challenge someone meanwhile, or tune your deck: you stay in the queue, and you'll be called the moment someone is found.</p>
          <div className="flex gap-2">
            <button onClick={onDecks} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink2">
              Tune my deck
            </button>
            <button onClick={() => matchmaker.cancel()} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink2">
              Stop searching
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => matchmaker.find()} data-primary disabled={!mm.connected} className="rounded-xl bg-accent px-4 py-3 font-display font-bold text-black disabled:opacity-50">
          Find a random opponent ▶
        </button>
      )}
      <label className="flex items-center gap-2 text-[11px] text-ink2">
        <input
          type="checkbox"
          checked={keep}
          onChange={(e) => {
            setKeep(e.target.checked);
            setKeepSearching(e.target.checked);
          }}
        />
        Keep searching after each series
      </label>
    </section>
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
      You left several matches with strangers recently. You can search again in <b className="tabular-nums">{clock(left)}</b>. Challenges and room codes still work.
    </p>
  );
}

function FriendRoom({ rejoin, busy, host, code, onType, saveName, enter }: { rejoin: string | null; busy: boolean; host: () => void; code: string; onType: (t: string) => void; saveName: string; enter: (c: string) => void }) {
  return (
    <details className="lab-panel rounded-xl border border-line px-3 py-2" open={!!rejoin}>
      <summary className="cursor-pointer font-display text-sm font-bold">Play a friend by room code</summary>
      <div className="mt-2 flex flex-col gap-2">
        {rejoin && (
          <button onClick={() => enter(rejoin)} className="turn-glow rounded-xl border-2 border-accent px-4 py-2 font-display font-bold text-accent">
            Rejoin room {rejoin} ▶
          </button>
        )}
        <button onClick={host} disabled={busy} className="rounded-lg border border-accent/70 px-4 py-2 font-display text-sm font-bold text-accent disabled:opacity-50">
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
          className="w-full rounded-lg border border-line bg-black/30 px-3 py-2 text-center font-display text-lg tracking-[0.3em] uppercase placeholder:text-sm placeholder:tracking-normal placeholder:normal-case"
        />
        <div className="text-center text-[11px] text-mute">In a room, friends see your save's name, {saveName}.</div>
      </div>
    </details>
  );
}

function BlockedList() {
  const [list, setList] = useState(loadBlocked);
  if (!list.length) return null;
  return (
    <details className="lab-panel rounded-xl border border-line px-3 py-2 text-sm">
      <summary className="cursor-pointer text-xs text-ink2">Blocked players ({list.length}): never matched, their messages hidden</summary>
      <ul className="mt-2 flex flex-col gap-1">
        {list.map((b) => (
          <li key={b.id} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{b.name}</span>
            <button
              onClick={() => {
                unblock(b.id);
                setList(loadBlocked());
                matchmaker.refreshBlocked();
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

/** Who's here and the chat: side by side on a wide screen, as two tabs on a phone. */
function LoungePanels() {
  const [tab, setTab] = useState<'chat' | 'players'>('chat');
  const mm = useMatchmaker();
  const [hidden, setHidden] = useState(chatHidden);
  const [, bump] = useState(0);
  const refresh = () => bump((x) => x + 1);
  const others = mm.players.filter((p) => p.id !== mm.you).length;
  // Messages that came in while the phone showed the players: counted on the Chat tab.
  const seen = useRef(mm.chat.length);
  if (tab === 'chat') seen.current = mm.chat.length;
  const fresh = mm.chat.slice(seen.current).filter((m) => m.from !== mm.you);
  const unread = tab === 'chat' ? 0 : fresh.length;
  const named = fresh.some((m) => mentions(m.text, onlineName()));
  const tabBtn = (id: 'chat' | 'players', label: string, badge = 0) => (
    <button onClick={() => setTab(id)} role="tab" aria-selected={tab === id} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold ${tab === id ? 'bg-accent text-black' : 'text-ink2'}`}>
      {label}
      {badge > 0 && <span className={`count-pop rounded-full px-1.5 text-[10px] font-bold ${named ? 'bg-amber-400 text-black' : 'bg-accent/80 text-black'}`}>{badge > 9 ? '9+' : badge}</span>}
    </button>
  );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex gap-1 rounded-lg bg-black/30 p-1 md:hidden" role="tablist">
        {tabBtn('chat', 'Chat', unread)}
        {tabBtn('players', `Players (${others})`)}
      </div>
      <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_300px]">
        <div className={`${tab === 'chat' ? '' : 'hidden'} min-w-0 md:block`}>
          <ChatPanel
            hidden={hidden}
            onToggle={(h) => {
              setHidden(h);
              setChatHidden(h);
            }}
            onChange={refresh}
          />
        </div>
        <div className={`${tab === 'players' ? '' : 'hidden'} min-w-0 md:block`}>
          <PlayersPanel onChange={refresh} />
        </div>
      </div>
    </div>
  );
}

/** What you can do about another player: challenge, befriend, block, report. */
function PlayerMenu({ p, msg, onClose, onChange }: { p: { id: string; name: string }; msg?: ChatMsg; onClose: () => void; onChange: () => void }) {
  const mm = useMatchmaker();
  const [reporting, setReporting] = useState(false);
  const friend = isFriend(p.id);
  const live = mm.players.find((x) => x.id === p.id);
  const item = 'rounded px-2 py-1 text-left text-xs text-ink2 hover:bg-white/5';
  if (reporting)
    return (
      <div className="pop flex flex-col gap-1 rounded-lg border border-line bg-panel p-2 shadow-xl" role="menu">
        <div className="text-[11px] text-mute">
          Report {p.name}
          {msg ? ' for this message' : ''}:
        </div>
        {REPORT_REASONS.map((r) => (
          <button
            key={r}
            role="menuitem"
            onClick={() => {
              matchmaker.report(p.id, r, msg?.id);
              onClose();
            }}
            className={`${item} hover:text-red-200`}
          >
            {r}
          </button>
        ))}
      </div>
    );
  return (
    <div className="pop flex flex-col gap-0.5 rounded-lg border border-line bg-panel p-1.5 shadow-xl" role="menu">
      {live && live.status !== 'playing' && !mm.outgoing && (
        <button
          role="menuitem"
          onClick={() => {
            matchmaker.challenge(p.id);
            onClose();
          }}
          className={`${item} font-semibold text-accent`}
        >
          Challenge to a best of 3
        </button>
      )}
      {friend ? (
        <button
          role="menuitem"
          onClick={() => {
            removeFriend(p.id);
            onChange();
            onClose();
          }}
          className={item}
        >
          Remove friend
        </button>
      ) : live ? (
        <button
          role="menuitem"
          onClick={() => {
            matchmaker.befriend(p.id);
            onClose();
          }}
          className={item}
        >
          Add friend
        </button>
      ) : null}
      <button
        role="menuitem"
        onClick={() => {
          if (!window.confirm(`Block ${p.name}? You'll never be matched, their messages are hidden, and they can't challenge you.`)) return;
          block(p.id, p.name);
          removeFriend(p.id);
          matchmaker.refreshBlocked();
          onChange();
          onClose();
        }}
        className={item}
      >
        Block
      </button>
      <button role="menuitem" onClick={() => setReporting(true)} className={item}>
        Report…
      </button>
    </div>
  );
}

const STATUS_LABEL = { lounge: null, searching: 'searching', playing: 'in a match' } as const;

function PlayersPanel({ onChange }: { onChange: () => void }) {
  const mm = useMatchmaker();
  const [menu, setMenu] = useState<string | null>(null);
  const blocked = new Set(loadBlocked().map((b) => b.id));
  const friends = loadFriends();
  const friendIds = new Set(friends.map((f) => f.id));
  const here = mm.players.filter((p) => p.id !== mm.you && !blocked.has(p.id));
  // Friends first, then players searching, then the rest.
  const order = (p: PresenceEntry) => (friendIds.has(p.id) ? 0 : p.status === 'searching' ? 1 : p.status === 'lounge' ? 2 : 3);
  here.sort((a, b) => order(a) - order(b));
  const friendsOn = useFriendsOnline();
  const away = friends.filter((f) => !here.some((p) => p.id === f.id) && !blocked.has(f.id));
  const elsewhere = away.filter((f) => friendsOn[f.id]);
  const offline = away.filter((f) => !friendsOn[f.id]);
  const row = (p: PresenceEntry) => {
    const st = STATUS_LABEL[p.status];
    const can = p.status !== 'playing' && !mm.outgoing;
    return (
      <li key={p.id} className="relative">
        <div className="flex items-center gap-2 rounded-lg bg-black/25 px-2 py-1.5">
          <ProfileCard p={p} className="flex-1" tag={friendIds.has(p.id) ? <span className="text-[10px] text-sky-300" title="Friend">★</span> : undefined} />
          {st && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${p.status === 'searching' ? 'bg-accent/20 text-accent' : 'bg-white/10 text-mute'}`}>{st}</span>}
          <button onClick={() => matchmaker.challenge(p.id)} disabled={!can} className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-30" title={can ? 'Challenge to a best of 3' : p.status === 'playing' ? 'In a match' : 'You have a challenge out'}>
            Challenge
          </button>
          <button onClick={() => setMenu(menu === p.id ? null : p.id)} className="shrink-0 rounded-md border border-line px-1.5 py-1 text-[11px] text-ink2" aria-label={`More for ${p.name}`} aria-expanded={menu === p.id}>
            ⋯
          </button>
        </div>
        {menu === p.id && (
          <div className="absolute right-0 top-full z-20 mt-1 w-56">
            <PlayerMenu p={p} onClose={() => setMenu(null)} onChange={onChange} />
          </div>
        )}
      </li>
    );
  };
  return (
    <section className="lab-panel flex flex-col gap-2 rounded-xl border border-line p-3" aria-label="Players in the lounge">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-base font-bold">Here in Lounge {mm.lounge}</h2>
        <span className="text-[11px] text-mute">
          {here.length} other{here.length === 1 ? '' : 's'}
        </span>
      </div>
      {here.length === 0 ? <p className="text-xs text-ink2">Nobody else is in this lounge yet. Others may be in other lounges: search, and you'll be matched with the next person who does too.</p> : <ul className="flex flex-col gap-1">{here.map(row)}</ul>}
      {elsewhere.length > 0 && (
        <>
          <div className="lab-label mt-1">Friends in other lounges</div>
          <ul className="flex flex-col gap-1">
            {elsewhere.map((f) => {
              const where = friendsOn[f.id];
              const playing = where.status === 'playing';
              return (
                <li key={f.id} className="flex items-center gap-2 rounded-lg bg-black/25 px-2 py-1.5 text-xs">
                  <ProfileBadge emblem={f.emblem} size={24} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold text-sky-200">{f.name}</span>
                    <span className="text-mute"> · {playing ? 'in a match' : where.lounge ? `Lounge ${where.lounge}` : 'online'}</span>
                  </span>
                  {where.lounge && (
                    <button onClick={() => matchmaker.joinLounge(where.lounge!)} className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] text-ink2">
                      Go there
                    </button>
                  )}
                  <button onClick={() => matchmaker.challenge(f.id)} disabled={playing || !!mm.outgoing} className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-30">
                    Challenge
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {offline.length > 0 && (
        <>
          <div className="lab-label mt-1">Friends offline</div>
          <ul className="flex flex-col gap-1">
            {offline.map((f) => (
              <li key={f.id} className="flex items-center gap-2 px-2 py-1 text-xs text-mute">
                <span className="opacity-50">
                  <ProfileBadge emblem={f.emblem} size={22} />
                </span>
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <button
                  onClick={() => {
                    removeFriend(f.id);
                    onChange();
                  }}
                  className="text-[10px] underline"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ChatPanel({ hidden, onToggle, onChange }: { hidden: boolean; onToggle: (h: boolean) => void; onChange: () => void }) {
  const mm = useMatchmaker();
  const [text, setText] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const list = useRef<HTMLOListElement | null>(null);
  const blocked = useMemo(() => new Set(loadBlocked().map((b) => b.id)), [mm.chat, menu]); // eslint-disable-line react-hooks/exhaustive-deps
  const msgs = mm.chat.filter((m) => !blocked.has(m.from));
  const friendIds = new Set(loadFriends().map((f) => f.id));
  const now = useNow(30_000);
  const muted = mm.mutedUntil && mm.mutedUntil > now ? mm.mutedUntil : null;
  // Keep the newest message in view, unless you've scrolled up to read.
  useEffect(() => {
    const el = list.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [msgs.length, hidden]);
  if (hidden)
    return (
      <section className="lab-panel flex items-center gap-2 rounded-xl border border-line p-3 text-xs text-ink2">
        <span className="flex-1">Chat is hidden. Challenges and search still work.</span>
        <button onClick={() => onToggle(false)} className="rounded border border-line px-2 py-1">
          Show chat
        </button>
      </section>
    );
  return (
    <section className="lab-panel flex h-[min(520px,60dvh)] flex-col rounded-xl border border-line" aria-label="Lounge chat">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="font-display text-base font-bold">Chat</h2>
        <span className="min-w-0 flex-1 truncate text-[10px] text-mute">Be kind · never share personal details · tap a name to block or report</span>
        <button onClick={() => onToggle(true)} className="shrink-0 text-[10px] text-mute underline">
          Hide
        </button>
      </div>
      <ol ref={list} className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-live="polite">
        {msgs.length === 0 && <li className="text-xs text-mute">No messages yet. Say hi.</li>}
        {msgs.map((m) => {
          const mine = m.from === mm.you;
          return (
            <li key={m.id} className={`relative flex items-start gap-2 rounded text-sm ${!mine && mentions(m.text, onlineName()) ? '-mx-1 bg-amber-400/10 px-1' : ''}`}>
              <ProfileBadge emblem={m.emblem} size={20} />
              <div className="min-w-0 flex-1">
                <button onClick={() => !mine && setMenu(menu === m.id ? null : m.id)} className={`mr-1.5 font-semibold ${mine ? 'text-accent' : friendIds.has(m.from) ? 'text-sky-300 hover:underline' : 'text-ink hover:underline'}`} disabled={mine}>
                  {m.name}
                </button>
                <span className="break-words text-ink2">{m.text}</span>
                <span className="ml-1.5 text-[10px] text-mute">{new Date(m.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
              {menu === m.id && (
                <div className="absolute left-6 top-full z-20 mt-0.5 w-56">
                  <PlayerMenu p={{ id: m.from, name: m.name }} msg={m} onClose={() => setMenu(null)} onChange={onChange} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <form
        className="flex gap-2 border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          matchmaker.sayInChat(text);
          setText('');
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, CHAT_MAX))}
          disabled={!!muted || !mm.connected}
          placeholder={muted ? `Muted until ${new Date(muted).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'Say something…'}
          aria-label="Chat message"
          maxLength={CHAT_MAX}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-line bg-black/30 px-3 py-2 text-sm disabled:opacity-50"
        />
        <button type="submit" disabled={!!muted || !text.trim() || !mm.connected} className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-black disabled:opacity-40">
          Send
        </button>
      </form>
    </section>
  );
}
