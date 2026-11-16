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
  // Headless machines (boxes in a rack, reached over ssh) need no desk.
  const hosts = new Set(scenario.hosts.filter((h) => !h.headless).map((h) => h.hostname));
  const headless = new Set(scenario.hosts.filter((h) => h.headless).map((h) => h.hostname));
  const seen = new Set<string>();

  for (const desk of map.desks) {
    if (headless.has(desk.hostname)) problems.push(`desk "${desk.hostname}" is on the map, but the scenario says that host is headless (no screen)`);
    else if (!hosts.has(desk.hostname)) problems.push(`desk "${desk.hostname}" is on the map but is not a host in the scenario`);
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
  if (!isFree(map, map.outsideSpawn.x, map.outsideSpawn.y, PLAYER_RADIUS)) problems.push('the "outside" spawn point is inside a wall or furniture');

  // Can every desk be walked to? (Doors count as passable here.) This catches
  // a cupboard drawn in front of a doorway, which would seal a room.
  const tileOf = (v: number) => Math.floor(v / map.tile);
  const reached = new Set<number>();
  const queue: [number, number][] = [[tileOf(map.defaultSpawn.x), tileOf(map.defaultSpawn.y)]];
  while (queue.length > 0) {
    const [col, row] = queue.pop()!;
    if (map.solid[row]?.[col] !== false || reached.has(row * map.cols + col)) continue;
    reached.add(row * map.cols + col);
    queue.push([col + 1, row], [col - 1, row], [col, row + 1], [col, row - 1]);
  }
  const reachable = (x: number, y: number) => reached.has(tileOf(y) * map.cols + tileOf(x));
  for (const desk of map.desks) {
    if (!reachable(desk.seatX, desk.seatY)) problems.push(`the chair of desk "${desk.hostname}" cannot be reached on foot (is something blocking a doorway?)`);
  }
  if (!reachable(map.outsideSpawn.x, map.outsideSpawn.y)) problems.push('the "outside" spawn point cannot be reached on foot from inside the building');

  // Doors and badges: every restricted door must be openable by somebody, and
  // every zone a badge lists must exist, or a typo would silently lock a room.
  const zones = new Set(map.doors.filter((d) => d.restricted).map((d) => d.zone));
  const granted = new Set(scenario.accounts.flatMap((a) => a.badge?.access ?? []));
  for (const door of map.doors) {
    if (door.restricted && !door.reader) problems.push(`door "${door.code}" is restricted but has no badge reader`);
    if (door.restricted && !door.zone) problems.push(`door "${door.code}" is restricted but has no zone`);
    if (door.restricted && door.zone && !granted.has(door.zone)) problems.push(`door "${door.code}": no badge in the scenario opens zone "${door.zone}"`);
  }
  for (const a of scenario.accounts) {
    for (const zone of a.badge?.access ?? []) {
      if (!zones.has(zone)) problems.push(`the badge of "${a.username}" lists zone "${zone}", which no restricted door on the map has`);
    }
  }
  const entrance = scenario.badgeSystem?.entranceDoor;
  if (entrance && !map.doors.some((d) => d.code === entrance && d.reader)) {
    problems.push(`badgeSystem.entranceDoor "${entrance}" is not a door with a badge reader on the map`);
  }

  if (problems.length > 0) {
    throw new Error(`Map "${mapName}" does not match scenario "${scenario.id}":\n- ${problems.join('\n- ')}`);
  }
}
