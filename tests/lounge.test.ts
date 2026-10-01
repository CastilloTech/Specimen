// The lounge's rules (server/lobby.ts) and its chat filter (server/names.ts): profiles, the chat rate limit,
// muting after reports, blocks both ways, and what a chat message may carry.
import { describe, expect, it } from 'vitest';
import { cleanChat, CHAT_MAX } from '../server/names';
import { CHAT_BURST, CHAT_WINDOW_MS, chatAllowed, checkProfile, compatible, LOUNGE_SIZE, loungeCounts, loungeList, MUTE_MS, MUTE_REPORTS, mutedUntil, pickLounge, REPORT_WINDOW_MS } from '../server/lobby';

describe('Lounge chat filter', () => {
  it('ordinary messages pass untouched', () => {
    for (const m of ['gg wp, nice Bastion deck!', 'I have 3 cards and 10 HP', 'I won 2-1 at 10:30', 'classy grape peacock assassin', '😀', 'ok']) expect(cleanChat(m)).toEqual({ ok: true, text: m });
  });

  it('tidies spacing and refuses empty or overlong messages', () => {
    expect(cleanChat('  hi    there  ')).toEqual({ ok: true, text: 'hi there' });
    expect(cleanChat('   ').ok).toBe(false);
    expect(cleanChat('x'.repeat(CHAT_MAX + 1))).toMatchObject({ ok: false, reason: expect.stringMatching(/under/) });
    expect(cleanChat(5).ok).toBe(false);
  });

  it('blanks bad words, even spelled out or stretched', () => {
    expect(cleanChat('shit happens')).toEqual({ ok: true, text: '•••• happens' });
    expect(cleanChat('what the fuuuck')).toEqual({ ok: true, text: 'what the ••••••' });
    expect(cleanChat('f u c k you')).toEqual({ ok: true, text: '•••• you' });
    expect(cleanChat('puta madre')).toEqual({ ok: true, text: '•••• madre' });
  });

  it('removes links, handles, emails and phone numbers', () => {
    expect(cleanChat('go to www.site.com now')).toEqual({ ok: true, text: 'go to [link removed] now' });
    expect(cleanChat('check example.com/x')).toEqual({ ok: true, text: 'check [link removed]' });
    expect(cleanChat('add me on discord')).toEqual({ ok: true, text: 'add me on [link removed]' });
    expect(cleanChat('mail me ana@x.com')).toEqual({ ok: true, text: 'mail me [email removed]' });
    expect(cleanChat('call me 555-123-4567')).toEqual({ ok: true, text: 'call me [number removed]' });
  });

  it('a message that would be nothing but blanks is not sent', () => {
    expect(cleanChat('fuck')).toMatchObject({ ok: false, reason: expect.stringMatching(/filter/) });
  });

  it('invisible characters are stripped', () => {
    expect(cleanChat('he​llo\u0007')).toEqual({ ok: true, text: 'hello' });
  });
});

