/**
 * Doors and badges (Phase 3, part A).
 *
 * Where things are on the shipped map (column, row of a tile):
 *   Finance door      FIN         tiles (7,13) (8,13)   - Finance above, corridor below
 *   Server room door  SRV-ROOM    tiles (49,4) (49,5)   - IT on the left, server room on the right
 *   Security door     SEC-OFFICE  tiles (15,18) (16,18) - corridor above, office below
 *   Bathrooms door    BATHROOMS   tiles (50,18) (51,18) - no reader
 *   Main entrance     MAIN-ENT    tiles (5,31) (6,31)   - Reception above, pavement below
 */
import { describe, expect, it } from 'vitest';
import { createWorld, openTerminal, queryEvents } from '@insider/engine';
import { DOOR_DENIED_MS, DOOR_OPEN_MS, TICK_RATE, parseOfficeMap } from '@insider/shared';
import { checkMapAgainstScenario } from '../src/mapCheck';
import { PW, Recorder, clone, scenario, tiledMap } from './helpers';

const TILE = 32;
const ACCESS = '/var/log/badge/access.log';
const DOORS = '/var/log/badge/doors.log';
const ticksFor = (ms: number) => Math.ceil((ms / 1000) * TICK_RATE) + 2;
const look = (r: Recorder, code: string) => r.game.publicState().doors[code].look;
/** Lines of a badge log written during the match (the file starts with the previous day's lines). */
const today = (r: Recorder, path: string) => r.file('SEC-SRV-01', path).split('\n').filter((l) => l.startsWith('2026-03-02'));

/** Holds a direction for some ticks, like keeping a key pressed. */
function hold(r: Recorder, clientId: string, dx: number, dy: number, ticks: number): void {
  r.send(clientId, 'move', { dx, dy });
  r.tick(ticks);
  r.send(clientId, 'move', { dx: 0, dy: 0 });
}

