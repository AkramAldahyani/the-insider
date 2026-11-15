/** Log viewers: journalctl, dmesg, crontab. */
import { journalStamp } from '../core/time';
import { getNode } from '../fs/vfs';
import type { Handler } from './types';
import { fail } from './types';
import { parseArgs } from './util';

/**
 * journalctl: the system journal.
 * Supported: -n N (last N lines), -u UNIT / -t TAG (filter by program),
 * -k (kernel only), -r (newest first), -g TEXT (filter by text).
 * Like real systemd, only root and members of "adm"/"systemd-journal" may read it.
 */
const journalctl: Handler = (c, args) => {
  const { flags, values } = parseArgs(args, 'nutgSUp');
  const privileged = c.cred.user === 'root' || c.cred.groups.includes('adm') || c.cred.groups.includes('systemd-journal');
  if (!privileged) {
    return {
      stderr:
        'Hint: You are currently not seeing messages from other users and the system.\n' +
        "      Users in groups 'adm', 'systemd-journal' can see all messages.\n" +
        '      Pass -q to turn off this notice.\n',
      stdout: '-- No entries --\n',
    };
  }
  let entries = c.host.journal;
  if (flags.has('k')) entries = entries.filter((e) => e.kernel);
  const unit = values.u ?? values.t;
  if (unit) {
    const wanted = unit.replace(/\.service$/, '');
    // "ssh" and "sshd" are the same service on Ubuntu
    entries = entries.filter((e) => e.ident === wanted || e.ident.replace(/d$/, '') === wanted.replace(/d$/, ''));
  }
  if (values.g) entries = entries.filter((e) => e.message.toLowerCase().includes(values.g.toLowerCase()));
  if (values.n !== undefined) {
    const n = parseInt(values.n, 10);
    if (Number.isNaN(n)) return fail(`Failed to parse lines '${values.n}'`);
    entries = n === 0 ? [] : entries.slice(-n);
  }
  if (flags.has('r')) entries = [...entries].reverse();
  if (entries.length === 0) return { stdout: '-- No entries --\n' };
  const out = entries
    .map((e) => `${journalStamp(e.time)} ${c.host.hostname} ${e.ident}${e.pid === null ? '' : `[${e.pid}]`}: ${e.message}\n`)
    .join('');
  return { stdout: out };
};

/**
 * dmesg: kernel messages since boot (hardware, USB devices, network link...).
 * NOTE: real Ubuntu restricts dmesg to root. We allow everyone on purpose so
 * that ordinary employees can check their own PC for USB events (game design).
 */
const dmesg: Handler = (c) => {
  const out = c.host.journal
    .filter((e) => e.kernel)
    .map((e) => `[${((e.time - c.host.bootTime) / 1000).toFixed(6).padStart(12)}] ${e.message}\n`)
    .join('');
  return { stdout: out };
};

/** crontab -l: show a user's scheduled jobs (stored in /var/spool/cron/crontabs/<user>). */
const crontab: Handler = (c, args) => {
  const { flags, values } = parseArgs(args, 'u');
  const user = values.u ?? c.cred.user;
  if (values.u && c.cred.user !== 'root' && values.u !== c.cred.user) return fail('must be privileged to use -u');
  if (flags.has('e') || flags.has('r')) return fail('crontab: editing crontabs is not supported in this simulation yet');
  if (!flags.has('l')) return fail('usage:\tcrontab [-u user] file\n\tcrontab [ -u user ] [ -i ] { -e | -l | -r }');
  const node = getNode(c.host, `/var/spool/cron/crontabs/${user}`);
  if (!node || node.type !== 'file') return fail(`no crontab for ${user}`);
  return { stdout: node.content ?? '' };
};

export const logCommands: Record<string, Handler> = { journalctl, dmesg, crontab };
