/**
 * CCTV recording (Phase 3, part F).
 *
 * Cameras on the shipped map: CAM-01 Reception, CAM-02 / CAM-03 the corridor
 * (west and east end), CAM-04 the IT side of the server room door, CAM-05
 * the cafeteria. Finance, HR, Marketing, the security office, the server
 * room, the printer room, storage and the bathrooms have no camera.
 */
import { describe, expect, it } from 'vitest';
import { TICK_RATE, parseOfficeMap } from '@insider/shared';
import { checkMapAgainstScenario } from '../src/mapCheck';
import { Recorder, clone, scenario, tiledMap } from './helpers';

const seconds = (s: number) => s * TICK_RATE;
const TILE = 32;
/** Is this player in the newest picture of any camera? */
const onAnyCamera = (r: Recorder, playerId: string) =>
  r.game.cctv.cameras.some((c) => r.game.cctv.at(c.id, r.game.world.time)?.people.some((p) => p.playerId === playerId));
const motionLog = (r: Recorder) => r.file('SEC-SRV-01', '/var/log/cctv/motion.log').split('\n').filter(Boolean);

describe('cameras', () => {
  it('the map has five cameras, each watching a room up to a range', () => {
    const r = new Recorder();
    expect(r.game.cctv.cameras.map((c) => `${c.id} ${c.covers}`)).toEqual([
      'CAM-01 Reception', 'CAM-02 Corridor', 'CAM-03 Corridor', 'CAM-04 IT department', 'CAM-05 Cafeteria / meeting room',
    ]);
    const cam4 = r.game.cctv.cameras[3];
    expect(r.game.cctv.sees(cam4, 48.5 * TILE, 4.5 * TILE)).toBe(true); // in front of the server room door
    expect(r.game.cctv.sees(cam4, 51.5 * TILE, 4.5 * TILE)).toBe(false); // inside the server room: another room
    expect(r.game.cctv.sees(cam4, 42.5 * TILE, 12.5 * TILE)).toBe(false); // the far corner of IT: out of range
    // The two corridor cameras together see the whole corridor.
    const [west, east] = [r.game.cctv.cameras[1], r.game.cctv.cameras[2]];
    for (let col = 1; col < 55; col++) expect(r.game.cctv.sees(west, (col + 0.5) * TILE, 15.5 * TILE) || r.game.cctv.sees(east, (col + 0.5) * TILE, 15.5 * TILE), `column ${col}`).toBe(true);
  });

  it('a camera whose room does not exist is refused at start-up', () => {
    const map = clone(tiledMap);
    map.layers.find((l) => l.name === 'cameras')!.objects![0].properties!.find((p) => p.name === 'covers')!.value = 'Lobby';
    expect(() => checkMapAgainstScenario(parseOfficeMap(map), scenario, 'test')).toThrow('camera "CAM-01 Reception" covers "Lobby", which is not a room on the map');
  });
});

