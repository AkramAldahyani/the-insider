/**
 * Turns a player's choice on the start menu into the settings of their private
 * match (Phase 5a, part A). The choice was checked by `parseSoloChoice`
 * (@insider/shared); everything else (scenario, map, developer tools...) still
 * comes from the server operator only.
 */
import { ALL_WEAKNESSES, chooseWeaknesses, type Scenario, type WeaknessId } from '@insider/engine';
import { DEFENDER_LADDER, SOLO_MEETINGS, ladderLevel, withCameras, type SoloChoice, type SoloDifficulty } from '@insider/shared';
import { INVESTIGATION_PACE } from './bots/investigation-pace';
import { Random } from './bots/random';
import type { OfficeGameOptions } from './game';
import { DEFENDER_SETTINGS, LADDER_SETTINGS, TRAINING_SETTINGS, type DefenderSettings } from './ladder';

/**
 * What a difficulty level of INVESTIGATION means, besides what the bot hacker
 * knows and how fast it is (bots/hacker-knowledge.ts and hacker-pace.ts).
 */
export interface Level {
  /** How many weaknesses the office has today. More = more ways in. */
  weaknesses: number;
  /** How often bots leave their desk without locking (more open PCs, more false trails). */
  forgetLock: number;
  /** How many clues colleagues put on the board themselves. With 0 they only speak in meetings. */
  pinClues: number;
}
export const LEVELS: Record<SoloDifficulty, Level> = {
  easy: { weaknesses: 2, forgetLock: 0.15, pinClues: 3 },
  normal: { weaknesses: 3, forgetLock: 0.25, pinClues: 0 },
  hard: { weaknesses: 4, forgetLock: 0.4, pinClues: 0 },
};

/**
 * What a difficulty level of INFILTRATION means, besides how fast the bots
 * investigate (bots/investigation-pace.ts). Here the player is the hacker, so
 * more weaknesses and more open screens make it easier.
 */
interface InfiltrationLevel {
  weaknesses: number;
  forgetLock: number;
  /** Game minutes between two rounds of checks every bot makes of its own PC. */
  checkMinutes: readonly [number, number];
  /** Game minutes between two old actions of the hacker the SIEM flags again (anti-stall). */
  escalationMinutes: number;
  /**
   * Game minutes between first reading the flag and handing it in. Without it a
   * player who does everything in one burst is gone before anybody can look,
   * and being quiet would not matter.
   */
  handInMinutes: number;
}
const INFILTRATION: Record<SoloDifficulty, InfiltrationLevel> = {
  easy: { weaknesses: 4, forgetLock: 0.45, checkMinutes: [12, 25], escalationMinutes: 20, handInMinutes: 2 },
  normal: { weaknesses: 3, forgetLock: 0.3, checkMinutes: [7, 15], escalationMinutes: 15, handInMinutes: 4 },
  hard: { weaknesses: 2, forgetLock: 0.15, checkMinutes: [4, 9], escalationMinutes: 10, handInMinutes: 5 },
};
/** In Infiltration the colleagues are at work from the start: an empty office would be the perfect moment. */
const ARRIVE_SECONDS = 20;
/** How many clues the bots may put on the board in Infiltration: as good as all they find. */
const INFILTRATION_PINS = 40;

/**
 * Weaknesses that give the hacker a way in without waiting for somebody's
 * mistake. A solo match (and a lobby's) always has one: without, the bot hacker waits beside
 * the administrator, and a match can take hours (Phase 5 part J).
 */
const DIRECT: WeaknessId[] = ['plaintext-password', 'weak-admin-password'];

/** `botAdmin`: the administrator is played by the computer. */
export function pickWeaknesses(scenario: Scenario, botAdmin: boolean, seed: number, count: number): WeaknessId[] {
  const random = new Random(seed ^ 0x3ea4);
  // A careless administrator is a bot's habit: it means nothing when a person is the administrator.
  const pool = chooseWeaknesses(scenario, seed, ALL_WEAKNESSES).filter((id) => !(id === 'careless-admin' && !botAdmin));
  const direct = pool.filter((id) => DIRECT.includes(id));
  const picked: WeaknessId[] = direct.length > 0 ? [random.pick(direct)] : [];
  const rest = pool.filter((id) => !picked.includes(id));
  while (picked.length < count && rest.length > 0) picked.push(rest.splice(random.int(0, rest.length - 1), 1)[0]);
  return picked;
}

/**
 * Who the human plays. A person with the chosen role (as the hacker: an ordinary employee), picked with the match's
 * seed, so two matches as "employee" need not be the same employee.
 */