describe('Lounge rules', () => {
  const base = { name: 'Ana', emblem: 'aegis', faction: 'predator', worldFaction: 'corrosion', won: 3, lost: 1 };

  it('a profile is checked: name for strangers, real Specimen, a real emblem (or the Build), sane counts', () => {
    expect(checkProfile(base)).toEqual(base);
    expect(checkProfile({ ...base, name: 'Admin' })).toMatch(/reserved/);
    expect(checkProfile({ ...base, faction: 'dragon' })).toMatch(/Unknown/);
    expect(checkProfile({ ...base, emblem: 'nope' })).toMatchObject({ emblem: 'predator' });
    expect(checkProfile({ ...base, won: -4, lost: 1.5 })).toMatchObject({ won: 0, lost: 0 });
    expect(checkProfile(null)).toMatch(/Missing/);
  });

  it('chat: a few messages at once, then a pause', () => {
    let times: number[] | undefined;
    for (let i = 0; i < CHAT_BURST; i++) {
      const next = chatAllowed(times, 1000 + i);
      expect(next).not.toBeNull();
      times = next!;
    }
    expect(chatAllowed(times, 1000 + CHAT_BURST)).toBeNull();
    expect(chatAllowed(times, 1000 + CHAT_WINDOW_MS)).not.toBeNull();
  });

  it('muted only after reports from several different players, for a while', () => {
    const now = 10 ** 9;
    const by = (n: number, who = (i: number) => `p${i}`) => Array.from({ length: n }, (_, i) => ({ from: who(i), at: now - i * 1000 }));
    expect(mutedUntil(by(MUTE_REPORTS - 1), now)).toBeNull();
    expect(mutedUntil(by(10, () => 'same'), now)).toBeNull(); // one angry player is not enough
    expect(mutedUntil(by(MUTE_REPORTS), now)).toBe(now + MUTE_MS);
    expect(mutedUntil(by(MUTE_REPORTS), now + MUTE_MS)).toBeNull();
    expect(mutedUntil(by(MUTE_REPORTS), now + REPORT_WINDOW_MS + 1)).toBeNull();
  });

  it('a block works both ways for challenges and the queue', () => {
    expect(compatible({ pub: 'a', blocked: [] }, { pub: 'b', blocked: [] })).toBe(true);
    expect(compatible({ pub: 'a', blocked: ['b'] }, { pub: 'b', blocked: [] })).toBe(false);
    expect(compatible({ pub: 'a', blocked: [] }, { pub: 'b', blocked: ['a'] })).toBe(false);
    expect(compatible({ pub: 'a', blocked: [] }, { pub: 'a', blocked: [] })).toBe(false);
  });
});

describe('Lounges of ten', () => {
  const people = (lounge: number, n: number, prefix = `l${lounge}-`) => Array.from({ length: n }, (_, i) => ({ pub: `${prefix}${i}`, lounge }));

  it('counts each player once, however many tabs, and ignores those not in a lounge', () => {
    const c = loungeCounts([...people(1, 3), { pub: 'l1-0', lounge: 1 }, { pub: 'nowhere' }, ...people(4, 2)]);
    expect([...c]).toEqual([
      [1, 3],
      [4, 2],
    ]);
  });

  it('lists the lounges with people, plus the first empty one to start a new lounge', () => {
    expect(loungeList(loungeCounts([...people(1, 3), ...people(3, LOUNGE_SIZE)]))).toEqual([
      { id: 1, count: 3 },
      { id: 2, count: 0 },
      { id: 3, count: LOUNGE_SIZE },
    ]);
    expect(loungeList(new Map())).toEqual([{ id: 1, count: 0 }]);
  });

  it('a random lounge is one with people and room; when all are full (or empty), a new one', () => {
    const c = loungeCounts([...people(1, LOUNGE_SIZE), ...people(2, 4), ...people(3, 9)]);
    const picks = new Set(Array.from({ length: 40 }, (_, i) => pickLounge(c, () => (i % 10) / 10)));
    expect([...picks].sort()).toEqual([2, 3]);
    expect(pickLounge(loungeCounts([...people(1, LOUNGE_SIZE), ...people(2, LOUNGE_SIZE)]), Math.random)).toBe(3);
    expect(pickLounge(new Map(), Math.random)).toBe(1);
  });
});

describe('Being named in chat', () => {
  it('your name as a whole word, any case, with or without @', async () => {
    const { mentions } = await import('../src/ui/matchmaker');
    expect(mentions('gg Ana Strange, nice', 'Ana Strange')).toBe(true);
    expect(mentions('@ana strange you there?', 'Ana Strange')).toBe(true);
    expect(mentions('Banana Strangers', 'Ana Strange')).toBe(false);
    expect(mentions('hi all', 'Ana Strange')).toBe(false);
    expect(mentions('Mr. Bones!', 'Mr. Bones')).toBe(true);
    expect(mentions('anything', null)).toBe(false);
  });
});
