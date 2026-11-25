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
 *
 * SWITCH USER. A locked screen normally accepts only its user's password. But
 * like a real desktop it also offers "switch user": anyone with an account on
 * that machine can log in next to the locked session. The first session is
 * not touched - it stays logged in and locked, "parked" behind the new one -
 * and both logins are in the logs.
 */
import { MAX_SCREEN } from './core/limits';
import { noteUnattendedInput, syncUnattended } from './auth/unattended';
import { findUser, verifyPassword } from './auth/accounts';
import { openSession, topSession } from './auth/sessions';
import './commands/index';
import { pendingHandlers } from './commands/table';
import { emit, withActor } from './events/log';
import { allocPid } from './proc/processes';
import { makeCtx, resumeFrame, runLine, type Frame, type Run } from './shell/exec';
import { loginBanner, shellPrompt } from './shell/prompt';
import type { GameEvent, Pending, Terminal, World } from './types';
import { recordPassword } from './tools/keyboard';

/** What kind of screen a PC is showing. */
export type ScreenKind = 'login' | 'locked' | 'shell';

export interface TerminalResult {
  /** Text to print (may be empty, may contain several lines). */
  output: string;
  /** What to show in front of the next input, e.g. "user@host:~$ " or "Password: ". */
  prompt: string;
  /** Master-log events created by this call (handy for tests and the debug view). NEVER send to a client. */
  events: GameEvent[];
  /** Present when the next input is an answer to a question rather than a shell command. */
  awaitingInput?: { masked: boolean };
  /** Login prompt, lock screen, or a usable shell. */
  screen: ScreenKind;
  /** True on the lock screen: `switchUser` is possible. */
  canSwitchUser: boolean;
}

export interface OpenResult extends TerminalResult {
  terminalId: string;
}

/** What anyone walking past a desk can see on its monitor. */
export interface ScreenState {
  state: 'login' | 'locked' | 'unlocked';
  /** The user whose session is on screen (null at the login prompt). */
  user: string | null;
}

const terminalId = (hostname: string) => `term-${hostname}`;

function newTerminal(world: World, hostname: string): Terminal {
  return { id: terminalId(hostname), host: hostname, playerId: null, stack: [], parked: [], pending: null, notice: '' };
}

function loginPending(hostname: string): Pending {
  return { kind: 'login-user', prompt: `${hostname} login: `, masked: false, data: {} };
}

/** Banner for the two "you cannot use the shell yet" screens. */
function screenBanner(world: World, terminal: Terminal): string {
  if (terminal.pending?.kind === 'login-user') {
    const waiting = terminal.parked.map((stack) => world.sessions[stack[0]]?.user).filter(Boolean);
    const note = waiting.length > 0 ? `(still logged in and locked: ${waiting.join(', ')})\n\n` : '';
    return `\nUbuntu 22.04.4 LTS ${terminal.host} tty1\n\n${note}`;
  }
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
  const host = world.hosts[terminal.host];
  // A parked session that was ended from outside (its process was killed) is gone.
  terminal.parked = terminal.parked.filter((stack) => stack.length > 0);

  if (terminal.stack.length === 0) {
    if (terminal.pending?.kind.startsWith('login-')) return; // someone is in the middle of logging in
    const parked = terminal.parked.pop();
    if (!parked) {
      terminal.pending = loginPending(terminal.host);
      run.out.push(screenBanner(world, terminal));
      return;
    }
    // The visible session ended (or a switch-user login was abandoned):
    // the screen falls back to the session that was parked behind it.
    terminal.stack = parked;
    host.consoleSessionId = parked[0];
    terminal.pending = null;
  }
  const locked = world.sessions[terminal.stack[0]].locked;
  if (locked && terminal.pending?.kind !== 'unlock') {
    terminal.pending = { kind: 'unlock', prompt: 'Password: ', masked: true, data: {} };
    run.out.push(screenBanner(world, terminal));
  } else if (!locked && terminal.pending?.kind === 'unlock') {
    // Unlocked from elsewhere (loginctl over ssh) while the lock screen was up.
    terminal.pending = null;
  }
}

