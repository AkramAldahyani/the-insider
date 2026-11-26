/**
 * The office as a small plan, drawn on a canvas: floors, walls, desks and the
 * emergency button. The minimap (Minimap.tsx) and the debrief's replay
 * (ReplayMap.tsx) draw their marks on top of it.
 *
 * Only what is on the map file: nothing about people. What each of them adds
 * decides what the plan shows.
 */
import type { OfficeMap } from '@insider/shared';

export const PLAN_COLORS = {
  background: '#0b1320',
  floor: '#2b3f3d',
  wall: '#7f8ea2',
  desk: '#b29377',
  button: '#e5484d',
  label: 'rgba(226, 235, 241, 0.75)',
};

/** Draws the plan of `map` at `scale` (canvas pixels per map pixel). */
export function drawPlan(ctx: CanvasRenderingContext2D, map: OfficeMap, scale: number, labels = false): void {
  const t = map.tile * scale;
  ctx.fillStyle = PLAN_COLORS.background;
  ctx.fillRect(0, 0, map.width * scale, map.height * scale);
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (map.walls[r][c]) ctx.fillStyle = PLAN_COLORS.wall;
      else if (map.floor[r][c]) ctx.fillStyle = PLAN_COLORS.floor;
      else continue;
      // A hair larger than the tile: no seams between tiles.
      ctx.fillRect(Math.floor(c * t), Math.floor(r * t), Math.ceil(t) + 0.5, Math.ceil(t) + 0.5);
    }
  }
  ctx.fillStyle = PLAN_COLORS.desk;
  for (const d of map.desks) ctx.fillRect(d.x * scale, d.y * scale, Math.max(2, d.width * scale), Math.max(2, d.height * scale));
  const button = map.furniture.find((f) => f.kind === 'button');
  if (button) dot(ctx, (button.x + button.width / 2) * scale, (button.y + button.height / 2) * scale, Math.max(2.5, 5 * scale), PLAN_COLORS.button);
  if (!labels) return;
  ctx.font = `${Math.max(9, Math.round(11 * scale * 2))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PLAN_COLORS.label;
  for (const room of map.rooms) {
    if (room.name === 'Corridor' || room.name === 'Outside' || room.width * scale < 40) continue;
    ctx.fillText(room.name.split(' / ')[0], (room.x + room.width / 2) * scale, (room.y + 12) * scale + 6);
  }
}

/** A round mark with a dark rim. */
export function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, radius / 3);
  ctx.strokeStyle = 'rgba(5, 8, 12, 0.85)';
  ctx.stroke();
}

/** Where the desk with this hostname is, as its middle (or undefined). */
export function deskCentre(map: OfficeMap, hostname: string): { x: number; y: number } | undefined {
  const d = map.desks.find((desk) => desk.hostname === hostname);
  return d && { x: d.x + d.width / 2, y: d.y + d.height / 2 };
}
