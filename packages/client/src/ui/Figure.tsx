/**
 * A player's character, drawn large from the same pixel sheet the office uses
 * (characterArt.ts): one frame of the sheet, scaled up without smoothing.
 * `walking` steps through the four frames of its direction.
 */
import type { Facing, Look } from '@insider/shared';
import type { CSSProperties } from 'react';
import { DIRECTIONS, FRAME_H, FRAME_W, lookSheet } from '../game/characterArt';

export function Figure({ look, scale = 4, facing = 'down', walking = false, label }: { look: Look; scale?: number; facing?: Facing; walking?: boolean; label?: string }) {
  const row = DIRECTIONS.indexOf(facing);
  const style = {
    '--w': `${FRAME_W * scale}px`,
    '--h': `${FRAME_H * scale}px`,
    '--row': `${-row * FRAME_H * scale}px`,
    '--sheet-w': `${FRAME_W * 4 * scale}px`,
    backgroundImage: `url(${lookSheet(look)})`,
  } as CSSProperties;
  return <span className={`figure ${walking ? 'figure-walking' : ''}`} style={style} role="img" aria-label={label ?? 'Your character'} />;
}
