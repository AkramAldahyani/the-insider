/**
 * Bot employees (Phase 3, part B): route finding, walking, doors, and the
 * rule that a bot must look exactly like a human to every browser.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, PLAYER_SPEED, TICK_RATE, findPath, isFree, parseOfficeMap, type PublicState } from '@insider/shared';
import { Mover } from '../src/bots/mover';
import { Random } from '../src/bots/random';
import type { Avatar } from '../src/visibility';
import { Recorder, scenario, tiledMap } from './helpers';

const TILE = 32;
const centre = (col: number, row: number) => ({ x: (col + 0.5) * TILE, y: (row + 0.5) * TILE });
const seconds = (s: number) => s * TICK_RATE;
const accessToday = (r: Recorder) => r.file('SEC-SRV-01', '/var/log/badge/access.log').split('\n').filter((l) => l.startsWith('2026-03-02'));

describe('route finding', () => {
  const map = parseOfficeMap(tiledMap);

  it('finds a route around walls, made of straight stretches, ending exactly at the target', () => {
    const from = centre(10, 6); // in Finance
    const to = map.desks.find((d) => d.hostname === 'HR-LT-03')!;
    const path = findPath(map, from.x, from.y, to.seatX, to.seatY)!;
    expect(path.at(-1)).toEqual({ x: to.seatX, y: to.seatY });
    // Every stretch is horizontal or vertical and crosses only free tiles.
    let at = from;
    for (const point of path.slice(0, -1)) {
      expect(at.x === point.x || at.y === point.y).toBe(true);
      const steps = Math.max(Math.abs(point.x - at.x), Math.abs(point.y - at.y)) / TILE;
      for (let i = 0; i <= steps; i++) {
        const x = at.x + ((point.x - at.x) / (steps || 1)) * i;
        const y = at.y + ((point.y - at.y) / (steps || 1)) * i;
        expect(map.solid[Math.floor(y / TILE)][Math.floor(x / TILE)]).toBe(false);
      }
      at = point;
    }
    // Finance -> corridor -> HR needs only a handful of corners.
    expect(path.length).toBeLessThanOrEqual(8);
  });

  it('returns null when the target is inside a wall or cannot be reached', () => {
    expect(findPath(map, centre(10, 6).x, centre(10, 6).y, 0, 0)).toBeNull(); // the outer wall
    // With the Finance doorway declared off-limits there is no way out of Finance.
    const avoid = (col: number, row: number) => row === 13 && (col === 7 || col === 8);
    expect(findPath(map, centre(10, 6).x, centre(10, 6).y, centre(20, 15).x, centre(20, 15).y, avoid)).toBeNull();
  });
});

describe('bots walking', () => {
  /** A game with one hand-made bot body, to test walking on its own. */
  function loneWalker(playerId: string, col: number, row: number) {
    const r = new Recorder();
    const player = r.game.world.players.find((p) => p.id === playerId)!;
    const body: Avatar = { clientId: `bot:${playerId}`, playerId, account: player.account, name: player.name, ...centre(col, row), facing: 'up', seatedAt: '', terminalId: '', dx: 0, dy: 0 };
    const game = r.game as unknown as { avatars: Map<string, Avatar>; collision: typeof r.map; walker(a: Avatar): never };
    game.avatars.set(body.clientId, body);
    const mayEnter = (a: Avatar, d: { restricted: boolean; zone: string }) => !d.restricted || r.game.world.badges.holders[a.account].access.includes(d.zone);
    const mover = new Mover(body, { map: r.map, collision: game.collision, doors: r.game.doors, walker: (a) => game.walker(a), mayEnter }, new Random(7));
    const run = (maxSeconds: number) => {
      for (let i = 0; i < seconds(maxSeconds) && mover.state === 'walking'; i++) {
        mover.update(1000 / TICK_RATE);
        r.tick();
      }
    };
    return { r, body, mover, run };
  }

  it('a bot walks at human speed and never through a wall, desk or closed door', () => {
    const { r, body, mover, run } = loneWalker('p1', 10, 6);
    const desk = r.map.desks.find((d) => d.hostname === 'HR-LT-03')!;
    expect(mover.goTo(desk.seatX, desk.seatY)).toBe(true);
    const maxStep = PLAYER_SPEED / TICK_RATE + 0.01;
    let last = { x: body.x, y: body.y };
    let ticks = 0;
    while (mover.state === 'walking' && ticks++ < seconds(60)) {
      mover.update(1000 / TICK_RATE);
      r.tick();
      expect(Math.hypot(body.x - last.x, body.y - last.y)).toBeLessThanOrEqual(maxStep);
      expect(isFree(r.map, body.x, body.y, PLAYER_RADIUS)).toBe(true);
      last = { x: body.x, y: body.y };
    }
    expect(mover.state).toBe('arrived');
    expect(body).toMatchObject({ x: desk.seatX, y: desk.seatY });
    // It tapped its badge at both doors on the way, like a person.
    expect(accessToday(r).map((l) => l.replace(/^\S+ \S+ /, ''))).toEqual([
      'DOOR=FIN BADGE=0412 USER=s.alharbi RESULT=GRANTED DIR=OUT',
      'DOOR=HR BADGE=0412 USER=s.alharbi RESULT=GRANTED DIR=IN',
    ]);
  });

  it('a bot whose badge opens the server room walks in; one whose badge does not, does not try', () => {
    const server = parseOfficeMap(tiledMap).desks.find((d) => d.hostname === 'ADMIN-SRV-01')!;
    const khalid = loneWalker('p5', 47, 6);
    expect(khalid.mover.goTo(server.seatX, server.seatY)).toBe(true);
    khalid.run(30);
    expect(khalid.mover.state).toBe('arrived');
    expect(accessToday(khalid.r).at(-1)).toMatch(/DOOR=SRV-ROOM BADGE=0107 USER=k\.nasser RESULT=GRANTED DIR=IN$/);

    const sara = loneWalker('p1', 47, 6);
    expect(sara.mover.goTo(server.seatX, server.seatY)).toBe(false);
    expect(sara.mover).toMatchObject({ state: 'failed', failure: 'no-route' });
    expect(accessToday(sara.r)).toEqual([]); // she never rattled the door
  });

  it('a bot let into a restricted room by someone else can still leave', () => {
    const { r, body, mover, run } = loneWalker('p1', 51, 5); // Sara, placed inside the server room
    expect(mover.goTo(centre(45, 8).x, centre(45, 8).y)).toBe(true);
    run(30);
    expect(mover.state).toBe('arrived');
    expect(body.x).toBeLessThan(49 * TILE);
    expect(accessToday(r).at(-1)).toMatch(/DOOR=SRV-ROOM BADGE=0412 USER=s\.alharbi RESULT=GRANTED DIR=OUT$/);
  });
});