describe('doors', () => {
  it('a closed door blocks movement like a wall', () => {
    const r = new Recorder();
    r.connect('a', 'p1'); // Sara, inside Finance
    r.walkToTile('a', 'p1', 7, 11);
    hold(r, 'a', 0, 1, 60); // three seconds of walking down into the door
    expect(look(r, 'FIN')).toBe('closed');
    expect(r.position('p1').y).toBeLessThan(13 * TILE); // still above the doorway
    expect(today(r, ACCESS)).toEqual([]); // walking into a door is not a tap
  });

  it('a granted tap opens the door for 3 seconds, then it closes; both are logged', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    r.walkToTile('a', 'p1', 7, 12);
    r.send('a', 'tap', { door: 'FIN' });
    expect(r.notice('a')).toContain('Badge accepted');
    expect(look(r, 'FIN')).toBe('open');
    expect(today(r, ACCESS)).toEqual([expect.stringMatching(/^2026-03-02 09:00:\d\d DOOR=FIN BADGE=0412 USER=s\.alharbi RESULT=GRANTED DIR=OUT$/)]);

    hold(r, 'a', 0, 1, 20); // one second: through the doorway into the corridor
    expect(r.position('p1').y).toBeGreaterThan(14 * TILE);
    expect(look(r, 'FIN')).toBe('open'); // not yet 3 seconds
    r.tick(ticksFor(DOOR_OPEN_MS));
    expect(look(r, 'FIN')).toBe('closed');

    const lines = today(r, DOORS);
    expect(lines[0]).toMatch(/DOOR=FIN EVENT=OPEN$/);
    expect(lines[1]).toMatch(/DOOR=FIN EVENT=CLOSE OPEN_FOR=3\.[01]s PASSAGES=1$/);
    // The master log (server only) knows WHO walked through.
    expect(queryEvents(r.game.world, { type: 'door.pass' })).toMatchObject([{ user: 's.alharbi', actor: 'p1', origin: 'physical', details: { door: 'FIN', direction: 'OUT' } }]);
  });

  it('a door does not close on someone standing in the doorway', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    r.walkToTile('a', 'p1', 7, 12);
    r.send('a', 'tap', { door: 'FIN' });
    r.walkToTile('a', 'p1', 7, 13); // stop in the doorway
    r.tick(ticksFor(DOOR_OPEN_MS) + 40);
    expect(look(r, 'FIN')).toBe('open');
    r.walkToTile('a', 'p1', 7, 15);
    r.tick(5);
    expect(look(r, 'FIN')).toBe('closed');
  });

  it('a refused badge leaves the door shut, shows a red light for a moment, and is logged', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    expect(r.walkToTile('a', 'p1', 48, 4)).toBe(true); // out of Finance, into IT, up to the server room door
    r.tick(10);
    r.send('a', 'tap', { door: 'SRV-ROOM' });
    expect(r.notice('a')).toContain('Access denied');
    expect(look(r, 'SRV-ROOM')).toBe('denied');
    hold(r, 'a', 1, 0, 30);
    expect(r.position('p1').x).toBeLessThan(49 * TILE); // still in IT
    r.tick(ticksFor(DOOR_DENIED_MS));
    expect(look(r, 'SRV-ROOM')).toBe('closed');
    expect(today(r, ACCESS).at(-1)).toMatch(/DOOR=SRV-ROOM BADGE=0412 USER=s\.alharbi RESULT=DENIED DIR=IN$/);
    expect(today(r, DOORS).some((l) => l.includes('SRV-ROOM'))).toBe(false); // it never opened
  });

  it('who may enter the restricted rooms follows the scenario', () => {
    const allowed = (playerId: string, door: string, col: number, row: number) => {
      const r = new Recorder();
      r.connect('a', playerId);
      r.walkToTile('a', playerId, col, row);
      r.tick(10);
      r.send('a', 'tap', { door });
      return look(r, door) === 'open';
    };
    // Server room: the sysadmin and the IT helpdesk.
    expect(allowed('p5', 'SRV-ROOM', 48, 4)).toBe(true);
    expect(allowed('p8', 'SRV-ROOM', 48, 4)).toBe(true);
    expect(allowed('p10', 'SRV-ROOM', 48, 4)).toBe(false);
    // Security office: the guard and the sysadmin.
    expect(allowed('p5', 'SEC-OFFICE', 15, 17)).toBe(true);
    expect(allowed('p8', 'SEC-OFFICE', 15, 17)).toBe(false);
    expect(allowed('p1', 'SEC-OFFICE', 15, 17)).toBe(false);
  });

  it('tailgating: one tap, two people through, and the door log shows it', () => {
    const r = new Recorder();
    r.connect('k', 'p5'); // Khalid may enter
    r.connect('s', 'p1'); // Sara may not
    r.walkToTile('s', 'p1', 47, 5);
    r.walkToTile('k', 'p5', 48, 4);
    r.tick(10);
    r.send('k', 'tap', { door: 'SRV-ROOM' });
    r.game.handle('k', 'move', { dx: 1, dy: 0 });
    r.game.handle('s', 'move', { dx: 1, dy: 0 });
    r.tick(25);
    expect(r.position('p5').x).toBeGreaterThan(50 * TILE);
    expect(r.position('p1').x).toBeGreaterThan(50 * TILE); // Sara is in the server room
    r.send('k', 'move', { dx: 0, dy: 0 });
    r.send('s', 'move', { dx: 0, dy: 0 });
    r.tick(ticksFor(DOOR_OPEN_MS));

    const taps = today(r, ACCESS).filter((l) => l.includes('SRV-ROOM'));
    expect(taps).toHaveLength(1);
    expect(taps[0]).toMatch(/BADGE=0107 USER=k\.nasser RESULT=GRANTED DIR=IN$/);
    expect(today(r, DOORS).at(-1)).toMatch(/DOOR=SRV-ROOM EVENT=CLOSE OPEN_FOR=\d\.\ds PASSAGES=2$/);
    expect(queryEvents(r.game.world, { type: 'door.pass' }).filter((e) => e.details.door === 'SRV-ROOM').map((e) => e.actor).sort()).toEqual(['p1', 'p5']);

    // Leaving is always allowed (fire safety), but the exit tap carries Sara's own badge.
    r.walkToTile('s', 'p1', 50, 4);
    r.send('s', 'tap', { door: 'SRV-ROOM' });
    expect(look(r, 'SRV-ROOM')).toBe('open');
    expect(today(r, ACCESS).at(-1)).toMatch(/DOOR=SRV-ROOM BADGE=0412 USER=s\.alharbi RESULT=GRANTED DIR=OUT$/);
  });

  it('a door without a reader opens when walked into, closes behind, and logs nothing', () => {
    const r = new Recorder();
    r.connect('a', 'p9'); // Maha, in Reception (its door has no reader)
    expect(r.walkToTile('a', 'p9', 50, 22)).toBe(true); // into the bathrooms
    const seen = new Set(r.states.map((s) => s.doors.BATHROOMS.look));
    expect(seen).toEqual(new Set(['closed', 'open']));
    r.tick(40);
    expect(look(r, 'BATHROOMS')).toBe('closed');
    expect(look(r, 'RECEPTION')).toBe('closed');
    expect(today(r, ACCESS)).toEqual([]);
    expect(today(r, DOORS)).toEqual([]);
    // Tapping a door that has no reader does nothing at all.
    r.send('a', 'tap', { door: 'BATHROOMS' });
    expect(today(r, ACCESS)).toEqual([]);
  });

  it('the main entrance logs departures and arrivals', () => {
    const r = new Recorder();
    r.connect('a', 'p9');
    expect(r.walkToTile('a', 'p9', 6, 32)).toBe(true); // out onto the pavement
    r.tick(ticksFor(DOOR_OPEN_MS));
    expect(r.walkToTile('a', 'p9', 6, 29)).toBe(true); // and back in
    const taps = today(r, ACCESS);
    expect(taps).toHaveLength(2);
    expect(taps[0]).toMatch(/DOOR=MAIN-ENT BADGE=0233 USER=m\.yousef RESULT=GRANTED DIR=OUT$/);
    expect(taps[1]).toMatch(/DOOR=MAIN-ENT BADGE=0233 USER=m\.yousef RESULT=GRANTED DIR=IN$/);
  });

  it('the server measures the distance to the reader and ignores nonsense', () => {
    const r = new Recorder();
    r.connect('a', 'p5');
    r.send('a', 'tap', { door: 'SRV-ROOM' }); // from his desk
    expect(r.notice('a')).toContain('too far');
    r.send('a', 'tap', { door: 'NO-SUCH-DOOR' });
    r.send('a', 'tap', { door: 42 });
    r.send('a', 'tap');
    expect(look(r, 'SRV-ROOM')).toBe('closed');
    expect(today(r, ACCESS)).toEqual([]);
  });

  it('holding the key down does not fill the log', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    r.walkToTile('a', 'p1', 7, 12);
    for (let i = 0; i < 20; i++) r.send('a', 'tap', { door: 'FIN' }); // no time passes between these
    expect(today(r, ACCESS)).toHaveLength(1);
  });
});

