import { describe, expect, it } from 'vitest';
import { parseOfficeMap } from '@insider/shared';
import { TICK_STEP, clearPath, release, steeringAxis } from '../../../e2e/helpers/navigation';
import { tiledMap } from './helpers';

const map = parseOfficeMap(tiledMap);

describe('letting go of a movement key', () => {
  /**
   * A body that moves `step` px per update and coasts `step` px after a release,
   * as traced in the Reception doorway. Returns how many key presses it took to
   * come within `tolerance` of the target (0 = never, in 20).
   */
  function presses(start: number, target: number, step: number, tolerance: number, rule: typeof release): number {
    let x = start;
    let coast = TICK_STEP;
    for (let n = 1; n <= 20; n++) {
      const direction = Math.sign(target - x);
      const r = rule(Math.abs(target - x), coast, tolerance);
      if (r.tap) x += direction * step; // a tap lasts one tick
      else {
        do x += direction * step; while (direction * (target - x) > r.at);
        x += direction * step;
        coast = (coast + step) / 2;
      }
      if (Math.abs(target - x) <= tolerance) return n;
    }
    return 0;
  }

  it('releasing at the target bounced across the Reception doorway for ever (the traced failure)', () => {
    const atTarget: typeof release = (_remaining, _coast, tolerance) => ({ tap: false, at: tolerance });
    expect(presses(198.7, 208, 10.5, 5.9, atTarget)).toBe(0);
  });

  it('releasing early arrives in a few presses, from anywhere and for the steps seen on slow and fast machines', () => {
    for (const step of [8.5, 9.5, 10.5]) {
      for (let start = 100; start <= 320; start += 0.7) {
        if (Math.abs(start - 208) <= 5.9) continue;
        const n = presses(start, 208, step, 5.9, release);
        expect(n, `step ${step} from ${start.toFixed(1)}`).toBeGreaterThan(0);
        expect(n, `step ${step} from ${start.toFixed(1)}`).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('browser walking approaches', () => {
  it('aligns below the HR desk before moving sideways, using the observed failing position', () => {
    const from = { x: 620.6, y: 131.6 }, chair = { x: 576, y: 144 };
    expect(clearPath(map, from, chair)).toBe(false);
    expect(steeringAxis(map, from, chair, 5.9)).toBe('y');
    expect(steeringAxis(map, { x: from.x, y: chair.y }, chair, 5.9)).toBe('x');
  });

  it('walks along a clear security-office corridor without chasing the sideways tile centre', () => {
    expect(steeringAxis(map, { x: 451.5, y: 848 }, { x: 464, y: 720 }, 5.9)).toBe('y');
  });

  it('does not cut a body-sized corner through a desk or across a room wall', () => {
    expect(clearPath(map, { x: 620.6, y: 131.6 }, { x: 592, y: 131.6 })).toBe(false);
    expect(clearPath(map, { x: 320, y: 144 }, { x: 576, y: 144 })).toBe(false);
    expect(clearPath(map, { x: 620.6, y: 144 }, { x: 576, y: 144 })).toBe(true);
  });
});