describe('bot employees in a match', () => {
  it('every employee comes in through the main entrance and reaches their own desk', () => {
    const r = new Recorder({ bots: true });
    expect(Object.keys(r.game.publicState().players)).toEqual([]); // nobody has arrived at 09:00:00
    /** Employees who have sat down at their own desk at least once. */
    const reached = new Set<string>();
    let ticks = 0;
    while (ticks++ < seconds(420) && reached.size < scenario.players.length) {
      r.game.tick(1000 / TICK_RATE);
      if (ticks % 5 !== 0) continue;
      for (const p of Object.values(r.game.publicState().players)) {
        // Nobody is ever inside a wall, a desk or furniture.
        expect(isFree(r.map, p.x, p.y, PLAYER_RADIUS), p.name).toBe(true);
        if (p.seatedAt === scenario.players.find((x) => x.id === p.id)!.desk) reached.add(p.id);
      }
    }
    expect([...reached].sort()).toEqual(scenario.players.map((p) => p.id).sort());
    expect(r.game.bots!.list().filter((b) => b.failure)).toEqual([]);

    const taps = accessToday(r);
    expect(taps.some((l) => l.includes('RESULT=DENIED'))).toBe(false); // bots do not try doors their badge cannot open
    // Arrivals: most badge in; a few walk in behind a colleague while the door is open.
    const arrivals = taps.filter((l) => l.includes('DOOR=MAIN-ENT') && l.endsWith('DIR=IN'));
    expect(arrivals.length).toBeGreaterThanOrEqual(6);
    expect(new Set(arrivals.map((l) => /USER=(\S+)/.exec(l)![1])).size).toBe(arrivals.length); // nobody arrived twice
    expect(taps.some((l) => /DOOR=SEC-OFFICE BADGE=0119 USER=t\.omar RESULT=GRANTED DIR=IN$/.test(l))).toBe(true);
    // The door log's body count is at least the number of taps: everyone who came in was counted.
    const passages = r.file('SEC-SRV-01', '/var/log/badge/doors.log').split('\n')
      .filter((l) => l.startsWith('2026-03-02') && l.includes('DOOR=MAIN-ENT EVENT=CLOSE'))
      .reduce((sum, l) => sum + Number(/PASSAGES=(\d+)/.exec(l)![1]), 0);
    expect(passages).toBe(10);
  });

  it('a browser cannot tell a bot from a human', () => {
    const r = new Recorder({ bots: true });
    r.connect('a', 'p1');
    r.tick(seconds(120));
    const state = r.game.publicState();
    const players = Object.values(state.players);
    expect(players.length).toBeGreaterThan(3);
    // Same fields for everyone, and no value anywhere that marks a bot.
    for (const p of players) expect(Object.keys(p).sort()).toEqual(['activity', 'facing', 'id', 'name', 'seatedAt', 'x', 'y']);
    const everything = JSON.stringify({ states: r.states as PublicState[], sent: [...r.sent.values()] }).toLowerCase();
    expect(everything).not.toContain('bot');
    // Positions are rounded the same way for humans and bots (one decimal).
    for (const p of players) expect(Math.round(p.x * 10) / 10).toBe(p.x);
  });

  it('an employee played by a bot can still be picked; the human takes over', () => {
    const r = new Recorder({ bots: true });
    r.tick(seconds(250)); // everyone has arrived
    expect(r.game.publicState().players.p3).toBeDefined(); // Lina, a bot
    r.connect('a');
    const lobby = r.last('a', 'lobby')!.payload as { employees: { id: string; taken: boolean }[] };
    expect(lobby.employees.every((e) => !e.taken)).toBe(true); // "taken" would give the bots away

    r.send('a', 'choose', { playerId: 'p3' });
    expect(r.last('a', 'welcome')).toBeDefined();
    expect(r.game.bots!.has('p3')).toBe(false);
    const spawn = r.map.spawns['HR-LT-03'];
    expect(r.game.publicState().players.p3).toMatchObject({ x: spawn.x, y: spawn.y, seatedAt: '' }); // one Lina, next to her desk
    expect(Object.keys(r.game.publicState().players)).toHaveLength(10);

    // When the human leaves, a bot comes to work as Lina again.
    r.game.disconnect('a');
    expect(r.game.publicState().players.p3).toBeUndefined();
    expect(r.game.bots!.has('p3')).toBe(true);
    r.tick(seconds(250));
    expect(r.game.publicState().players.p3).toBeDefined();
  });

  it('the same seed gives the same morning', () => {
    const run = () => {
      const r = new Recorder({ bots: true });
      r.tick(seconds(90));
      return JSON.stringify(r.game.publicState().players) + accessToday(r).join('\n');
    };
    expect(run()).toBe(run());
  });

  it('an office can run without bots', () => {
    const r = new Recorder({ bots: false });
    r.tick(seconds(300));
    expect(Object.keys(r.game.publicState().players)).toEqual([]);
  });
});
