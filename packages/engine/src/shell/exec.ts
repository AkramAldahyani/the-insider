/**
 * Step 4: run a parsed command line.
 *
 * Handles pipes (the stdout text of one command becomes the stdin text of the
 * next), redirection to files, and the ; && || operators.
 *
 * INTERACTIVE COMMANDS: when a command needs an answer from the user (ssh, su
 * and sudo asking for a password) it returns `pending`. We then store "where
 * we were" (a Frame: the remaining commands, as plain data) inside the
 * terminal and stop. When the answer arrives, `resumeFrame` continues from
 * exactly that point - so `sudo cat /etc/shadow | grep root > out.txt` still
 * pipes and redirects correctly after the password prompt.
 */
import { findUser, getCred } from '../auth/accounts';
import { MAX_ARGS, MAX_PIPE, MAX_READ } from '../core/limits';
import { topSession } from '../auth/sessions';
import { dispatch } from '../commands/table';
import type { CmdCtx, CmdResult } from '../commands/types';
import { readTracked } from '../commands/util';
import { FsError, resolvePath, writeFile } from '../fs/vfs';
import type { Session, Terminal, World } from '../types';
import { expandWord, type ExpandEnv } from './expand';
import { ShellSyntaxError } from './lexer';
import { parse, type ListItem, type SimpleCommand } from './parser';

/** One call to sendInput: the world, the terminal, and the text to print. */
export interface Run {
  world: World;
  terminal: Terminal;
  out: string[];
  /** What this line may still read. */
  budget?: { left: number };
}

interface FileTarget {
  host: string;
  user: string;
  path: string;
}

/** Where a command's output should go, decided before the command starts. */
interface Redir {
  out: FileTarget | null;
  err: FileTarget | 'merge' | null;
}

/** "Where we were" in a command line. Plain JSON, stored in Terminal.pending.resume. */
export interface Frame {
  items: ListItem[];
  /** Index of the command inside items[0].pipeline that is waiting. */
  stage: number;
  redir: Redir;
}

export function makeCtx(run: Run, session: Session, piped: boolean): CmdCtx {
  const host = run.world.hosts[session.host];
  return {
    world: run.world,
    terminal: run.terminal,
    session,
    host,
    cred: getCred(host, session.user),
    piped,
    sudo: false,
    budget: (run.budget ??= { left: MAX_READ }),
  };
}

function expandEnv(c: CmdCtx): ExpandEnv {
  const home = findUser(c.host, c.session.user)?.home ?? '/';
  return {
    host: c.host,
    cwd: c.session.cwd,
    cred: c.cred,
    home,
    vars: {
      HOME: home,
      USER: c.session.user,
      LOGNAME: c.session.user,
      PWD: c.session.cwd,
      HOSTNAME: c.host.hostname,
      SHELL: '/bin/bash',
      UID: String(findUser(c.host, c.session.user)?.uid ?? ''),
      '?': String(c.session.lastExit),
    },
  };
}

/** Expands a command's words, opens its redirections, and runs it. */
function startCommand(run: Run, session: Session, cmd: SimpleCommand, stdin: string, piped: boolean): { result: CmdResult; redir: Redir } {
  const redir: Redir = { out: null, err: null };
  const c = makeCtx(run, session, piped || cmd.redirects.some((r) => r.fd === 1));
  const env = expandEnv(c);
  const now = run.world.time;
  const bashError = (target: string, e: unknown): { result: CmdResult; redir: Redir } => ({
    result: { stderr: `bash: ${target}: ${e instanceof FsError ? e.message : 'ambiguous redirect'}\n`, exit: 1 },
    redir: { out: null, err: null },
  });

  // `< file`
  if (cmd.stdin) {
    const words = expandWord(cmd.stdin, env);
    try {
      if (words.length !== 1) throw new Error('ambiguous');
      stdin = readTracked(c, words[0]);
    } catch (e) {
      return bashError(words[0] ?? '', e);
    }
  }

  // `> file`, `>> file`, `2> file`, `2>&1`. Like bash, the file is created or
  // emptied BEFORE the command runs, and a failure here cancels the command.
  for (const r of cmd.redirects) {
    if (!r.target) {
      redir.err = 'merge';
      continue;
    }
    const words = expandWord(r.target, env);
    try {
      if (words.length !== 1) throw new Error('ambiguous');
      const path = resolvePath(session.cwd, words[0]);
      writeFile(c.host, path, '', c.cred, now, r.append);
      const target = { host: c.host.hostname, user: session.user, path };
      if (r.fd === 1) redir.out = target;
      else redir.err = target;
    } catch (e) {
      return bashError(words[0] ?? '', e);
    }
  }

  const argv = cmd.words.flatMap((w) => expandWord(w, env));
  if (argv.length === 0) return { result: {}, redir };
  if (argv.length > MAX_ARGS) return { result: { stderr: `bash: ${argv[0]}: Argument list too long\n`, exit: 126 }, redir };
  return { result: dispatch(c, argv, stdin), redir };
}

