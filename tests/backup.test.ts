import { beforeEach, describe, expect, it } from 'vitest';
import { decodeCode, encodeCode } from '../src/ui/codec';

// A tiny in-memory localStorage for the storage module.
class MemStorage {
  m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
(globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
const S = await import('../src/ui/storage');

describe('codes', () => {
  it('round-trip any JSON, survive line breaks, and reject the wrong tag or damage', async () => {
    const v = { a: [1, 2, 3], s: 'Specimen ✦ ünïcode', n: null, deep: { x: 'y'.repeat(5000) } };
    const code = await encodeCode('SPX1', v);
    expect(code.startsWith('SPX1.')).toBe(true);
    expect(code.length).toBeLessThan(400); // repetitive data compresses
    expect(await decodeCode('SPX1', code)).toEqual(v);
    expect(await decodeCode('SPX1', `  ${code.slice(0, 30)}\n${code.slice(30)}  `)).toEqual(v);
    await expect(decodeCode('SPS1', code)).rejects.toThrow();
    await expect(decodeCode('SPX1', code.slice(0, code.length - 12))).rejects.toThrow();
  });
});

describe('save backups', () => {
  beforeEach(() => localStorage.clear());

  it('export every per-save key, restore into another slot, and replace what was there', () => {
    S.createSave(0, 'Alice');
    S.saveReplay({ id: 'r', at: 1, me: 0, names: ['A', 'B'], result: 'win', rounds: 5, setup: { seed: 1, players: [] as never }, actions: [] });
    localStorage.setItem('specimen.save0.progress', JSON.stringify({ biomass: 321 }));
    localStorage.setItem('specimen.save0.someFutureKey', JSON.stringify([1, 2]));
    const b = S.exportSave(0)!;
    expect(Object.keys(b.data).sort()).toEqual(['progress', 'replays', 'someFutureKey']);
    expect(S.loadSaveIndex().slots[0]!.backedUp).toBeGreaterThan(0);

    S.createSave(2, 'Bob');
    localStorage.setItem('specimen.save2.decks', JSON.stringify([{ id: 'x' }]));
    S.importSave(2, S.parseBackup(JSON.parse(JSON.stringify(b))));
    const idx = S.loadSaveIndex();
    expect(idx.active).toBe(2);
    expect(idx.slots[2]!.name).toBe('Alice');
    expect(JSON.parse(localStorage.getItem('specimen.save2.progress')!)).toEqual({ biomass: 321 });
    expect(localStorage.getItem('specimen.save2.decks')).toBeNull(); // Bob's data is gone
    expect(S.loadReplays()).toHaveLength(1);
  });

  it('rejects things that are not saves', () => {
    expect(() => S.parseBackup({ game: 'Other' })).toThrow();
    expect(() => S.parseBackup(null)).toThrow();
    expect(() => S.parseBackup({ game: 'Specimen', kind: 'save', v: 2, meta: { name: 'x' }, data: {} })).toThrow(/newer/);
    expect(() => S.parseBackup({ game: 'Specimen', kind: 'save', v: 1, meta: { name: 'x' }, data: { '../evil': 1 } })).toThrow();
  });

  it('deleting a save removes every key it had', () => {
    S.createSave(1, 'C');
    localStorage.setItem('specimen.save1.anything', '1');
    S.deleteSave(1);
    expect([...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).filter((k) => k!.startsWith('specimen.save1.'))).toEqual([]);
  });
});
