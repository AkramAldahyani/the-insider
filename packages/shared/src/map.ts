/**
 * The office map.
 *
 * Maps are drawn in the free editor "Tiled" and saved as JSON (maps/*.json).
 * This file turns that JSON into the small `OfficeMap` structure the game
 * uses, and holds the movement/collision rule so that the server (which
 * decides where players are) and any other code agree on what a wall is.
 *
 * What the game reads from a Tiled map:
 *  - tile layer "walls":   any non-empty tile blocks movement;
 *  - tile layer "floor":   only for drawing;
 *  - object layer "rooms":  rectangles with a name (HUD room label);
 *  - object layer "desks":  rectangles with a `hostname` property. A desk
 *    blocks movement; its chair is the tile just below its middle;
 *  - object layer "furniture": rectangles that block movement (no logic);
 *  - object layers "doors", "cameras", "badge_readers": drawn only. They carry
 *    properties (locked, covers, door...) that later phases will use;
 *  - object layer "spawns": points with a `desk` property (where the owner of
 *    that desk appears), plus one named "default".
 */

// ───────────────────────────── Tiled JSON (the parts we use) ─────────────────────────────

export interface TiledProperty {
  name: string;
  type: string;
  value: string | number | boolean;
}

export interface TiledObject {
  id: number;
  name: string;
  type?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  point?: boolean;
  properties?: TiledProperty[];
}

export interface TiledLayer {
  name: string;
  type: 'tilelayer' | 'objectgroup';
  /** Tile layers: width*height tile ids, row by row, 0 = empty. */
  data?: number[];
  width?: number;
  height?: number;
  objects?: TiledObject[];
}

export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  [other: string]: unknown;
}

// ───────────────────────────── What the game uses ─────────────────────────────

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapRoom extends Rect {
  name: string;
}

export interface MapDesk extends Rect {
  hostname: string;
  /** Where a player sits (pixel position of the chair). */
  seatX: number;
  seatY: number;
}

export interface MapDoor extends Rect {
  name: string;
  locked: boolean;
  badgeRequired: boolean;
}

export interface MapMarker {
  name: string;
  x: number;
  y: number;
  /** All custom properties, untouched (later phases read them). */
  props: Record<string, string | number | boolean>;
}

export interface MapFurniture extends Rect {
  name: string;
  kind: string;
}

export interface OfficeMap {
  /** Size in tiles and tile size in pixels. */
  cols: number;
  rows: number;
  tile: number;
  /** Size in pixels. */
  width: number;
  height: number;
  /** floor[row][col] = tile id (for drawing), 0 = none. */
  floor: number[][];
  /** walls[row][col] = tile id (for drawing), 0 = none. */
  walls: number[][];
  /** solid[row][col] = true where nobody can walk (walls, desks, furniture). */
  solid: boolean[][];
  rooms: MapRoom[];
  desks: MapDesk[];
  doors: MapDoor[];
  cameras: MapMarker[];
  badgeReaders: MapMarker[];
  furniture: MapFurniture[];
  /** desk hostname -> where its owner appears. */
  spawns: Record<string, { x: number; y: number }>;
  defaultSpawn: { x: number; y: number };
}

function props(o: TiledObject): Record<string, string | number | boolean> {
  return Object.fromEntries((o.properties ?? []).map((p) => [p.name, p.value]));
}

function grid(layer: TiledLayer | undefined, cols: number, rows: number): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) out.push(Array.from({ length: cols }, (_, c) => layer?.data?.[r * cols + c] ?? 0));
  return out;
}

