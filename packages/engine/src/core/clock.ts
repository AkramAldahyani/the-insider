/**
 * The game clock.
 *
 * Time never moves by itself: the caller (CLI, tests, later the game server)
 * decides when and by how much. That keeps the engine deterministic.
 *
 * While time moves forward, a few background things happen at their exact
 * moments so logs get correct timestamps:
 *  - every hour at :17 cron runs its hourly job on each machine (log noise);
 *  - online machines renew their DHCP lease halfway through it.
 */
import { syslog, pidOf } from '../events/journal';
import { dhcpRequest, expireLeases } from '../net/dhcp';
import { allocPid } from '../proc/processes';
import type { World } from '../types';
import { HOUR, MINUTE } from './time';

const CRON_MINUTE = 17 * MINUTE;

function nextCronTick(after: number): number {
  return (Math.floor((after - CRON_MINUTE) / HOUR) + 1) * HOUR + CRON_MINUTE;
}

function runCron(world: World): void {
  for (const host of Object.values(world.hosts)) {
    if (!host.online || !pidOf(host, '/usr/sbin/cron')) continue;
    const pid = allocPid(world, host);
    syslog(world, host, 'CRON', pid, 'pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)', 'auth');
    syslog(world, host, 'CRON', pid, '(root) CMD (   cd / && run-parts --report /etc/cron.hourly)');
    syslog(world, host, 'CRON', pid, 'pam_unix(cron:session): session closed for user root', 'auth');
  }
}

/** Moves the clock to an absolute time, running scheduled background work on the way. */
export function advanceTo(world: World, target: number): void {
  if (target < world.time) throw new Error('Game time cannot go backwards');
  for (;;) {
    // Find the earliest scheduled thing that happens before `target`.
    let when = nextCronTick(world.time);
    let action: () => void = () => runCron(world);
    for (const lease of world.dhcp.leases) {
      const host = world.hosts[lease.hostname];
      if (lease.end !== null || !host?.online) continue;
      const renewAt = lease.lastRenew + world.dhcp.leaseMs / 2;
      if (renewAt < when) {
        when = Math.max(renewAt, world.time);
        action = () => dhcpRequest(world, host);
      }
    }
    if (when > target) break;
    world.time = when;
    action();
  }
  world.time = target;
  expireLeases(world);
}

/** Moves the clock forward by `ms` milliseconds of game time. */
export function advanceTime(world: World, ms: number): void {
  advanceTo(world, world.time + Math.max(0, ms));
}
