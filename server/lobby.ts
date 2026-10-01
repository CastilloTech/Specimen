// The lounges' rules, independent of Cloudflare (the Lobby Durable Object in worker.ts stores and moves
// messages). Online play is split into small lounges of LOUNGE_SIZE people: you go to a random one or pick one.
// In your lounge you see who's there (with their profile cards) and chat; you can challenge anyone (they answer
// yes or no), and the casual queue and friends work across all lounges. No ratings: whoever has
// waited longest is matched first, never with someone either player has blocked. Players who often walk out of
// strangers' series wait a little before they can search again, and a player reported by several people is
// muted in chat for a while.
import { FACTIONS, WORLD_FACTIONS } from '../src/engine';
import type { Faction, WorldFactionId } from '../src/engine';
import { checkName } from './names';
import type { PushSub } from './push';

/** What others see of a player: their name, chosen emblem, current Specimen and series record. */
export interface Profile {
  name: string;
  emblem: Faction | WorldFactionId;
  faction: Faction;
  worldFaction: WorldFactionId;
  won: number;
  lost: number;
}

export type Presence = 'lounge' | 'searching' | 'playing';

/** Someone in the lounge, as everyone sees them. */
export interface PresenceEntry extends Profile {
  id: string;
  status: Presence;
}

export interface ChatMsg {
  id: string;
  /** The sender's public id. */
  from: string;
  name: string;
  emblem: Profile['emblem'];
  text: string;
  at: number;
}

/** Client → lounge. `device`: the player's private device id (the server works out their public id from it). */
export type LobbyClientMsg =
  | { t: 'hello'; device: string; profile?: Profile; blocked?: string[]; status?: Presence; lounge?: number | 'random' }
  /** Go to a lounge: a given one (if it has room), or a random one with room. */
  | { t: 'join'; lounge: number | 'random' }
  | { t: 'profile'; profile: Profile }
  | { t: 'status'; status: Presence }
  | { t: 'blocked'; blocked: string[] }
  | { t: 'find'; since?: number; device?: string; name?: string; blocked?: string[]; bestOf?: number }
  | { t: 'cancel' }
  /** Turning down a found match ("Not now", or too late): the room is called off at once. */
  | { t: 'decline'; code: string }
  | { t: 'chat'; text: string }
  | { t: 'challenge'; to: string; bestOf?: number }
  | { t: 'withdraw' }
  | { t: 'answer'; id: string; yes: boolean }
  | { t: 'friend'; to: string }
  | { t: 'friendAnswer'; to: string; yes: boolean }
  | { t: 'report'; target: string; msgId?: string; reason: string }
  /** Which of these players (public ids, your friends) are in online play, and where. */
  | { t: 'friends'; ids: string[] }
  /** The player is still there (taps, typing): at most once a minute. */
  | { t: 'active' }
  /** Out of your lounge (back to the list), staying in online play. */
  | { t: 'leaveLounge' }
  /** Notifications while the game is closed: the browser's push subscription (null: off), whose arrival to tell
   *  you about (your friends' public ids), and which kinds you want. */
  | { t: 'push'; sub: PushSub | null; watch?: string[]; events?: PushEvents }
  | { t: 'ping' };
/** Lounge → client. */
export type LobbyServerMsg =
  | { t: 'welcome'; you: string; mutedUntil: number | null }
  /** The lounges and how full they are (with the next empty one, to start a new lounge). */
  | { t: 'lounges'; list: LoungeInfo[] }
  /** You're now in this lounge: who's here and its recent chat. */
  | { t: 'lounge'; id: number; players: PresenceEntry[]; chat: ChatMsg[] }
  /** Someone arrived in your lounge, or changed (status, profile). */
  | { t: 'here'; entry: PresenceEntry }
  /** Someone left your lounge. */
  | { t: 'gone'; id: string }
  | { t: 'counts'; searching: number; recent: number }
  | { t: 'searching'; since: number }
  | { t: 'matched'; code: string; opponent: string; profile?: PresenceEntry; via?: 'queue' | 'challenge'; bestOf?: number }
  | { t: 'cooldown'; until: number }
  | { t: 'chat'; msg: ChatMsg }
  | { t: 'challenged'; id: string; from: PresenceEntry; until: number; bestOf?: number }
  | { t: 'challengeSent'; id: string; to: string; until: number }
  /** A challenge is over without a match: declined, withdrawn, expired, or one side became unavailable. */
  | { t: 'challengeOver'; id: string; reason: string }
  | { t: 'friendReq'; from: PresenceEntry }
  | { t: 'friendAccepted'; from: PresenceEntry }
  | { t: 'notice'; text: string }
  | { t: 'friends'; online: Record<string, FriendStatus> }
  /** Your lounge's chat was cleared (by a moderator). */
  | { t: 'chatCleared' }
  /** Taken out of your lounge after too long without activity. */
  | { t: 'kicked'; lounge: number }
  | { t: 'error'; message: string }
  | { t: 'pong' };

