import { describe, expect, it } from 'vitest';
import { queryEvents } from '@insider/engine';
import { INTERACT_DISTANCE, PLAYER_RADIUS, isFree, parseOfficeMap } from '@insider/shared';
import { checkMapAgainstScenario } from '../src/mapCheck';
import { OfficeGame } from '../src/game';
import { PW, Recorder, clone, scenario, tiledMap } from './helpers';

describe('map and scenario consistency', () => {
  it('the shipped map matches the shipped scenario', () => {
    expect(() => checkMapAgainstScenario(parseOfficeMap(tiledMap), scenario)).not.toThrow();
  });

  it('the map has every room of the design and the object layers later phases need', () => {
    const map = parseOfficeMap(tiledMap);
    const rooms = new Set(map.rooms.map((r) => r.name));
    for (const name of ['Reception', 'Finance', 'HR', 'Marketing', 'IT department', 'Server room', 'Security office',
      'Cafeteria / meeting room', 'Printer room', 'Storage', 'Bathrooms', 'Corridor']) {
      expect(rooms, name).toContain(name);
    }
    expect(map.desks.length).toBeGreaterThanOrEqual(9); // 8+ workstations and the server
    expect(map.doors.length).toBeGreaterThan(10);
    expect(map.cameras.length).toBeGreaterThan(0);
    expect(map.badgeReaders.length).toBeGreaterThan(0);
    expect(map.doors.find((d) => d.name === 'Server room door')).toMatchObject({ code: 'SRV-ROOM', reader: true, restricted: true, zone: 'server-room' });
  });

  it('refuses to start, listing every problem, when a desk and a host do not match', () => {
    const broken = clone(tiledMap);
    const desks = broken.layers.find((l) => l.name === 'desks')!.objects!;
    desks.find((o) => o.name === 'FIN-LT-07')!.properties![0].value = 'FIN-LT-99'; // typo in the map
    let message = '';
    try {
      new OfficeGame({ scenario, map: broken, mapName: 'broken' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('Map "broken" does not match scenario "nexora-small"');
    expect(message).toContain('desk "FIN-LT-99" is on the map but is not a host in the scenario');
    expect(message).toContain('host "FIN-LT-07" is in the scenario but has no desk on the map');
    expect(message).toContain('player "p1" sits at "FIN-LT-07", which has no desk on the map');
  });

  it('refuses a scenario with a machine that has no desk', () => {
    const bigger = clone(scenario);
    bigger.hosts.push({ ...clone(bigger.hosts[1]), hostname: 'IT-WS-09', mac: '52:54:00:17:09:09' });
    expect(() => new OfficeGame({ scenario: bigger, map: tiledMap, mapName: 'office-small' }))
      .toThrow('host "IT-WS-09" is in the scenario but has no desk on the map');
  });
});

describe('start screen', () => {
  it('offers the employees without their passwords and marks taken ones', () => {
    const r = new Recorder();
    r.connect('a');
    const lobby = r.last('a', 'lobby')!.payload as { employees: { id: string; name: string; desk: string; taken: boolean }[]; dev: boolean };
    expect(lobby.dev).toBe(false);
    expect(lobby.employees).toHaveLength(10);
    expect(lobby.employees[0]).toEqual({ id: 'p1', name: 'Sara Alharbi', title: 'Accountant', department: 'Finance', desk: 'FIN-LT-07', taken: false });

    r.connect('b');
    r.send('a', 'choose', { playerId: 'p1' });
    // "b" is still choosing and is told that Sara is now taken.
    const updated = r.last('b', 'lobby')!.payload as typeof lobby;
    expect(updated.employees.find((e) => e.id === 'p1')!.taken).toBe(true);
    r.send('b', 'choose', { playerId: 'p1' });
    expect(r.last('b', 'notice')!.payload).toEqual({ text: 'Sara Alharbi is already being played.' });
    expect(r.last('b', 'welcome')).toBeUndefined();
  });

  it('gives a player their own onboarding card and puts them next to their desk', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    const { playerId, card } = r.last('a', 'welcome')!.payload as { playerId: string; card: Record<string, string> };
    expect(playerId).toBe('p1');
    expect(card).toEqual({
      name: 'Sara Alharbi', title: 'Accountant', department: 'Finance', username: 's.alharbi', password: PW['s.alharbi'],
      hostname: 'FIN-LT-07', ip: r.game.world.hosts['FIN-LT-07'].ip, mac: '52:54:00:f1:07:07', location: 'Finance, desk 7',
      badgeId: '0412', badgeAccess: [],
    });
    const desk = r.map.desks.find((d) => d.hostname === 'FIN-LT-07')!;
    const me = r.position('p1');
    expect(Math.hypot(me.x - desk.seatX, me.y - desk.seatY)).toBeLessThan(3 * r.map.tile);
  });
});

describe('movement', () => {
  it('is decided by the server, at walking speed, and stops at walls', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    const start = r.position('p1');
    r.send('a', 'move', { dx: -1, dy: 0 });
    r.tick(20); // one second
    const after = r.position('p1');
    expect(start.x - after.x).toBeGreaterThan(160);
    expect(start.x - after.x).toBeLessThan(180);
    expect(after.y).toBe(start.y);

    // A cheating browser cannot ask for more speed or a position.
    r.send('a', 'move', { dx: -500, dy: 0, x: 9999, y: 9999 });
    r.tick(10);
    expect(after.x - r.position('p1').x).toBeLessThan(90);

    // Keep walking left for a long time: the outer wall stops her.
    r.tick(400);
    const stuck = r.position('p1');
    const wallX = 1 * r.map.tile; // right edge of the wall tiles in column 0
    expect(stuck.x).toBeGreaterThanOrEqual(wallX + PLAYER_RADIUS);
    expect(stuck.x).toBeLessThan(wallX + PLAYER_RADIUS + 6);
    expect(isFree(r.map, stuck.x, stuck.y, PLAYER_RADIUS)).toBe(true);
  });

  it('walking diagonally is not faster, and slides along walls', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    const start = r.position('p1');
    r.send('a', 'move', { dx: 1, dy: 1 });
    r.tick(10);
    const p = r.position('p1');
    expect(Math.hypot(p.x - start.x, p.y - start.y)).toBeLessThan(90);
    r.tick(600); // into the bottom-right corner of the room
    const corner = r.position('p1');
    expect(isFree(r.map, corner.x, corner.y, PLAYER_RADIUS)).toBe(true);
    expect(corner.y).toBeGreaterThan(12 * r.map.tile);
  });

  it('the sysadmin can walk from IT into the server room and sit at the server', () => {
    const r = new Recorder();
    r.connect('a', 'p5');
    expect(r.sitAt('a', 'p5', 'ADMIN-SRV-01')).toBe(true);
    expect(r.last('a', 'term.open')!.payload).toMatchObject({ hostname: 'ADMIN-SRV-01', screen: 'login', prompt: 'ADMIN-SRV-01 login: ' });
  });
});