function screenKind(world: World, terminal: Terminal): ScreenKind {
  if (terminal.stack.length === 0) return 'login';
  return world.sessions[terminal.stack[0]].locked ? 'locked' : 'shell';
}

/** A terminal keeps only its last lines: of a huge output only the end is shown. */
function lastPart(text: string): string {
  if (text.length <= MAX_SCREEN) return text;
  const line = text.indexOf('\n', text.length - MAX_SCREEN);
  return '[...]\n' + text.slice(line >= 0 && line < text.length - 1 ? line + 1 : text.length - MAX_SCREEN);
}

function finish(world: World, terminal: Terminal, run: Run, firstEvent: number): TerminalResult {
  syncUnattended(world, terminal);
  const session = topSession(world, terminal);
  const result: TerminalResult = {
    output: lastPart(run.out.join('')),
    prompt: terminal.pending ? terminal.pending.prompt : session ? shellPrompt(world, session) : '',
    events: world.events.slice(firstEvent),
    screen: screenKind(world, terminal),
    canSwitchUser: terminal.pending?.kind === 'unlock',
  };
  if (terminal.pending) result.awaitingInput = { masked: terminal.pending.masked };
  return result;
}

function getTerminal(world: World, id: string): Terminal {
  const terminal = world.terminals[id];
  if (!terminal) throw new Error(`Unknown terminal: ${id}`);
  return terminal;
}

/**
 * Runs `fn` as "something done at this terminal's own keyboard" and packs the
 * result. Everything emitted inside is tagged with the physical player and
 * with the machine whose keyboard was used.
 */
function atKeyboard(world: World, terminal: Terminal, fn: (run: Run) => void): TerminalResult {
  const firstEvent = world.events.length;
  const run: Run = { world, terminal, out: [] };
  withActor(terminal.playerId, () => fn(run), terminal.host);
  return finish(world, terminal, run, firstEvent);
}

