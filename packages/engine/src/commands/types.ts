/**
 * The contract every shell command follows.
 *
 * A command is a plain function: it receives its arguments and its standard
 * input as text, and returns its standard output / standard error as text
 * plus an exit code. The shell (exec.ts) takes care of pipes and redirection,
 * so commands never need to know where their output goes.
 */
import type { Cred } from '../fs/vfs';
import type { Host, Pending, Session, Terminal, World } from '../types';

export interface CmdCtx {
  world: World;
  terminal: Terminal;
  /** The shell the command was typed in. */
  session: Session;
  host: Host;
  /**
   * The identity used for permission checks. Normally the session's user;
   * under `sudo` it is root (or the -u user) while `session.user` stays the caller.
   */
  cred: Cred;
  /** True when stdout goes into a pipe or a file instead of the screen. */
  piped: boolean;
  /** True when the command is being run through sudo. */
  sudo: boolean;
}

export interface CmdResult {
  stdout?: string;
  stderr?: string;
  /** 0 = success. Defaults to 0. */
  exit?: number;
  /** Set when the command needs the user to answer a question first (a password...). */
  pending?: Pending;
}

export type Handler = (c: CmdCtx, args: string[], stdin: string) => CmdResult;

/** Called with the user's answer to a `Pending` question of a given kind. */
export type PendingHandler = (c: CmdCtx, pending: Pending, answer: string) => CmdResult;

/** Shortcut for "print an error and fail". */
export const fail = (message: string, exit = 1): CmdResult => ({ stderr: message.endsWith('\n') ? message : `${message}\n`, exit });