describe('snapshots', () => {
  it('record who is in view, where, and whether they sit at a desk', () => {
    const r = new Recorder();
    r.connect('a', 'p9'); // Maha, in Reception
    r.tick(seconds(3));
    const first = r.game.cctv.at('CAM-01', r.game.world.time)!;
    const me = r.position('p9');
    expect(first.id).toMatch(/^CAM-01-\d{6}$/);
    expect(first.people).toEqual([{ playerId: 'p9', name: 'Maha Yousef', x: Math.round(me.x), y: Math.round(me.y), facing: 'up', seatedAt: '' }]);

    r.sitAt('a', 'p9', 'REC-PC-01');
    r.tick(seconds(3));
    expect(r.game.cctv.at('CAM-01', r.game.world.time)!.people[0]).toMatchObject({ playerId: 'p9', seatedAt: 'REC-PC-01' });
    // The earlier picture is still there: asking for an earlier time returns it.
    expect(r.game.cctv.at('CAM-01', first.time)).toEqual(first);
    expect(r.game.cctv.find(first.id)).toEqual(first);
    // Before the match there is no picture.
    expect(r.game.cctv.at('CAM-01', first.time - 60_000)).toBeUndefined();
  });

  it('a still scene is stored once a minute, not every two seconds', () => {
    const r = new Recorder();
    r.connect('a', 'p9');
    r.tick(seconds(300)); // five minutes without moving
    const count = r.game.cctv.recording('CAM-01').length;
    expect(count).toBeGreaterThanOrEqual(5);
    expect(count).toBeLessThanOrEqual(8);
    // An empty room is recorded the same way.
    expect(r.game.cctv.recording('CAM-05').every((s) => s.people.length === 0)).toBe(true);
    expect(r.game.cctv.recording('CAM-05').length).toBeLessThanOrEqual(8);
  });

  it('walking through a camera\'s view leaves a trail of pictures', () => {
    const r = new Recorder();
    r.connect('a', 'p9');
    r.walkToTile('a', 'p9', 30, 15); // out of Reception, east along the corridor
    r.tick(seconds(3));
    const trail = r.game.cctv.recording('CAM-02').filter((s) => s.people.some((p) => p.playerId === 'p9'));
    expect(trail.length).toBeGreaterThanOrEqual(3);
    const xs = trail.map((s) => s.people[0].x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs); // she moves steadily east
    // Reception's camera saw her leave.
    expect(r.game.cctv.at('CAM-01', r.game.world.time)!.people).toEqual([]);
  });

  it('blind spots: nobody in the printer room, storage, bathrooms or a department room is ever filmed', () => {
    const r = new Recorder();
    r.connect('a', 'p9');
    for (const [col, row] of [[37, 24], [43, 24], [50, 22]] as const) { // printer room, storage, bathrooms
      r.walkToTile('a', 'p9', col, row);
      r.tick(seconds(4));
      expect(onAnyCamera(r, 'p9'), `tile ${col},${row}`).toBe(false);
    }
    r.walkToTile('a', 'p9', 30, 16); // back in the corridor
    r.tick(seconds(3));
    expect(onAnyCamera(r, 'p9')).toBe(true);

    const finance = new Recorder();
    finance.connect('s', 'p1'); // Sara stays in Finance
    finance.sitAt('s', 'p1', 'FIN-LT-07');
    finance.tick(seconds(60));
    for (const camera of finance.game.cctv.cameras) expect(finance.game.cctv.recording(camera.id).some((s) => s.people.length > 0)).toBe(false);
  });

  it('tailgating is on camera: two people at the server room door for one badge tap', () => {
    const r = new Recorder();
    r.connect('k', 'p5');
    r.connect('s', 'p1');
    r.walkToTile('s', 'p1', 47, 5);
    r.walkToTile('k', 'p5', 48, 4);
    r.tick(seconds(3));
    r.send('k', 'tap', { door: 'SRV-ROOM' });
    const tapTime = r.game.world.time;
    const picture = r.game.cctv.at('CAM-04', tapTime)!;
    expect(picture.people.map((p) => p.playerId).sort()).toEqual(['p1', 'p5']);
    // Both go in; the camera does not see into the server room, so the next picture is empty.
    r.game.handle('k', 'move', { dx: 1, dy: 0 });
    r.game.handle('s', 'move', { dx: 1, dy: 0 });
    r.tick(seconds(3));
    expect(r.game.cctv.at('CAM-04', r.game.world.time)!.people).toEqual([]);
  });
});

describe('the motion log on the security server', () => {
  it('says when the head count of a camera changed and which snapshot shows it, without names', () => {
    const r = new Recorder();
    r.connect('a', 'p9');
    r.tick(seconds(3));
    r.walkToTile('a', 'p9', 20, 15);
    r.tick(seconds(3));
    const log = motionLog(r);
    expect(log[0]).toMatch(/^2026-03-02 09:00:\d\d CAM-01 MOTION persons=1 snapshot=CAM-01-\d{6}$/);
    expect(log.some((l) => /CAM-01 MOTION persons=0/.test(l))).toBe(true);
    expect(log.some((l) => /CAM-02 MOTION persons=1/.test(l))).toBe(true);
    expect(log.join('\n')).not.toMatch(/Maha|m\.yousef|p9/);
    // Every snapshot named in the log can be looked up.
    for (const line of log) expect(r.game.cctv.find(/snapshot=(\S+)/.exec(line)![1]), line).toBeDefined();
  });

  it('only the guard and the sysadmin can read it', () => {
    expect(scenario.hosts.find((h) => h.hostname === 'SEC-SRV-01')!.logReaders).toEqual(['t.omar', 'k.nasser']);
  });
});

describe('recordings stay on the server', () => {
  it('nothing about cameras or snapshots is sent to a browser', () => {
    const r = new Recorder({ bots: true });
    r.connect('a', 'p9');
    r.tick(seconds(240));
    expect(r.game.cctv.recording('CAM-02').length).toBeGreaterThan(10);
    const everything = JSON.stringify({ sent: [...r.sent.values()], states: r.states });
    expect(everything).not.toMatch(/CAM-0|snapshot|cctv/i);
  });

  it('a jump of the clock does not flood the recording, and the same seed records the same pictures', () => {
    const r = new Recorder({ dev: true });
    r.connect('a', 'p9');
    r.tick(seconds(5));
    const before = r.game.cctv.recording('CAM-01').length;
    r.send('a', 'dev.jump', { duration: '+2h' });
    r.tick(seconds(5));
    expect(r.game.cctv.recording('CAM-01').length - before).toBeLessThanOrEqual(3);

    const run = () => {
      const g = new Recorder({ bots: true });
      g.tick(seconds(300));
      return JSON.stringify(g.game.cctv.cameras.map((c) => g.game.cctv.recording(c.id)));
    };
    expect(run()).toBe(run());
  });
});
