/** Small questions about the hackers of a match, for every part of the engine (no other imports, so no import circles). */
import type { World } from '../types';

/** Is this player one of the hackers (also when they were already caught)? */
export function isHacker(world: World, playerId: string | null | undefined): boolean {
  return playerId !== null && playerId !== undefined && world.mission.hackers.includes(playerId);
}

/** The hackers who are still in the game. */
export function activeHackers(world: World): string[] {
  return world.mission.hackers.filter((id) => !world.mission.caught.includes(id));
}
