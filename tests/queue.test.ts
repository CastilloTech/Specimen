// The matchmaking queue (server/lobby.ts), names shown to strangers (server/names.ts), and the rooms the queue
// makes (server/room.ts): only the two matched players, under checked names, and a room that gives up on a
// player who never arrives.
import { describe, expect, it } from 'vitest';
import { chipRows, chipsFor, starterDeck } from '../src/engine';
import { checkName } from '../server/names';
import { banned, cleanBlocks, cooldownUntil, COOLDOWN_MAX_MS, COOLDOWN_STEP_MS, FREE_LEAVES, MAX_REQUEUE_MS, nextReset, pickPartner, pubOf, searchSince } from '../server/lobby';
import type { Seeker } from '../server/lobby';
import { decline, join, leave, newRoom, nextWake, QUEUE_JOIN_MS, tick, viewFor } from '../server/room';

describe('Names strangers see', () => {
  it('ordinary names pass, tidied', () => {
    for (const n of ['Ana', 'Carlos Castillo', 'José', 'xX_Viper_Xx', "D'Arcy", 'Mr. Bones']) expect(checkName(n)).toEqual({ ok: true, name: n });
    expect(checkName('  Big   Ana  ')).toEqual({ ok: true, name: 'Big Ana' });
  });

  it('words that merely contain a bad word pass', () => {
    for (const n of ['Shinigami', 'Torpedo', 'Classy Dan', 'Grape Ape', 'Peacock', 'Spicy', 'Assassin', 'Dickens', 'Cucumber', 'Essex', 'Analyst', 'Bass Drop']) expect(checkName(n).ok).toBe(true);
  });

  it('length, characters and links are checked', () => {
    expect(checkName('ab')).toMatchObject({ ok: false, reason: expect.stringMatching(/3 to 16/) });
    expect(checkName('x'.repeat(17)).ok).toBe(false);
    expect(checkName('Ana<script>')).toMatchObject({ ok: false, reason: expect.stringMatching(/only/) });
    expect(checkName('123')).toMatchObject({ ok: false, reason: expect.stringMatching(/two letters/) });
    for (const n of ['www.site.com', 'ana.gg', 'discord ana', 'my twitch']) expect(checkName(n)).toMatchObject({ ok: false, reason: expect.stringMatching(/links/) });
    expect(checkName(42).ok).toBe(false);
  });

  it("the game's characters and staff-sounding names are reserved", () => {
    for (const n of ['Z Z Z', 'The Handler', 'Admin', 'Admin Joe', 'M0derator', 'Player 1', 'Specimen', 'CastilloTech', 'Official Ana']) expect(checkName(n)).toMatchObject({ ok: false, reason: expect.stringMatching(/reserved/) });
  });

  it('the word filter sees through spacing, repeats, accents and look-alikes', () => {
    for (const n of ['f u c k', 'Fuuuuck', 'sh1t', 'Big A55', 'a s s', 'niiigger', 'Nigga99', 'Hitler', 'puta', 'pendejo', 'kys', 'pedo']) expect(checkName(n)).toMatchObject({ ok: false, reason: expect.stringMatching(/not allowed/) });
  });
});

const seek = (pub: string, since: number, blocked: string[] = []): Seeker => ({ pub, name: pub, blocked, since });

