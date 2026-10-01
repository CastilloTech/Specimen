import type { GameState, PlayerId } from '../engine';
import { decodeCode, encodeCode } from './codec';
import type { SavedReplay } from './storage';

// Sharing without a server: a replay travels inside a link (its setup and actions, compressed into the URL
// fragment, which never reaches any server), and the daily result as a short text with a round-by-round grid.

export const REPLAY_TAG = 'SPR1';

type Shared = Omit<SavedReplay, 'id'>;

export const replayCode = (r: SavedReplay): Promise<string> => {
  const { id: _id, ...rest } = r;
  return encodeCode(REPLAY_TAG, rest);
};

export async function replayFromCode(code: string): Promise<SavedReplay> {
  const r = await decodeCode<Shared>(REPLAY_TAG, code, 'replay link');
  if (!r || !r.setup || !Array.isArray(r.setup.players) || r.setup.players.length !== 2 || !Array.isArray(r.actions) || !Array.isArray(r.names)) throw new Error('The replay link is damaged.');
  return { ...r, id: `shared-${r.setup.seed}-${r.actions.length}`, me: r.me === 1 ? 1 : 0 };
}

/** The game's own address with a fragment (e.g. "#replay=SPR1.…" or "#daily"). */
export const appLink = (fragment = '') => `${location.origin}${location.pathname}${fragment ? `#${fragment}` : ''}`;

export const replayLink = async (r: SavedReplay) => appLink(`replay=${await replayCode(r)}`);

/** What a link opened the game with: a shared replay, the daily challenge, or an online room invite. */
export type Incoming = { kind: 'replay'; code: string } | { kind: 'daily' } | { kind: 'room'; code: string } | { kind: 'lounge' } | { kind: 'admin' } | null;
export function readIncoming(hash = location.hash): Incoming {
  const h = decodeURIComponent(hash.replace(/^#/, ''));
  if (h.startsWith('replay=')) return { kind: 'replay', code: h.slice('replay='.length) };
  if (h === 'daily') return { kind: 'daily' };
  // A notification from online play opens the lounge; the admin page has its own link.
  if (h === 'lounge') return { kind: 'lounge' };
  if (h === 'admin') return { kind: 'admin' };
  // An online room invite: #room=ABCDE
  if (/^room=[A-Za-z]{5}$/.test(h)) return { kind: 'room', code: h.slice(5).toUpperCase() };
  return null;
}
export const clearIncoming = () => history.replaceState(null, '', location.pathname + location.search);

/** The system share sheet where there is one (phones), else the clipboard. */
export async function shareOrCopy(data: { title: string; text?: string; url?: string }): Promise<'shared' | 'copied' | 'failed'> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };
  if (nav.share && (!nav.canShare || nav.canShare(data)) && matchMedia('(pointer: coarse)').matches) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'failed';
    }
  }
  try {
    await navigator.clipboard.writeText([data.text, data.url].filter(Boolean).join('\n'));
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** One square per round: 🟩 you dealt more damage than you took, 🟥 you took more, ⬜ even. */
export function roundGrid(s: GameState, me: PlayerId): string {
  const sn = s.snapshots;
  const opp = (1 - me) as PlayerId;
  let out = '';
  for (let i = 1; i < sn.length; i++) {
    const took = sn[i - 1].hp[me] - sn[i].hp[me];
    const dealt = sn[i - 1].hp[opp] - sn[i].hp[opp];
    out += dealt > took ? '🟩' : took > dealt ? '🟥' : '⬜';
  }
  return out;
}