/** Sends a finished command's stderr/stdout to files if redirected. Returns what is left of stdout. */
function finishCommand(run: Run, redir: Redir, r: CmdResult): string {
  let stdout = (r.stdout ?? '').slice(0, MAX_PIPE);
  let stderr = r.stderr ?? '';
  const save = (t: FileTarget, text: string) => {
    const host = run.world.hosts[t.host];
    try {
      writeFile(host, t.path, text, getCred(host, t.user), run.world.time, true);
    } catch (e) {
      // The file was checked when the command started, but it may have become too large.
      if (e instanceof FsError) run.out.push(`bash: ${t.path}: ${e.message}\n`);
    }
  };
  if (redir.err === 'merge') {
    stdout += stderr;
    stderr = '';
  } else if (redir.err) {
    save(redir.err, stderr);
    stderr = '';
  }
  if (redir.out) {
    save(redir.out, stdout);
    stdout = '';
  }
  run.out.push(stderr); // stderr always goes straight to the screen
  return stdout;
}

/**
 * Runs list items starting at `frame`. If `injected` is given it is used as
 * the result of the waiting command instead of running it again.
 */
export function resumeFrame(run: Run, frame: Frame, injected?: CmdResult): void {
  let { items } = frame;
  let stage = frame.stage;
  let redir: Redir = frame.redir;
  let stdin = '';

  while (items.length > 0) {
    const item = items[0];
    let exit = 0;

    for (; stage < item.pipeline.length; stage++) {
      const session = topSession(run.world, run.terminal);
      if (!session) return;
      const piped = stage < item.pipeline.length - 1;

      let result: CmdResult;
      if (injected) {
        result = injected;
        injected = undefined;
      } else {
        const started = startCommand(run, session, item.pipeline[stage], stdin, piped);
        result = started.result;
        redir = started.redir;
      }

      if (result.pending) {
        // The command asked a question: print what it has so far and park here.
        run.out.push(result.stderr ?? '', result.stdout ?? '');
        run.terminal.pending = { ...result.pending, resume: { items, stage, redir } satisfies Frame };
        return;
      }

      stdin = finishCommand(run, redir, result);
      exit = result.exit ?? 0;
      session.lastExit = exit;

      // ssh / su / exit switched us to a different shell. The rest of the line
      // is dropped (documented simplification).
      if (topSession(run.world, run.terminal)?.id !== session.id) {
        run.out.push(stdin);
        return;
      }
    }
    run.out.push(stdin); // the last command's stdout reaches the screen

    // `a && b` runs b only if a succeeded; `a || b` only if a failed.
    let op = item.next;
    items = items.slice(1);
    while (items.length > 0 && ((op === '&&' && exit !== 0) || (op === '||' && exit === 0))) {
      op = items[0].next;
      items = items.slice(1);
    }
    stage = 0;
    stdin = '';
  }
}

/**
 * A SIEM query has its own "|" steps (`siem source=auth | count by user`).
 * Like a search box, the whole rest of a line that starts with `siem` belongs
 * to the query, so it is passed on as one argument instead of being split
 * into shell pipes. (A query already written in quotes is left as it is.)
 */
function siemLine(line: string): string {
  const m = /^(\s*siem)\s+(.+)$/.exec(line);
  if (!m || /^(['"])[^'"]*\1\s*$/.test(m[2])) return line;
  return `${m[1]} '${m[2].replace(/'/g, "'\\''")}'`;
}

/** Parses and runs one line typed at a shell prompt. */
export function runLine(run: Run, line: string): void {
  let items: ListItem[];
  try {
    items = parse(siemLine(line));
  } catch (e) {
    if (!(e instanceof ShellSyntaxError)) throw e;
    run.out.push(`bash: ${e.message}\n`);
    const session = topSession(run.world, run.terminal);
    if (session) session.lastExit = 2;
    return;
  }
  resumeFrame(run, { items, stage: 0, redir: { out: null, err: null } });
}
