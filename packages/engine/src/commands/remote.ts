/**
 * ssh and scp: reaching other machines.
 *
 * KEY FORENSIC RULE: a login attempt is logged on the TARGET machine, with the
 * IP address of the machine the attempt CAME FROM. If an attacker hops
 * A -> B -> C, machine C only ever sees B's address. Following that chain
 * back, hop by hop, is the core investigation skill of the game.
 */
import { findUser, getCred, uidOf, verifyPassword } from '../auth/accounts';
import { openSession } from '../auth/sessions';
import { randInt } from '../core/rng';
import { emit } from '../events/log';
import { FsError, basename, getNode, readFile, resolvePath, writeFile } from '../fs/vfs';
import { allocPid } from '../proc/processes';
import { loginBanner } from '../shell/prompt';
import type { Host, Pending } from '../types';
import { lookup } from './net';
import type { CmdCtx, CmdResult, Handler, PendingHandler } from './types';
import { fail } from './types';
import { abs, errText } from './util';

const MAX_TRIES = 3;

/** Checks that `target` can be reached on the ssh port; returns an error result if not. */
function connectError(tool: string, name: string, target: Host | undefined): CmdResult | null {
  if (!target) return fail(`${tool}: Could not resolve hostname ${name}: Name or service not known`, 255);
  if (!target.online) return fail(`${tool}: connect to host ${name} port 22: No route to host`, 255);
  if (!target.services.some((s) => s.port === 22)) return fail(`${tool}: connect to host ${name} port 22: Connection refused`, 255);
  return null;
}

/** Can this account log in with this password on that machine? */
function authenticate(target: Host, user: string, password: string): boolean {
  const entry = findUser(target, user);
  return !!entry && !entry.shell.endsWith('nologin') && !entry.shell.endsWith('false') && verifyPassword(target, user, password);
}

/** Records a failed password on the target and decides whether to ask again. */
function wrongPassword(c: CmdCtx, pending: Pending, target: Host, tool: string): CmdResult {
  const d = pending.data;
  const user = String(d.user);
  const attempt = Number(d.attempt);
  emit(c.world, {
    host: target.hostname, user, sourceIp: c.host.ip, type: 'ssh.fail',
    details: { port: d.port, pid: d.pid, invalidUser: !findUser(target, user), attempt, fromHost: c.host.hostname, fromUser: c.session.user },
  });
  if (attempt < MAX_TRIES) {
    return { stderr: 'Permission denied, please try again.\n', pending: { ...pending, data: { ...d, attempt: attempt + 1 } } };
  }
  emit(c.world, { host: target.hostname, user, sourceIp: c.host.ip, type: 'ssh.giveup', details: { port: d.port, pid: d.pid } });
  return fail(`${user}@${String(d.name)}: Permission denied (publickey,password).${tool === 'scp' ? '\nlost connection' : ''}`, 255);
}

function passwordPrompt(c: CmdCtx, kind: string, user: string, name: string, target: Host, extra: Record<string, unknown> = {}): Pending {
  return {
    kind,
    prompt: `${user}@${name}'s password: `,
    masked: true,
    // port/pid identify this one connection in the target's logs
    data: { user, name, host: target.hostname, attempt: 1, port: randInt(c.world, 32768, 60999), pid: allocPid(c.world, target), ...extra },
  };
}

// ───────────────────────────── ssh ─────────────────────────────

const ssh: Handler = (c, args) => {
  let user = c.cred.user;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-l') user = args[++i] ?? user;
    else if (args[i] === '-p' || args[i] === '-i' || args[i] === '-o') i++; // accepted and ignored
    else if (!args[i].startsWith('-')) rest.push(args[i]);
  }
  if (rest.length === 0) return fail('usage: ssh [-l login_name] [-p port] [user@]hostname', 255);
  if (rest.length > 1) return fail('ssh: running a remote command is not supported in this simulation; log in and type it instead', 255);
  let name = rest[0];
  if (name.includes('@')) [user, name] = [name.slice(0, name.indexOf('@')), name.slice(name.indexOf('@') + 1)];

  const target = lookup(c, name);
  const error = connectError('ssh', name, target);
  if (error) return error;
  return { pending: passwordPrompt(c, 'ssh-pass', user, name, target!) };
};

const sshPassword: PendingHandler = (c, pending, answer) => {
  const user = String(pending.data.user);
  const target = c.world.hosts[String(pending.data.host)];
  if (!authenticate(target, user, answer)) return wrongPassword(c, pending, target, 'ssh');
  // Success: a new shell on the target, stacked on top of the current one.
  const conn = { port: Number(pending.data.port), pid: Number(pending.data.pid) };
  const session = openSession(c.world, { host: target, user, kind: 'ssh', from: c.host, parent: c.session, conn });
  c.terminal.stack.push(session.id);
  return { stdout: loginBanner(target, session) };
};

