/**
 * Phase 4, part A on the server: joining as the hacker, who learns what, the
 * one-person server room door and the careless sysadmin bot.
 */
import { describe, expect, it } from 'vitest';
import { ALL_WEAKNESSES, queryEvents } from '@insider/engine';
import { TICK_RATE, type MissionBriefing } from '@insider/shared';
import { loadGameOptions } from '../src/app';
import { PW, Recorder, scenario } from './helpers';

const TILE = 32;
const START = Date.parse(scenario.startTime);
const seconds = (s: number) => s * TICK_RATE;
const minutes = (m: number) => m * 60 * TICK_RATE;
const welcome = (r: Recorder, client: string) => r.last(client, 'welcome')!.payload as { playerId: string; mission: MissionBriefing | null };
const lobby = (r: Recorder, client: string) => r.last(client, 'lobby')!.payload as { hackerOpen: boolean };
const look = (r: Recorder, code: string) => r.game.publicState().doors[code].look;
const doorsLog = (r: Recorder) => r.file('SEC-SRV-01', '/var/log/badge/doors.log').split('\n').filter((l) => l.startsWith('2026-03-02') && l.includes('SRV-ROOM'));

describe('joining as the hacker', () => {
  it('the hacker gets a private briefing and a tools folder; an employee gets neither', () => {
    const r = new Recorder();
    r.connect('h');
    expect(lobby(r, 'h').hackerOpen).toBe(true);
    r.send('h', 'choose', { playerId: 'p4', hacker: true });
    expect(welcome(r, 'h').mission).toMatchObject({ toolsPath: '/home/o.farouk/.tools' });
    expect(r.game.world.mission.hacker).toBe('p4');
    expect(r.file('MKT-LT-11', '/home/o.farouk/.tools/README')).toContain('Every tool leaves a trace');

    r.connect('e', 'p1');
    expect(welcome(r, 'e').mission).toBeNull();
    expect(r.file('FIN-LT-07', '/home/s.alharbi/.tools/README')).toBe('');
  });

  it('one hacker per match; the role is free again when the hacker leaves', () => {
    const r = new Recorder();
    r.connect('h');
    r.send('h', 'choose', { playerId: 'p4', hacker: true });
    r.connect('x');
    expect(lobby(r, 'x').hackerOpen).toBe(false);
    r.send('x', 'choose', { playerId: 'p1', hacker: true });
    expect(r.notice('x')).toContain('already has its hacker');
    expect(r.last('x', 'welcome')).toBeUndefined(); // still on the start screen
    expect(r.game.world.mission.hacker).toBe('p4');

    r.game.disconnect('h');
    r.flush();
    expect(lobby(r, 'x').hackerOpen).toBe(true);
    r.send('x', 'choose', { playerId: 'p1', hacker: true });
    expect(welcome(r, 'x').mission).not.toBeNull();
    expect(r.game.world.mission.hacker).toBe('p1');
  });

  it('a hacker flag that is not exactly `true` is an ordinary employee', () => {
    const r = new Recorder();
    r.connect('a');
    r.send('a', 'choose', { playerId: 'p1', hacker: 'yes' });
    expect(welcome(r, 'a').mission).toBeNull();
    expect(r.game.world.mission.hacker).toBeNull();
  });
});

