/**
 * Byte-identical Deno port of lib/prng.ts.
 *
 * If you edit one, edit BOTH. Drift here = different boards on client vs
 * server = legitimate submissions get rejected. There's no test gate yet —
 * keep this short and obvious so a 5-second diff catches a mistake.
 */

export function hashStr(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function prngFromSeed(seed: string): () => number {
  return mulberry32(hashStr(seed));
}

export function seededShuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function seededPickUnique(range: number[], count: number, rnd: () => number): number[] {
  const pool = range.slice();
  const out: number[] = [];
  while (out.length < count && pool.length) {
    const idx = Math.floor(rnd() * pool.length);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

export function gameGridFromSeed(seed: string): number[] {
  const rnd = prngFromSeed("grid-" + seed);
  const nums = Array.from({ length: 25 }, (_, i) => i + 1);
  return seededShuffle(nums, rnd);
}
