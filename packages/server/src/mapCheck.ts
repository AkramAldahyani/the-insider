/**
 * Start-up check: do the map and the scenario describe the same office?
 *
 * The map says where desks are; the scenario says which machines exist. If a
 * desk points at a machine that does not exist (or a machine has no desk),
 * the game would half-work in confusing ways. So the server refuses to start
 * and prints every problem at once.
 */
import type { Scenario } from '@insider/engine';
import { PLAYER_RADIUS, isFree, type OfficeMap } from '@insider/shared';

export function checkMapAgainstScenario(map: OfficeMap, scenario: Scenario, mapName = 'map'): void {
  const problems: string[] = [];
  const hosts = new Set(scenario.hosts.map((h) => h.hostname));
  const seen = new Set<string>();

  for (const desk of map.desks) {
    if (!hosts.has(desk.hostname)) problems.push(`desk "${desk.hostname}" is on the map but is not a host in the scenario`);
    if (seen.has(desk.hostname)) problems.push(`desk "${desk.hostname}" appears twice on the map`);
    seen.add(desk.hostname);
    if (!isFree(map, desk.seatX, desk.seatY, PLAYER_RADIUS)) problems.push(`the chair of desk "${desk.hostname}" is inside a wall or furniture`);
    const spawn = map.spawns[desk.hostname];
    if (!spawn) problems.push(`desk "${desk.hostname}" has no spawn point (layer "spawns", property desk=${desk.hostname})`);
    else if (!isFree(map, spawn.x, spawn.y, PLAYER_RADIUS)) problems.push(`the spawn point of desk "${desk.hostname}" is inside a wall or furniture`);
  }
  for (const hostname of hosts) {
    if (!seen.has(hostname)) problems.push(`host "${hostname}" is in the scenario but has no desk on the map`);
  }
  for (const player of scenario.players) {
    if (!seen.has(player.desk)) problems.push(`player "${player.id}" sits at "${player.desk}", which has no desk on the map`);
  }
  if (!isFree(map, map.defaultSpawn.x, map.defaultSpawn.y, PLAYER_RADIUS)) problems.push('the default spawn point is inside a wall or furniture');

  if (problems.length > 0) {
    throw new Error(`Map "${mapName}" does not match scenario "${scenario.id}":\n- ${problems.join('\n- ')}`);
  }
}
