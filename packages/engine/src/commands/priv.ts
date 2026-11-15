/** su and sudo: becoming another user. */
import { findUser, getCred, sudoRule, uidOf, verifyPassword } from '../auth/accounts';
import { openSession } from '../auth/sessions';
import { MINUTE } from '../core/time';
import { emit } from '../events/log';
import { allocPid } from '../proc/processes';
import { BUILTINS, commands, dispatch } from './table';
import type { CmdCtx, CmdResult, Handler, PendingHandler } from './types';
import { fail } from './types';

// ───────────────────────────── su ─────────────────────────────

function parseSu(args: string[]): { user: string; login: boolean } {
  let user = 'root';
  let login = false;
  for (const a of args) {
    if (a === '-' || a === '-l' || a === '--login') login = true;
    else if (!a.startsWith('-')) user = a;
  }
  return { user, login };
}

/** Starts a new shell as `user` on top of the current one. */
function openSuShell(c: CmdCtx, user: string, login: boolean): CmdResult {
  const session = openSession(c.world, { host: c.host, user, kind: 'su', loginShell: login, parent: c.session });
  c.terminal.stack.push(session.id);
  return {};
}

/**
 * su: asks for the TARGET user's password (unlike sudo, which asks for yours).
 * root can become anyone without a password.
 */
const su: Handler = (c, args) => {
  const { user, login } = parseSu(args);
  if (!findUser(c.host, user)) return fail(`su: user ${user} does not exist or the user entry does not contain all the required fields`);
  if (c.cred.user === 'root') return openSuShell(c, user, login);
  return { pending: { kind: 'su-pass', prompt: 'Password: ', masked: true, data: { user, login } } };
};

const suPassword: PendingHandler = (c, pending, answer) => {
  const user = String(pending.data.user);
  if (verifyPassword(c.host, user, answer)) return openSuShell(c, user, Boolean(pending.data.login));
  emit(c.world, {
    host: c.host.hostname, user: c.session.user, sourceIp: c.session.sourceIp, type: 'su.fail',
    details: { to: user, tty: c.session.tty, uid: uidOf(c.host, c.session.user), pid: allocPid(c.world, c.host) },
  });
  return fail('su: Authentication failure');
};

// ───────────────────────────── sudo ─────────────────────────────

interface SudoArgs {
  runAs: string;
  shell: '' | 'login' | 'plain'; // -i / -s
  list: boolean;
  validate: boolean;
  forget: boolean;
  command: string[];
}

function parseSudo(args: string[]): SudoArgs {
  const p: SudoArgs = { runAs: 'root', shell: '', list: false, validate: false, forget: false, command: [] };
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      i++;
      break;
    }
    if (!a.startsWith('-')) break;
    if (a === '-u') p.runAs = args[++i] ?? 'root';
    else if (a === '-i') p.shell = 'login';
    else if (a === '-s') p.shell = 'plain';
    else if (a === '-l') p.list = true;
    else if (a === '-v') p.validate = true;
    else if (a === '-k' || a === '-K') p.forget = true;
  }
  p.command = args.slice(i);
  return p;
}

/** The "TTY=... ; PWD=... ; COMMAND=..." facts that sudo writes to auth.log. */
function sudoDetails(c: CmdCtx, p: SudoArgs): Record<string, unknown> {
  const name = p.command[0];
  const path = !name ? '/bin/bash' : name.includes('/') ? name : `/usr/bin/${name}`;
  return {
    tty: c.session.tty,
    cwd: c.session.cwd,
    runAs: p.runAs,
    runAsUid: uidOf(c.host, p.runAs),
    uid: uidOf(c.host, c.session.user),
    command: [path, ...p.command.slice(1)].join(' '),
  };
}

/**
 * sudo: run one command as root (or as -u USER).
 *  - asks for YOUR OWN password (remembered for 15 minutes per shell);
 *  - only works if /etc/sudoers allows you;
 *  - every use - allowed or refused - is written to /var/log/auth.log.
 */
const sudo: Handler = (c, args, stdin) => {
  const p = parseSudo(args);
  const me = c.session.user;
  if (p.forget) {
    c.session.sudoUntil = 0;
    return {};
  }
  if (!p.list && !p.validate && !p.shell && p.command.length === 0) {
    return fail('usage: sudo -h | -K | -k | -V\nusage: sudo -v [-u user]\nusage: sudo -l [-u user] [command]\nusage: sudo [-u user] [-i | -s] [command]');
  }
  if (c.cred.user === 'root') return sudoRun(c, p, stdin);

  const rule = sudoRule(c.host, me);
  const remembered = c.session.sudoUntil > c.world.time;
  if (rule.allowed && (rule.nopasswd || remembered)) return sudoRun(c, p, stdin);
  return { pending: { kind: 'sudo-pass', prompt: `[sudo] password for ${me}: `, masked: true, data: { args, stdin, attempt: 1 } } };
};