describe('what the other players learn', () => {
  it('nothing: not who the hacker is, not today\'s weaknesses', () => {
    const r = new Recorder({ weaknesses: [...ALL_WEAKNESSES], bots: true });
    r.connect('h');
    r.send('h', 'choose', { playerId: 'p4', hacker: true });
    r.connect('e', 'p1');
    r.connect('late'); // someone still on the start screen
    r.tick(minutes(3));
    const m = r.game.world.mission;
    expect(m.weaknesses).toHaveLength(5);

    for (const client of ['e', 'late']) {
      const stream = JSON.stringify(r.sent.get(client));
      for (const secret of [...ALL_WEAKNESSES, 'rumours', '.tools', 'backup-2025', 'nexora2026', 'onePersonDoors', 'carelessPlayer']) {
        expect(stream.includes(secret), `${client} received "${secret}"`).toBe(false);
      }
      expect(stream).not.toContain('"mission":{');
    }
    // The public state has no new fields, and says nothing about roles.
    const states = JSON.stringify(r.states);
    expect(states).not.toMatch(/hacker|mission|weak|rumour/i);
    for (const p of Object.values(r.game.publicState().players)) expect(Object.keys(p).sort()).toEqual(['facing', 'id', 'name', 'seatedAt', 'x', 'y']);
    // The start screen says only whether the role is free.
    expect(Object.keys(r.last('late', 'lobby')!.payload as object).sort()).toEqual(['dev', 'employees', 'hackerOpen', 'mapName', 'scenarioName']);
  });

  it('the hacker is told the goal and rumours, not which weaknesses are on', () => {
    const r = new Recorder({ weaknesses: ['extra-sudo', 'plaintext-password'] });
    r.connect('h');
    r.send('h', 'choose', { playerId: 'p4', hacker: true });
    const stream = JSON.stringify(r.sent.get('h'));
    expect(stream).toContain('/root/flag.txt');
    for (const secret of [...ALL_WEAKNESSES, r.game.world.mission.extraSudoAccount, 'backup-2025']) expect(stream.includes(secret), secret).toBe(false);
  });

  it('the developer view of the mission exists only on a development server', () => {
    const dev = new Recorder({ dev: true, weaknesses: ['extra-sudo'] });
    dev.connect('a', 'p1');
    dev.send('a', 'dev.show', { what: 'mission' });
    expect((dev.last('a', 'dev.result')!.payload as { text: string }).text).toMatch(/weaknesses: +extra-sudo[\s\S]*one-person doors: SRV-ROOM/);
    const prod = new Recorder({ weaknesses: ['extra-sudo'] });
    prod.connect('a', 'p1');
    prod.send('a', 'dev.show', { what: 'mission' });
    expect(prod.messages('a', 'dev.result')).toEqual([]);
  });
});

describe('the toolkit in a match', () => {
  it('the hacker runs a tool at his desk; nobody else receives anything about it', () => {
    const r = new Recorder();
    r.connect('h');
    r.send('h', 'choose', { playerId: 'p4', hacker: true });
    r.connect('e', 'p3'); // Lina, also in the office
    r.sitAt('h', 'p4', 'MKT-LT-11');
    r.type('h', PW['o.farouk']);
    expect(r.type('h', '~/.tools/selftest')).toContain('toolkit OK on MKT-LT-11');
    r.type('h', '~/.tools/selftest --long'); // (cooling down: refused, and still private)
    r.tick(seconds(40));
    const other = JSON.stringify(r.sent.get('e'));
    for (const word of ['selftest', 'toolkit', '.tools', 'cooling']) expect(other.includes(word), word).toBe(false);
    expect(JSON.stringify(r.states)).not.toMatch(/selftest|toolkit/);
  });
});