/** Converts a Tiled JSON map into an OfficeMap. Throws a readable error if a required layer is missing. */
export function parseOfficeMap(json: TiledMap): OfficeMap {
  const tile = json.tilewidth;
  if (json.tileheight !== tile) throw new Error('Map tiles must be square');
  const layer = (name: string) => json.layers.find((l) => l.name === name);
  const objects = (name: string) => layer(name)?.objects ?? [];
  for (const required of ['floor', 'walls', 'rooms', 'desks', 'spawns']) {
    if (!layer(required)) throw new Error(`Map has no layer called "${required}"`);
  }
  const cols = json.width;
  const rows = json.height;
  const walls = grid(layer('walls'), cols, rows);
  const solid = walls.map((row) => row.map((id) => id !== 0));

  /** Marks every tile a rectangle touches as not walkable. */
  const block = (r: Rect) => {
    for (let row = Math.floor(r.y / tile); row < Math.ceil((r.y + r.height) / tile); row++) {
      for (let col = Math.floor(r.x / tile); col < Math.ceil((r.x + r.width) / tile); col++) {
        if (solid[row]?.[col] !== undefined) solid[row][col] = true;
      }
    }
  };

  const desks: MapDesk[] = objects('desks').map((o) => {
    const hostname = String(props(o).hostname ?? '');
    if (!hostname) throw new Error(`Desk object #${o.id} has no "hostname" property`);
    block(o);
    return { hostname, x: o.x, y: o.y, width: o.width, height: o.height, seatX: o.x + o.width / 2, seatY: o.y + o.height + tile / 2 };
  });
  const furniture: MapFurniture[] = objects('furniture').map((o) => {
    block(o);
    return { name: o.name, kind: String(props(o).kind ?? 'box'), x: o.x, y: o.y, width: o.width, height: o.height };
  });
  const marker = (o: TiledObject): MapMarker => ({ name: o.name, x: o.x, y: o.y, props: props(o) });

  const spawns: Record<string, { x: number; y: number }> = {};
  let defaultSpawn: { x: number; y: number } | null = null;
  for (const o of objects('spawns')) {
    const desk = props(o).desk;
    if (typeof desk === 'string' && desk) spawns[desk] = { x: o.x, y: o.y };
    else defaultSpawn = { x: o.x, y: o.y };
  }
  if (!defaultSpawn) throw new Error('Map layer "spawns" needs one point without a "desk" property (the default spawn)');

  return {
    cols, rows, tile,
    width: cols * tile,
    height: rows * tile,
    floor: grid(layer('floor'), cols, rows),
    walls,
    solid,
    rooms: objects('rooms').map((o) => ({ name: o.name, x: o.x, y: o.y, width: o.width, height: o.height })),
    desks,
    doors: objects('doors').map((o) => ({
      name: o.name, x: o.x, y: o.y, width: o.width, height: o.height,
      locked: props(o).locked === true, badgeRequired: props(o).badgeRequired === true,
    })),
    cameras: objects('cameras').map(marker),
    badgeReaders: objects('badge_readers').map(marker),
    furniture,
    spawns,
    defaultSpawn,
  };
}

/** Name of the room containing a point ("Corridor" style names come from the map), or "" outside all rooms. */
export function roomAt(map: OfficeMap, x: number, y: number): string {
  const room = map.rooms.find((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  return room?.name ?? '';
}

/** Is a square of half-size `radius` centred on (x, y) free of walls and furniture? */
export function isFree(map: OfficeMap, x: number, y: number, radius: number): boolean {
  if (x - radius < 0 || y - radius < 0 || x + radius > map.width || y + radius > map.height) return false;
  // -0.001 so a box that exactly touches a tile edge does not count as inside the next tile.
  const c0 = Math.floor((x - radius) / map.tile);
  const c1 = Math.floor((x + radius - 0.001) / map.tile);
  const r0 = Math.floor((y - radius) / map.tile);
  const r1 = Math.floor((y + radius - 0.001) / map.tile);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (map.solid[r][c]) return false;
  return true;
}

/**
 * Moves a player by (dx, dy) pixels, stopping at walls. The two directions
 * are tried separately so walking diagonally into a wall slides along it
 * instead of getting stuck. Long moves are cut into small steps so a player
 * can never jump through a thin wall, whatever the speed.
 */
export function moveWithCollision(map: OfficeMap, x: number, y: number, dx: number, dy: number, radius: number): { x: number; y: number } {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (map.tile / 4)));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (sx !== 0 && isFree(map, x + sx, y, radius)) x += sx;
    if (sy !== 0 && isFree(map, x, y + sy, radius)) y += sy;
  }
  return { x, y };
}

/** The desk whose chair is closest to a point, with the distance to that chair. */
export function nearestDesk(map: OfficeMap, x: number, y: number): { desk: MapDesk; distance: number } | null {
  let best: { desk: MapDesk; distance: number } | null = null;
  for (const desk of map.desks) {
    const distance = Math.hypot(desk.seatX - x, desk.seatY - y);
    if (!best || distance < best.distance) best = { desk, distance };
  }
  return best;
}
