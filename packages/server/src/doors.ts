/**
 * The doors of the office.
 *
 * A door is a piece of wall that can be switched off. While it is closed its
 * tiles are solid in the collision grid, exactly like a wall; opening it makes
 * them walkable. Because the door only changes the grid, movement code needs
 * no special cases, and ANYONE can walk through an open door, whoever opened
 * it. That is what makes tailgating (slipping in behind a colleague) possible.
 *
 * Two kinds:
 *  - doors WITH a badge reader open for 3 seconds after a granted tap. Every
 *    tap, and every open/close, is reported to the engine, which writes the
 *    badge-system logs (engine/src/physical/badges.ts);
 *  - doors WITHOUT a reader (bathrooms, cafeteria...) open by themselves when
 *    somebody walks up, and write nothing.
 *
 * A door never closes on a person: it waits until the doorway is empty.
 *
 * Door timers run in REAL time, like walking does. The game clock can be sped
 * up, but bodies do not move faster, so a door must not close faster either.
 */
import { doorClosed, doorOpened, doorPassed, tapBadge, type World } from '@insider/engine';
import {
  AUTO_DOOR_HOLD_MS, DOOR_DENIED_MS, DOOR_OPEN_MS, PLAYER_RADIUS, TAP_DISTANCE,
  distanceToRect, doorApproach, doorSide, doorTiles,
  type DoorLook, type MapDoor, type OfficeMap, type Rect,
} from '@insider/shared';

/** What the doors need to know about a body in the office. */
export interface Walker {
  /** Unique per body (the avatar's client id). */
  key: string;
  playerId: string;
  /** Account of the employee, i.e. whose badge this body carries. */
  account: string;
  x: number;
  y: number;
  /** Sitting at a desk: cannot be at a door. */
  seated: boolean;
}

interface DoorState {
  def: MapDoor;
  /** The doorway plus one tile in front and behind: "at this door". */
  approach: Rect;
  open: boolean;
  /** Game time when it opened (for the log). */
  openedAt: number;
  /** Real milliseconds until it may close. */
  holdMs: number;
  /** Real milliseconds the reader keeps flashing red. */
  deniedMs: number;
  /** People who walked through since it opened. */
  passages: number;
  /** Walker key -> which side of the door they were on at the last look. */
  sides: Map<string, 1 | -1>;
}

/** Minimum real time between two taps by the same person (a held-down key must not fill the log). */
const TAP_COOLDOWN_MS = 400;

export class Doors {
  private readonly doors: DoorState[];
  private readonly cooldown = new Map<string, number>();

  /**
   * @param map     the map as drawn (never changed here);
   * @param solid   the collision grid players are moved against. This class
   *                switches the door tiles in it on and off.
   */
  constructor(private readonly world: World, private readonly map: OfficeMap, private readonly solid: boolean[][]) {
    this.doors = map.doors.map((def) => ({
      def, approach: doorApproach(def, map.tile), open: false, openedAt: 0, holdMs: 0, deniedMs: 0, passages: 0, sides: new Map(),
    }));
    for (const door of this.doors) this.setSolid(door, true); // every door starts closed
  }

  private setSolid(door: DoorState, solid: boolean): void {
    for (const [col, row] of doorTiles(this.map, door.def)) this.solid[row][col] = solid;
  }

  private open(door: DoorState, holdMs: number): void {
    door.holdMs = Math.max(door.holdMs, holdMs);
    if (door.open) return;
    door.open = true;
    door.openedAt = this.world.time;
    door.passages = 0;
    this.setSolid(door, false);
    if (door.def.reader) doorOpened(this.world, door.def.code);
  }

  private close(door: DoorState): void {
    door.open = false;
    this.setSolid(door, true);
    if (door.def.reader) doorClosed(this.world, door.def.code, door.openedAt, door.passages);
  }

  /**
   * A badge held against a reader. Returns the text for the player's HUD, or
   * null when the request makes no sense (unknown door, door without reader,
   * tapping too fast) and is simply ignored.
   */
  tap(walker: Walker, code: string): { granted: boolean; text: string } | null {
    const door = this.doors.find((d) => d.def.code === code && d.def.reader);
    if (!door || walker.seated || this.cooldown.has(walker.key)) return null;
    // The browser says "I am at the door"; the server measures it itself.
    if (distanceToRect(door.def, walker.x, walker.y) > TAP_DISTANCE) return { granted: false, text: 'You are too far from the badge reader.' };
    this.cooldown.set(walker.key, TAP_COOLDOWN_MS);

    const direction = doorSide(door.def, walker.x, walker.y) === door.def.inside ? 'OUT' : 'IN';
    const result = tapBadge(this.world, {
      door: door.def.code, zone: door.def.zone, restricted: door.def.restricted, account: walker.account, direction, actor: walker.playerId,
    });
    if (!result.badgeId) return { granted: false, text: 'You have no badge.' };
    if (!result.granted) {
      door.deniedMs = DOOR_DENIED_MS;
      return { granted: false, text: `Access denied: your badge does not open the ${door.def.name.toLowerCase()}.` };
    }
    door.deniedMs = 0;
    this.open(door, DOOR_OPEN_MS);
    return { granted: true, text: `Badge accepted: the ${door.def.name.toLowerCase()} is open for ${DOOR_OPEN_MS / 1000} seconds.` };
  }

  /** Advances the doors by `realMs` of real time, looking at where everybody is now. */
  tick(realMs: number, walkers: Walker[]): void {
    for (const [key, left] of this.cooldown) {
      if (left <= realMs) this.cooldown.delete(key);
      else this.cooldown.set(key, left - realMs);
    }
    const walking = walkers.filter((w) => !w.seated);

    for (const door of this.doors) {
      // 1. Count people crossing: someone who was on one side and is now on the other.
      const here = new Set<string>();
      for (const w of walking) {
        if (distanceToRect(door.approach, w.x, w.y) > 0) continue;
        here.add(w.key);
        const side = doorSide(door.def, w.x, w.y);
        const before = door.sides.get(w.key);
        if (before !== undefined && before !== side && door.open) {
          door.passages++;
          doorPassed(this.world, door.def.code, w.account, side === door.def.inside ? 'IN' : 'OUT', w.playerId);
        }
        door.sides.set(w.key, side);
      }
      for (const key of [...door.sides.keys()]) if (!here.has(key)) door.sides.delete(key);

      // 2. A door without a reader opens for anyone who walks up to it.
      if (!door.def.reader && walking.some((w) => distanceToRect(door.approach, w.x, w.y) <= PLAYER_RADIUS)) this.open(door, AUTO_DOOR_HOLD_MS);

      // 3. Timers. A door waits for an empty doorway before it closes.
      door.deniedMs = Math.max(0, door.deniedMs - realMs);
      if (!door.open) continue;
      door.holdMs -= realMs;
      const blocked = walking.some((w) => distanceToRect(door.def, w.x, w.y) < PLAYER_RADIUS);
      if (door.holdMs <= 0 && !blocked) this.close(door);
    }
  }

  /** What every door looks like right now (public: anyone in the office can see a door). */
  looks(): { id: string; look: DoorLook }[] {
    return this.doors.map((d) => ({ id: d.def.code, look: d.open ? 'open' : d.deniedMs > 0 ? 'denied' : 'closed' }));
  }

  /** Developer panel / tests: the full state of one door. */
  inspect(code: string): { open: boolean; passages: number; holdMs: number } | undefined {
    const d = this.doors.find((x) => x.def.code === code);
    return d && { open: d.open, passages: d.passages, holdMs: d.holdMs };
  }
}
