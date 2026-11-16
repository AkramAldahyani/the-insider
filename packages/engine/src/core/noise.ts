/**
 * Background noise: what machines write into their logs when nobody is
 * doing anything.
 *
 * Real logs are never quiet. Clocks get synchronised, timers fire, machines
 * ask for software updates. If our logs only contained what players did, the
 * hacker's lines would be the only ones and investigating would be trivial.
 * (DESIGN.md section 10: "logs are never suspiciously clean".)
 *
 * HOW IT IS SCHEDULED. Each machine has a few "sources", each with a period.
 * A source fires at  phase + k x period,  where the phase is derived from the
 * machine's name, so the machines do not all write at the same second. There
 * is no stored timetable: the next firing time is computed from the clock.
 *
 * Noise starts when the match starts (`world.noise.from`). During the replay
 * of the scenario's history it is off, which keeps world creation fast and
 * keeps the random numbers drawn there exactly as they were.
 *
 * Nothing here uses the random generator: which message appears is derived
 * from the time and the machine's name.
 */
import { syslog } from '../events/journal';
import { emit } from '../events/log';
import { hashString } from './rng';
import { MINUTE } from './time';
import type { Host, World } from '../types';

interface Source {
  name: string;
  periodMs: number;
  applies(world: World, host: Host): boolean;
  run(world: World, host: Host, tick: number): void;
}

const SYSTEMD_LINES = [
  'Starting Cleanup of Temporary Directories...',
  'systemd-tmpfiles-clean.service: Deactivated successfully.',
  'Started Run anacron jobs.',
  'anacron.service: Deactivated successfully.',
  'Starting Message of the Day...',
  'motd-news.service: Deactivated successfully.',
  'Starting Refresh fwupd metadata and update motd...',
  'fwupd-refresh.service: Deactivated successfully.',
];

const SOURCES: Source[] = [
  {
    // Every machine keeps its clock in step with the time server (the DNS/DHCP server).
    name: 'timesync',
    periodMs: 16 * MINUTE,
    applies: (world, host) => host.hostname !== world.dnsServer,
    run: (world, host) => {
      const server = world.hosts[world.dnsServer];
      syslog(world, host, 'systemd-timesyncd', 400 + (hashString(host.hostname) % 150), `Contacted time server ${server?.ip ?? '10.0.1.10'}:123 (${world.dnsServer}).`);
    },
  },
  {
    name: 'systemd',
    periodMs: 11 * MINUTE,
    applies: () => true,
    run: (world, host, tick) => syslog(world, host, 'systemd', 1, SYSTEMD_LINES[(tick + hashString(host.hostname)) % SYSTEMD_LINES.length]),
  },
  {
    // Workstations look for software updates: a DNS query and a web request, with no person involved.
    name: 'updates',
    periodMs: 23 * MINUTE,
    applies: (world, host) => host.kind === 'workstation' && world.web.updateSite !== '',
    run: (world, host, tick) => {
      const site = world.web.sites.find((s) => s.host === world.web.updateSite);
      if (!site) return;
      emit(world, { host: host.hostname, user: '', type: 'dns.query', details: { name: site.host, found: true, ip: site.ip } });
      emit(world, {
        host: host.hostname, user: '', type: 'web.request',
        details: { method: 'GET', url: `http://${site.host}/ubuntu/dists/jammy/InRelease`, site: site.host, ip: site.ip, status: tick % 5 === 0 ? 200 : 304, bytes: tick % 5 === 0 ? 270087 : 0, ms: 40 + (hashString(host.hostname, tick) % 180), agent: 'apt' },
      });
    },
  },
];

/** When does this source next fire on this host, strictly after `after`? */
function nextFire(world: World, host: Host, source: Source, after: number): number {
  const phase = (world.noise.from as number) + (hashString(`${host.hostname}/${source.name}`) % source.periodMs);
  const k = Math.max(0, Math.floor((after - phase) / source.periodMs) + 1);
  return phase + k * source.periodMs;
}

/**
 * The next moment at which some noise is due (after everything already
 * done), and a function that produces it. Called by the clock.
 */
export function nextNoise(world: World): { when: number; run: () => void } {
  let when = Infinity;
  const due: { host: Host; source: Source }[] = [];
  if (world.noise.from !== null) {
    for (const host of Object.values(world.hosts)) {
      if (!host.online) continue;
      for (const source of SOURCES) {
        if (!source.applies(world, host)) continue;
        const at = nextFire(world, host, source, world.noise.done);
        if (at < when) {
          when = at;
          due.length = 0;
        }
        if (at === when) due.push({ host, source });
      }
    }
  }
  return {
    when,
    run: () => {
      for (const { host, source } of due) source.run(world, host, Math.floor((when - world.noise.from!) / source.periodMs));
      world.noise.done = when;
    },
  };
}