/** A player sits down at a PC. */
export function openTerminal(world: World, hostname: string, physicalPlayerId: string): OpenResult {
  const host = world.hosts[hostname];
  if (!host) throw new Error(`Unknown host: ${hostname}`);
  if (host.headless) throw new Error(`${hostname} has no screen or keyboard (reach it over ssh)`);
  const id = terminalId(hostname);
  const terminal = (world.terminals[id] ??= newTerminal(world, hostname));
  terminal.playerId = physicalPlayerId;

  const result = atKeyboard(world, terminal, (run) => {
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
  return { terminalId: id, ...result };
}

/** The player stands up. Sessions stay exactly as they are (locked or not!). */
export function leaveTerminal(world: World, id: string): void {
  const terminal = world.terminals[id];
  if (!terminal || terminal.playerId === null) return;
  withActor(terminal.playerId, () => {
    emit(world, { host: terminal.host, user: topSession(world, terminal)?.user ?? '', type: 'terminal.leave', details: { player: terminal.playerId } });
  }, terminal.host);
  terminal.playerId = null;
  syncUnattended(world, terminal); // walking away from an unlocked screen starts the clock
}

/** Is the next line typed at this terminal a password (shown as stars)? */
export function awaitingSecret(world: World, id: string): boolean {
  return world.terminals[id]?.pending?.masked ?? false;
}

/** The prompt a terminal is currently showing, without sending any input. */
export function currentPrompt(world: World, id: string): string {
  const terminal = getTerminal(world, id);
  const session = topSession(world, terminal);
  return terminal.pending ? terminal.pending.prompt : session ? shellPrompt(world, session) : '';
}

/** What a passer-by sees on a PC's monitor. Works for PCs nobody has sat at yet. */
export function screenState(world: World, hostname: string): ScreenState {
  const terminal = world.terminals[terminalId(hostname)];
  const session = terminal?.stack[0] ? world.sessions[terminal.stack[0]] : undefined;
  if (!session) return { state: 'login', user: null };
  return { state: session.locked ? 'locked' : 'unlocked', user: session.user };
}

/** One line typed at the keyboard of a terminal. */
export function sendInput(world: World, id: string, text: string): TerminalResult {
  const terminal = getTerminal(world, id);
  const line = text.replace(/[\r\n]+$/, '');
  noteUnattendedInput(world, terminal);

  return atKeyboard(world, terminal, (run) => {
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
      recordPassword(world, terminal, pending, line);
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
}

/**
 * The screen changed without anyone typing here (a remote command
 * locked/unlocked it, a connection was killed). Returns what to
 * draw now, or null when nothing changed. The game server calls this for
 * seated players after time passes.
 */
export function refreshTerminal(world: World, id: string): TerminalResult | null {
  const terminal = getTerminal(world, id);
  const locked = terminal.stack[0] ? world.sessions[terminal.stack[0]].locked : false;
  const stale =
    terminal.notice !== '' ||
    (terminal.stack.length === 0 && !terminal.pending) ||
    (locked && terminal.pending?.kind !== 'unlock') ||
    (!locked && terminal.pending?.kind === 'unlock');
  if (!stale) return null;

  const firstEvent = world.events.length;
  const run: Run = { world, terminal, out: [] };
  run.out.push(terminal.notice);
  terminal.notice = '';
  syncScreen(run);
  return finish(world, terminal, run, firstEvent);
}

/**
 * Ctrl+C. At a question asked by a command (ssh/su/sudo password) it gives up
 * and returns to the shell. At a switch-user login it returns to the lock
 * screen. Anywhere else it just gives a fresh prompt.
 */
export function cancelInput(world: World, id: string): TerminalResult {
  const terminal = getTerminal(world, id);
  return atKeyboard(world, terminal, (run) => {
    const pending = terminal.pending;
    if (!pending) {
      const session = topSession(world, terminal);
      if (session) session.lastExit = 130;
      return;
    }
    if (pending.kind === 'unlock') return; // nothing to cancel: the screen stays locked
    terminal.pending = null;
    if (pending.kind === 'ssh-pass' || pending.kind === 'scp-pass') {
      // The target saw a connection that never finished logging in.
      const d = pending.data;
      const from = world.hosts[terminal.host];
      const via = topSession(world, terminal);
      emit(world, { host: String(d.host), user: String(d.user), sourceIp: via ? world.hosts[via.host].ip : from.ip, type: 'ssh.giveup', details: { port: d.port, pid: d.pid } });
    }
    const session = topSession(world, terminal);
    if (session) session.lastExit = 130;
    syncScreen(run);
  });
}

/**
 * "Switch user" on the lock screen: keeps the locked session logged in, hides
 * it, and shows a login prompt for someone else.
 */
export function switchUser(world: World, id: string): TerminalResult {
  const terminal = getTerminal(world, id);
  return atKeyboard(world, terminal, (run) => {
    syncScreen(run);
    if (terminal.pending?.kind !== 'unlock') return; // only offered on a lock screen
    const host = world.hosts[terminal.host];
    const session = world.sessions[terminal.stack[0]];
    emit(world, { host: host.hostname, user: session.user, type: 'session.switch', details: { logindId: session.logindId } });
    terminal.parked.push(terminal.stack);
    terminal.stack = [];
    host.consoleSessionId = null;
    terminal.pending = loginPending(host.hostname);
    run.out.push(screenBanner(world, terminal));
  });
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
      // Switch user back to someone who is already logged in: their old
      // session comes to the front again instead of a second one starting.
      const index = terminal.parked.findIndex((stack) => world.sessions[stack[0]]?.user === user);
      if (index >= 0) {
        terminal.stack = terminal.parked.splice(index, 1)[0];
        const session = world.sessions[terminal.stack[0]];
        session.locked = false;
        host.consoleSessionId = session.id;
        emit(world, { host: host.hostname, user, type: 'session.unlock', details: { logindId: session.logindId, pid: allocPid(world, host), via: 'switch-user' } });
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
        emit(world, { host: host.hostname, user: session.user, type: 'session.unlock', details: { logindId: session.logindId, pid: allocPid(world, host), via: 'password' } });
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
