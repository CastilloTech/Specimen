// The matchmaking queue's rules, independent of Cloudflare (the Lobby Durable Object in worker.ts stores and
// moves messages). Casual only: no ratings, so whoever has waited longest is matched first, except with
// someone either player has blocked. Players who often walk out of strangers' series wait a little before
// they can queue again.

/** Client → lobby. `device`: the player's private device id (the server works out their public id from it). */
export type LobbyClientMsg =
  | { t: 'hello'; device: string }
  | { t: 'find'; device: string; name: string; blocked?: string[]; since?: number }
  | { t: 'cancel' }
  /** Turning down a found match ("Not now", or too late): the room is called off at once. */
  | { t: 'decline'; code: string }
  | { t: 'ping' };
/** Lobby → client. */
export type LobbyServerMsg =
  | { t: 'counts'; searching: number; recent: number }
  | { t: 'searching'; since: number }
  | { t: 'matched'; code: string; opponent: string }
  | { t: 'cooldown'; until: number }
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
}

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

/** The longest-waiting player `me` may be matched with, or null. */
export function pickPartner(me: Seeker, others: Seeker[]): Seeker | null {
  const ok = others.filter((o) => o.pub !== me.pub && !me.blocked.includes(o.pub) && !o.blocked.includes(me.pub));
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
