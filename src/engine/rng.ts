// Seeded RNG (mulberry32). The generator state is a plain int stored on the game
// state (`state.rng`) so that a match replays identically from seed + action list.

export function nextFloat(holder: { rng: number }): number {
  holder.rng = (holder.rng + 0x6d2b79f5) | 0;
  let t = holder.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(holder: { rng: number }, n: number): number {
  return Math.floor(nextFloat(holder) * n);
}

export function shuffleInPlace<T>(holder: { rng: number }, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(holder, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Independent generator for callers outside the game state (bots, simulator). */
export function makeRng(seed: number): { rng: number; float(): number; int(n: number): number; pick<T>(a: T[]): T } {
  const h = {
    rng: seed | 0,
    float() {
      return nextFloat(h);
    },
    int(n: number) {
      return nextInt(h, n);
    },
    pick<T>(a: T[]): T {
      return a[nextInt(h, a.length)];
    },
  };
  return h;
}
