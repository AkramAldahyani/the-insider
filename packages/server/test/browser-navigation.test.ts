import { describe, expect, it } from 'vitest';
import { parseOfficeMap } from '@insider/shared';
import { clearPath, steeringAxis } from '../../../e2e/helpers/navigation';
import { tiledMap } from './helpers';

const map = parseOfficeMap(tiledMap);

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