function pickPlayer(options: OfficeGameOptions, choice: SoloChoice, seed: number): string {
  const role = choice.mode === 'infiltration' ? 'employee' : choice.role;
  const people = options.scenario.players.filter((p) => role === 'any' || (p.role ?? 'employee') === role);
  if (people.length === 0) throw new Error(`Nobody at this company has the role "${role}".`);
  // Its own sequence: the choice of role never changes who the hacker is, or anything else the seed decides.
  return new Random(seed ^ 0x501050).pick(people).id;
}

const roleOf = (options: OfficeGameOptions, playerId: string): SoloChoice['role'] =>
  (options.scenario.players.find((p) => p.id === playerId)!.role ?? 'employee') as SoloChoice['role'];

/** A level of the scenario ladder: an Infiltration in which everything is fixed (ladder.ts). */
function ladderGameOptions(base: OfficeGameOptions, level: number): OfficeGameOptions {
  const s = LADDER_SETTINGS[level - 1];
  return {
    ...base,
    seed: s.seed,
    map: withCameras(base.map, ladderLevel(level)?.cameras),
    bots: true,
    botOptions: {
      ...base.botOptions, hacker: false, investigate: true, arriveSeconds: ARRIVE_SECONDS, investigationPace: INVESTIGATION_PACE[s.pace],
      pinClues: INFILTRATION_PINS, forgetLock: s.forgetLock, checkMinutes: s.checkMinutes,
    },
    weaknesses: s.weaknesses,
    escalationMinutes: s.escalationMinutes,
    meetingTimes: { ...base.meetingTimes, usesPerPlayer: SOLO_MEETINGS },
    soloPlayer: s.playerId,
    soloHacker: true,
    handInMinutes: s.handInMinutes,
  };
}

/**
 * The training day, or a level of the defender ladder: an Investigation in which
 * everything is fixed (ladder.ts). Who the player is follows from the job and the level's seed.
 */
function defenderGameOptions(base: OfficeGameOptions, role: SoloChoice['role'], s: DefenderSettings): OfficeGameOptions {
  const playerId = pickPlayer(base, { mode: 'investigation', role, difficulty: 'normal' }, s.seed);
  return {
    ...base,
    seed: s.seed,
    bots: true,
    botOptions: { ...base.botOptions, hacker: true, hackerDifficulty: s.hackerDifficulty, hackerPace: s.hackerPace, hackerNot: playerId, forgetLock: s.forgetLock, pinClues: s.pinClues },
    weaknesses: s.weaknesses,
    meetingTimes: { ...base.meetingTimes, usesPerPlayer: SOLO_MEETINGS },
    soloPlayer: playerId,
  };
}

export function soloGameOptions(base: OfficeGameOptions, choice: SoloChoice, seed: number): OfficeGameOptions {
  if (choice.mode === 'training') return defenderGameOptions(base, 'soc', TRAINING_SETTINGS);
  if (choice.mode === 'investigation' && choice.level !== undefined) return defenderGameOptions(base, DEFENDER_LADDER[choice.level - 1].role, DEFENDER_SETTINGS[choice.level - 1]);
  if (choice.level !== undefined) return ladderGameOptions(base, choice.level);
  const playerId = pickPlayer(base, choice, seed);
  // The operator may force certain weaknesses (VULNS, for tests); otherwise the level decides how many.
  const weaknesses = (count: number) => (Array.isArray(base.weaknesses) ? base.weaknesses : pickWeaknesses(base.scenario, roleOf(base, playerId) !== 'sysadmin', seed, count));
  if (choice.mode === 'infiltration') {
    const level = INFILTRATION[choice.difficulty];
    return {
      ...base,
      seed,
      bots: true,
      botOptions: {
        ...base.botOptions, hacker: false, investigate: true, arriveSeconds: ARRIVE_SECONDS, investigationPace: INVESTIGATION_PACE[choice.difficulty],
        pinClues: INFILTRATION_PINS, forgetLock: level.forgetLock, checkMinutes: level.checkMinutes,
      },
      weaknesses: weaknesses(level.weaknesses),
      escalationMinutes: base.escalationMinutes ?? level.escalationMinutes,
      meetingTimes: { ...base.meetingTimes, usesPerPlayer: SOLO_MEETINGS },
      soloPlayer: playerId,
      soloHacker: true,
      handInMinutes: level.handInMinutes,
    };
  }
  const level = LEVELS[choice.difficulty];
  return {
    ...base,
    seed,
    // A solo match needs its colleagues and its hacker, whatever the shared office is set to.
    bots: true,
    botOptions: { ...base.botOptions, hacker: true, hackerDifficulty: choice.difficulty, hackerNot: playerId, forgetLock: level.forgetLock, pinClues: level.pinClues },
    weaknesses: weaknesses(level.weaknesses),
    meetingTimes: { ...base.meetingTimes, usesPerPlayer: SOLO_MEETINGS },
    soloPlayer: playerId,
  };
}