describe('The queue', () => {
  it('matches the longest-waiting player, never yourself', () => {
    expect(pickPartner(seek('a', 50), [seek('b', 30), seek('c', 10), seek('a', 1)])?.pub).toBe('c');
    expect(pickPartner(seek('a', 50), [])).toBeNull();
  });

  it('a block works both ways', () => {
    expect(pickPartner(seek('a', 50, ['c']), [seek('b', 30), seek('c', 10)])?.pub).toBe('b');
    expect(pickPartner(seek('a', 50), [seek('b', 30, ['a']), seek('c', 10, ['a'])])).toBeNull();
  });

  it('walking out of series: a few a day are free, then the wait grows (capped)', () => {
    const now = 10 ** 9;
    const leaves = (n: number) => Array.from({ length: n }, (_, i) => now - 1000 * (n - i));
    expect(cooldownUntil(leaves(FREE_LEAVES), now)).toBeNull();
    expect(cooldownUntil(leaves(FREE_LEAVES + 1), now)).toBe(now - 1000 + COOLDOWN_STEP_MS);
    expect(cooldownUntil(leaves(FREE_LEAVES + 20), now)).toBe(now - 1000 + COOLDOWN_MAX_MS);
    expect(cooldownUntil(leaves(FREE_LEAVES + 1), now + COOLDOWN_STEP_MS)).toBeNull();
    // A day later, they no longer count.
    expect(cooldownUntil(leaves(10), now + 25 * 60 * 60 * 1000)).toBeNull();
  });

  it('a place kept in the queue is never in the future or too far back; block lists are cleaned', () => {
    expect(searchSince(undefined, 1000)).toBe(1000);
    expect(searchSince(2000, 1000)).toBe(1000);
    expect(searchSince(0, 10 ** 7)).toBe(10 ** 7 - MAX_REQUEUE_MS);
    expect(cleanBlocks(['0123456789abcdef', 'nope', 5, 'FFFFFFFFFFFFFFFF'])).toEqual(['0123456789abcdef']);
    expect(cleanBlocks(Array.from({ length: 80 }, (_, i) => i.toString(16).padStart(16, '0')))).toHaveLength(50);
  });

  it('a public id is a stable hash of the device id, not the id itself', async () => {
    const d = 'a'.repeat(32);
    const p = await pubOf(d);
    expect(p).toMatch(/^[a-f0-9]{16}$/);
    expect(await pubOf(d)).toBe(p);
    expect(await pubOf('b'.repeat(32))).not.toBe(p);
    expect(d).not.toContain(p);
  });
});

const player = (name: string) => {
  const chip = chipsFor('corrosion')[0].id;
  return { name, faction: 'predator' as const, worldFaction: 'corrosion' as const, chip, loadout: chipRows(chip).map((r) => r.nodes[0].id), deck: starterDeck('predator', 'corrosion') };
};
let n = 0;
const tok = () => `t${++n}`;

