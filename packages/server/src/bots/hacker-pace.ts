/**
 * How FAST the simulated hacker plays (Phase 5, part J). Only the timing lives
 * here; what it does is in hacker.ts, and what it knows in hacker-knowledge.ts.
 *
 * Without these pauses the bot finished a match 3 to 7 minutes after the start,
 * before a defender had even sat down. With them, the hacker behaves like
 * somebody who also has a job: it works normally for a while, thinks before
 * each line, goes back to its own work after a failure, and does not hand the
 * flag in the second it has read it (reading it raises a HIGH alert, so this
 * last pause is the defenders' final chance).
 *
 * All numbers are [shortest, longest] in GAME time; the real pause is a random
 * one in between, from the bot's own seeded sequence, so matches still replay.
 */
import type { HackerDifficulty } from './hacker-knowledge';

type Range = readonly [number, number];

export interface HackerPace {
  /** Minutes of ordinary work after arriving, before the first attempt. */
  coverMinutes: Range;
  /** Seconds between two terminal lines. (A password question on the screen is answered at once.) */
  lineSeconds: Range;
  /** Minutes back at ordinary work after a failed attempt or a meeting. */
  restMinutes: Range;
  /** Minutes of ordinary work between reading the flag and handing it in. */
  handInMinutes: Range;
}

/** No pauses to speak of: for tests and demonstrations. This is how the bot played before part J. */
export const FAST_PACE: HackerPace = { coverMinutes: [2, 2], lineSeconds: [2, 5], restMinutes: [0.5, 0.5], handInMinutes: [0, 0] };

const PACES: Record<HackerDifficulty, HackerPace> = {
  easy: { coverMinutes: [6, 9], lineSeconds: [35, 75], restMinutes: [3, 5], handInMinutes: [4, 6] },
  normal: { coverMinutes: [5, 8], lineSeconds: [25, 55], restMinutes: [2, 4], handInMinutes: [3, 5] },
  hard: { coverMinutes: [4, 6], lineSeconds: [15, 35], restMinutes: [1.5, 3], handInMinutes: [2, 3] },
};

export function paceFor(difficulty: HackerDifficulty): HackerPace {
  return PACES[difficulty];
}

/** The BOT_HACKER_PACE setting. Undefined = the pace that belongs to the difficulty. */
export function parseHackerPace(value = 'normal'): HackerPace | undefined {
  if (value === 'normal') return undefined;
  if (value === 'fast') return FAST_PACE;
  throw new Error(`BOT_HACKER_PACE must be normal or fast, not "${value}"`);
}