describe('the server room door without the tailgating weakness', () => {
  /** Khalid (may enter) at the door, Sara (may not) right beside him. */
  function atTheDoor(weaknesses: ('tailgate')[]): Recorder {
    const r = new Recorder({ weaknesses });
    r.connect('k', 'p5');
    r.connect('s', 'p1');
    r.walkToTile('s', 'p1', 47, 5);
    r.walkToTile('k', 'p5', 48, 4);
    r.tick(seconds(4)); // doors they came through have closed
    return r;
  }
  const bothWalkIn = (r: Recorder) => {
    r.send('k', 'tap', { door: 'SRV-ROOM' });
    r.game.handle('k', 'move', { dx: 1, dy: 0 });
    r.game.handle('s', 'move', { dx: 1, dy: 0 });
    r.tick(seconds(2));
    r.send('k', 'move', { dx: 0, dy: 0 });
    r.send('s', 'move', { dx: 0, dy: 0 });
  };

  it('one badge lets one person in: the second is stopped although the door looked open', () => {
    const r = atTheDoor([]);
    r.send('k', 'tap', { door: 'SRV-ROOM' });
    expect(look(r, 'SRV-ROOM')).toBe('open');
    r.game.handle('k', 'move', { dx: 1, dy: 0 });
    r.game.handle('s', 'move', { dx: 1, dy: 0 });
    r.tick(seconds(2));
    expect(r.position('p5').x).toBeGreaterThan(50 * TILE); // Khalid is inside
    expect(r.position('p1').x).toBeLessThan(49 * TILE); // Sara is still in IT
    // The door closed as soon as he was through, not after 3 seconds.
    expect(look(r, 'SRV-ROOM')).toBe('closed');
    expect(doorsLog(r).at(-1)).toMatch(/EVENT=CLOSE OPEN_FOR=[01]\.\ds PASSAGES=1$/);
    expect(queryEvents(r.game.world, { type: 'door.pass', since: START }).filter((e) => e.details.door === 'SRV-ROOM').map((e) => e.actor)).toEqual(['p5']);
  });

  it('he gets out again with his own tap, and she still cannot slip in as he leaves', () => {
    const r = atTheDoor([]);
    bothWalkIn(r);
    r.walkToTile('k', 'p5', 50, 4);
    r.send('k', 'tap', { door: 'SRV-ROOM' });
    r.game.handle('k', 'move', { dx: -1, dy: 0 });
    r.game.handle('s', 'move', { dx: 1, dy: 0 });
    r.tick(seconds(2));
    expect(r.position('p5').x).toBeLessThan(49 * TILE);
    expect(r.position('p1').x).toBeLessThan(49 * TILE);
  });

  it('with the weakness on, the same two walk in together (tailgating)', () => {
    const r = atTheDoor(['tailgate']);
    bothWalkIn(r);
    expect(r.position('p5').x).toBeGreaterThan(50 * TILE);
    expect(r.position('p1').x).toBeGreaterThan(50 * TILE);
    r.tick(seconds(4));
    expect(doorsLog(r).at(-1)).toMatch(/PASSAGES=2$/);
  });

  it('bots cope with the one-person door: nobody gets stuck, and only badge holders get in', () => {
    const r = new Recorder({ bots: true, weaknesses: [] });
    r.tick(minutes(45));
    expect(r.game.bots!.list().filter((b) => b.failure)).toEqual([]);
    const entered = queryEvents(r.game.world, { type: 'door.pass', since: START }).filter((e) => e.details.door === 'SRV-ROOM' && e.details.direction === 'IN');
    for (const e of entered) expect(['k.nasser', 'd.aziz'], e.user).toContain(e.user);
  });
});

describe('the careless sysadmin', () => {
  it('his bot leaves the admin PC open far more often than his colleagues leave theirs', () => {
    const r = new Recorder({ bots: true, weaknesses: ['careless-admin'] });
    r.tick(minutes(90));
    const world = r.game.world;
    const rate = (playerId: string, host: string) => {
      const forgotten = world.unattended.filter((w) => w.host === host && w.ownerPlayer === playerId && w.from > START).length;
      const locked = queryEvents(world, { type: 'session.lock', host, actor: playerId, since: START }).length;
      return forgotten / Math.max(1, forgotten + locked);
    };
    expect(rate('p5', 'IT-WS-02')).toBeGreaterThan(0.55);
    expect(rate('p1', 'FIN-LT-07')).toBeLessThan(0.5);
    expect(world.unattended.filter((w) => w.host === 'IT-WS-02' && w.from > START).length).toBeGreaterThanOrEqual(3);
  }, 30_000);
});

describe('server settings', () => {
  it('a real server picks random weaknesses unless told otherwise', () => {
    expect(loadGameOptions({}).weaknesses).toBe('random');
    expect(loadGameOptions({ weaknesses: 'none' }).weaknesses).toEqual([]);
    expect(loadGameOptions({ weaknesses: 'extra-sudo, tailgate' }).weaknesses).toEqual(['extra-sudo', 'tailgate']);
    expect(() => loadGameOptions({ weaknesses: 'open-bar' })).toThrow('Unknown weakness "open-bar"');
    const r = new Recorder({ weaknesses: 'random' });
    expect(r.game.world.mission.weaknesses.length).toBeGreaterThanOrEqual(2);
  });
});
