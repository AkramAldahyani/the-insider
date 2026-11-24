/**
 * What the server does with a level of the scenario ladder (Phase 5a, part G).
 * The texts and the extra cameras are in shared/src/ladder.ts.
 *
 * A level is fixed: the same employee, the same weaknesses and the same seed
 * every time, whatever the server's settings are (SEED, VULNS, STALL_MINUTES).
 */
import type { WeaknessId } from '@insider/engine';
import type { SoloDifficulty } from '@insider/shared';

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