describe('the badge server', () => {
  it('starts with the previous working day in its log: everyone in and out through the main entrance', () => {
    const r = new Recorder();
    const friday = r.file('SEC-SRV-01', ACCESS).split('\n').filter((l) => l.startsWith('2026-02-27')); // the match starts on Monday 2 March
    expect(friday).toHaveLength(scenario.accounts.length * 2);
    for (const account of scenario.accounts) {
      const mine = friday.filter((l) => l.includes(`USER=${account.username} `));
      expect(mine[0]).toMatch(new RegExp(`^2026-02-27 08:\\d\\d:\\d\\d DOOR=MAIN-ENT BADGE=${account.badge!.id} USER=${account.username} RESULT=GRANTED DIR=IN$`));
      expect(mine[1]).toMatch(/^2026-02-27 17:\d\d:\d\d DOOR=MAIN-ENT .* DIR=OUT$/);
    }
    // The file is in time order.
    expect([...friday].sort()).toEqual(friday);
  });

  it('has no screen: nobody can sit at it, and it needs no desk', () => {
    const world = createWorld(clone(scenario), 1);
    expect(world.hosts['SEC-SRV-01'].headless).toBe(true);
    expect(() => openTerminal(world, 'SEC-SRV-01', 'p1')).toThrow('no screen or keyboard');
    const r = new Recorder();
    expect(r.map.desks.some((d) => d.hostname === 'SEC-SRV-01')).toBe(false);
    r.connect('a', 'p1');
    r.send('a', 'sit', { hostname: 'SEC-SRV-01' }); // ignored: there is no such desk
    expect(r.position('p1')).toMatchObject({ seatedAt: '' });
  });

  it('the security guard reads the badge log over ssh; other employees have no account there', () => {
    const r = new Recorder();
    r.connect('g', 'p10'); // Tariq, in the security office
    r.connect('s', 'p1');
    r.walkToTile('s', 'p1', 7, 12);
    r.send('s', 'tap', { door: 'FIN' });

    r.sitAt('g', 'p10', 'SEC-WS-01');
    r.type('g', PW['t.omar']);
    r.type('g', 'ssh SEC-SRV-01');
    r.type('g', PW['t.omar']);
    expect(r.type('g', 'tail -n 1 /var/log/badge/access.log')).toMatch(/DOOR=FIN BADGE=0412 USER=s\.alharbi RESULT=GRANTED DIR=OUT/);
    expect(r.type('g', 'cat /etc/badge/doors.conf')).toContain('SRV-ROOM');

    r.sitAt('s', 'p1', 'FIN-LT-07');
    r.type('s', PW['s.alharbi']);
    r.type('s', 'ssh SEC-SRV-01');
    r.type('s', PW['s.alharbi']);
    r.type('s', PW['s.alharbi']);
    expect(r.type('s', PW['s.alharbi'])).toContain('Permission denied');
  });

  it('a player sees their own badge on their onboarding card', () => {
    const r = new Recorder();
    r.connect('a', 'p8');
    expect((r.last('a', 'welcome')!.payload as { card: object }).card).toMatchObject({ badgeId: '0417', badgeAccess: ['server-room'] });
  });
});

