/**
 * Writes one log line on a host, in all the places a real Linux box keeps it:
 *  - the system journal (what `journalctl` and `dmesg` show)
 *  - the text files under /var/log (auth.log, syslog, kern.log)
 *
 * The log FILES are ordinary files in the virtual filesystem, so `cat`, `grep`
 * and `tail` work on them - and a later "log cleaner" tool can delete lines.
 */
import { syslogStamp } from '../core/time';
import { sysWrite } from '../fs/vfs';
import type { Host, World } from '../types';

export type Facility = 'auth' | 'daemon' | 'kernel';

export function syslog(
  world: World,
  host: Host,
  ident: string,
  pid: number | null,
  message: string,
  facility: Facility = 'daemon',
): void {
  const time = world.time;
  host.journal.push({ time, ident, pid, message, kernel: facility === 'kernel' });

  const tag = pid === null ? ident : `${ident}[${pid}]`;
  let text: string;
  if (facility === 'kernel') {
    const secs = ((time - host.bootTime) / 1000).toFixed(6).padStart(12, ' ');
    text = `${syslogStamp(time)} ${host.hostname} kernel: [${secs}] ${message}\n`;
  } else {
    text = `${syslogStamp(time)} ${host.hostname} ${tag}: ${message}\n`;
  }

  // Log files are root:adm 640 - readable by root and members of group "adm".
  const opts = { owner: 'syslog', group: 'adm', mode: 0o640, time, append: true };
  if (facility === 'auth') sysWrite(host, '/var/log/auth.log', text, opts);
  else sysWrite(host, '/var/log/syslog', text, opts);
  if (facility === 'kernel') sysWrite(host, '/var/log/kern.log', text, opts);
}

/** pid of the first process whose command contains `needle` (0 if not running). */
export function pidOf(host: Host, needle: string): number {
  return host.processes.find((p) => p.command.includes(needle))?.pid ?? 0;
}
