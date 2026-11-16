/**
 * The bots' own random number generator.
 *
 * Bots never call Math.random(): with the same seed they make the same
 * choices, which is what lets a test (or a bug report) replay a match.
 *
 * It is separate from the engine's generator (`world.rngState`) on purpose.
 * The engine's numbers decide things like which IP address a PC gets; if bots
 * drew from the same sequence, adding a bot would change everybody's IP.
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A number from 0 (included) to 1 (not included). Same algorithm as the engine: "mulberry32". */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A number between min and max. */
  between(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** A whole number between min and max, both included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with the given probability (0 = never, 1 = always). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** One item of a list. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}
