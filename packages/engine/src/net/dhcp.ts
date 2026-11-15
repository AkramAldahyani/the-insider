/**
 * Simulated DHCP server.
 *
 * The important part for the game is the lease HISTORY: "which MAC address had
 * which IP, from when until when". A log line only ever shows an IP address,
 * and an IP is not a person - defenders must go IP -> MAC -> machine -> desk.
 * So leases are never deleted; ended ones just get an `end` time.
 */
import { randInt } from '../core/rng';
import { syslogStamp } from '../core/time';
import { emit } from '../events/log';
import { sysWrite } from '../fs/vfs';
import type { Host, Lease, World } from '../types';

/** The lease currently held by this MAC address, if any. */
export function activeLease(world: World, mac: string): Lease | undefined {
  return world.dhcp.leases.find((l) => l.mac === mac && l.end === null);
}

function ipInUse(world: World, ip: string): boolean {
  return world.dhcp.leases.some((l) => l.ip === ip && l.end === null);
}

/** Picks an address for a new client. */
function chooseIp(world: World, mac: string): string {
  const { prefix, rangeStart, rangeEnd, leases } = world.dhcp;
  // Real DHCP servers try to give a returning client its previous address.
  for (let i = leases.length - 1; i >= 0; i--) {
    if (leases[i].mac === mac && !ipInUse(world, leases[i].ip)) return leases[i].ip;
  }
  for (let tries = 0; tries < 50; tries++) {
    const ip = prefix + randInt(world, rangeStart, rangeEnd);
    if (!ipInUse(world, ip)) return ip;
  }
  for (let n = rangeStart; n <= rangeEnd; n++) {
    if (!ipInUse(world, prefix + n)) return prefix + n;
  }
  throw new Error('DHCP pool exhausted');
}

/**
 * A host asks for an address (at boot) or renews the one it has.
 * Updates `host.ip`, records the lease and returns the IP.
 */
export function dhcpRequest(world: World, host: Host): string {
  const now = world.time;
  let lease = activeLease(world, host.mac);
  const kind = lease ? 'renew' : 'new';
  if (lease) {
    lease.lastRenew = now;
    lease.expires = now + world.dhcp.leaseMs;
  } else {
    lease = {
      ip: chooseIp(world, host.mac),
      mac: host.mac,
      hostname: host.hostname,
      start: now,
      end: null,
      lastRenew: now,
      expires: now + world.dhcp.leaseMs,
    };
    world.dhcp.leases.push(lease);
  }
  host.ip = lease.ip;
  emit(world, { host: host.hostname, user: 'root', type: 'dhcp.ack', details: { ip: lease.ip, mac: host.mac, kind } });
  writeLeasesFile(world);
  return lease.ip;
}

/** The host gives its address back (shutdown, cable unplugged, ...). */
export function dhcpRelease(world: World, host: Host): void {
  const lease = activeLease(world, host.mac);
  if (!lease) return;
  lease.end = world.time;
  emit(world, { host: host.hostname, user: 'root', type: 'dhcp.release', details: { ip: lease.ip, mac: host.mac } });
  host.ip = '';
  writeLeasesFile(world);
}

/** Ends leases that ran out because their machine is switched off. */
export function expireLeases(world: World): void {
  let changed = false;
  for (const lease of world.dhcp.leases) {
    if (lease.end === null && lease.expires <= world.time && !world.hosts[lease.hostname]?.online) {
      lease.end = lease.expires;
      changed = true;
    }
  }
  if (changed) writeLeasesFile(world);
}

/** Evidence query: who held this IP at that moment? */
export function leaseHolderAt(world: World, ip: string, time: number): Lease | undefined {
  return world.dhcp.leases.find((l) => l.ip === ip && l.start <= time && (l.end === null || time < l.end));
}

/** Evidence query: all leases (oldest first) matching the given fields. */
export function leaseHistory(world: World, filter: { ip?: string; mac?: string; hostname?: string } = {}): Lease[] {
  return world.dhcp.leases.filter(
    (l) =>
      (!filter.ip || l.ip === filter.ip) &&
      (!filter.mac || l.mac === filter.mac) &&
      (!filter.hostname || l.hostname === filter.hostname),
  );
}

/**
 * Rewrites /var/lib/dhcp/dhcpd.leases on the DHCP server so that a sysadmin
 * can read the lease history with `cat`, like on a real ISC dhcpd.
 */
export function writeLeasesFile(world: World): void {
  const server = world.hosts[world.dhcp.serverHost];
  if (!server) return;
  let text = '# The format of this file is documented in the dhcpd.leases(5) manual page.\n# All times are UTC.\n\n';
  for (const l of world.dhcp.leases) {
    text += `lease ${l.ip} {\n`;
    text += `  starts ${syslogStamp(l.start)};\n`;
    text += `  ends ${syslogStamp(l.end ?? l.expires)};\n`;
    text += `  binding state ${l.end === null ? 'active' : 'free'};\n`;
    text += `  hardware ethernet ${l.mac};\n`;
    text += `  client-hostname "${l.hostname}";\n}\n`;
  }
  sysWrite(server, '/var/lib/dhcp/dhcpd.leases', text, { owner: 'dhcpd', group: 'dhcpd', mode: 0o644, time: world.time });
}
