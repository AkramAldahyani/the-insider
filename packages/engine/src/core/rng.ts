/**
 * Seedable random numbers.
 *
 * We never call Math.random(): the generator's state lives in `world.rngState`,
 * so the same seed + the same inputs always produce exactly the same world.
 * The algorithm is "mulberry32" - tiny, fast, and good enough for a game.
 */
import type { World } from '../types';

/** Returns a float in [0, 1) and advances the world's RNG state. */
export function nextRandom(world: World): number {
  world.rngState = (world.rngState + 0x6d2b79f5) >>> 0;
  let t = world.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Random integer between min and max, both inclusive. */
export function randInt(world: World, min: number, max: number): number {
  return min + Math.floor(nextRandom(world) * (max - min + 1));
}

/** Random string of `length` characters taken from `alphabet`. */
export function randString(world: World, length: number, alphabet: string): string {
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[randInt(world, 0, alphabet.length - 1)];
  return s;
}

/** Simple non-cryptographic string hash (FNV-1a), returns an unsigned 32-bit number. */
export function hashString(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
