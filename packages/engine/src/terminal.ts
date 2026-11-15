/**
 * The public "play the game" API: sit at a PC and type.
 *
 *   const t = openTerminal(world, 'FIN-LT-07', 'p1');   // walk up to a desk
 *   sendInput(world, t.terminalId, 'ls -la');           // type a line
 *   leaveTerminal(world, t.terminalId);                 // walk away
 *
 * A terminal is the physical screen of ONE host and it persists: walking away
 * does not log anyone out. Whoever sits down next finds it exactly as it was
 * left - a login prompt, a lock screen, or an open shell (possibly ssh'd
 * somewhere else). That is the "someone used my unlocked PC" mechanic.
 *
 * Every call returns the text to print, the prompt to show next, and whether
 * the next input is a normal command or an answer to a question (and if that
 * answer should be hidden while typing, like a password).
 */
import { findUser, verifyPassword } from './auth/accounts';
import { openSession, topSession } from './auth/sessions';
import './commands/index';
import { pendingHandlers } from './commands/table';
import { emit, withActor } from './events/log';
import { allocPid } from './proc/processes';
import { makeCtx, resumeFrame, runLine, type Frame, type Run } from './shell/exec';
import { loginBanner, shellPrompt } from './shell/prompt';
import type { GameEvent, Pending, Terminal, World } from './types';

export interface TerminalResult {
  /** Text to print (may be empty, may contain several lines). */
  output: string;
  /** What to show in front of the next input, e.g. "user@host:~$ " or "Password: ". */
  prompt: string;
  /** Master-log events created by this call (handy for tests and the debug view). */
  events: GameEvent[];
  /** Present when the next input is an answer to a question rather than a shell command. */
  awaitingInput?: { masked: boolean };
}

export interface OpenResult extends TerminalResult {
  terminalId: string;
}

const terminalId = (hostname: string) => `term-${hostname}`;

function loginPending(hostname: string): Pending {
  return { kind: 'login-user', prompt: `${hostname} login: `, masked: false, data: {} };
}

/** Banner for the two "you cannot use the shell yet" screens. */
function screenBanner(world: World, terminal: Terminal): string {
  if (terminal.pending?.kind === 'login-user') return `\nUbuntu 22.04.4 LTS ${terminal.host} tty1\n\n`;
  if (terminal.pending?.kind === 'unlock') {
    const user = world.sessions[terminal.stack[0]]?.user;
    return `\n*** ${terminal.host}: screen locked by ${user} ***\nEnter the password for ${user} to unlock.\n`;
  }
  return '';
}

/**
 * Makes the terminal show the right screen for the current state:
 * nobody logged in -> login prompt; console session locked -> lock screen.
 */
function syncScreen(run: Run): void {
  const { world, terminal } = run;
  if (terminal.stack.length === 0) {
    if (!terminal.pending?.kind.startsWith('login-')) {
      terminal.pending = loginPending(terminal.host);
      run.out.push(screenBanner(world, terminal));
    }
  } else if (world.sessions[terminal.stack[0]].locked && terminal.pending?.kind !== 'unlock') {
    terminal.pending = { kind: 'unlock', prompt: 'Password: ', masked: true, data: {} };
    run.out.push(screenBanner(world, terminal));
  }
}

function finish(world: World, terminal: Terminal, run: Run, firstEvent: number): TerminalResult {
  const session = topSession(world, terminal);
  const result: TerminalResult = {
    output: run.out.join(''),
    prompt: terminal.pending ? terminal.pending.prompt : session ? shellPrompt(world, session) : '',
    events: world.events.slice(firstEvent),
  };
  if (terminal.pending) result.awaitingInput = { masked: terminal.pending.masked };
  return result;
}

/** A player sits down at a PC. */
export function openTerminal(world: World, hostname: string, physicalPlayerId: string): OpenResult {
  const host = world.hosts[hostname];
  if (!host) throw new Error(`Unknown host: ${hostname}`);
  const id = terminalId(hostname);
  const terminal = (world.terminals[id] ??= { id, host: hostname, playerId: null, stack: [], pending: null, notice: '' });
  terminal.playerId = physicalPlayerId;

  const firstEvent = world.events.length;
  const run: Run = { world, terminal, out: [] };
  withActor(physicalPlayerId, () => {
    emit(world, { host: hostname, user: topSession(world, terminal)?.user ?? '', type: 'terminal.sit', details: { player: physicalPlayerId } });
    run.out.push(terminal.notice);
    terminal.notice = '';
    // A half-typed login left by someone else starts over.
    if (terminal.pending?.kind.startsWith('login-')) terminal.pending = null;
    const before = run.out.length;
    syncScreen(run);
    // Always show the login / lock banner when sitting down, even if that screen was already up.
    if (run.out.length === before) run.out.push(screenBanner(world, terminal));
  });
  return { terminalId: id, ...finish(world, terminal, run, firstEvent) };
}

