/**
 * Turns a player's choice on the start menu into the settings of their private
 * match (Phase 5a, part A). The choice was checked by `parseSoloChoice`
 * (@insider/shared); everything else (scenario, map, developer tools...) still
 * comes from the server operator only.
 */
import { SOLO_MEETINGS, type SoloChoice } from '@insider/shared';
import { Random } from './bots/random';
import type { OfficeGameOptions } from './game';

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

export function soloGameOptions(base: OfficeGameOptions, choice: SoloChoice, seed: number): OfficeGameOptions {
  const playerId = pickPlayer(base, choice, seed);
  return {
    ...base,
    seed,
    // A solo match needs its colleagues and its hacker, whatever the shared office is set to.
    bots: true,
    botOptions: { ...base.botOptions, hacker: true, hackerDifficulty: choice.difficulty, hackerNot: playerId },
    meetingTimes: { ...base.meetingTimes, usesPerPlayer: SOLO_MEETINGS },
    soloPlayer: playerId,
  };
}