describe('Rooms the queue makes', () => {
  it('seat only the two matched players, under checked names, and tell each who the other is', () => {
    const r = newRoom('QUEUE', 0, ['pa', 'pb']);
    expect(join(r, { t: 'join', player: player('Ana') }, 0, Math.random, tok, 'stranger').reply).toMatchObject({ t: 'error' });
    expect(join(r, { t: 'join', player: player('Ana') }, 0, Math.random, tok).reply).toMatchObject({ t: 'error' }); // no id at all
    expect(join(r, { t: 'join', player: player('Admin') }, 0, Math.random, tok, 'pa').reply).toMatchObject({ t: 'error', message: expect.stringMatching(/reserved/) });
    expect(join(r, { t: 'join', player: player('  Ana ') }, 0, Math.random, tok, 'pa').seat).toBe(0);
    expect(join(r, { t: 'join', player: player('Ana again') }, 0, Math.random, tok, 'pa').reply).toMatchObject({ t: 'error' }); // one seat each
    join(r, { t: 'join', player: player('Ben') }, 0, Math.random, tok, 'pb');
    expect(r.state?.phase).toBe('mulligan');
    expect(r.seats[0]!.player.name).toBe('Ana');
    expect(viewFor(r, 0)).toMatchObject({ queue: true, opponentId: 'pb' });
    expect(viewFor(r, 1)).toMatchObject({ queue: true, opponentId: 'pa' });
  });

  it('friend rooms keep any save name and are not queue rooms', () => {
    const r = newRoom('FRIEND', 0);
    join(r, { t: 'join', player: player('Player 1') }, 0, Math.random, tok, 'pa');
    join(r, { t: 'join', player: player('Ben') }, 0, Math.random, tok);
    expect(r.seats[0]!.player.name).toBe('Player 1');
    expect(viewFor(r, 1)).toMatchObject({ queue: false, opponentId: 'pa' });
    expect(viewFor(r, 0)).toMatchObject({ opponentId: null });
  });

  it('give up on a player who never arrives', () => {
    const r = newRoom('QUEUE', 0, ['pa', 'pb']);
    join(r, { t: 'join', player: player('Ana') }, 0, Math.random, tok, 'pa');
    expect(nextWake(r)).toBe(QUEUE_JOIN_MS);
    expect(tick(r, QUEUE_JOIN_MS - 1)).toBe(false);
    expect(tick(r, QUEUE_JOIN_MS)).toBe(true);
    expect(viewFor(r, 0)).toEqual({ t: 'noshow' });
    expect(join(r, { t: 'join', player: player('Ben') }, QUEUE_JOIN_MS + 5, Math.random, tok, 'pb').reply).toEqual({ t: 'noshow' });
    expect(nextWake(r)).toBeNull();
  });

  it('a matched player turning the match down calls the room off at once (only before it starts, only them)', () => {
    const r = newRoom('QUEUE', 0, ['pa', 'pb']);
    join(r, { t: 'join', player: player('Ana') }, 0, Math.random, tok, 'pa');
    expect(decline(r, 'someone')).toBe(false);
    expect(decline(r, 'pb')).toBe(true);
    expect(viewFor(r, 0)).toEqual({ t: 'noshow' });
    const started = newRoom('QUEUE', 0, ['pa', 'pb']);
    join(started, { t: 'join', player: player('Ana') }, 0, Math.random, tok, 'pa');
    join(started, { t: 'join', player: player('Ben') }, 0, Math.random, tok, 'pb');
    expect(decline(started, 'pb')).toBe(false);
  });

  it('walking out of a stranger series is reported for the cooldown; a friend series is not', () => {
    const q = newRoom('QUEUE', 0, ['pa', 'pb']);
    join(q, { t: 'join', player: player('Ana') }, 0, Math.random, tok, 'pa');
    join(q, { t: 'join', player: player('Ben') }, 0, Math.random, tok, 'pb');
    leave(q, 1, 10);
    expect(q.penalties).toEqual(['pb']);
    const f = newRoom('FRIEND', 0);
    join(f, { t: 'join', player: player('Ana') }, 0, Math.random, tok, 'pa');
    join(f, { t: 'join', player: player('Ben') }, 0, Math.random, tok, 'pb');
    leave(f, 1, 10);
    expect(f.penalties ?? []).toEqual([]);
  });
});

describe('Series length, bans and the daily reset', () => {
  it('the queue only matches players wanting the same length of series', () => {
    expect(pickPartner({ ...seek('a', 50), bestOf: 1 }, [seek('b', 10), { ...seek('c', 30), bestOf: 1 }])?.pub).toBe('c');
    expect(pickPartner(seek('a', 50), [{ ...seek('b', 10), bestOf: 1 }])).toBeNull();
  });
  it('a chat ban mutes; a suspension also stops play with strangers; both end', () => {
    const now = 1000;
    expect(banned({ scope: 'chat', until: 2000, reason: '' }, 'chat', now)).toBe(true);
    expect(banned({ scope: 'chat', until: 2000, reason: '' }, 'play', now)).toBe(false);
    expect(banned({ scope: 'all', until: 2000, reason: '' }, 'play', now)).toBe(true);
    expect(banned({ scope: 'all', until: 2000, reason: '' }, 'chat', 2000)).toBe(false);
    expect(banned(null, 'chat', now)).toBe(false);
  });
  it('the free allowance comes back at the next midnight UTC', () => {
    expect(new Date(nextReset(Date.UTC(2026, 9, 1, 20, 30))).toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(new Date(nextReset(Date.UTC(2026, 11, 31, 23, 59))).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
