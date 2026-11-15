/**
 * Login sessions: opening, closing, locking and killing them.
 *
 * A session is "one running shell". Opening one creates everything a real
 * login leaves behind: processes, a `last`/`who` record, a network connection
 * (for ssh) and log lines (through events). Closing it cleans those up and
 * writes the shell history to disk.
 *
 * BASH HISTORY RULE (documented design choice): like real bash, commands are
 * kept in memory while the session is open and written to ~/.bash_history only
 * when the session ends normally. So an intruder who is still logged in has
 * not yet left a history file - and one whose shell is killed with `kill -9`
 * never does.
 */
import { randInt } from '../core/rng';
import { emit } from '../events/log';
import { getNode, sysWrite } from '../fs/vfs';
import { removeProcess, spawn } from '../proc/processes';
import type { Host, Session, Terminal, World } from '../types';
import { findUser, uidOf } from './accounts';

export interface OpenSessionInput {
  host: Host;
  user: string;
  kind: Session['kind'];
  /** `su -` and `sudo -i` start login shells; plain `su` does not. */
  loginShell?: boolean;
  /** ssh only: the machine the connection comes from. */
  from?: Host;
  /** su only: the session `su` was typed in. (For ssh: the shell `ssh` was typed in.) */
  parent?: Session;
  /**
   * ssh only: the source port and sshd pid already used while asking for the
   * password, so failed and successful attempts of ONE connection share them
   * in the logs, as on a real server.
   */
  conn?: { port: number; pid: number };
}

/** Lowest free pseudo-terminal number on a host (pts/0, pts/1, ...). */
function freePts(world: World, host: Host): string {
  const used = new Set(
    Object.values(world.sessions)
      .filter((s) => s.host === host.hostname && s.logoutTime === null)
      .map((s) => s.tty),
  );
  let n = 0;
  while (used.has(`pts/${n}`)) n++;
  return `pts/${n}`;
}

export function openSession(world: World, input: OpenSessionInput): Session {
  const { host, user, kind, from, parent } = input;
  const now = world.time;
  const entry = findUser(host, user);
  const home = entry?.home ?? '/';
  const loginShell = input.loginShell ?? kind !== 'su';
  const id = `s${++world.counters.session}`;
  const homeExists = getNode(host, home)?.type === 'dir';

  const session: Session = {
    id,
    host: host.hostname,
    user,
    kind,
    loginShell,
    tty: kind === 'console' ? 'tty1' : kind === 'ssh' ? freePts(world, host) : parent!.tty,
    sourceIp: kind === 'ssh' ? from!.ip : (parent?.sourceIp ?? null),
    sourcePort: kind === 'ssh' ? (input.conn?.port ?? randInt(world, 32768, 60999)) : (parent?.sourcePort ?? null),
    loginTime: now,
    logoutTime: null,
    locked: false,
    lastActivity: now,
    cwd: loginShell || !parent ? (homeExists ? home : '/') : parent.cwd,
    oldCwd: '',
    history: [],
    historyBase: 0,
    lastExit: 0,
    sudoUntil: 0,
    pids: [],
    authPid: 0,
    logindId: 0,
    parentId: parent?.id ?? null,
    client: null,
  };
  session.oldCwd = session.cwd;

  // Like bash, start with the history saved by earlier sessions.
  const histFile = getNode(host, `${home}/.bash_history`);
  if (histFile?.type === 'file') {
    session.history = (histFile.content ?? '').split('\n').filter((l) => l !== '');
    session.historyBase = session.history.length;
  }

  const uid = uidOf(host, user);
  const own = (command: string, owner: string, tty: string, stat = 'Ss') => {
    const p = spawn(world, host, { user: owner, command, tty, stat, sessionId: id });
    session.pids.push(p.pid);
    return p;
  };

  if (kind === 'ssh') {
    // Server side: the two sshd processes and the user's shell.
    const priv = own(`sshd: ${user} [priv]`, 'root', '?');
    if (input.conn) {
      priv.pid = input.conn.pid;
      session.pids[0] = priv.pid;
    }
    session.authPid = priv.pid;
    own(`sshd: ${user}@${session.tty}`, user, '?', 'S');
    own('-bash', user, session.tty);
    session.logindId = host.nextLogindId++;
    host.wtmp.push({ user, tty: session.tty, from: from!.ip, login: now, logout: null, sessionId: id });
    host.connections.push({ localIp: host.ip, localPort: 22, peerIp: from!.ip, peerPort: session.sourcePort!, pid: session.authPid, program: 'sshd', sessionId: id });
    // Client side: the ssh program and its end of the connection.
    const clientUser = parent?.user ?? user;
    const client = spawn(world, from!, { user: clientUser, command: `ssh ${user}@${host.hostname}`, tty: parent?.tty ?? '?', stat: 'S+', sessionId: id });
    session.client = { host: from!.hostname, pid: client.pid };
    from!.connections.push({ localIp: from!.ip, localPort: session.sourcePort!, peerIp: host.ip, peerPort: 22, pid: client.pid, program: 'ssh', sessionId: id });
    emit(world, {
      host: host.hostname, user, sourceIp: from!.ip, type: 'ssh.accept',
      details: { port: session.sourcePort, pid: session.authPid, tty: session.tty, logindId: session.logindId, uid, fromHost: from!.hostname },
    });
  } else if (kind === 'console') {
    session.authPid = own(`/bin/login -p --`, 'root', 'tty1', 'Ss').pid;
    own('-bash', user, 'tty1');
    session.logindId = host.nextLogindId++;
    host.wtmp.push({ user, tty: 'tty1', from: '', login: now, logout: null, sessionId: id });
    host.consoleSessionId = id;
    emit(world, { host: host.hostname, user, type: 'login.success', details: { pid: session.authPid, tty: 'tty1', logindId: session.logindId, uid } });
  } else {
    session.authPid = own(loginShell ? `su - ${user}` : `su ${user}`, 'root', session.tty, 'S').pid;
    own(loginShell ? '-bash' : 'bash', user, session.tty, 'S');
    session.logindId = parent!.logindId;
    emit(world, {
      host: host.hostname, user: parent!.user, sourceIp: session.sourceIp, type: 'su.success',
      details: { to: user, toUid: uid, uid: uidOf(host, parent!.user), tty: session.tty, pid: session.authPid },
    });
  }

  world.sessions[id] = session;
  return session;
}

