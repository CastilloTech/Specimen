import { useCallback, useEffect, useState } from 'react';
import { ScreenHeader } from '../components/ScreenHeader';
import { SERVER_URL } from '../online';
import type { LoungeOverview } from '../../../server/lobby';
import type { RoomInfo } from '../../../server/room';

// The admin page (open the game with #admin): today's server usage and its busiest rooms (to catch a runaway
// room before the free plan's daily allowance runs out), who's online, reports with the reported message, bans,
// and clearing a lounge's chat. Everything needs the admin code (the server's ADMIN_TOKEN secret).

const TOKEN_KEY = 'specimen.adminToken';
const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};

interface Usage {
  day: string;
  durableRequests: number;
  freeLimit: number;
  resetAt: number;
  workerRequests: number;
  workerErrors: number;
  top: { id: string; requests: number; kind: 'lounges' | 'room' }[];
}
interface Overview {
  /** Null while the lounges are resting (the daily allowance ran out). */
  lounges: LoungeOverview | null;
  usage: Usage | { error: string } | null;
  resting: number | null;
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const clock = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function AdminScreen({ onBack }: { onBack: () => void }) {
  const [token, setToken] = useState(readToken);
  const [draft, setDraft] = useState('');
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [room, setRoom] = useState<{ id: string; info: RoomInfo | null } | null>(null);

  const call = useCallback(
    async <T,>(path: string, body?: unknown): Promise<T> => {
      const res = await fetch(`${SERVER_URL}/admin/${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const json = (await res.json().catch(() => ({}))) as T & { error?: string; resetAt?: number };
      if (res.status === 401) throw new Error('Wrong admin code.');
      if (json.error === 'resting') throw new Error(`The server is resting (daily allowance used up) until ${clock(json.resetAt!)}.`);
      if (!res.ok) throw new Error(json.error ?? `Server answered ${res.status}`);
      return json;
    },
    [token],
  );
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setData(await call<Overview>('overview'));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [call, token]);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);
  const act = async (path: string, body: unknown, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await call(path, body);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!token)
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 p-3">
        <ScreenHeader title="Admin" sub="Online play: usage and moderation" onBack={onBack} />
        <form
          className="lab-panel flex flex-col gap-2 rounded-xl border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              localStorage.setItem(TOKEN_KEY, draft.trim());
            } catch {
              /* asked again next time */
            }
            setToken(draft.trim());
          }}
        >
          <label htmlFor="admin-code" className="text-xs text-ink2">
            Admin code
          </label>
          <input id="admin-code" type="password" value={draft} onChange={(e) => setDraft(e.target.value)} className="rounded-lg border border-line bg-black/30 px-3 py-2 text-sm" autoComplete="off" />
          <button type="submit" disabled={!draft.trim()} className="rounded-lg bg-accent px-3 py-2 font-bold text-black disabled:opacity-40">
            Open
          </button>
        </form>
      </div>
    );

  const u = data?.usage;
  const l = data?.lounges;
  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-3 p-3">
      <ScreenHeader
        title="Admin"
        sub={loading ? 'Loading…' : data ? 'Refreshes every 30 s' : ''}
        onBack={onBack}
        right={
          <div className="flex gap-1.5">
            <button onClick={() => void load()} className="rounded-md border border-line px-2 py-1 text-xs text-ink2">
              Refresh
            </button>
            <button
              onClick={() => {
                try {
                  localStorage.removeItem(TOKEN_KEY);
                } catch {
                  /* fine */
                }
                setToken('');
                setData(null);
              }}
              className="rounded-md border border-line px-2 py-1 text-xs text-ink2"
            >
              Sign out
            </button>
          </div>
        }
      />
      {err && <p className="rounded-lg border border-red-500/40 bg-red-950/30 p-2 text-xs text-red-200">{err}</p>}
      {data?.resting && <p className="rounded-lg border border-amber-400/50 bg-amber-950/30 p-2 text-xs text-amber-100">Online play is resting: the daily allowance ran out. It comes back {clock(data.resting)}. Live numbers, reports and bans return then.</p>}

      <section className="lab-panel rounded-xl border border-line p-3">
        <h2 className="font-display text-base font-bold">Server usage today (UTC)</h2>
        {!u ? (
          <p className="mt-1 text-xs text-ink2">
            Not set up. Create a Cloudflare API token with <b>Account Analytics: Read</b> (dash.cloudflare.com → My Profile → API Tokens), then in the game's <code>server</code> folder run <code>npx wrangler secret put CF_API_TOKEN</code> and paste it.
          </p>
        ) : 'error' in u ? (
          <p className="mt-1 text-xs text-amber-200">Couldn't read usage: {u.error}</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2 text-sm">
            <UsageBar used={u.durableRequests} limit={u.freeLimit} />
            <div className="text-xs text-ink2">
              {u.durableRequests.toLocaleString()} of {u.freeLimit.toLocaleString()} match-server requests · resets {clock(u.resetAt)} · web requests {u.workerRequests.toLocaleString()} ({u.workerErrors} errors)
            </div>
            <div className="lab-label mt-1">Busiest today</div>
            <ul className="flex flex-col gap-1">
              {u.top.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-lg bg-black/25 px-2.5 py-1.5 text-xs">
                  <span className={`w-16 shrink-0 font-semibold ${t.kind === 'lounges' ? 'text-sky-300' : 'text-ink'}`}>{t.kind === 'lounges' ? 'Lounges' : 'Room'}</span>
                  <span className={`w-20 shrink-0 text-right tabular-nums ${t.requests > u.freeLimit / 10 ? 'font-bold text-red-300' : ''}`}>{t.requests.toLocaleString()}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-mute">{t.id}</span>
                  {t.kind === 'room' && (
                    <button
                      onClick={async () => {
                        try {
                          const r = await call<{ info: RoomInfo | null }>(`room/${t.id}`);
                          setRoom({ id: t.id, info: r.info });
                        } catch (e) {
                          setErr((e as Error).message);
                        }
                      }}
                      className="shrink-0 rounded border border-line px-2 py-0.5 text-ink2"
                    >
                      Inspect
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {room && (
              <div className="rounded-lg border border-line bg-black/30 p-2 text-xs">
                {room.info ? (
                  <>
                    <div className="font-semibold">
                      Room {room.info.code} · {room.info.players.join(' vs ')}
                    </div>
                    <div className="text-ink2">
                      {room.info.phase ?? 'waiting'} · {room.info.series} · {room.info.sockets} connected, {room.info.watching} watching · created {ago(room.info.createdAt)} · next alarm {room.info.alarmAt ? clock(room.info.alarmAt) : 'none'} · empty alarms in a row {room.info.idleRings}
                    </div>
                  </>
                ) : (
                  <div className="text-ink2">This room no longer exists.</div>
                )}
                <div className="mt-1.5 flex gap-2">
                  {room.info && (
                    <button onClick={() => void act(`room/${room.id}/close`, {}, 'Close this room? Anyone in it is disconnected.').then(() => setRoom(null))} className="rounded border border-red-500/50 px-2 py-0.5 text-red-200">
                      Close room
                    </button>
                  )}
                  <button onClick={() => setRoom(null)} className="rounded border border-line px-2 py-0.5 text-ink2">
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {l && (
        <section className="lab-panel rounded-xl border border-line p-3">
          <h2 className="font-display text-base font-bold">Live</h2>
          <div className="mt-2 grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
            {[
              ['Online', l.online],
              ['Searching', l.searching],
              ['In a match', l.playing],
              ['Matches today', l.matchesToday],
              ['Last hour', l.matchesHour],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-black/25 p-2">
                <div className="font-display text-xl font-bold">{v}</div>
                <div className="text-[10px] text-mute">{k}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-mute">{l.pushSubscribers} players have notifications on.</div>
          {l.lounges.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {l.lounges.map((x) => (
                <li key={x.id} className="flex items-center gap-1.5 rounded-lg bg-black/25 px-2 py-1 text-xs">
                  Lounge {x.id} · {x.count}/10
                  <button onClick={() => void act('clear-chat', { lounge: x.id }, `Clear Lounge ${x.id}'s chat for everyone?`)} className="rounded border border-line px-1.5 text-[10px] text-ink2">
                    Clear chat
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {l && (
        <section className="lab-panel rounded-xl border border-line p-3">
          <h2 className="font-display text-base font-bold">Reports ({l.reports.length})</h2>
          {l.reports.length === 0 ? (
            <p className="mt-1 text-xs text-ink2">No reports.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {l.reports.map((r) => (
                <li key={`${r.at}-${r.from}`} className="rounded-lg bg-black/25 px-2.5 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <b>{r.name || 'Unknown'}</b>
                    <span className="font-mono text-[10px] text-mute">{r.target}</span>
                    <span className="text-amber-200">{r.reason}</span>
                    <span className="ml-auto text-mute">
                      {ago(r.at)}
                      {r.lounge ? ` · Lounge ${r.lounge}` : ''}
                    </span>
                  </div>
                  {r.message && <div className="mt-1 rounded bg-black/30 px-2 py-1 text-ink2">“{r.message}”</div>}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button onClick={() => void act('ban', { target: r.target, scope: 'chat', hours: 24, reason: r.reason }, `Mute ${r.name || r.target} in chat for 24 hours?`)} className="rounded border border-line px-2 py-0.5 text-ink2">
                      Mute chat 24 h
                    </button>
                    <button onClick={() => void act('ban', { target: r.target, scope: 'all', hours: 24 * 7, reason: r.reason }, `Suspend ${r.name || r.target} from playing strangers for 7 days?`)} className="rounded border border-red-500/50 px-2 py-0.5 text-red-200">
                      Suspend 7 days
                    </button>
                    <button onClick={() => void act('dismiss-report', { at: r.at, from: r.from })} className="rounded border border-line px-2 py-0.5 text-mute">
                      Dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {l && <Bans bans={l.bans} onBan={(b) => void act('ban', b)} onUnban={(id) => void act('unban', { target: id }, 'Lift this ban?')} />}
    </div>
  );
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const f = Math.min(1, used / limit);
  return (
    <div className="h-3 overflow-hidden rounded-full bg-black/40" title={`${Math.round(f * 100)}%`}>
      <div className={`h-full rounded-full ${f > 0.8 ? 'bg-red-500' : f > 0.5 ? 'bg-amber-400' : 'bg-accent'}`} style={{ width: `${f * 100}%` }} />
    </div>
  );
}

function Bans({ bans, onBan, onUnban }: { bans: LoungeOverview['bans']; onBan: (b: { target: string; scope: 'chat' | 'all'; hours: number; reason: string }) => void; onUnban: (id: string) => void }) {
  const [target, setTarget] = useState('');
  const [scope, setScope] = useState<'chat' | 'all'>('chat');
  const [hours, setHours] = useState(24);
  const [reason, setReason] = useState('');
  return (
    <section className="lab-panel rounded-xl border border-line p-3">
      <h2 className="font-display text-base font-bold">Bans ({bans.length})</h2>
      <ul className="mt-2 flex flex-col gap-1">
        {bans.map((b) => (
          <li key={b.id} className="flex items-center gap-2 rounded-lg bg-black/25 px-2.5 py-1.5 text-xs">
            <span className="font-mono text-[10px] text-mute">{b.id}</span>
            <span className={b.scope === 'all' ? 'text-red-200' : 'text-amber-200'}>{b.scope === 'all' ? 'suspended' : 'chat muted'}</span>
            <span className="min-w-0 flex-1 truncate text-ink2">{b.reason}</span>
            <span className="text-mute">until {clock(b.until)}</span>
            <button onClick={() => onUnban(b.id)} className="rounded border border-line px-2 py-0.5 text-ink2">
              Lift
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex flex-wrap items-center gap-1.5 text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^[a-f0-9]{16}$/.test(target.trim())) return;
          onBan({ target: target.trim(), scope, hours, reason });
          setTarget('');
          setReason('');
        }}
      >
        <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="player id (16 characters)" className="w-44 rounded border border-line bg-black/30 px-2 py-1 font-mono" />
        <select value={scope} onChange={(e) => setScope(e.target.value as 'chat' | 'all')} className="rounded border border-line bg-black/30 px-1 py-1">
          <option value="chat">Mute chat</option>
          <option value="all">Suspend</option>
        </select>
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="rounded border border-line bg-black/30 px-1 py-1">
          {[1, 24, 72, 168, 720].map((h) => (
            <option key={h} value={h}>
              {h < 24 ? `${h} h` : `${h / 24} d`}
            </option>
          ))}
        </select>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="reason" className="min-w-0 flex-1 rounded border border-line bg-black/30 px-2 py-1" />
        <button type="submit" className="rounded bg-accent px-2 py-1 font-bold text-black">
          Ban
        </button>
      </form>
    </section>
  );
}