describe('sitting and standing', () => {
  it('refuses to sit from too far away (the server measures the distance)', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    r.send('a', 'sit', { hostname: 'HR-LT-03' }); // she is in Finance
    expect(r.last('a', 'notice')!.payload).toEqual({ text: 'You are too far from HR-LT-03.' });
    expect(r.last('a', 'term.open')).toBeUndefined();
    expect(r.game.publicState().players.p1.seatedAt).toBe('');
    expect(queryEvents(r.game.world, { type: 'terminal.sit' })).toHaveLength(0);

    // Just outside the limit: still no. Just inside: yes.
    const desk = r.map.desks.find((d) => d.hostname === 'FIN-LT-07')!;
    r.walkTo('a', 'p1', desk.seatX, desk.seatY + INTERACT_DISTANCE + 8);
    r.send('a', 'sit', { hostname: 'FIN-LT-07' });
    expect(r.last('a', 'term.open')).toBeUndefined();
    r.walkTo('a', 'p1', desk.seatX, desk.seatY + INTERACT_DISTANCE - 8);
    r.send('a', 'sit', { hostname: 'FIN-LT-07' });
    expect(r.last('a', 'term.open')!.payload).toMatchObject({ hostname: 'FIN-LT-07', screen: 'locked', masked: true, canSwitchUser: true });
  });

  it('sitting snaps to the chair, blocks walking, and is visible to everyone', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    r.sitAt('a', 'p1', 'FIN-LT-07');
    const desk = r.map.desks.find((d) => d.hostname === 'FIN-LT-07')!;
    expect(r.position('p1')).toMatchObject({ x: desk.seatX, y: desk.seatY, facing: 'up', seatedAt: 'FIN-LT-07' });
    expect(r.game.publicState().desks['FIN-LT-07'].occupantId).toBe('p1');

    r.send('a', 'move', { dx: 1, dy: 0 });
    r.tick(20);
    expect(r.position('p1').x).toBe(desk.seatX);
  });

  it('only one player can sit at a desk', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    r.connect('b', 'p2');
    r.sitAt('a', 'p1', 'FIN-LT-07');
    r.sitAt('b', 'p2', 'FIN-LT-07');
    expect(r.last('b', 'notice')!.payload).toEqual({ text: 'Sara Alharbi is sitting at FIN-LT-07.' });
    expect(r.last('b', 'term.open')).toBeUndefined();
  });

  it('standing up leaves the PC exactly as it is: unlocked stays unlocked', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    r.sitAt('a', 'p1', 'FIN-LT-07');
    r.type('a', PW['s.alharbi']);
    expect(r.screen('a').prompt).toBe('s.alharbi@FIN-LT-07:~$ ');
    r.type('a', 'cd Documents');

    r.send('a', 'stand');
    expect(r.last('a', 'term.close')).toBeDefined();
    expect(r.game.publicState().players.p1.seatedAt).toBe('');
    expect(r.game.publicState().desks['FIN-LT-07']).toEqual({ hostname: 'FIN-LT-07', screen: 'unlocked', lockUser: '', occupantId: '' });
    // She can walk again...
    r.send('a', 'move', { dx: 0, dy: 1 });
    r.tick(5);
    expect(r.position('p1').y).toBeGreaterThan(r.map.desks.find((d) => d.hostname === 'FIN-LT-07')!.seatY);
    // ...and whoever sits down next gets her open shell, in the folder she left it in.
    r.connect('b', 'p2');
    r.sitAt('b', 'p2', 'FIN-LT-07');
    expect(r.last('b', 'term.open')!.payload).toMatchObject({ screen: 'shell', prompt: 's.alharbi@FIN-LT-07:~/Documents$ ', masked: false });
    expect(r.type('b', 'whoami')).toBe('s.alharbi\n');
    // The engine knows the account AND who was really at the keyboard.
    const command = queryEvents(r.game.world, { type: 'command', host: 'FIN-LT-07' }).pop()!;
    expect(command).toMatchObject({ user: 's.alharbi', actor: 'p2', origin: 'physical' });
  });

  it('terminal messages from a player who is not seated are ignored', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    const before = r.game.world.events.length;
    r.send('a', 'term.line', { text: 'whoami' });
    r.send('a', 'term.cancel');
    r.send('a', 'term.switchUser');
    expect(r.messages('a', 'term.output')).toHaveLength(0);
    expect(r.game.world.events.length).toBe(before);
  });
});

