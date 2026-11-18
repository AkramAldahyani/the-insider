import { PLAYER_RADIUS } from '../../packages/shared/src/constants';

/** Same square-body clearance as the game; closed doors are handled by badge input. */
export function clearPath(map: { tile: number; solid: boolean[][] }, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const clear = (x: number, y: number) => {
    for (let r = Math.floor((y - PLAYER_RADIUS) / map.tile); r <= Math.floor((y + PLAYER_RADIUS - 0.001) / map.tile); r++) {
      for (let c = Math.floor((x - PLAYER_RADIUS) / map.tile); c <= Math.floor((x + PLAYER_RADIUS - 0.001) / map.tile); c++) {
        if (map.solid[r]?.[c] !== false) return false;
      }
    }
    return true;
  };
  const stepsX = Math.ceil(Math.abs(to.x - from.x) / 4);
  const stepsY = Math.ceil(Math.abs(to.y - from.y) / 4);
  for (let i = 0; i <= stepsX; i++) if (!clear(from.x + (to.x - from.x) * (stepsX ? i / stepsX : 0), from.y)) return false;
  for (let i = 0; i <= stepsY; i++) if (!clear(to.x, from.y + (to.y - from.y) * (stepsY ? i / stepsY : 0))) return false;
  return true;
}

/** Choose a clear L-shaped approach, preferring the larger remaining distance. */
export function steeringAxis(map: { tile: number; solid: boolean[][] }, from: { x: number; y: number }, to: { x: number; y: number }, tolerance: number): 'x' | 'y' | null {
  const preferred = Math.abs(to.x - from.x) > Math.abs(to.y - from.y) ? 'x' : 'y';
  for (const axis of [preferred, preferred === 'x' ? 'y' : 'x'] as const) {
    if (Math.abs(to[axis] - from[axis]) <= tolerance) continue;
    const aligned = axis === 'x' ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
    if (clearPath(map, from, aligned) && clearPath(map, aligned, to)) return axis;
  }
  return null;
}
