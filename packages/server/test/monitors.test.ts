/**
 * Phase 5, part B (server side): the security-office monitors. Camera
 * recordings, the badge log and the motion log, only for someone standing at
 * the CCTV monitors.
 */
import { describe, expect, it } from 'vitest';
import { INTERACT_DISTANCE, TICK_RATE } from '@insider/shared';
import { Recorder } from './helpers';

const seconds = (s: number) => Math.round(s * TICK_RATE);
type Index = { cameras: { id: string; shots: { id: string; time: number; count: number }[] }[]; badges: string[]; motion: string[] };
type Frame = { camera: string; id: string; time: number; people: { name: string; x: number; y: number; seatedAt: string; activity: string }[] };
const index = (r: Recorder, c: string) => r.last(c, 'monitors.index')?.payload as Index | undefined;
const frame = (r: Recorder, c: string) => r.last(c, 'monitors.frame')?.payload as Frame | undefined;

/** Tariq (the guard, client "g") walks from his desk to the monitors in the security office. */
function guardAtMonitors(r: Recorder): void {
  r.connect('g', 'p10');
  const station = r.map.furniture.find((f) => f.kind === 'monitors')!;
  expect(r.walkTo('g', 'p10', station.x + station.width / 2, station.y - 20)).toBe(true);
}

describe('the security-office monitors', () => {
  it('someone standing at them gets every camera\'s recording list, the badge log and the motion log', () => {
    const r = new Recorder();
    r.connect('m', 'p9'); // Maha arrives at reception: badge line, camera motion
    r.tick(seconds(5));
    guardAtMonitors(r);
    r.send('g', 'monitors.open');
    const i = index(r, 'g')!;
    expect(i.cameras.map((c) => c.id)).toEqual(['CAM-01', 'CAM-02', 'CAM-03', 'CAM-04', 'CAM-05', 'CAM-06']);
    expect(i.cameras[0].shots.length).toBeGreaterThan(0);
    expect(i.cameras[0].shots.at(-1)).toMatchObject({ id: expect.stringMatching(/^CAM-01-\d{6}$/), count: expect.any(Number) });
    expect(i.badges.some((l) => l.includes('USER=m.yousef') && l.includes('DOOR=MAIN-ENT'))).toBe(true);
    expect(i.motion.some((l) => l.includes('CAM-01 MOTION persons=1'))).toBe(true);
  });

  it('shows a camera\'s picture: who stood where; earlier pictures are kept', () => {
    const r = new Recorder();
    r.connect('m', 'p9');
    r.tick(seconds(3));
    const early = r.game.world.time;
    r.walkToTile('m', 'p9', 20, 15); // she leaves reception for the corridor
    r.tick(seconds(3));
    guardAtMonitors(r);
    r.send('g', 'monitors.frame', { camera: 'CAM-01' }); // now
    expect(frame(r, 'g')).toMatchObject({ camera: 'CAM-01', people: [] });
    r.send('g', 'monitors.frame', { camera: 'CAM-01', time: early }); // back then
    const then = frame(r, 'g')!;
    expect(then.id).toMatch(/^CAM-01-/);
    expect(then.people).toEqual([{ name: 'Maha Yousef', x: expect.any(Number), y: expect.any(Number), facing: 'up', seatedAt: '', activity: '' }]);
    expect(Object.keys(then.people[0]).sort()).toEqual(['activity', 'facing', 'name', 'seatedAt', 'x', 'y']); // no player ids
    // The corridor camera shows where she is now.
    r.send('g', 'monitors.frame', { camera: 'CAM-02' });
    expect(frame(r, 'g')!.people.map((p) => p.name)).toContain('Maha Yousef');
    // A time in the future is "now"; an unknown camera is ignored.
    r.send('g', 'monitors.frame', { camera: 'CAM-01', time: r.game.world.time + 3_600_000 });
    expect(frame(r, 'g')!.time).toBeLessThanOrEqual(r.game.world.time);
    const before = r.messages('g', 'monitors.frame').length;
    r.send('g', 'monitors.frame', { camera: 'CAM-99' });
    expect(r.messages('g', 'monitors.frame')).toHaveLength(before);
  });

  it('nobody away from the monitors gets anything, guard or not', () => {
    const r = new Recorder();
    r.connect('g', 'p10'); // Tariq at his desk, a few steps from the monitors
    r.connect('s', 'p1'); // Sara in Finance
    for (const c of ['g', 's']) {
      r.send(c, 'monitors.open');
      r.send(c, 'monitors.frame', { camera: 'CAM-01' });
      expect(r.messages(c, 'monitors.index'), c).toEqual([]);
      expect(r.messages(c, 'monitors.frame'), c).toEqual([]);
    }
    expect(r.notice('s')).toContain('The security monitors are in the security office');
  });

  it('anyone who stands there can look, not only the guard (the door is the protection)', () => {
    const r = new Recorder({ weaknesses: ['tailgate'] });
    r.connect('k', 'p5'); // Khalid's badge opens the security office
    const station = r.map.furniture.find((f) => f.kind === 'monitors')!;
    expect(r.walkTo('k', 'p5', station.x + station.width / 2, station.y - 20)).toBe(true);
    r.send('k', 'monitors.open');
    expect(index(r, 'k')).toBeDefined();
    // Two steps back is too far.
    r.walkTo('k', 'p5', station.x + station.width / 2, station.y - INTERACT_DISTANCE - 40);
    const count = r.messages('k', 'monitors.index').length;
    r.send('k', 'monitors.open');
    expect(r.messages('k', 'monitors.index')).toHaveLength(count);
  });

  it('monitor data goes only to the person using them', () => {
    const r = new Recorder();
    r.connect('m', 'p9');
    guardAtMonitors(r);
    r.send('g', 'monitors.open');
    r.send('g', 'monitors.frame', { camera: 'CAM-01' });
    const other = JSON.stringify(r.sent.get('m'));
    expect(other).not.toMatch(/monitors|CAM-0|MOTION|DOOR=/);
  });
});