describe('the clock and the screens', () => {
  it('game time follows real time, times the speed setting', () => {
    const r = new Recorder({ speed: 1 });
    const t0 = r.game.world.time;
    r.tick(20);
    expect(r.game.world.time - t0).toBe(1000);
    expect(r.game.publicState().clock).toBe(t0 + 1000);

    const fast = new Recorder({ speed: 60 });
    fast.tick(20);
    expect(fast.game.world.time - t0).toBe(60_000);
  });

  it('a screen never locks itself; a lock typed at it is seen by the seated player and by everyone', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    r.sitAt('a', 'p1', 'FIN-LT-07');
    r.type('a', PW['s.alharbi']);
    r.tick(20 * 600); // ten minutes without a key
    expect(r.game.publicState().desks['FIN-LT-07'].screen).toBe('unlocked');

    r.type('a', 'loginctl lock-session');
    expect(r.game.publicState().desks['FIN-LT-07']).toMatchObject({ screen: 'locked', lockUser: 's.alharbi', occupantId: 'p1' });
    expect(r.screen('a')).toMatchObject({ screen: 'locked', masked: true, prompt: 'Password: ' });
    expect(r.screen('a').output).toContain('screen locked by s.alharbi');
  });

  it('the old "someone is typing" message no longer exists and is ignored', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    r.sitAt('a', 'p1', 'FIN-LT-07');
    const before = r.game.world.events.length;
    r.send('a', 'term.activity');
    expect(r.game.world.events.length).toBe(before);
  });

  it('switch user works through messages', () => {
    const r = new Recorder();
    r.connect('a', 'p5'); // Khalid
    r.sitAt('a', 'p5', 'FIN-LT-07');
    r.send('a', 'term.switchUser');
    expect(r.screen('a')).toMatchObject({ screen: 'login', prompt: 'FIN-LT-07 login: ' });
    r.type('a', 'k.nasser');
    r.type('a', PW['k.nasser']);
    expect(r.screen('a').prompt).toBe('k.nasser@FIN-LT-07:~$ ');
    expect(r.game.publicState().desks['FIN-LT-07'].screen).toBe('unlocked');
  });

  it('Ctrl+C cancels a password question', () => {
    const r = new Recorder();
    r.connect('a', 'p3');
    r.sitAt('a', 'p3', 'HR-LT-03'); // unlocked
    r.type('a', 'ssh l.haddad@ADMIN-SRV-01');
    expect(r.screen('a').masked).toBe(true);
    r.send('a', 'term.cancel');
    expect(r.screen('a')).toMatchObject({ masked: false, prompt: 'l.haddad@HR-LT-03:~$ ' });
  });

  it('disconnecting is like standing up: the session stays', () => {
    const r = new Recorder();
    r.connect('a', 'p1');
    r.sitAt('a', 'p1', 'FIN-LT-07');
    r.type('a', PW['s.alharbi']);
    r.game.disconnect('a');
    r.flush();
    expect(r.game.publicState().players.p1).toBeUndefined();
    expect(r.game.publicState().desks['FIN-LT-07']).toMatchObject({ screen: 'unlocked', occupantId: '' });
  });
});