/** Someone in the queue (kept on their socket, so it survives the lobby sleeping). */
export interface Seeker {
  pub: string;
  name: string;
  /** Public ids this player has blocked. */
  blocked: string[];
  /** When they started waiting (ms): the longest-waiting are matched first. */
  since: number;
  /** The length of series they want (only matched with the same). */
  bestOf?: number;
}

/** Notifications a player wants while the game is closed. */
export interface PushEvents {
  /** A friend arrives in the lounges. */
  friends: boolean;
  /** Someone challenges you. */
  challenges: boolean;
}

/** A friend's whereabouts: in online play (and which lounge), and the room they're playing in, to watch. */
export interface FriendStatus {
  status: Presence;
  lounge: number | null;
  room?: string | null;
}

/** A player's ban: from chat only, or from online play with strangers (lounges, search, challenges). */
export interface Ban {
  scope: 'chat' | 'all';
  until: number;
  reason: string;
}

/** A report, kept for the admin page. */
export interface StoredReport {
  at: number;
  from: string;
  target: string;
  name: string;
  lounge: number | null;
  reason: string;
  message: string | null;
}

export interface LoungeInfo {
  id: number;
  count: number;
}

/** What each lounge socket carries (its attachment, at most 2 KB). */
export interface LoungeTag {
  pub: string;
  profile: Profile;
  /** The lounge this player is in (none until they pick one). */
  lounge?: number;
  blocked: string[];
  status: Presence;
  /** Searching the queue since (ms), and for which length of series. */
  since?: number;
  bestOf?: number;
  /** The room this player is playing in (made by the lounge), for friends who want to watch. */
  room?: string;
  /** When this player's last few chat messages went out (ms), for the rate limit. */
  chat?: number[];
  /** The challenge this player has out (to someone here, or an invite to an offline friend). */
  challenge?: { id: string; to: string; until: number; bestOf?: number };
  /** Players who just said no to this player: no new challenge to them until then (ms). */
  noAgain?: Record<string, number>;
  /** When this player last did something (ms): sat idle in a lounge too long, they're taken out. */
  active?: number;
}

/** People per lounge. */
export const LOUNGE_SIZE = 10;
/** In a lounge this long without doing anything (not searching, not in a match), you leave it. The game warns a
 *  minute before and takes you out itself; the server does it a minute later for a tab left open and forgotten. */
export const IDLE_MS = 10 * 60 * 1000;
export const IDLE_WARN_MS = 9 * 60 * 1000;
export const SERVER_IDLE_MS = IDLE_MS + 60 * 1000;

/** Whether a player has sat idle in a lounge too long (searching or playing never counts as idle). */
export const idleTooLong = (t: { lounge?: number; status: Presence; active?: number }, now: number) => !!t.lounge && t.status === 'lounge' && now - (t.active ?? now) >= SERVER_IDLE_MS;

/** How many people are in each lounge (one per player, however many tabs). */
export function loungeCounts(members: { pub: string; lounge?: number }[]): Map<number, number> {
  const seen = new Map<number, Set<string>>();
  for (const m of members) if (m.lounge) (seen.get(m.lounge) ?? seen.set(m.lounge, new Set()).get(m.lounge)!).add(m.pub);
  return new Map([...seen].map(([id, who]) => [id, who.size]));
}

/** The lounges to list: every one with people in it, plus the first empty one (a new lounge). */
export function loungeList(counts: Map<number, number>): LoungeInfo[] {
  const list = [...counts].filter(([, n]) => n > 0).map(([id, count]) => ({ id, count }));
  let fresh = 1;
  while (counts.get(fresh)) fresh++;
  return [...list, { id: fresh, count: 0 }].sort((a, b) => a.id - b.id);
}

/** A random lounge with room: one that already has people if any (so it's social), else a new one. */
export function pickLounge(counts: Map<number, number>, rand: () => number): number {
  const open = [...counts].filter(([, n]) => n > 0 && n < LOUNGE_SIZE).map(([id]) => id);
  if (open.length) return open[Math.floor(rand() * open.length)];
  return loungeList(counts).find((l) => l.count === 0)!.id;
}

/** An invite to an offline friend (sent as a notification) waits this long. */
export const INVITE_MS = 120_000;
/** "Your friend is online" at most this often per friend. */
export const FRIEND_PUSH_GAP_MS = 6 * 60 * 60 * 1000;
/** A best of 1 or a best of 3 (the default). */
export const seriesLength = (x: unknown) => (x === 1 ? 1 : 3);
/** The next midnight UTC: when the free plan's daily allowance resets. */
export const nextReset = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};
/** A ban still in force for this kind of thing. */
export const banned = (b: Ban | null | undefined, what: 'chat' | 'play', now: number) => !!b && b.until > now && (what === 'chat' || b.scope === 'all');

/** A challenge waits this long for an answer. */
export const CHALLENGE_MS = 20_000;
/** After a "no", the same player can't be challenged by you again for this long. */
export const CHALLENGE_AGAIN_MS = 60_000;
/** Chat: at most CHAT_BURST messages in CHAT_WINDOW_MS. */
export const CHAT_BURST = 4;
export const CHAT_WINDOW_MS = 8_000;
/** The lounge keeps this many recent messages to show newcomers. */
export const CHAT_HISTORY = 60;
/** Reported in chat by this many different players within REPORT_WINDOW_MS: muted for MUTE_MS. */
export const MUTE_REPORTS = 3;
export const REPORT_WINDOW_MS = 60 * 60 * 1000;
export const MUTE_MS = 60 * 60 * 1000;

