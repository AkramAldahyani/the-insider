import { HACKER_RUMOURS, type WeaknessId } from '@insider/engine';
import { Random } from './random';

export type HackerDifficulty = 'easy' | 'normal' | 'hard';
export interface HackerKnowledge {
  rumours: WeaknessId[];
  /** Missing means unknown, not false. Only Hard receives negative confirmations. */
  confirmed: Partial<Record<WeaknessId, boolean>>;
}

export function parseHackerDifficulty(value = 'normal'): HackerDifficulty {
  if (value === 'easy' || value === 'normal' || value === 'hard') return value;
  throw new Error(`BOT_HACKER_DIFFICULTY must be easy, normal or hard, not "${value}"`);
}

/** A separate seeded stream keeps knowledge stable across arrivals, meetings and human handoffs. */
export function hackerKnowledge(difficulty: HackerDifficulty, seed: number, enabled: readonly WeaknessId[]): HackerKnowledge {
  const rumours = Object.keys(HACKER_RUMOURS) as WeaknessId[];
  if (difficulty === 'easy') return { rumours, confirmed: {} };
  if (difficulty === 'hard') return { rumours, confirmed: Object.fromEntries(rumours.map((id) => [id, enabled.includes(id)])) };
  const random = new Random(seed ^ 0x4b4e4f57);
  const pool = rumours.filter((id) => enabled.includes(id));
  // Confirm half (rounded down). A lone weakness has a seeded 50% chance of confirmation.
  // With two or more, Normal always leaves at least one enabled weakness to discover.
  const count = pool.length === 1 ? Number(random.chance(0.5)) : Math.floor(pool.length / 2);
  const confirmed: HackerKnowledge['confirmed'] = {};
  for (let i = 0; i < count; i++) confirmed[pool.splice(random.int(0, pool.length - 1), 1)[0]] = true;
  return { rumours, confirmed };
}
