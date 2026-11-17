/** Commands about login sessions: who is/was logged in, history, lock, exit. */
import { uidOf } from '../auth/accounts';
import { closeSession, lockConsole, unlockConsole } from '../auth/sessions';
import { hhmm, isoMinute, lastStamp, fullStamp, DAY, HOUR, MINUTE } from '../core/time';
import { uptimeLine } from './identity';
import type { Handler } from './types';
import { fail } from './types';
import { parseArgs } from './util';

const p2 = (n: number) => String(n).padStart(2, '0');

/**
 * last: the login history of this machine, newest first. This is the wtmp
 * data. Remote logins show the SOURCE IP in the third column.
 */
const last: Handler = (c, args) => {
  const { values, rest } = parseArgs(args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a)), 'n');
  const limit = values.n ? parseInt(values.n, 10) : Infinity;
  const entries = [...c.host.wtmp].reverse().filter((w) => rest.length === 0 || rest.includes(w.user) || rest.includes(w.tty));
  let out = '';
  for (const w of entries.slice(0, limit)) {
    let tail: string;
    if (w.user === 'reboot') tail = '  still running';
    else if (w.logout === null) tail = '  still logged in';
    else {
      const d = w.logout - w.login;
      const days = Math.floor(d / DAY);
      const span = `${days > 0 ? `${days}+` : ''}${p2(Math.floor((d % DAY) / HOUR))}:${p2(Math.floor((d % HOUR) / MINUTE))}`;
      tail = `- ${hhmm(w.logout)}  (${span})`;
    }
    // Real `last` cuts names to 8 characters; we use a wider column so full usernames stay readable.
    out += `${w.user.padEnd(10)} ${w.tty.padEnd(12)} ${w.from.padEnd(16)} ${lastStamp(w.login)} ${tail}\n`;
  }
  const first = c.host.wtmp[0];
  out += `\nwtmp begins ${fullStamp(first ? first.login : c.host.bootTime)}\n`;
  return { stdout: out };
};

/** Everyone logged in right now. */
const who: Handler = (c) => {
  const out = c.host.wtmp
    .filter((w) => w.logout === null && w.user !== 'reboot')
    .map((w) => `${w.user.padEnd(10)} ${w.tty.padEnd(12)} ${isoMinute(w.login)}${w.from ? ` (${w.from})` : ''}\n`)
    .join('');
  return { stdout: out };
};

function idleText(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}.00s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${p2(s % 60)}`;
  return `${Math.floor(s / 3600)}:${p2(Math.floor((s % 3600) / 60))}m`;
}

/** Like who, plus idle time and what each user is running. */
const w: Handler = (c) => {
  let out = uptimeLine(c.world, c.host);
  out += `${'USER'.padEnd(10)} ${'TTY'.padEnd(8)} ${'FROM'.padEnd(16)} ${'LOGIN@'.padEnd(8)} ${'IDLE'.padStart(5)}   JCPU   PCPU WHAT\n`;
  for (const e of c.host.wtmp.filter((x) => x.logout === null && x.user !== 'reboot')) {
    const session = e.sessionId ? c.world.sessions[e.sessionId] : undefined;
    const mine = session?.id === c.session.id || session?.tty === c.session.tty;
    const idle = mine ? '0.00s' : idleText(c.world.time - (session?.lastActivity ?? e.login));
    out += `${e.user.padEnd(10)} ${e.tty.padEnd(8)} ${(e.from || '-').padEnd(16)} ${hhmm(e.login).padEnd(8)} ${idle.padStart(5)}  0.04s  0.01s ${mine ? 'w' : '-bash'}\n`;
  }
  return { stdout: out };
};

/** history: this shell's command list (in memory; saved to ~/.bash_history on exit). */
const history: Handler = (c, args) => {
  const s = c.session;
  if (args[0] === '-c') {
    s.history = [];
    s.historyBase = 0;
    return {};
  }
  if (args[0] === '-w') {
    // write everything out now: mark all as "new" so closing the session saves it
    return {};
  }
  const n = args[0] ? parseInt(args[0], 10) : s.history.length;
  if (Number.isNaN(n)) return fail(`bash: history: ${args[0]}: numeric argument required`);
  const start = Math.max(0, s.history.length - n);
  const out = s.history.slice(start).map((line, i) => `${String(start + i + 1).padStart(5)}  ${line}\n`).join('');
  return { stdout: out };
};

/** exit / logout: leave the current shell and return to the one underneath. */
const exit: Handler = (c) => {
  const s = c.session;
  closeSession(c.world, s);
  c.terminal.stack.pop();
  let out = s.loginShell ? 'logout\n' : 'exit\n';
  if (s.kind === 'ssh' || s.kind === 'implant') out += `Connection to ${s.host} closed.\n`;
  return { stdout: out };
};

/**
 * loginctl lock-session: lock the screen of this machine's console session.
 * After that, the physical keyboard only accepts that user's password.
 *
 * It also works over ssh (by the same user, or by root). That is a real
 * helpdesk feature and a real risk: `unlock-session` typed remotely opens the
 * PC for whoever is standing at it. So both leave a clear line in auth.log on
 * this machine, naming who asked and from which address.
 */
const loginctl: Handler = (c, args) => {
  const sub = args[0] ?? 'list-sessions';
  const consoleSession = c.host.consoleSessionId ? c.world.sessions[c.host.consoleSessionId] : undefined;
  const allowed = consoleSession && (c.cred.user === 'root' || c.cred.user === consoleSession.user);

  if (sub === 'lock-session' || sub === 'lock-sessions') {
    if (!consoleSession) return fail('Failed to lock session: No graphical session found on seat0');
    if (!allowed) return fail('Failed to lock session: Access denied');
    lockConsole(c.world, c.host, { by: c.session.user, via: 'loginctl', sourceIp: c.session.sourceIp, tty: c.session.tty });
    return {};
  }
  if (sub === 'unlock-session' || sub === 'unlock-sessions') {
    if (!consoleSession) return fail('Failed to unlock session: No graphical session found on seat0');
    if (!allowed) return fail('Failed to unlock session: Access denied');
    unlockConsole(c.world, c.host, { by: c.session.user, via: 'loginctl', sourceIp: c.session.sourceIp, tty: c.session.tty });
    return {};
  }
  if (sub === 'list-sessions') {
    const active = Object.values(c.world.sessions).filter((s) => s.host === c.host.hostname && s.logoutTime === null && s.kind !== 'su');
    let out = 'SESSION  UID USER             SEAT  TTY  \n';
    for (const s of active) {
      out += `${String(s.logindId).padStart(7)} ${String(uidOf(c.host, s.user) ?? '').padStart(4)} ${s.user.padEnd(16)} ${(s.kind === 'console' ? 'seat0' : '').padEnd(5)} ${s.tty}\n`;
    }
    return { stdout: `${out}\n${active.length} sessions listed.\n` };
  }
  return fail(`Unknown command verb ${sub}.`);
};

export const sessionCommands: Record<string, Handler> = { last, who, w, history, exit, logout: exit, loginctl };
