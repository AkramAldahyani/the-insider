/** Process commands: ps and kill. */
import { terminateSession } from '../auth/sessions';
import { psStart } from '../core/time';
import { emit } from '../events/log';
import { allocPid, removeProcess } from '../proc/processes';
import type { Process } from '../types';
import type { Handler } from './types';
import { fail } from './types';

/** ps shortens long user names to 7 characters and a "+", like the real one. */
const psUser = (u: string) => (u.length > 8 ? `${u.slice(0, 7)}+` : u);

const ps: Handler = (c, args) => {
  const opts = args.join('').replace(/-/g, '');
  const everything = /[aexA]/.test(opts);
  const now = c.world.time;
  // ps always lists itself, so add a short-lived entry for this very command.
  const self: Process = { pid: allocPid(c.world, c.host), user: c.cred.user, tty: c.session.tty, start: now, command: `ps ${args.join(' ')}`.trim(), stat: 'R+', vsz: 10072, rss: 1608 };
  const procs = [...c.host.processes, self].filter((p) => everything || p.tty === c.session.tty).sort((a, b) => a.pid - b.pid);

  let out: string;
  if (opts.includes('u')) {
    out = 'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n';
    for (const p of procs) {
      const mem = ((p.rss / 8_037_120) * 100).toFixed(1);
      out += `${psUser(p.user).padEnd(8)} ${String(p.pid).padStart(7)}  0.0 ${mem.padStart(4)} ${String(p.vsz).padStart(6)} ${String(p.rss).padStart(5)} ${p.tty.padEnd(8)} ${p.stat.padEnd(4)} ${psStart(p.start, now).padEnd(5)}   0:00 ${p.command}\n`;
    }
  } else if (opts.includes('f')) {
    out = 'UID          PID    PPID  C STIME TTY          TIME CMD\n';
    for (const p of procs) {
      const ppid = p.pid === 1 ? 0 : p.command.startsWith('[') ? 2 : 1;
      out += `${psUser(p.user).padEnd(8)} ${String(p.pid).padStart(7)} ${String(ppid).padStart(7)}  0 ${psStart(p.start, now).padEnd(5)} ${p.tty.padEnd(8)} 00:00:00 ${p.command}\n`;
    }
  } else {
    out = '    PID TTY          TIME CMD\n';
    for (const p of procs) {
      out += `${String(p.pid).padStart(7)} ${p.tty.padEnd(8)} 00:00:00 ${p.command.split(' ')[0].replace(/^-/, '').split('/').pop()}\n`;
    }
  }
  return { stdout: out };
};

/**
 * kill: end a process. You may only kill your own processes unless you are root.
 * Killing a login session's shell or its sshd throws that user off the machine.
 * `kill -9` gives the shell no chance to save its history.
 */
const kill: Handler = (c, args) => {
  let hard = false;
  const pids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-s') hard = /^(9|KILL|SIGKILL)$/.test(args[++i] ?? '');
    else if (a.startsWith('-')) hard = /^-(9|KILL|SIGKILL)$/.test(a);
    else pids.push(a);
  }
  if (pids.length === 0) return fail('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]', 2);

  let err = '';
  for (const text of pids) {
    const pid = Number(text);
    const proc = c.host.processes.find((p) => p.pid === pid);
    if (!Number.isInteger(pid)) err += `bash: kill: ${text}: arguments must be process or job IDs\n`;
    else if (!proc) err += `bash: kill: (${pid}) - No such process\n`;
    else if (c.cred.user !== 'root' && proc.user !== c.cred.user) err += `bash: kill: (${pid}) - Operation not permitted\n`;
    else {
      emit(c.world, { host: c.host.hostname, user: c.cred.user, sourceIp: c.session.sourceIp, type: 'process.kill', details: { pid, command: proc.command, owner: proc.user, signal: hard ? 'KILL' : 'TERM' } });
      if (pid === 1 || proc.command.startsWith('[')) continue; // init and kernel threads ignore signals
      const session = proc.sessionId ? c.world.sessions[proc.sessionId] : undefined;
      if (session && session.logoutTime === null) terminateSession(c.world, session, hard);
      else removeProcess(c.host, pid);
    }
  }
  return { stderr: err, exit: err ? 1 : 0 };
};

export const procCommands: Record<string, Handler> = { ps, kill };