/** The player stands up. Sessions stay exactly as they are (locked or not!). */
export function leaveTerminal(world: World, id: string): void {
  const terminal = world.terminals[id];
  if (!terminal || terminal.playerId === null) return;
  withActor(terminal.playerId, () => {
    emit(world, { host: terminal.host, user: topSession(world, terminal)?.user ?? '', type: 'terminal.leave', details: { player: terminal.playerId } });
  });
  terminal.playerId = null;
}

/** The prompt a terminal is currently showing, without sending any input. */
export function currentPrompt(world: World, id: string): string {
  const terminal = world.terminals[id];
  if (!terminal) throw new Error(`Unknown terminal: ${id}`);
  const session = topSession(world, terminal);
  return terminal.pending ? terminal.pending.prompt : session ? shellPrompt(world, session) : '';
}

/** One line typed at the keyboard of a terminal. */
export function sendInput(world: World, id: string, text: string): TerminalResult {
  const terminal = world.terminals[id];
  if (!terminal) throw new Error(`Unknown terminal: ${id}`);
  const line = text.replace(/[\r\n]+$/, '');
  const firstEvent = world.events.length;
  const run: Run = { world, terminal, out: [] };

  withActor(terminal.playerId, () => {
    if (terminal.notice) {
      // The connection died while the player was away: what they typed went nowhere.
      run.out.push(terminal.notice);
      terminal.notice = '';
      syncScreen(run);
      return;
    }
    syncScreen(run);
    const pending = terminal.pending;
    if (pending) {
      terminal.pending = null;
      answerPending(run, pending, line);
    } else {
      shellInput(run, line);
    }
    syncScreen(run);
    run.out.push(terminal.notice);
    terminal.notice = '';
    const session = topSession(world, terminal);
    if (session) session.lastActivity = world.time;
  });
  return finish(world, terminal, run, firstEvent);
}

/** A line typed at a normal shell prompt. */
function shellInput(run: Run, line: string): void {
  const { world, terminal } = run;
  const session = topSession(world, terminal);
  if (!session || line.trim() === '') return;

  // Like Ubuntu's default bash (HISTCONTROL=ignoreboth): lines starting with a
  // space and immediate repeats are not saved in the history.
  if (!line.startsWith(' ') && session.history[session.history.length - 1] !== line) {
    session.history.push(line);
  }
  emit(world, {
    host: session.host, user: session.user, sourceIp: session.sourceIp, type: 'command',
    details: { command: line, cwd: session.cwd, tty: session.tty, session: session.id },
  });
  runLine(run, line);
}

/** A line typed in answer to a question (login name, password, ...). */
function answerPending(run: Run, pending: Pending, answer: string): void {
  const { world, terminal } = run;
  const host = world.hosts[terminal.host];

  switch (pending.kind) {
    case 'login-user': {
      const user = answer.trim();
      terminal.pending = user
        ? { kind: 'login-pass', prompt: 'Password: ', masked: true, data: { user, attempt: pending.data.attempt ?? 1 } }
        : pending;
      return;
    }
    case 'login-pass': {
      const user = String(pending.data.user);
      const attempt = Number(pending.data.attempt ?? 1);
      const entry = findUser(host, user);
      const ok = !!entry && !entry.shell.endsWith('nologin') && verifyPassword(host, user, answer);
      if (!ok) {
        emit(world, { host: host.hostname, user, type: 'login.fail', details: { pid: allocPid(world, host), tty: 'tty1', attempt } });
        run.out.push('\nLogin incorrect\n');
        terminal.pending = { ...loginPending(host.hostname), data: { attempt: attempt + 1 } };
        return;
      }
      const session = openSession(world, { host, user, kind: 'console' });
      terminal.stack = [session.id];
      run.out.push(loginBanner(host, session));
      return;
    }
    case 'unlock': {
      const session = world.sessions[terminal.stack[0]];
      if (verifyPassword(host, session.user, answer)) {
        session.locked = false;
        emit(world, { host: host.hostname, user: session.user, type: 'session.unlock', details: { logindId: session.logindId, pid: allocPid(world, host) } });
      } else {
        emit(world, { host: host.hostname, user: session.user, type: 'unlock.fail', details: { pid: allocPid(world, host) } });
        run.out.push('Sorry, that password is incorrect.\n');
        terminal.pending = pending;
      }
      return;
    }
    default: {
      // A question asked by a command (ssh / su / sudo / scp password).
      const session = topSession(world, terminal);
      const handler = pendingHandlers[pending.kind];
      if (!session || !handler) return;
      const result = handler(makeCtx(run, session, false), pending, answer);
      resumeFrame(run, pending.resume as Frame, result);
    }
  }
}
