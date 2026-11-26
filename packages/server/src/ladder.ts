/**
 * What the server does with a level of the scenario ladder (Phase 5a, part G).
 * The texts and the extra cameras are in shared/src/ladder.ts.
 *
 * A level is fixed: the same employee, the same weaknesses and the same seed
 * every time, whatever the server's settings are (SEED, VULNS, STALL_MINUTES).
 */
import type { WeaknessId } from '@insider/engine';
import type { SoloDifficulty } from '@insider/shared';
import type { HackerDifficulty } from './bots/hacker-knowledge';
import type { HackerPace } from './bots/hacker-pace';

export interface LadderSettings {
  seed: number;
  /** Who the player is. */
  playerId: string;
  weaknesses: WeaknessId[];
  /** How fast the bots investigate (bots/investigation-pace.ts). */
  pace: SoloDifficulty;
  forgetLock: number;
  checkMinutes: readonly [number, number];
  escalationMinutes: number;
  handInMinutes: number;
}

export const LADDER_SETTINGS: LadderSettings[] = [
  { seed: 101, playerId: 'p4', weaknesses: ['plaintext-password'], pace: 'easy', forgetLock: 0.5, checkMinutes: [15, 25], escalationMinutes: 20, handInMinutes: 1 },
  { seed: 102, playerId: 'p1', weaknesses: ['weak-admin-password'], pace: 'easy', forgetLock: 0.4, checkMinutes: [12, 22], escalationMinutes: 20, handInMinutes: 2 },
  { seed: 103, playerId: 'p7', weaknesses: ['plaintext-password'], pace: 'normal', forgetLock: 0.6, checkMinutes: [10, 18], escalationMinutes: 15, handInMinutes: 5 },
  { seed: 104, playerId: 'p6', weaknesses: ['weak-admin-password', 'careless-admin'], pace: 'normal', forgetLock: 0.3, checkMinutes: [8, 15], escalationMinutes: 15, handInMinutes: 4 },
  { seed: 105, playerId: 'p2', weaknesses: ['weak-admin-password'], pace: 'hard', forgetLock: 0.1, checkMinutes: [5, 10], escalationMinutes: 10, handInMinutes: 5 },
];

// ───────────────────────────── The defender ladder and the training day ─────────────────────────────

/**
 * A level of the defender ladder (texts in shared/src/defenderLadder.ts). The
 * computer hacker plays as in every match; a level only fixes the office's
 * weaknesses, what the hacker knows of them, and how fast it is.
 */
export interface DefenderSettings {
  seed: number;
  weaknesses: WeaknessId[];
  /** What the computer hacker knows (bots/hacker-knowledge.ts). */
  hackerDifficulty: HackerDifficulty;
  /** How fast it plays; undefined = the pace of its difficulty (bots/hacker-pace.ts). */
  hackerPace?: HackerPace;
  /** How often colleagues leave their PC open. */
  forgetLock: number;
  /** Clues colleagues pin themselves. */
  pinClues: number;
}

/**
 * The training day: slower than any match, so that a beginner can read every
 * step of the guide, and the contact waits long for the flag. Only timing: the
 * hacker does what it always does.
 */
export const TRAINING_PACE: HackerPace = { coverMinutes: [3, 4], lineSeconds: [12, 20], restMinutes: [1, 2], handInMinutes: [15, 18] };
const LEARNING_PACE: HackerPace = { coverMinutes: [4, 6], lineSeconds: [20, 40], restMinutes: [2, 3], handInMinutes: [9, 11] };

export const TRAINING_SETTINGS: DefenderSettings = { seed: 201, weaknesses: ['plaintext-password'], hackerDifficulty: 'hard', hackerPace: TRAINING_PACE, forgetLock: 0.1, pinClues: 0 };

export const DEFENDER_SETTINGS: DefenderSettings[] = [
  { seed: 301, weaknesses: ['plaintext-password'], hackerDifficulty: 'hard', hackerPace: LEARNING_PACE, forgetLock: 0.1, pinClues: 0 },
  { seed: 302, weaknesses: ['weak-admin-password'], hackerDifficulty: 'hard', hackerPace: LEARNING_PACE, forgetLock: 0.1, pinClues: 0 },
  { seed: 306, weaknesses: ['careless-admin'], hackerDifficulty: 'hard', hackerPace: LEARNING_PACE, forgetLock: 0.15, pinClues: 0 },
  { seed: 304, weaknesses: ['plaintext-password'], hackerDifficulty: 'hard', hackerPace: LEARNING_PACE, forgetLock: 0.15, pinClues: 0 },
  { seed: 305, weaknesses: ['weak-admin-password', 'plaintext-password', 'careless-admin'], hackerDifficulty: 'hard', forgetLock: 0.4, pinClues: 0 },
];
