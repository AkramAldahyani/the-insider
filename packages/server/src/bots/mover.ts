/**
 * Walking a bot's body along a route.
 *
 * A bot's body is the same kind of object as a human's (an Avatar) and obeys
 * the same rules: the same speed, the same walls, the same doors. The only
 * difference is where the wish to move comes from: a human's comes from the
 * keyboard, a bot's from this class.
 *
 * What a Mover does each tick:
 *   1. If a badge door is right ahead: stop, take a moment (like a person
 *      finding their badge), tap, and wait for the door. If the badge is
 *      refused, give up.
 *   2. Otherwise step towards the next point of the route.
 *   3. If it has not moved for a while (something unexpected is in the way),
 *      look for a new route; after a few failed attempts, give up.
 *
 * Giving up is reported through `state`, and whoever gave the order decides
 * what to do next. A Mover never teleports and never walks through anything.
 */
import {
  PLAYER_RADIUS, PLAYER_SPEED, TAP_DISTANCE, distanceToRect, doorSide, findPath, moveWithCollision,
  type MapDoor, type OfficeMap, type Point,
} from '@insider/shared';
import type { Doors, Walker } from '../doors';
import type { Avatar } from '../visibility';
import type { Random } from './random';

export type MoverState = 'idle' | 'walking' | 'arrived' | 'failed';

/** What a Mover needs from the game. */
export interface MoverWorld {
  /** The map as drawn (routes are planned on it; doors are passable). */
  map: OfficeMap;
  /** The map with closed doors solid (bodies are moved against it). */
  collision: OfficeMap;
  doors: Doors;
  walker(avatar: Avatar): Walker;
  /** May this body's badge enter through this door? (Used to avoid planning a route through a door that will refuse.) */
  mayEnter(avatar: Avatar, door: MapDoor): boolean;
}

/** How far off the centre line of a corridor a bot may walk, in pixels. Keeps bots from all walking the exact same line. */
const WOBBLE = 4;
const STUCK_MS = 1500;
const MAX_REPLANS = 3;

export class Mover {
  state: MoverState = 'idle';
  /** Why the last walk failed: "no-route", "denied" (a door refused the badge) or "stuck". */
  failure = '';
  private path: Point[] = [];
  private target: Point | null = null;
  private stuckMs = 0;
  private replans = 0;
  /** Door the bot is dealing with, and how long until it taps (real ms). */
  private door: { code: string; waitMs: number; tapped: boolean } | null = null;

  constructor(private readonly body: Avatar, private readonly world: MoverWorld, private readonly random: Random) {}

  /** Starts walking to a point. Returns false (and sets state "failed") if there is no route. */
  goTo(x: number, y: number): boolean {
    this.target = { x, y };
    this.replans = 0;
    this.stuckMs = 0;
    this.door = null;
    return this.plan();
  }

  stop(): void {
    this.state = 'idle';
    this.path = [];
    this.target = null;
    this.door = null;
  }

  /** Is there a way to this point, with this badge? (Asking changes nothing.) */
  canReach(x: number, y: number): boolean {
    return this.route({ x, y }) !== null;
  }

  private route(target: Point): Point[] | null {
    const { map } = this.world;
    // Restricted doors this badge does not open count as walls, unless we are
    // already behind one (then it is the way out, which is always allowed).
    const refuses = map.doors.filter((d) => d.restricted && !this.world.mayEnter(this.body, d) && !this.isBehind(d));
    const avoid = (col: number, row: number) => refuses.some((d) => distanceToRect(d, (col + 0.5) * map.tile, (row + 0.5) * map.tile) === 0);
    return findPath(map, this.body.x, this.body.y, target.x, target.y, avoid);
  }

  private plan(): boolean {
    const path = this.route(this.target!);
    if (!path) {
      this.state = 'failed';
      this.failure = 'no-route';
      this.path = [];
      return false;
    }
    // Nudge the corner points sideways a little, so ten bots do not walk in single file.
    // (The last point is the real target and stays exact. 4 px is safe: a doorway leaves 6 px each side.)
    this.path = path.map((p, i) => (i === path.length - 1 ? p : { x: p.x + this.random.between(-WOBBLE, WOBBLE), y: p.y + this.random.between(-WOBBLE, WOBBLE) }));
    this.state = 'walking';
    this.failure = '';
    return true;
  }