describe('map and scenario: doors and badges', () => {
  const check = (map = tiledMap, s = scenario) => () => checkMapAgainstScenario(parseOfficeMap(map), s, 'test');

  it('every door has a code, knows its inside, and the readers are where the decision says', () => {
    const map = parseOfficeMap(tiledMap);
    expect(map.doors.filter((d) => d.reader).map((d) => d.code).sort()).toEqual(['FIN', 'HR', 'IT', 'MAIN-ENT', 'MKT', 'SEC-OFFICE', 'SRV-ROOM']);
    expect(map.doors.filter((d) => d.restricted).map((d) => d.code).sort()).toEqual(['SEC-OFFICE', 'SRV-ROOM']);
    expect(map.doors.find((d) => d.code === 'FIN')).toMatchObject({ axis: 'y', inside: -1 }); // Finance is above its door
    expect(map.doors.find((d) => d.code === 'SRV-ROOM')).toMatchObject({ axis: 'x', inside: 1 }); // the server room is to the right
    expect(map.doors.find((d) => d.code === 'MAIN-ENT')).toMatchObject({ axis: 'y', inside: -1 });
    for (const door of map.doors.filter((d) => d.reader)) expect(map.badgeReaders.some((b) => b.props.door === door.code), door.code).toBe(true);
  });

  it('a desk for a headless machine is refused', () => {
    const map = clone(tiledMap);
    const desks = map.layers.find((l) => l.name === 'desks')!.objects!;
    desks[0].properties!.find((p) => p.name === 'hostname')!.value = 'SEC-SRV-01';
    expect(check(map)).toThrow('the scenario says that host is headless');
  });

  it('furniture that seals a room is refused', () => {
    const map = clone(tiledMap);
    // A cupboard right behind the security office door (tiles 15-16, row 19).
    map.layers.find((l) => l.name === 'furniture')!.objects!.push({
      id: 9999, name: 'Cupboard', x: 15 * TILE, y: 19 * TILE, width: 2 * TILE, height: TILE, properties: [{ name: 'kind', type: 'string', value: 'shelf' }],
    });
    expect(check(map)).toThrow('the chair of desk "SEC-WS-01" cannot be reached on foot');
  });

  it('a restricted door nobody can open, or a badge for a zone that does not exist, is refused', () => {
    const nobody = clone(scenario);
    for (const a of nobody.accounts) if (a.badge) a.badge.access = (a.badge.access ?? []).filter((z) => z !== 'server-room');
    expect(check(tiledMap, nobody)).toThrow('door "SRV-ROOM": no badge in the scenario opens zone "server-room"');

    const typo = clone(scenario);
    typo.accounts[0].badge!.access = ['sever-room'];
    expect(check(tiledMap, typo)).toThrow('the badge of "s.alharbi" lists zone "sever-room"');

    const entrance = clone(scenario);
    entrance.badgeSystem!.entranceDoor = 'FRONT';
    expect(check(tiledMap, entrance)).toThrow('badgeSystem.entranceDoor "FRONT"');
  });
});
