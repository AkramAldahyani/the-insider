/**
 * Route finding on the office map ("A*", pronounced A-star).
 *
 * The map is a grid of tiles. A* explores outward from the start tile, always
 * continuing from the tile whose (steps walked so far + straight-line guess
 * of the steps still to go) is smallest. On a grid this finds a shortest
 * route and looks at far fewer tiles than checking every possibility.
 *
 * It is our own ~60 lines instead of a library because the map is tiny (under
 * 2,000 tiles) and this way the server, the tests and later the client's
 * movement prediction all share one implementation with no extra dependency.
 *
 * Doors are NOT obstacles here: `map.solid` holds walls, desks and furniture
 * only. Whoever follows the route deals with doors on the way (taps a badge,
 * waits for the door to open, or gives up).
 */
import type { OfficeMap } from './map';

export interface Point {
  x: number;
  y: number;
}

/** The four directions a route may take from a tile: no diagonals, so a route never cuts a corner. */
const STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * A walkable route between two pixel positions, as the points where it
 * changes direction (tile centres), ending at the exact target. Returns null
 * if there is no way.
 *
 * @param avoid  optional: tiles to treat as blocked for this search (for
 *               example a door this walker's badge does not open).
 */
export function findPath(map: OfficeMap, fromX: number, fromY: number, toX: number, toY: number, avoid?: (col: number, row: number) => boolean): Point[] | null {
  const tileOf = (v: number) => Math.floor(v / map.tile);
  const index = (col: number, row: number) => row * map.cols + col;
  const start = index(tileOf(fromX), tileOf(fromY));
  const goalCol = tileOf(toX);
  const goalRow = tileOf(toY);
  const goal = index(goalCol, goalRow);
  if (map.solid[goalRow]?.[goalCol] !== false) return null;

  // cost[i] = steps from the start to tile i (Infinity = not reached yet).
  const cost = new Array<number>(map.cols * map.rows).fill(Infinity);
  const cameFrom = new Int32Array(map.cols * map.rows).fill(-1);
  /** Direction (index into STEPS) used to arrive at a tile: lets us prefer going straight. */
  const arrivedBy = new Int8Array(map.cols * map.rows).fill(-1);
  const open: number[] = [start];
  cost[start] = 0;
  const guess = (i: number) => Math.abs((i % map.cols) - goalCol) + Math.abs(Math.floor(i / map.cols) - goalRow);

  while (open.length > 0) {
    // Take the most promising tile. (A plain scan is fast enough for a map this small.)
    let best = 0;
    for (let k = 1; k < open.length; k++) if (cost[open[k]] + guess(open[k]) < cost[open[best]] + guess(open[best])) best = k;
    const current = open.splice(best, 1)[0];
    if (current === goal) break;
    const col = current % map.cols;
    const row = Math.floor(current / map.cols);
    STEPS.forEach(([dc, dr], direction) => {
      const nc = col + dc;
      const nr = row + dr;
      if (map.solid[nr]?.[nc] !== false || avoid?.(nc, nr)) return;
      // A turn costs a tiny bit extra, so among equally short routes the one with fewer corners wins.
      const next = cost[current] + 1 + (arrivedBy[current] !== -1 && arrivedBy[current] !== direction ? 0.001 : 0);
      const i = index(nc, nr);
      if (next >= cost[i]) return;
      if (cost[i] === Infinity) open.push(i);
      cost[i] = next;
      cameFrom[i] = current;
      arrivedBy[i] = direction;
    });
  }
  if (cost[goal] === Infinity) return null;

  // Walk back from the goal to the start, then keep only the corners.
  const tiles: number[] = [];
  for (let i = goal; i !== -1; i = cameFrom[i]) tiles.unshift(i);
  const centre = (i: number): Point => ({ x: ((i % map.cols) + 0.5) * map.tile, y: (Math.floor(i / map.cols) + 0.5) * map.tile });
  const points = tiles.map(centre);
  const corners = points.filter((p, k) => {
    const a = points[k - 1];
    const b = points[k + 1];
    return !a || !b || (a.x === p.x) !== (p.x === b.x);
  });
  // The first point is the centre of the tile we are already in: drop it unless it is the only one.
  if (corners.length > 1) corners.shift();
  return [...corners, { x: toX, y: toY }];
}