  /** Is this body inside the room behind a door? */
  private isBehind(door: MapDoor): boolean {
    const room = this.world.map.rooms.filter((r) => r.name === door.room);
    return room.some((r) => this.body.x >= r.x && this.body.x < r.x + r.width && this.body.y >= r.y && this.body.y < r.y + r.height);
  }

  /** The badge door the next step of the route goes through, if the bot is at it. */
  private doorAhead(next: Point): MapDoor | null {
    for (const door of this.world.map.doors) {
      if (!door.reader || distanceToRect(door, this.body.x, this.body.y) > TAP_DISTANCE - 8) continue;
      // "Ahead" = the next point is on the other side of the door, or in the doorway itself.
      const crossing = doorSide(door, next.x, next.y) !== doorSide(door, this.body.x, this.body.y) || distanceToRect(door, next.x, next.y) === 0;
      // ...and lined up with the doorway (not a point further along the same wall).
      const lined = door.axis === 'y' ? next.x >= door.x && next.x <= door.x + door.width : next.y >= door.y && next.y <= door.y + door.height;
      if (crossing && lined && distanceToRect(door, this.body.x, this.body.y) > 0) return door;
    }
    return null;
  }

  /** Advances the walk by `realMs` of real time. */
  update(realMs: number): void {
    if (this.state !== 'walking') return;
    const body = this.body;
    const next = this.path[0];
    if (!next) {
      this.state = 'arrived';
      return;
    }

    // 1. A badge door right ahead.
    const ahead = this.doorAhead(next);
    if (!ahead) this.door = null;
    else {
      if (this.door?.code !== ahead.code) {
        const open = this.world.doors.inspect(ahead.code)?.open ?? false;
        // An open door: most people badge anyway, some just walk through behind a colleague.
        // (Not at a one-person door: there the open door is still a wall for anyone who did not badge.)
        const skip = open && !this.world.doors.isOnePerson(ahead.code) && this.random.chance(0.25);
        this.door = { code: ahead.code, waitMs: skip ? 0 : this.random.between(250, 700), tapped: skip };
      }
      if (!this.door.tapped) {
        this.door.waitMs -= realMs;
        if (this.door.waitMs > 0) return; // standing at the reader
        this.door.tapped = true;
        const result = this.world.doors.tap(this.world.walker(body), ahead.code);
        if (result && !result.granted) {
          this.state = 'failed';
          this.failure = 'denied';
          return;
        }
      }
    }

    // 2. Step towards the next point, at walking speed.
    const step = (PLAYER_SPEED * realMs) / 1000;
    const dx = next.x - body.x;
    const dy = next.y - body.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance <= step ? 1 : step / distance;
    const moved = this.world.doors.withAccess(body.clientId, body.x, body.y, () => moveWithCollision(this.world.collision, body.x, body.y, dx * scale, dy * scale, PLAYER_RADIUS));
    const progress = Math.hypot(moved.x - body.x, moved.y - body.y);
    if (progress > 0.01) {
      if (Math.abs(dx) > Math.abs(dy)) body.facing = dx < 0 ? 'left' : 'right';
      else body.facing = dy < 0 ? 'up' : 'down';
    }
    body.x = moved.x;
    body.y = moved.y;
    if (Math.hypot(next.x - body.x, next.y - body.y) < 0.5) {
      // Close enough: stand exactly on the point (half a pixel, so this is not a jump).
      body.x = next.x;
      body.y = next.y;
      this.path.shift();
      if (this.path.length === 0) this.state = 'arrived';
      this.stuckMs = 0;
      return;
    }

    // 3. Not getting anywhere? (Waiting for a door we tapped is fine for a moment: it opens on the next tick.)
    if (progress > step * 0.2) {
      this.stuckMs = 0;
      return;
    }
    this.stuckMs += realMs;
    if (this.stuckMs < STUCK_MS) return;
    this.stuckMs = 0;
    this.door = null; // tap again if a door closed in our face
    if (++this.replans > MAX_REPLANS || !this.plan()) {
      this.state = 'failed';
      this.failure = this.failure || 'stuck';
    }
  }
}
