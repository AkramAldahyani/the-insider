/**
 * The command table and the dispatcher that looks a command up and runs it.
 *
 * The table starts empty and is filled by commands/index.ts. It lives in its
 * own file so that `sudo` (which needs to run OTHER commands) can import the
 * dispatcher without creating a circular import.
 */
import { FsError, basename, canExec, canRead, dirname, resolvePath, walk } from '../fs/vfs';
import { runTool, toolMarker } from '../tools/toolkit';
import type { CmdCtx, CmdResult, Handler, PendingHandler } from './types';

export const commands: Record<string, Handler> = {};
export const pendingHandlers: Record<string, PendingHandler> = {};

/** Commands that are part of bash itself (so `sudo cd` cannot work, like on real Linux). */
export const BUILTINS = new Set(['cd', 'exit', 'logout', 'history']);

const BIN_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

export function dispatch(c: CmdCtx, argv: string[], stdin: string): CmdResult {
  let name = argv[0];
  const shell = c.sudo ? 'sudo' : 'bash';

  if (name.includes('/')) {
    // A path like /usr/bin/ls or ./script.sh
    const abs = resolvePath(c.session.cwd, name);
    if (BIN_DIRS.includes(dirname(abs)) && Object.hasOwn(commands, basename(abs)) && !BUILTINS.has(basename(abs))) {
      name = basename(abs);
    } else {
      try {
        const node = walk(c.host, abs, c.cred);
        if (node.type === 'dir') return { stderr: `${shell}: ${name}: Is a directory\n`, exit: 126 };
        if (!canExec(node, c.cred)) return { stderr: `${shell}: ${name}: Permission denied\n`, exit: 126 };
        // A toolkit file (game item, see tools/toolkit.ts) runs its tool. Other programs and scripts do not run.
        const tool = toolMarker(node.content);
        if (tool) {
          // Like any program, it must be readable to be run as a script.
          if (!canRead(node, c.cred)) return { stderr: `${shell}: ${name}: Permission denied\n`, exit: 126 };
          return runTool(c, abs, tool, argv.slice(1));
        }
        return { stderr: `${shell}: ${name}: programs and scripts cannot be executed in this simulation (use cat to read them)\n`, exit: 126 };
      } catch (e) {
        const msg = e instanceof FsError ? e.message : 'No such file or directory';
        return { stderr: `${shell}: ${name}: ${msg}\n`, exit: 127 };
      }
    }
  }

  const handler = Object.hasOwn(commands, name) ? commands[name] : undefined;
  c.command = name;
  if (!handler || (c.sudo && BUILTINS.has(name))) {
    return { stderr: `${shell}: ${name}: command not found\n`, exit: 127 };
  }
  try {
    return handler(c, argv.slice(1), stdin);
  } catch (e) {
    // Commands handle their own errors; this is a safety net so that a bug in
    // one command can never crash the whole game.
    if (e instanceof FsError) return { stderr: `${name}: ${e.message}\n`, exit: 1 };
    return { stderr: `${name}: internal simulation error: ${(e as Error).message}\n`, exit: 1 };
  }
}
