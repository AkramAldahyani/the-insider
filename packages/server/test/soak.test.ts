/**
 * Soak test (Phase 3, part G): a full office of bots runs for three game
 * hours, hour by hour, and we check that it stays alive and healthy:
 *
 *  - nobody gets stuck, nobody ends up inside a wall;
 *  - every kind of evidence keeps accumulating, every hour;
 *  - memory stays bounded (the things that are capped really are capped);
 *  - bots never try doors their badge cannot open, and give up on few tasks.
 *
 * Three game hours are 216,000 server ticks; with nothing to draw and no
 * network they run in a few seconds.
 */
import { describe, expect, it } from 'vitest';
import { queryEvents, serializeWorld } from '@insider/engine';
import { PLAYER_RADIUS, TICK_RATE, isFree } from '@insider/shared';
import { Recorder, scenario } from './helpers';

const HOURS = 3;
const TICKS_PER_HOUR = 3600 * TICK_RATE;
const START = Date.parse(scenario.startTime);

/** [machine, file] of every log that must keep growing. */
const LOGS: [string, string][] = [
  ['ADMIN-SRV-01', '/var/log/auth.log'],
  ['ADMIN-SRV-01', '/var/log/mail.log'],
  ['ADMIN-SRV-01', '/var/log/squid/access.log'],
  ['ADMIN-SRV-01', '/var/log/named/queries.log'],
  ['ADMIN-SRV-01', '/var/log/kern.log'],
  ['SEC-SRV-01', '/var/log/badge/access.log'],
  ['SEC-SRV-01', '/var/log/badge/doors.log'],
  ['SEC-SRV-01', '/var/log/cctv/motion.log'],
  ['FIN-LT-07', '/var/log/auth.log'],
  ['FIN-LT-07', '/var/log/syslog'],
  ['IT-WS-02', '/var/log/syslog'],
];

describe('soak: three hours of a living office', () => {
  it('stays alive, keeps producing evidence, and stays within its memory limits', () => {
    const r = new Recorder({ bots: true });
    const lineCount = () => LOGS.map(([host, path]) => r.file(host, path).split('\n').length);
    let lines = lineCount();
    let tasksDone = 0;
    let events = r.game.world.events.length;

    for (let hour = 1; hour <= HOURS; hour++) {
      /** Employees who sat at their own desk during this hour. */
      const worked = new Set<string>();
      for (let tick = 0; tick < TICKS_PER_HOUR; tick++) {
        r.game.tick(1000 / TICK_RATE);
        if (tick % (TICK_RATE * 5) !== 0) continue; // look every 5 seconds
        r.game.drain(); // nobody is listening; do not let messages pile up
        for (const p of Object.values(r.game.publicState().players)) {
          if (!isFree(r.map, p.x, p.y, PLAYER_RADIUS)) throw new Error(`${p.name} is inside something at ${p.x},${p.y} (hour ${hour})`);
          if (p.seatedAt === scenario.players.find((x) => x.id === p.id)!.desk) worked.add(p.id);
        }
      }

      // Everybody is in the building and was at their own desk at some point this hour.
      expect(Object.keys(r.game.publicState().players), `hour ${hour}`).toHaveLength(scenario.players.length);
      expect([...worked].sort(), `hour ${hour}: who worked at their desk`).toEqual(scenario.players.map((p) => p.id).sort());
      // Nobody's last walk ended in failure.
      expect(r.game.bots!.list().filter((b) => b.failure), `hour ${hour}`).toEqual([]);

      // Every log grew this hour.
      const now = lineCount();
      LOGS.forEach(([host, path], i) => expect(now[i], `hour ${hour}: ${host}:${path}`).toBeGreaterThan(lines[i]));
      lines = now;

      // Work got done this hour, and the master log grew.
      const done = scenario.players.reduce((n, p) => n + r.game.tasks.completed(p.id), 0);
      expect(done - tasksDone, `hour ${hour}: tasks finished`).toBeGreaterThanOrEqual(30);
      tasksDone = done;
      expect(r.game.world.events.length).toBeGreaterThan(events);
      events = r.game.world.events.length;
    }

    // ── After three hours ──
    const world = r.game.world;
    expect(world.time).toBe(START + HOURS * 3600_000);
    const since = { since: START };

    // Bots behave: no refused badges, few abandoned tasks, ssh sessions closed again.
    expect(queryEvents(world, { type: 'badge.tap', ...since }).filter((e) => e.details.granted === false)).toEqual([]);
    expect(r.game.tasks.abandoned).toBeLessThanOrEqual(Math.ceil(tasksDone * 0.1));
    expect(queryEvents(world, { type: 'ssh.accept', ...since }).length - queryEvents(world, { type: 'ssh.disconnect', ...since }).length).toBeLessThanOrEqual(3);
    // Screens were locked by hand AND forgotten (then caught by the auto-lock).
    const locks = queryEvents(world, { type: 'session.lock', ...since });
    expect(locks.filter((e) => e.details.via === 'loginctl').length).toBeGreaterThan(30);
    expect(locks.filter((e) => e.details.via === 'idle').length).toBeGreaterThan(5);
    // Tailgating happened naturally now and then: more bodies through badge doors than granted taps.
    const taps = queryEvents(world, { type: 'badge.tap', ...since }).length;
    const passes = queryEvents(world, { type: 'door.pass', ...since }).filter((e) => r.map.doors.find((d) => d.code === e.details.door)?.reader).length;
    expect(passes).toBeGreaterThan(taps * 0.8);

    // Memory: capped things are capped, and the whole world is still a modest size.
    for (const player of scenario.players) expect(r.game.bots!.observations(player.id).length).toBeLessThanOrEqual(300);
    for (const camera of r.game.cctv.cameras) expect(r.game.cctv.recording(camera.id).length).toBeLessThanOrEqual(6000);
    expect(Object.keys(world.sessions).length).toBeLessThan(400);
    expect(world.events.length).toBeLessThan(120_000);
    expect(serializeWorld(world).length).toBeLessThan(60_000_000);
  }, 120_000);
});
