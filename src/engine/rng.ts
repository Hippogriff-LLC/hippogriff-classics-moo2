// Deterministic, serializable PRNG (sfc32). All simulation randomness flows through an Rng whose
// state lives inside GameState so that save/load and replays are bit-for-bit reproducible.

export type RngState = [number, number, number, number];

export function seedState(seed: number): RngState {
  // splitmix32 to spread the seed
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const st: RngState = [next(), next(), next(), next()];
  return st;
}

export class Rng {
  s: RngState;
  constructor(state: RngState) {
    this.s = [state[0] >>> 0, state[1] >>> 0, state[2] >>> 0, state[3] >>> 0];
  }
  static fromSeed(seed: number): Rng {
    const r = new Rng(seedState(seed));
    for (let i = 0; i < 12; i++) r.u32();
    return r;
  }
  u32(): number {
    let [a, b, c, d] = this.s;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    this.s = [a >>> 0, b >>> 0, c, d];
    return t;
  }
  /** float in [0,1) */
  next(): number {
    return this.u32() / 4294967296;
  }
  /** integer in [0, n) */
  int(n: number): number {
    if (n <= 0) return 0;
    return Math.floor(this.next() * n);
  }
  /** integer in [lo, hi] */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of items) total += Math.max(0, w);
    let r = this.next() * total;
    for (const [v, w] of items) {
      r -= Math.max(0, w);
      if (r < 0) return v;
    }
    return items[items.length - 1][0];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
  state(): RngState {
    return [this.s[0], this.s[1], this.s[2], this.s[3]];
  }
}
