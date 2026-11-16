/**
 * The door-badge system: the engine's side of physical security.
 *
 * The SERVER package owns the doors themselves (where they are, whether they
 * are open, who is standing near them). When something happens at a door it
 * calls one of the functions here, which
 *   1. decides whether a badge is allowed through (`tapBadge`), and
 *   2. records the fact as master events, which materialize.ts turns into the
 *      lines of /var/log/badge/access.log and doors.log on the badge server.
 *
 * Keeping the rule and the logging in the engine means the CLI, tests and
 * later the debrief all see badge evidence the same way as any other evidence.
 *
 * WHO IS "USER" ON A BADGE LINE? The owner of the plastic badge: the employee
 * the player chose. It has nothing to do with which account that player is
 * logged in as on some PC.
 */
import { emit, withActor } from '../events/log';
import type { World } from '../types';

export type TapDirection = 'IN' | 'OUT';

export interface TapInput {
  /** Short door name used in the logs, e.g. "SRV-ROOM". */
  door: string;
  /** The zone behind the door, e.g. "server-room". */
  zone: string;
  /** True when only badges that list `zone` may ENTER. */
  restricted: boolean;
  /** Account of the badge's owner. */
  account: string;
  /** IN = from outside the room into it, OUT = leaving it. */
  direction: TapDirection;
  /** Player id of whoever held the badge (ground truth for the debrief). */
  actor: string | null;
}

export interface TapResult {
  granted: boolean;
  /** "" when this account has no badge at all (nothing is logged then). */
  badgeId: string;
}

/**
 * One badge held against a reader. Every tap is logged, granted or denied.
 *
 * Leaving a room is always allowed, even a restricted one: real buildings
 * must let people out (fire safety). The exit tap is still logged, so someone
 * who slipped in behind a colleague leaves their own badge number on the way
 * out.
 */
export function tapBadge(world: World, input: TapInput): TapResult {
  const badge = world.badges.holders[input.account];
  if (!badge) return { granted: false, badgeId: '' };
  const granted = !input.restricted || input.direction === 'OUT' || badge.access.includes(input.zone);
  // Third argument: the badge server counts as "where it was typed", so the
  // event is marked as done in person ("physical"), not by the system.
  withActor(input.actor, () => emit(world, {
    host: world.badges.serverHost,
    user: input.account,
    type: 'badge.tap',
    details: { door: input.door, zone: input.zone, badge: badge.id, granted, direction: input.direction },
  }), world.badges.serverHost);
  return { granted, badgeId: badge.id };
}

/** A door with a reader unlocked and opened. */
export function doorOpened(world: World, door: string): void {
  emit(world, { host: world.badges.serverHost, user: '', type: 'door.open', details: { door } });
}

/**
 * A door with a reader closed again. `passages` is what the beam sensor in
 * the door frame counted: how many people went through while it was open.
 * One granted tap followed by PASSAGES=2 is how tailgating shows up.
 */
export function doorClosed(world: World, door: string, openedAt: number, passages: number): void {
  emit(world, { host: world.badges.serverHost, user: '', type: 'door.close', details: { door, openMs: world.time - openedAt, passages } });
}

/**
 * A camera's recorder noticed that the number of people in view changed.
 * The log line names the camera, the head count and the snapshot to look at;
 * it does not name anybody (see server/src/cctv.ts for why).
 */
export function cctvMotion(world: World, camera: string, persons: number, snapshot: string): void {
  emit(world, { host: world.badges.serverHost, user: '', type: 'cctv.motion', details: { camera, persons, snapshot } });
}

/**
 * Somebody walked through a door. The sensor only counts bodies, so this
 * writes NO log line: who it was exists only in the master event list.
 */
export function doorPassed(world: World, door: string, account: string, direction: TapDirection, actor: string | null): void {
  withActor(actor, () => emit(world, { host: world.badges.serverHost, user: account, type: 'door.pass', details: { door, direction } }), world.badges.serverHost);
}
