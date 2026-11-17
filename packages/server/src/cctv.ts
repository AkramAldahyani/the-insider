/**
 * CCTV: what the cameras record.
 *
 * Each camera on the map watches one room (its `covers` property) up to a
 * distance (`range`, in tiles). Every few game seconds the recorder looks at
 * who is inside each camera's area and keeps a SNAPSHOT: the time, and for
 * every person in view their name, position, facing and the desk they sit
 * at. A snapshot is the data a picture is drawn from: in Phase 5 the security
 * office gets a viewer that renders it like the game's own view of that spot
 * (DESIGN.md section 2). Nothing here draws anything.
 *
 * To keep the recording small, a snapshot is stored only when the scene
 * changed since the last stored one (someone entered, left, moved to another
 * tile, sat down...), plus one "keyframe" a minute even if nothing moved.
 * Asking for the picture at any time returns the latest snapshot before it.
 *
 * WHAT IS LOGGED AS TEXT. The recorder also writes a motion log on the
 * security server (/var/log/cctv/motion.log): when the number of people in a
 * camera's view changed, and the id of the snapshot. It deliberately does NOT
 * list names: a log you could grep for "where was Sara all day" would make
 * the cameras far too strong. To learn who it was you must look at the picture.
 *
 * Rooms without a camera (printer room, storage, bathrooms, and the
 * department rooms in the small office) are blind spots: nobody in them is
 * ever in a snapshot.
 *
 * Snapshots stay on the server. Nothing in this phase sends them to a
 * browser; the developer panel can print one (development only).
 */
import { cctvMotion, type World } from '@insider/engine';
import { roomAt, type Facing, type OfficeMap } from '@insider/shared';

/** One person as a camera sees them. */
export interface SeenPerson {
  playerId: string;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  /** Hostname of the desk they sit at, "" when standing. */
  seatedAt: string;
  /** What they were visibly doing ("at-pc": crouched at a PC). */
  activity: string;
}

export interface Snapshot {
  /** "CAM-01-000042": the camera and a running number. */
  id: string;
  camera: string;
  /** Game time (ms). */
  time: number;
  people: SeenPerson[];
}

export interface Camera {
  /** "CAM-01". */
  id: string;
  /** "CAM-01 Reception". */
  name: string;
  x: number;
  y: number;
  /** The room it watches. */
  covers: string;
  /** How far it sees, in pixels. */
  range: number;
}

/** What the recorder needs to know about a body. */
export interface Filmed {
  playerId: string;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  seatedAt: string;
  activity?: string;
}

/** A camera looks this often (game ms). */
const INTERVAL_MS = 2000;
/** Even an unchanged scene is stored this often (game ms). */
const KEYFRAME_MS = 60_000;
/** Oldest snapshots are dropped beyond this many per camera (about 5 busy hours). */
const MAX_PER_CAMERA = 6000;
const DEFAULT_RANGE_TILES = 14;

export class Cctv {
  readonly cameras: Camera[];
  private readonly recordings = new Map<string, Snapshot[]>();
  private readonly counters = new Map<string, number>();
  /** Per camera: a compact description of the last stored scene, to detect change. */
  private readonly lastScene = new Map<string, string>();
  private readonly lastCount = new Map<string, number>();
  private nextLook: number;

  constructor(private readonly world: World, private readonly map: OfficeMap) {
    this.cameras = map.cameras.map((c) => ({
      id: c.name.split(' ')[0],
      name: c.name,
      x: c.x,
      y: c.y,
      covers: String(c.props.covers ?? ''),
      range: (Number(c.props.range) || DEFAULT_RANGE_TILES) * map.tile,
    }));
    for (const camera of this.cameras) this.recordings.set(camera.id, []);
    this.nextLook = world.time;
  }

  /** Is a point inside a camera's view? (Same room as the camera watches, and close enough.) */
  sees(camera: Camera, x: number, y: number): boolean {
    return roomAt(this.map, x, y) === camera.covers && Math.hypot(x - camera.x, y - camera.y) <= camera.range;
  }

  /** Called every tick; records when it is time. */
  update(bodies: Filmed[]): void {
    // If the clock jumped ahead (developer panel), take one snapshot now rather than hundreds.
    if (this.world.time < this.nextLook) return;
    this.nextLook = this.world.time + INTERVAL_MS;

    for (const camera of this.cameras) {
      const people: SeenPerson[] = bodies
        .filter((b) => this.sees(camera, b.x, b.y))
        .map((b) => ({ playerId: b.playerId, name: b.name, x: Math.round(b.x), y: Math.round(b.y), facing: b.facing, seatedAt: b.seatedAt, activity: b.activity ?? '' }))
        .sort((a, b) => a.playerId.localeCompare(b.playerId));
      const recording = this.recordings.get(camera.id)!;
      // "Changed" = somebody is on another tile, turned, sat down or stood up, came or went.
      const scene = people.map((p) => `${p.playerId}:${Math.floor(p.x / this.map.tile)},${Math.floor(p.y / this.map.tile)}:${p.facing}:${p.seatedAt}:${p.activity}`).join('|');
      const last = recording.at(-1);
      if (last && scene === this.lastScene.get(camera.id) && this.world.time - last.time < KEYFRAME_MS) continue;

      const n = (this.counters.get(camera.id) ?? 0) + 1;
      this.counters.set(camera.id, n);
      const snapshot: Snapshot = { id: `${camera.id}-${String(n).padStart(6, '0')}`, camera: camera.id, time: this.world.time, people };
      recording.push(snapshot);
      if (recording.length > MAX_PER_CAMERA) recording.shift();
      this.lastScene.set(camera.id, scene);

      // The text log gets a line only when the head count changes.
      if (people.length !== (this.lastCount.get(camera.id) ?? 0)) {
        this.lastCount.set(camera.id, people.length);
        cctvMotion(this.world, camera.id, people.length, snapshot.id);
      }
    }
  }

  /** Every stored snapshot of a camera, oldest first. */
  recording(cameraId: string): Snapshot[] {
    return this.recordings.get(cameraId) ?? [];
  }

  /** The picture a camera showed at a given time: the latest snapshot at or before it. */
  at(cameraId: string, time: number): Snapshot | undefined {
    const recording = this.recording(cameraId);
    for (let i = recording.length - 1; i >= 0; i--) if (recording[i].time <= time) return recording[i];
    return undefined;
  }

  find(snapshotId: string): Snapshot | undefined {
    return this.recording(snapshotId.slice(0, snapshotId.lastIndexOf('-'))).find((s) => s.id === snapshotId);
  }
}