const EMBLEMS: string[] = [...FACTIONS, ...WORLD_FACTIONS];
const count = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? Math.min(n, 99_999) : 0);

/** A profile as sent by a player, checked: a name fit for strangers, a real emblem and Specimen. */
export function checkProfile(p: unknown): Profile | string {
  if (!p || typeof p !== 'object') return 'Missing profile.';
  const x = p as Partial<Profile>;
  const name = checkName(x.name);
  if (!name.ok) return name.reason;
  if (!FACTIONS.includes(x.faction as Faction) || !WORLD_FACTIONS.includes(x.worldFaction as WorldFactionId)) return 'Unknown Build or World Faction.';
  const emblem = EMBLEMS.includes(x.emblem as string) ? (x.emblem as Profile['emblem']) : x.faction!;
  return { name: name.name, emblem, faction: x.faction!, worldFaction: x.worldFaction!, won: count(x.won), lost: count(x.lost) };
}

/** Whether a player may send a chat message now (at most CHAT_BURST in CHAT_WINDOW_MS); returns the new send times. */
export function chatAllowed(times: number[] | undefined, now: number): number[] | null {
  const recent = (times ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
  return recent.length >= CHAT_BURST ? null : [...recent, now];
}

/** Reports against a player: muted until when, if enough different players reported them recently. */
export function mutedUntil(reports: { from: string; at: number }[], now: number): number | null {
  const recent = reports.filter((r) => now - r.at < REPORT_WINDOW_MS);
  const who = new Set(recent.map((r) => r.from));
  if (who.size < MUTE_REPORTS) return null;
  const until = Math.max(...recent.map((r) => r.at)) + MUTE_MS;
  return until > now ? until : null;
}

/** Whether two players may be put together (by the queue, or a challenge): neither has blocked the other. */
export const compatible = (a: Pick<LoungeTag, 'pub' | 'blocked'>, b: Pick<LoungeTag, 'pub' | 'blocked'>) => a.pub !== b.pub && !a.blocked.includes(b.pub) && !b.blocked.includes(a.pub);

export const DEVICE_ID = /^[a-f0-9]{32}$/;
/** A block list sent with each search is cut to this many (the most recent). */
export const MAX_BLOCKS = 50;
/** "Matches in the last hour", shown to those searching. */
export const RECENT_MS = 60 * 60 * 1000;
/** Leaving a stranger's series: this many a day are free, then each one adds a cooldown. */
export const FREE_LEAVES = 2;
export const LEAVE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const COOLDOWN_STEP_MS = 5 * 60 * 1000;
export const COOLDOWN_MAX_MS = 30 * 60 * 1000;
/** A player sent back to the queue (their opponent never showed) keeps their place, up to this far back. */
export const MAX_REQUEUE_MS = 5 * 60 * 1000;

/** The longest-waiting player `me` may be matched with (wanting the same length of series), or null. */
export function pickPartner(me: Seeker, others: Seeker[]): Seeker | null {
  const ok = others.filter((o) => o.pub !== me.pub && !me.blocked.includes(o.pub) && !o.blocked.includes(me.pub) && seriesLength(o.bestOf) === seriesLength(me.bestOf));
  ok.sort((a, b) => a.since - b.since);
  return ok[0] ?? null;
}

/** When a player may queue again after walking out of series (null: they may now). */
export function cooldownUntil(leaves: number[], now: number): number | null {
  const recent = leaves.filter((t) => now - t < LEAVE_WINDOW_MS);
  if (recent.length <= FREE_LEAVES) return null;
  const until = Math.max(...recent) + Math.min(COOLDOWN_MAX_MS, COOLDOWN_STEP_MS * (recent.length - FREE_LEAVES));
  return until > now ? until : null;
}

/** A search's start time: now, or (going back to the queue) the original time, but never in the future or too far back. */
export const searchSince = (since: unknown, now: number) => (typeof since === 'number' && isFinite(since) ? Math.min(now, Math.max(now - MAX_REQUEUE_MS, since)) : now);

/** A cleaned block list: public ids only, the most recent ones. */
export const cleanBlocks = (b: unknown): string[] => (Array.isArray(b) ? b.filter((x): x is string => typeof x === 'string' && /^[a-f0-9]{16}$/.test(x)).slice(-MAX_BLOCKS) : []);

/** A player's public id: the first 16 hex characters of their device id's SHA-256 (the device id stays private). */
export async function pubOf(device: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`specimen:${device}`));
  return [...new Uint8Array(d)]
    .slice(0, 8)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

/** What the admin page sees. */
export interface LoungeOverview {
  online: number;
  searching: number;
  playing: number;
  lounges: LoungeInfo[];
  matchesToday: number;
  matchesHour: number;
  reports: StoredReport[];
  bans: (Ban & { id: string })[];
  pushSubscribers: number;
}

