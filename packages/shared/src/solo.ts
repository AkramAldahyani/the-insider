/**
 * Solo matches (DESIGN.md section 1a): one human, everybody else a bot.
 *
 * The start menu sends a SoloChoice when it asks the server for a private
 * match. Like everything a browser sends, it is not trusted: the server reads
 * it with `parseSoloChoice`, which accepts only the values listed here and
 * ignores anything else (a browser cannot smuggle in a seed, the developer
 * tools, or the hacker's name this way).
 */

import { LADDER } from './ladder';

/** Name of the Colyseus room type for solo matches (each one is a room of its own). */
export const SOLO_ROOM_NAME = 'solo';

/** Emergency meetings the player of a solo match may call (the shared office allows one). */
export const SOLO_MEETINGS = 2;

/** Investigation: the player defends. Infiltration: the player is the hacker, posing as an ordinary employee. */
export const SOLO_MODES = ['investigation', 'infiltration'] as const;
export type SoloMode = (typeof SOLO_MODES)[number];

/** Whose job to play; "any" lets the server pick a person. */
export const SOLO_ROLES = ['any', 'employee', 'soc', 'guard', 'sysadmin', 'helpdesk'] as const;
export type SoloRole = (typeof SOLO_ROLES)[number];

export const SOLO_DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type SoloDifficulty = (typeof SOLO_DIFFICULTIES)[number];

export interface SoloChoice {
  mode: SoloMode;
  role: SoloRole;
  difficulty: SoloDifficulty;
  /** Infiltration only: a level of the scenario ladder (1 = the first). Everything else is then fixed by the level. */
  level?: number;
}

/** Checks what a browser asked for. Null = not a valid choice. */
export function parseSoloChoice(value: unknown): SoloChoice | null {
  if (typeof value !== 'object' || value === null) return null;
  const { mode, role, difficulty, level } = value as Record<string, unknown>;
  const one = <T extends string>(list: readonly T[], x: unknown): T | undefined => list.find((item) => item === x);
  const m = one(SOLO_MODES, mode);
  const r = one(SOLO_ROLES, role);
  const d = one(SOLO_DIFFICULTIES, difficulty);
  if (!m || !r || !d) return null;
  // The hacker is one of the ordinary employees, as in every match.
  if (m === 'infiltration' && r !== 'any' && r !== 'employee') return null;
  if (level === undefined) return { mode: m, role: r, difficulty: d };
  if (m !== 'infiltration' || typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > LADDER.length) return null;
  return { mode: m, role: r, difficulty: d, level };
}
