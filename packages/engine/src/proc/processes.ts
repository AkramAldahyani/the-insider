/**
 * The per-host process table (what `ps aux` shows).
 * Processes here are just records - nothing actually runs. They exist so that
 * defenders can spot things (an odd process, someone's ssh session) and so
 * that `kill` has something to act on.
 */
import { randInt } from '../core/rng';
import type { Host, Process, World } from '../types';

/** Hands out the next pid. Small random gaps make the numbers look natural. */
export function allocPid(world: World, host: Host): number {
  host.nextPid += randInt(world, 1, 4);
  return host.nextPid;
}

export interface SpawnInput {
  user: string;
  command: string;
  tty?: string;
  stat?: string;
  sessionId?: string;
  vsz?: number;
  rss?: number;
}

export function spawn(world: World, host: Host, input: SpawnInput): Process {
  const proc: Process = {
    pid: allocPid(world, host),
    user: input.user,
    tty: input.tty ?? '?',
    start: world.time,
    command: input.command,
    stat: input.stat ?? 'Ss',
    vsz: input.vsz ?? randInt(world, 6000, 20000),
    rss: input.rss ?? randInt(world, 1500, 9000),
  };
  if (input.sessionId) proc.sessionId = input.sessionId;
  host.processes.push(proc);
  return proc;
}

export function removeProcess(host: Host, pid: number): void {
  host.processes = host.processes.filter((p) => p.pid !== pid);
  // A dead daemon stops listening.
  host.services = host.services.filter((s) => s.pid !== pid);
}

/** Creates the processes every freshly booted Linux machine has. */
export function bootProcesses(world: World, host: Host): void {
  host.processes = [];
  host.services = [];
  host.nextPid = 0;
  const sys = (user: string, command: string, stat = 'Ss', vsz?: number, rss?: number) =>
    spawn(world, host, { user, command, stat, vsz, rss });

  // pid 1 and kernel threads (shown in [brackets], they use no memory)
  host.nextPid = 0;
  host.processes.push({ pid: 1, user: 'root', tty: '?', start: world.time, command: '/sbin/init splash', stat: 'Ss', vsz: 167744, rss: 11532 });
  host.nextPid = 1;
  for (const k of ['[kthreadd]', '[rcu_gp]', '[kworker/0:0H-events_highpri]', '[ksoftirqd/0]', '[rcu_sched]', '[migration/0]', '[kswapd0]', '[kworker/0:1-events]']) {
    sys('root', k, 'I<', 0, 0);
  }
  host.nextPid = randInt(world, 280, 330);
  sys('root', '/lib/systemd/systemd-journald', 'Ss', 64932, 18200);
  sys('root', '/lib/systemd/systemd-udevd', 'Ss', 23720, 6100);
  host.nextPid += randInt(world, 150, 250);
  sys('systemd-resolve', '/lib/systemd/systemd-resolved', 'Ss', 25536, 12400);
  sys('systemd-timesync', '/lib/systemd/systemd-timesyncd', 'Ssl', 89360, 6400);
  sys('messagebus', '@dbus-daemon --system --address=systemd: --nofork --nopidfile --systemd-activation --syslog-only', 'Ss', 8756, 4800);
  if (host.kind === 'workstation') sys('root', '/usr/sbin/NetworkManager --no-daemon', 'Ssl', 259540, 17300);
  sys('syslog', '/usr/sbin/rsyslogd -n -iNONE', 'Ssl', 222404, 5300);
  sys('root', '/lib/systemd/systemd-logind', 'Ss', 15332, 7400);
  sys('root', '/usr/sbin/cron -f -P', 'Ss', 6896, 2900);
  const sshd = sys('root', 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', 'Ss', 15436, 9100);
  host.services.push({ port: 22, program: 'sshd', pid: sshd.pid });

  if (host.kind === 'server') {
    sys('root', '/sbin/agetty -o -p -- \\u --noclear tty1 linux', 'Ss+', 6176, 1100).tty = 'tty1';
  }
  // The machine that hands out IP addresses and answers DNS runs two more daemons.
  if (host.hostname === world.dhcp.serverHost) {
    sys('dhcpd', '/usr/sbin/dhcpd -user dhcpd -group dhcpd -f -4 -pf /run/dhcp-server/dhcpd.pid -cf /etc/dhcp/dhcpd.conf eth0', 'Ss', 17844, 9900);
  }
  if (host.hostname === world.dnsServer) {
    const named = sys('bind', '/usr/sbin/named -f -u bind', 'Ssl', 320120, 41800);
    host.services.push({ port: 53, program: 'named', pid: named.pid });
  }
}
