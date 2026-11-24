/**
 * Turns a player's choice on the start menu into the settings of their private
 * match (Phase 5a, part A). The choice was checked by `parseSoloChoice`
 * (@insider/shared); everything else (scenario, map, developer tools...) still
 * comes from the server operator only.
 */
import { ALL_WEAKNESSES, chooseWeaknesses, type Scenario, type WeaknessId } from '@insider/engine';
import { SOLO_MEETINGS, type SoloChoice, type SoloDifficulty } from '@insider/shared';
import { Random } from './bots/random';
import type { OfficeGameOptions } from './game';

/**
 * What a difficulty level means, besides what the bot hacker knows and how fast
 * it is (bots/hacker-knowledge.ts and hacker-pace.ts).
 */
interface Level {
  /** How many weaknesses the office has today. More = more ways in. */
  weaknesses: number;
  /** How often bots leave their desk without locking (more open PCs, more false trails). */
  forgetLock: number;
  /** Colleagues pin clues they find on the board themselves. Otherwise they only speak in meetings. */
  pinClues: boolean;
}
const LEVELS: Record<SoloDifficulty, Level> = {
  easy: { weaknesses: 2, forgetLock: 0.15, pinClues: true },
  normal: { weaknesses: 3, forgetLock: 0.25, pinClues: false },
  hard: { weaknesses: 4, forgetLock: 0.4, pinClues: false },
};

/**
 * Weaknesses that give the hacker a way in without waiting for somebody's
 * mistake. A solo match always has one: without, the bot hacker waits beside
 * the administrator, and a match can take hours (Phase 5 part J).
 */
const DIRECT: WeaknessId[] = ['plaintext-password', 'weak-admin-password'];

function pickWeaknesses(scenario: Scenario, choice: SoloChoice, seed: number): WeaknessId[] {
  const random = new Random(seed ^ 0x3ea4);
  // A careless administrator is a bot's habit: it means nothing when the player is the administrator.
  const pool = chooseWeaknesses(scenario, seed, ALL_WEAKNESSES).filter((id) => !(id === 'careless-admin' && choice.role === 'sysadmin'));
  const direct = pool.filter((id) => DIRECT.includes(id));
  const picked: WeaknessId[] = direct.length > 0 ? [random.pick(direct)] : [];
  const rest = pool.filter((id) => !picked.includes(id));
  while (picked.length < LEVELS[choice.difficulty].weaknesses && rest.length > 0) picked.push(rest.splice(random.int(0, rest.length - 1), 1)[0]);
  return picked;
}

/**
 * Who the human plays. A person with the chosen role, picked with the match's
 * seed, so two matches as "employee" need not be the same employee.
 */
function pickPlayer(options: OfficeGameOptions, choice: SoloChoice, seed: number): string {
  const people = options.scenario.players.filter((p) => choice.role === 'any' || (p.role ?? 'employee') === choice.role);
  if (people.length === 0) throw new Error(`Nobody at this company has the role "${choice.role}".`);
  // Its own sequence: the choice of role never changes who the hacker is, or anything else the seed decides.
  return new Random(seed ^ 0x501050).pick(people).id;
}

const roleOf = (options: OfficeGameOptions, playerId: string): SoloChoice['role'] =>
  (options.scenario.players.find((p) => p.id === playerId)!.role ?? 'employee') as SoloChoice['role'];

export function soloGameOptions(base: OfficeGameOptions, choice: SoloChoice, seed: number): OfficeGameOptions {
  const playerId = pickPlayer(base, choice, seed);
  const level = LEVELS[choice.difficulty];
  return {
    ...base,
    seed,
    // A solo match needs its colleagues and its hacker, whatever the shared office is set to.
    bots: true,
    botOptions: { ...base.botOptions, hacker: true, hackerDifficulty: choice.difficulty, hackerNot: playerId, forgetLock: level.forgetLock, pinClues: level.pinClues },
    // The operator may force certain weaknesses (VULNS, for tests); otherwise the level decides how many.
    weaknesses: Array.isArray(base.weaknesses) ? base.weaknesses : pickWeaknesses(base.scenario, { ...choice, role: roleOf(base, playerId) }, seed),
    meetingTimes: { ...base.meetingTimes, usesPerPlayer: SOLO_MEETINGS },
    soloPlayer: playerId,
  };
}