// ───────────────────────────── scp ─────────────────────────────

/** Splits "user@host:path" into its parts; returns null for a local path. */
function remoteSpec(text: string): { user: string | null; host: string; path: string } | null {
  const m = /^(?:([^@:/]+)@)?([^@:/]+):(.*)$/.exec(text);
  return m ? { user: m[1] ?? null, host: m[2], path: m[3] } : null;
}

const scp: Handler = (c, args) => {
  const rest = args.filter((a) => !a.startsWith('-'));
  if (rest.length !== 2) return fail('usage: scp [-r] source target      (one of them like user@host:path)');
  const [src, dst] = rest;
  const rs = remoteSpec(src);
  const rd = remoteSpec(dst);
  if ((rs && rd) || (!rs && !rd)) return fail('scp: exactly one of source and target must be remote (user@host:path)');
  const remote = (rs ?? rd)!;
  const user = remote.user ?? c.cred.user;
  const target = lookup(c, remote.host);
  const error = connectError('ssh', remote.host, target);
  if (error) return { ...error, stderr: `${error.stderr}lost connection\n` };
  return {
    pending: passwordPrompt(c, 'scp-pass', user, remote.host, target!, {
      upload: !!rd, remotePath: remote.path, localPath: rd ? src : dst,
    }),
  };
};

const scpPassword: PendingHandler = (c, pending, answer) => {
  const d = pending.data;
  const user = String(d.user);
  const target = c.world.hosts[String(d.host)];
  if (!authenticate(target, user, answer)) return wrongPassword(c, pending, target, 'scp');

  // scp logs in, copies, and logs out again. It leaves auth.log lines on the
  // target but (like the real thing) no entry in `last`.
  const logindId = target.nextLogindId++;
  const conn = { port: d.port, pid: d.pid, logindId, uid: uidOf(target, user), tty: 'notty', fromHost: c.host.hostname, via: 'scp' };
  emit(c.world, { host: target.hostname, user, sourceIp: c.host.ip, type: 'ssh.accept', details: conn });

  const now = c.world.time;
  const remoteCred = getCred(target, user);
  const remoteHome = findUser(target, user)?.home ?? '/';
  const remotePath = resolvePath(remoteHome, String(d.remotePath) || '.');
  const localPath = abs(c, String(d.localPath));
  const upload = Boolean(d.upload);
  const shownSrc = upload ? String(d.localPath) : String(d.remotePath);
  let result: CmdResult;
  try {
    const [srcHost, srcPath, srcCred] = upload ? [c.host, localPath, c.cred] : [target, remotePath, remoteCred];
    const [dstHost, dstPath, dstCred] = upload ? [target, remotePath, remoteCred] : [c.host, localPath, c.cred];
    if (getNode(srcHost, srcPath)?.type === 'dir') {
      result = fail(`scp: ${shownSrc}: not a regular file`);
    } else {
      const content = readFile(srcHost, srcPath, srcCred, now);
      // copying INTO a directory keeps the file's name
      const finalPath = getNode(dstHost, dstPath)?.type === 'dir' ? `${dstPath}/${basename(srcPath)}` : dstPath;
      writeFile(dstHost, finalPath, content, dstCred, now);
      emit(c.world, {
        host: target.hostname, user, sourceIp: c.host.ip, type: 'scp.transfer',
        details: { direction: upload ? 'upload' : 'download', remotePath: upload ? finalPath : remotePath, localHost: c.host.hostname, localPath: upload ? localPath : finalPath, bytes: content.length, localUser: c.cred.user },
      });
      const kb = Math.max(0.1, content.length / 1024).toFixed(1);
      result = { stdout: `${basename(srcPath).padEnd(44)} 100% ${String(content.length).padStart(5)}   ${kb.padStart(6)}KB/s   00:00\n` };
    }
  } catch (e) {
    if (!(e instanceof FsError)) throw e;
    result = fail(`scp: ${shownSrc}: ${errText(e)}`);
  }
  emit(c.world, { host: target.hostname, user, sourceIp: c.host.ip, type: 'ssh.disconnect', details: conn });
  return result;
};

export const remoteCommands: Record<string, Handler> = { ssh, scp };
export const remotePending: Record<string, PendingHandler> = { 'ssh-pass': sshPassword, 'scp-pass': scpPassword };
