/**
 * Learning to defend: the training day and the defender ladder.
 *
 * TRAINING DAY: one fixed, slow Investigation as the SOC analyst, with a guide
 * that says what to do next, step by step (client/src/game/training.ts).
 *
 * DEFENDER LADDER: five fixed Investigations, the mirror of the hacker ladder
 * (ladder.ts). Each level gives the player another job and the hacker another
 * way in, so that each one teaches another kind of evidence. Winning one opens
 * the next. What the server does with a level is in server/src/ladder.ts; the
 * computer hacker in them only does what it does in every match.
 */
import type { SoloChoice, SoloRole } from './solo';
import { LADDER, type LadderLevel } from './ladder';

export interface DefenderLevel {
  name: string;
  /** Whose job the player does (it decides which logs they may read). */
  role: Exclude<SoloRole, 'any'>;
  /** Shown in the menu and on the case at the start. */
  briefing: string;
  /** Shown after the match: what this level is about. */
  lesson: string;
}

export const DEFENDER_LADDER: DefenderLevel[] = [
  {
    name: 'The first alert',
    role: 'soc',
    briefing: 'A quiet morning, and a careless intruder. Wait for the HIGH alert, then follow its address: to a PC, and from the PC to its owner.',
    lesson: 'An alert names the address a command came from. The DHCP log says which PC had that address, and the desk says whose PC it is.',
  },
  {
    name: 'A guessed password',
    role: 'soc',
    briefing: 'Somebody is trying the administrator\'s password. Wrong guesses leave "Failed password" lines, and the right one leaves a login, from the same address.',
    lesson: 'Many failures and then one success from one address: a guessed password. Logins say WHICH account; the address says who really typed.',
  },
  {
    name: 'The open screen',
    role: 'guard',
    briefing: 'The administrator often walks away from an open PC. Whoever sits down there IS the administrator for the logs. The cameras and the badge log say who it really was.',
    lesson: 'A PC left open lends its owner\'s name to anybody. Only the physical traces, cameras and badges, tell who sat there.',
  },
  {
    name: 'My own name',
    role: 'sysadmin',
    briefing: 'You are the administrator. An old script holds your password. Watch for your own name in the logs, coming from a PC that is not yours.',
    lesson: 'A login as you, from an address that is not your PC, is the clearest sign of a stolen password. Check `last` on your servers now and then.',
  },
  {
    name: 'Everything at once',
    role: 'soc',
    briefing: 'Several ways in, a quick intruder, and colleagues who leave screens open. Use everything you have learned, and do not accuse too early.',
    lesson: 'Real cases mix false trails with true ones. A case is strong when clues from different places point at the same person.',
  },
];

/** The training day as a solo choice (everything else about it is fixed by the server). */
export const TRAINING_CHOICE: SoloChoice = { mode: 'training', role: 'soc', difficulty: 'easy' };

/** A level of the HACKER ladder, if this solo match is one. */
export const hackerLevel = (solo: SoloChoice | null | undefined): LadderLevel | undefined =>
  solo?.mode === 'infiltration' && solo.level ? LADDER[solo.level - 1] : undefined;

/** A level of the DEFENDER ladder, if this solo match is one. */
export const defenderLevel = (solo: SoloChoice | null | undefined): DefenderLevel | undefined =>
  solo?.mode === 'investigation' && solo.level ? DEFENDER_LADDER[solo.level - 1] : undefined;

/** The choice that plays this level of the defender ladder. */
export const defenderChoice = (level: number): SoloChoice => ({ mode: 'investigation', role: DEFENDER_LADDER[level - 1].role, difficulty: 'normal', level });
