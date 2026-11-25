/**
 * `helpdesk` - the IT helpdesk's console (DESIGN.md section 7: "Reset
 * passwords; force-lock any PC remotely").
 *
 *   helpdesk status          every PC and what its screen shows
 *   helpdesk lock HOST       lock that PC's screen from here
 *   helpdesk reset USER      give that account a new password (on every machine)
 *
 * It is installed only where /etc/helpdesk.conf exists (the helpdesk's PC),
 * and only the accounts listed in that file (or root) may use it. So it is
 * as safe as the helpdesk's own screen: whoever finds Dana's PC unlocked can
 * use it too. Every lock and every reset leaves a line on the machines
 * involved, naming the account that asked and the address it came from.
 */
import { lockConsole } from '../auth/sessions';
import { changePassword } from '../auth/passwords';
import { getNode } from '../fs/vfs';
import { hashString } from '../core/rng';
import { fail, type Handler } from './types';

/** Words for new passwords: easy to read out, hard to guess as a whole. */
const WORDS = ['Cedar', 'Harbor', 'Falcon', 'Quartz', 'Meadow', 'Copper', 'Orbit', 'Lantern', 'Willow', 'Summit', 'Ember', 'Glacier'];

const helpdesk: Handler = (c, args) => {
  const conf = getNode(c.host, '/etc/helpdesk.conf')?.content;
  if (conf === undefined) return fail('bash: helpdesk: command not found', 127);
  const allowed = (/^allow\s*=\s*(.+)$/m.exec(conf)?.[1] ?? '').split(/[\s,]+/).filter(Boolean);
  if (c.cred.user !== 'root' && !allowed.includes(c.cred.user)) return fail(`helpdesk: ${c.cred.user} is not a helpdesk account`);
  const [sub, target] = args;
  const world = c.world;

  if (sub === 'status') {
    let out = 'HOST          SCREEN     USER\n';
    for (const host of Object.values(world.hosts)) {
      if (host.kind !== 'workstation') continue;
      const session = host.consoleSessionId ? world.sessions[host.consoleSessionId] : undefined;
      const screen = !session ? 'login' : session.locked ? 'locked' : 'UNLOCKED';
      out += `${host.hostname.padEnd(13)} ${screen.padEnd(10)} ${session?.user ?? '-'}\n`;
    }
    return { stdout: out };
  }

  if (sub === 'lock') {
    const host = target ? Object.values(world.hosts).find((h) => h.hostname.toLowerCase() === target.toLowerCase()) : undefined;
    if (!host) return fail('Usage: helpdesk lock HOST   (see: helpdesk status)');
    const session = host.consoleSessionId ? world.sessions[host.consoleSessionId] : undefined;
    if (!session) return fail(`helpdesk: nobody is logged in at ${host.hostname}`);
    if (session.locked) return { stdout: `${host.hostname}: already locked (${session.user})\n` };
    // Like `loginctl lock-session` typed over ssh: the PC logs who asked and from where.
    lockConsole(world, host, { by: c.cred.user, via: 'helpdesk', sourceIp: c.host.ip, tty: 'helpdesk' });
    return { stdout: `${host.hostname}: screen of ${session.user} locked\n` };
  }

  if (sub === 'reset') {
    if (!target || !Object.hasOwn(world.credentials, target) || target.startsWith('root')) return fail('Usage: helpdesk reset USER   (an employee account, not root)');
    // A new password that depends only on the account and the time (no random numbers: replays stay identical).
    const h = hashString(`${target}/${world.time}`);
    const password = `${WORDS[h % WORDS.length]}-${WORDS[(h >>> 8) % WORDS.length]}-${10 + ((h >>> 16) % 90)}`;
    changePassword(world, target, password, { by: c.cred.user, sourceIp: c.host.ip, via: 'helpdesk' });
    return { stdout: `Password of ${target} reset on every machine.\nNew password: ${password}\nHand it to ${target} in person. (They are told it too.)\n` };
  }

  return fail('Usage: helpdesk status | helpdesk lock HOST | helpdesk reset USER');
};

export const helpdeskCommands: Record<string, Handler> = { helpdesk };