/** Ends a session and removes everything it owned. */
export function closeSession(world: World, session: Session, opts: { writeHistory?: boolean } = {}): void {
  if (session.logoutTime !== null) return;
  const host = world.hosts[session.host];
  const now = world.time;
  session.logoutTime = now;

  if (opts.writeHistory !== false) {
    const home = findUser(host, session.user)?.home;
    const fresh = session.history.slice(session.historyBase);
    if (home && fresh.length > 0 && getNode(host, home)?.type === 'dir') {
      sysWrite(host, `${home}/.bash_history`, fresh.join('\n') + '\n', {
        owner: session.user, group: session.user, mode: 0o600, time: now, append: true,
      });
    }
  }

  for (const pid of session.pids) removeProcess(host, pid);
  host.connections = host.connections.filter((c) => c.sessionId !== session.id);
  for (const w of host.wtmp) if (w.sessionId === session.id && w.logout === null) w.logout = now;
  if (session.client) {
    const clientHost = world.hosts[session.client.host];
    removeProcess(clientHost, session.client.pid);
    clientHost.connections = clientHost.connections.filter((c) => c.sessionId !== session.id);
  }
  if (host.consoleSessionId === session.id) host.consoleSessionId = null;

  const base = { host: host.hostname, user: session.user, sourceIp: session.sourceIp };
  if (session.kind === 'ssh') {
    emit(world, { ...base, type: 'ssh.disconnect', details: { port: session.sourcePort, pid: session.authPid, logindId: session.logindId } });
  } else if (session.kind === 'console') {
    emit(world, { ...base, type: 'logout', details: { pid: session.authPid, logindId: session.logindId } });
  } else {
    const parent = session.parentId ? world.sessions[session.parentId] : undefined;
    emit(world, { ...base, user: parent?.user ?? session.user, type: 'su.close', details: { to: session.user, pid: session.authPid } });
  }
}

/** The terminal (physical screen) whose stack contains this session, if any. */
export function terminalOf(world: World, sessionId: string): Terminal | undefined {
  return Object.values(world.terminals).find((t) => t.stack.includes(sessionId));
}

export function topSession(world: World, terminal: Terminal): Session | undefined {
  const id = terminal.stack[terminal.stack.length - 1];
  return id ? world.sessions[id] : undefined;
}

/**
 * Forcibly ends a session from the outside (its process was killed).
 * Every session stacked on top of it dies too - if you were ssh'd from A to B
 * to C and the A->B login is killed, C goes with it.
 */
export function terminateSession(world: World, session: Session, hard: boolean): void {
  const terminal = terminalOf(world, session.id);
  if (!terminal) {
    closeSession(world, session, { writeHistory: !hard });
    return;
  }
  const index = terminal.stack.indexOf(session.id);
  const dying = terminal.stack.splice(index).reverse();
  for (const id of dying) {
    const s = world.sessions[id];
    // Shells above the killed one get a hang-up signal and still save history.
    closeSession(world, s, { writeHistory: id === session.id ? !hard : true });
  }
  if (session.kind === 'ssh') {
    terminal.notice += `Connection to ${session.host} closed by remote host.\nConnection to ${session.host} closed.\n`;
  } else if (session.kind === 'su') {
    terminal.notice += 'Session terminated, killing shell... ...killed.\n';
  }
  terminal.pending = null;
}

// ───────────────────────────── Screen lock ─────────────────────────────

/** Locks the screen of a host's console session. Returns false if nobody is logged in there. */
export function lockConsole(world: World, host: Host, by: string): boolean {
  const session = host.consoleSessionId ? world.sessions[host.consoleSessionId] : undefined;
  if (!session) return false;
  if (!session.locked) {
    session.locked = true;
    emit(world, { host: host.hostname, user: session.user, type: 'session.lock', details: { logindId: session.logindId, by } });
  }
  return true;
}
