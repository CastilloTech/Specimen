// Compact match updates (server/room.ts `slim`): after the first view of a game, a client gets each update
// without the rules config and without the log entries it already has. Rebuilt on the client, every update must
// equal the full view exactly. Also the lounge's inactivity rule.
import { describe, expect, it } from 'vitest';
import { botAction, chipRows, chipsFor, makeRng, pendingPlayers, starterDeck } from '../src/engine';
import type { GameState, PlayerId } from '../src/engine';
import { act, gameKey, join, newRoom, ready, settle, slim, viewFor } from '../server/room';
import type { RoomData, Sent, ServerMsg } from '../server/room';
import { idleTooLong, SERVER_IDLE_MS } from '../server/lobby';

const player = (name: string, f: 'predator' | 'bastion', w: 'corrosion' | 'aegis') => {
  const chip = chipsFor(w)[0].id;
  return { name, faction: f, worldFaction: w, chip, loadout: chipRows(chip).map((r) => r.nodes[0].id), deck: starterDeck(f, w) };
};
let n = 0;
const tok = () => `t${++n}`;

/** What the client does with an update (mirrors OnlineConn): rebuild a compact one from the last view. */
function receive(prev: GameState | null, prevKey: string, m: ServerMsg): { state: GameState; key: string } | 'resync' {
  if (m.t !== 'state') throw new Error('not a state');
  const key = `${m.series.n}-${m.series.game}`;
  if (m.logFrom === undefined) return { state: m.state, key };
  if (!prev || prevKey !== key || prev.log.length < m.logFrom) return 'resync';
  return { state: { ...m.state, config: prev.config, log: [...prev.log.slice(0, m.logFrom), ...(m.logTail ?? [])] }, key };
}

describe('Compact match updates', () => {
  it('a whole series, rebuilt from compact updates, matches the full views exactly, at a fraction of the size', () => {
    const r: RoomData = newRoom('SLIMS', 0);
    join(r, { t: 'join', player: player('Ana', 'predator', 'corrosion') }, 0, () => 0.4, tok);
    join(r, { t: 'join', player: player('Ben', 'bastion', 'aegis') }, 0, () => 0.4, tok);
    const sent: (Sent | null)[] = [null, null];
    const have: { state: GameState | null; key: string }[] = [
      { state: null, key: '' },
      { state: null, key: '' },
    ];
    let full = 0;
    let compact = 0;
    let updates = 0;
    const deliver = () => {
      for (const seat of [0, 1] as PlayerId[]) {
        const v = viewFor(r, seat, 0)!;
        const out = slim(v, sent[seat], gameKey(r));
        sent[seat] = out.sent;
        full += JSON.stringify(v).length;
        compact += JSON.stringify(out.msg).length;
        updates++;
        const got = receive(have[seat].state, have[seat].key, out.msg);
        expect(got).not.toBe('resync');
        if (got === 'resync') return;
        expect(got.state).toEqual((v as Extract<ServerMsg, { t: 'state' }>).state);
        have[seat] = got;
      }
    };
    deliver();
    const rngs = [makeRng(3), makeRng(4)];
    for (let game = 0; game < 5 && !r.series.done; game++) {
      for (let i = 0; i < 3000 && r.state!.phase !== 'over'; i++) {
        const p = pendingPlayers(r.state!)[0];
        act(r, p, botAction(r.state!, p, rngs[p]), i);
        deliver();
      }
      if (!r.series.done) {
        ready(r, 0, 0, () => 0.6);
        ready(r, 1, 0, () => 0.6);
        deliver();
      }
    }
    expect(updates).toBeGreaterThan(50);
    // Far smaller on the wire.
    expect(compact / full).toBeLessThan(0.45);
  });

  it('a client that lost track asks again; the next game, and the end of each game, go out whole', () => {
    const r: RoomData = newRoom('SLIMT', 0);
    join(r, { t: 'join', player: player('Ana', 'predator', 'corrosion') }, 0, () => 0.4, tok);
    join(r, { t: 'join', player: player('Ben', 'bastion', 'aegis') }, 0, () => 0.4, tok);
    const first = slim(viewFor(r, 0)!, null, gameKey(r));
    expect(first.msg).not.toHaveProperty('logFrom');
    act(r, 0, { type: 'MULLIGAN', player: 0, mulligan: false }, 0);
    const second = slim(viewFor(r, 0)!, first.sent, gameKey(r));
    expect(second.msg).toHaveProperty('logFrom');
    expect((second.msg as { state: GameState }).state).not.toHaveProperty('config');
    // A client without the earlier view can't rebuild it: it asks for the whole view.
    expect(receive(null, '', second.msg)).toBe('resync');
    // The end of a game goes out whole (with the setup for the replay).
    r.state = { ...r.state!, phase: 'over', result: { winner: 0, reason: 'KO' } };
    settle(r, 0);
    expect(slim(viewFor(r, 0)!, second.sent, gameKey(r)).msg).not.toHaveProperty('logFrom');
    // The next game starts whole too (a different game key).
    ready(r, 0, 0, Math.random);
    ready(r, 1, 0, Math.random);
    expect(slim(viewFor(r, 0)!, second.sent, gameKey(r)).msg).not.toHaveProperty('logFrom');
  });
});

describe('Lounge inactivity', () => {
  it('only a player sitting in a lounge, not searching or playing, is idle; after the limit', () => {
    const now = 10 ** 9;
    expect(idleTooLong({ lounge: 1, status: 'lounge', active: now - SERVER_IDLE_MS }, now)).toBe(true);
    expect(idleTooLong({ lounge: 1, status: 'lounge', active: now - SERVER_IDLE_MS + 1 }, now)).toBe(false);
    expect(idleTooLong({ lounge: 1, status: 'searching', active: 0 }, now)).toBe(false);
    expect(idleTooLong({ lounge: 1, status: 'playing', active: 0 }, now)).toBe(false);
    expect(idleTooLong({ status: 'lounge', active: 0 }, now)).toBe(false);
  });
});
