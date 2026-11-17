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
import { syncUnattended } from './unattended';
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
  /** Only for a simulated USB implant connection. */
  backdoor?: { pid: number; port: number };
}

/**
 * Lowest free terminal name on a host: "pts/0, pts/1, ..." for ssh logins and
 * "tty1, tty2, ..." for people logged in at the screen (a second console
 * session appears when someone uses "switch user").
 */
function freeTty(world: World, host: Host, prefix: 'pts/' | 'tty'): string {
  const used = new Set(
    Object.values(world.sessions)
      .filter((s) => s.host === host.hostname && s.logoutTime === null)
      .map((s) => s.tty),
  );
  let n = prefix === 'tty' ? 1 : 0;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function openSession(world: World, input: OpenSessionInput): Session {
  const { host, user, kind, from, parent } = input;
  const remote = kind === 'ssh' || kind === 'implant';
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
    tty: kind === 'console' ? freeTty(world, host, 'tty') : remote ? freeTty(world, host, 'pts/') : parent!.tty,
    sourceIp: remote ? from!.ip : (parent?.sourceIp ?? null),
    sourcePort: remote ? (input.conn?.port ?? randInt(world, 32768, 60999)) : (parent?.sourcePort ?? null),
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

  if (kind === 'implant') {
    // An ordinary shell under the USB listener's account; no SSH authentication or fabricated login.
    session.backdoorPid = input.backdoor!.pid;
    session.authPid = own('sysupd: remote shell', user, session.tty).pid;
    own('bash', user, session.tty);
    const port = input.backdoor!.port;
    const client = spawn(world, from!, { user: parent!.user, command: `implant ${host.hostname}`, tty: parent!.tty, stat: 'S+', sessionId: id });
    session.client = { host: from!.hostname, pid: client.pid };
    host.connections.push({ localIp: host.ip, localPort: port, peerIp: from!.ip, peerPort: session.sourcePort!, pid: session.authPid, program: 'sysupd', sessionId: id });
    from!.connections.push({ localIp: from!.ip, localPort: session.sourcePort!, peerIp: host.ip, peerPort: port, pid: client.pid, program: 'implant', sessionId: id });
    emit(world, { host: host.hostname, user, sourceIp: from!.ip, type: 'implant.connect', details: { port, pid: session.authPid, fromHost: from!.hostname } });
  } else if (kind === 'ssh') {
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
    session.authPid = own(`/bin/login -p --`, 'root', session.tty, 'Ss').pid;
    own('-bash', user, session.tty);
    session.logindId = host.nextLogindId++;
    host.wtmp.push({ user, tty: session.tty, from: '', login: now, logout: null, sessionId: id });
    host.consoleSessionId = id;
    emit(world, { host: host.hostname, user, type: 'login.success', details: { pid: session.authPid, tty: session.tty, logindId: session.logindId, uid } });
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
  syncHost(world, host.hostname);

  const base = { host: host.hostname, user: session.user, sourceIp: session.sourceIp };
  if (session.kind === 'implant') {
    emit(world, { ...base, type: 'implant.disconnect', details: { pid: session.authPid } });
  } else if (session.kind === 'ssh') {
    emit(world, { ...base, type: 'ssh.disconnect', details: { port: session.sourcePort, pid: session.authPid, logindId: session.logindId } });
  } else if (session.kind === 'console') {
    emit(world, { ...base, type: 'logout', details: { pid: session.authPid, logindId: session.logindId } });
  } else {
    const parent = session.parentId ? world.sessions[session.parentId] : undefined;
    emit(world, { ...base, user: parent?.user ?? session.user, type: 'su.close', details: { to: session.user, pid: session.authPid } });
  }
}

/** The stack (visible, or parked by "switch user") of a terminal that contains this session. */
function stackOf(terminal: Terminal, sessionId: string): string[] | undefined {
  return [terminal.stack, ...terminal.parked].find((stack) => stack.includes(sessionId));
}

/** The terminal (physical screen) that this session belongs to, if any. */
export function terminalOf(world: World, sessionId: string): Terminal | undefined {
  return Object.values(world.terminals).find((t) => stackOf(t, sessionId));
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
  const stack = stackOf(terminal, session.id)!;
  const visible = stack === terminal.stack;
  const dying = stack.splice(stack.indexOf(session.id)).reverse();
  for (const id of dying) {
    const s = world.sessions[id];
    // Shells above the killed one get a hang-up signal and still save history.
    closeSession(world, s, { writeHistory: id === session.id ? !hard : true });
  }
  // A session hidden behind "switch user" is not on screen: nothing to show or reset.
  if (!visible) return;
  if (session.kind === 'ssh' || session.kind === 'implant') {
    terminal.notice += `Connection to ${session.host} closed by remote host.\nConnection to ${session.host} closed.\n`;
  } else if (session.kind === 'su') {
    terminal.notice += 'Session terminated, killing shell... ...killed.\n';
  }
  terminal.pending = null;
}

// ───────────────────────────── Screen lock ─────────────────────────────

/** How a lock or unlock was requested (ends up in the event and in the logs). */
export interface LockRequest {
  /** The account that asked. */
  by: string;
  /** "loginctl" (a typed command), "helpdesk" (the helpdesk console) or "scenario" (how the match starts). There is no auto-lock. */
  via: 'loginctl' | 'helpdesk' | 'scenario';
  /** Set when the command was typed in an ssh session: the address it came from. */
  sourceIp?: string | null;
  tty?: string;
}

/** Locks the screen of a host's console session. Returns false if nobody is logged in there. */
export function lockConsole(world: World, host: Host, req: LockRequest): boolean {
  const session = host.consoleSessionId ? world.sessions[host.consoleSessionId] : undefined;
  if (!session) return false;
  if (!session.locked) {
    session.locked = true;
    emit(world, {
      host: host.hostname, user: session.user, sourceIp: req.sourceIp ?? null, type: 'session.lock',
      details: { logindId: session.logindId, by: req.by, via: req.via, tty: req.tty ?? '' },
    });
  }
  syncHost(world, host.hostname);
  return true;
}

/**
 * Unlocks a console session WITHOUT its password, by command (`loginctl
 * unlock-session`). This is powerful - anyone who can run it remotely opens a
 * PC for whoever is standing in front of it - so it always leaves a loud log
 * line with the source address (see materialize.ts).
 */
export function unlockConsole(world: World, host: Host, req: LockRequest): boolean {
  const session = host.consoleSessionId ? world.sessions[host.consoleSessionId] : undefined;
  if (!session) return false;
  if (session.locked) {
    session.locked = false;
    emit(world, {
      host: host.hostname, user: session.user, sourceIp: req.sourceIp ?? null, type: 'session.unlock',
      details: { logindId: session.logindId, by: req.by, via: req.via, tty: req.tty ?? '' },
    });
  }
  syncHost(world, host.hostname);
  return true;
}

/** Updates the unattended-PC record of a host's screen (see unattended.ts). */
function syncHost(world: World, hostname: string): void {
  const terminal = Object.values(world.terminals).find((t) => t.host === hostname);
  if (terminal) syncUnattended(world, terminal);
}

/**
 * Forgets sessions that have ended, so a match can run for hours without
 * growing. Called by the clock after every advance.
 *
 * Nothing is lost that a player could look at: logins and logouts are in
 * wtmp (`last`) and auth.log, commands were saved to ~/.bash_history when the
 * shell ended. A session is kept while anything still points at it (a
 * terminal's screen, or a live session it was started from).
 */
export function pruneSessions(world: World): void {
  const referenced = new Set<string>();
  for (const terminal of Object.values(world.terminals)) {
    for (const id of terminal.stack) referenced.add(id);
    for (const stack of terminal.parked) for (const id of stack) referenced.add(id);
  }
  for (const session of Object.values(world.sessions)) {
    if (session.logoutTime === null && session.parentId) referenced.add(session.parentId);
  }
  for (const [id, session] of Object.entries(world.sessions)) {
    if (session.logoutTime !== null && !referenced.has(id)) delete world.sessions[id];
  }
}
