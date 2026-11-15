/** "Who and where am I?" commands. */
import { findUser, getCred, gidOf, uidOf } from '../auth/accounts';
import { dateStamp, hhmmss, DAY, HOUR, MINUTE } from '../core/time';
import { fqdn } from '../net/dns';
import type { Host, World } from '../types';
import type { Handler } from './types';
import { fail } from './types';

const whoami: Handler = (c) => ({ stdout: `${c.cred.user}\n` });

const id: Handler = (c, args) => {
  const user = args.find((a) => !a.startsWith('-')) ?? c.cred.user;
  const entry = findUser(c.host, user);
  if (!entry) return fail(`id: ‘${user}’: no such user`);
  const cred = getCred(c.host, user);
  const groups = cred.groups.map((g) => `${gidOf(c.host, g) ?? '?'}(${g})`);
  return { stdout: `uid=${entry.uid}(${user}) gid=${groups[0]} groups=${groups.join(',')}\n` };
};

const groups: Handler = (c, args) => {
  const user = args[0] ?? c.cred.user;
  if (uidOf(c.host, user) === null) return fail(`groups: ‘${user}’: no such user`);
  const list = getCred(c.host, user).groups.join(' ');
  return { stdout: args[0] ? `${user} : ${list}\n` : `${list}\n` };
};

const hostname: Handler = (c, args) => {
  if (args.includes('-I') || args.includes('-i')) return { stdout: `${c.host.ip} \n` };
  if (args.includes('-f')) return { stdout: `${fqdn(c.world, c.host)}\n` };
  return { stdout: `${c.host.hostname}\n` };
};

const uname: Handler = (c, args) => {
  if (args.some((a) => a.includes('a'))) {
    return { stdout: `Linux ${c.host.hostname} 5.15.0-105-generic #115-Ubuntu SMP Mon Apr 15 09:52:04 UTC 2024 x86_64 x86_64 x86_64 GNU/Linux\n` };
  }
  if (args.includes('-r')) return { stdout: '5.15.0-105-generic\n' };
  if (args.includes('-n')) return { stdout: `${c.host.hostname}\n` };
  return { stdout: 'Linux\n' };
};

const date: Handler = (c) => ({ stdout: `${dateStamp(c.world.time)}\n` });

/** The first line of `uptime` and `w`: " 09:15:02 up 3 days,  1:13,  2 users,  load average: ..." */
export function uptimeLine(world: World, host: Host): string {
  const up = world.time - host.bootTime;
  const days = Math.floor(up / DAY);
  const hours = Math.floor((up % DAY) / HOUR);
  const mins = Math.floor((up % HOUR) / MINUTE);
  let text = '';
  if (days > 0) text += `${days} day${days > 1 ? 's' : ''}, `;
  text += hours > 0 ? `${String(hours).padStart(2)}:${String(mins).padStart(2, '0')}` : `${mins} min`;
  const users = host.wtmp.filter((w) => w.logout === null && w.user !== 'reboot').length;
  // The "load" is cosmetic: derived from the number of processes so it is stable.
  const load = (host.processes.length % 17) / 100;
  return ` ${hhmmss(world.time)} up ${text},  ${users} user${users === 1 ? '' : 's'},  load average: ${load.toFixed(2)}, ${(load * 0.7).toFixed(2)}, ${(load * 0.4).toFixed(2)}\n`;
}

const uptime: Handler = (c) => ({ stdout: uptimeLine(c.world, c.host) });

/** `true` always succeeds and `false` always fails - handy with && and ||. */
const yes: Handler = () => ({});
const no: Handler = () => ({ exit: 1 });

export const identityCommands: Record<string, Handler> = { whoami, id, groups, hostname, uname, date, uptime, true: yes, false: no };
