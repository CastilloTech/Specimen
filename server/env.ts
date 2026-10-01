// What the server's pieces share: its bindings and settings, and a few small helpers.
import type { Lobby } from './lounge';
import type { MatchRoom } from './matchroom';

/** A Cloudflare rate limiter (configured in wrangler.jsonc; it doesn't count against the Durable Objects allowance). */
export interface Limiter {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ROOMS: DurableObjectNamespace<MatchRoom>;
  LOBBY: DurableObjectNamespace<Lobby>;
  /** Comma-separated origins allowed to call the server (the game's address; local dev is always allowed). */
  ALLOWED_ORIGINS: string;
  /** Per-address limits: creating rooms, opening connections, everything else. */
  RL_ROOMS?: Limiter;
  RL_CONNECT?: Limiter;
  RL_MISC?: Limiter;
  /** The admin page's secret code (a Worker secret). Without it, the admin page is off. */
  ADMIN_TOKEN?: string;
  /** Web Push: the server's VAPID key pair (the private one as a JWK, a Worker secret) and who to contact. */
  VAPID_PUBLIC?: string;
  VAPID_PRIVATE?: string;
  PUSH_SUBJECT?: string;
  /** Usage on the admin page: a read-only Cloudflare analytics token (a Worker secret) and the account id. */
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
}

/** Rooms are kept a day, then cleared. */
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
/** An alarm is never set for less than this ahead. */
export const MIN_ALARM_MS = 5_000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: easy to read out loud
export const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

/** The keep-alive ping both clients send, and its answer: Cloudflare replies on its own, without waking the object. */
export const PING = JSON.stringify({ t: 'ping' });
export const PONG = JSON.stringify({ t: 'pong' });

/** The error Cloudflare throws once the free plan's daily Durable Objects allowance is used up. */
export const isAllowanceError = (e: unknown) => /exceeded allowed volume|free tier/i.test(String((e as Error)?.message ?? e));

/** The one lounge object everyone shares. */
export const lobbyOf = (env: Env) => env.LOBBY.get(env.LOBBY.idFromName('lobby'));