const sudoPassword: PendingHandler = (c, pending, answer) => {
  const me = c.session.user;
  const args = pending.data.args as string[];
  const p = parseSudo(args);
  const attempt = Number(pending.data.attempt);
  const base = { host: c.host.hostname, user: me, sourceIp: c.session.sourceIp };

  if (!verifyPassword(c.host, me, answer)) {
    const final = attempt >= 3;
    emit(c.world, { ...base, type: 'sudo.fail', details: { ...sudoDetails(c, p), attempts: attempt, final } });
    if (!final) return { stderr: 'Sorry, try again.\n', pending: { ...pending, data: { ...pending.data, attempt: attempt + 1 } } };
    return fail('sudo: 3 incorrect password attempts');
  }

  const rule = sudoRule(c.host, me);
  if (!rule.allowed) {
    // Real sudo checks the password first and only THEN says you are not allowed.
    if (p.list) return fail(`Sorry, user ${me} may not run sudo on ${c.host.hostname}.`);
    emit(c.world, { ...base, type: 'sudo.denied', details: sudoDetails(c, p) });
    return fail(`${me} is not in the sudoers file.  This incident will be reported.`);
  }
  c.session.sudoUntil = c.world.time + 15 * MINUTE;
  return sudoRun(c, p, String(pending.data.stdin ?? ''));
};

/** The part of sudo that runs once the caller is known to be allowed. */
function sudoRun(c: CmdCtx, p: SudoArgs, stdin: string): CmdResult {
  const me = c.session.user;
  const rule = c.cred.user === 'root' ? { allowed: true, nopasswd: true, commands: 'ALL' as const } : sudoRule(c.host, me);
  if (p.validate) return {};
  if (p.list) {
    const what = rule.commands === 'ALL' ? 'ALL' : rule.commands.map((n) => `/usr/bin/${n}`).join(', ');
    return {
      stdout:
        `Matching Defaults entries for ${me} on ${c.host.hostname}:\n` +
        '    env_reset, mail_badpass, secure_path=/usr/local/sbin\\:/usr/local/bin\\:/usr/sbin\\:/usr/bin\\:/sbin\\:/bin\\:/snap/bin\n\n' +
        `User ${me} may run the following commands on ${c.host.hostname}:\n    (ALL : ALL) ${rule.nopasswd ? 'NOPASSWD: ' : ''}${what}\n`,
    };
  }
  if (!findUser(c.host, p.runAs)) return fail(`sudo: unknown user ${p.runAs}\nsudo: error initializing audit plugin sudoers_audit`);

  const base = { host: c.host.hostname, user: me, sourceIp: c.session.sourceIp };
  const name = p.command[0];
  if (rule.commands !== 'ALL' && (!name || !rule.commands.includes(name.split('/').pop()!))) {
    emit(c.world, { ...base, type: 'sudo.denied', details: { ...sudoDetails(c, p), reason: 'command not allowed' } });
    return fail(`Sorry, user ${me} is not allowed to execute '${String(sudoDetails(c, p).command)}' as ${p.runAs} on ${c.host.hostname}.`);
  }

  // `sudo -i` / `sudo -s`: a root shell.
  if (p.shell && p.command.length === 0) {
    emit(c.world, { ...base, type: 'sudo.exec', details: sudoDetails(c, p) });
    return openSuShell(c, p.runAs, p.shell === 'login');
  }
  if (!commands[name.split('/').pop()!] || BUILTINS.has(name)) return fail(`sudo: ${name}: command not found`);

  emit(c.world, { ...base, type: 'sudo.exec', details: sudoDetails(c, p) });
  // Run the command with the target user's identity. `c.session` is unchanged,
  // so logs still know who really asked.
  return dispatch({ ...c, cred: getCred(c.host, p.runAs), sudo: true }, p.command, stdin);
}

export const privCommands: Record<string, Handler> = { su, sudo };
export const privPending: Record<string, PendingHandler> = { 'su-pass': suPassword, 'sudo-pass': sudoPassword };
