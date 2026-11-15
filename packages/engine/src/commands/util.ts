/** Small helpers shared by the command implementations. */
import { emit } from '../events/log';
import { FsError, readFile, resolvePath, writeFile } from '../fs/vfs';
import type { FsNode } from '../types';
import type { CmdCtx } from './types';

export interface ParsedArgs {
  /** Single-letter flags that were given, e.g. "l" and "a" for `-la`. */
  flags: Set<string>;
  /** Flags that take a value, e.g. { n: "5" } for `-n 5` or `-n5`. */
  values: Record<string, string>;
  /** Long options without the dashes, e.g. "help" for `--help`. */
  long: Set<string>;
  /** Everything that is not an option. */
  rest: string[];
}

/**
 * Parses Unix-style options. `valueFlags` lists the letters that expect a
 * value (for `head -n 5`, pass "n"). A lone "-" and anything after "--" are
 * treated as normal arguments.
 */
export function parseArgs(args: string[], valueFlags = ''): ParsedArgs {
  const parsed: ParsedArgs = { flags: new Set(), values: {}, long: new Set(), rest: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      parsed.rest.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      parsed.long.add(arg.slice(2));
    } else if (arg.startsWith('-') && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j];
        if (valueFlags.includes(flag)) {
          // value is either glued on (-n5) or the next argument (-n 5)
          const glued = arg.slice(j + 1);
          parsed.values[flag] = glued !== '' ? glued : (args[++i] ?? '');
          break;
        }
        parsed.flags.add(flag);
      }
    } else {
      parsed.rest.push(arg);
    }
  }
  return parsed;
}

/** Absolute path of something the user typed, relative to the shell's current directory. */
export const abs = (c: CmdCtx, path: string) => resolvePath(c.session.cwd, path);

/** The Linux error text for an exception ("Permission denied", ...). Re-throws real bugs. */
export function errText(e: unknown): string {
  if (e instanceof FsError) return e.message;
  throw e;
}

/**
 * Reads a file as the current user AND records the access in the master event
 * log (not visible to players). A later phase turns these into file-audit
 * evidence, e.g. "who opened /etc/shadow".
 */
export function readTracked(c: CmdCtx, path: string): string {
  const full = abs(c, path);
  const content = readFile(c.host, full, c.cred, c.world.time);
  emit(c.world, { host: c.host.hostname, user: c.cred.user, sourceIp: c.session.sourceIp, type: 'file.read', details: { path: full, loginUser: c.session.user } });
  return content;
}

export function writeTracked(c: CmdCtx, path: string, content: string, append = false): void {
  const full = abs(c, path);
  writeFile(c.host, full, content, c.cred, c.world.time, append);
  emit(c.world, { host: c.host.hostname, user: c.cred.user, sourceIp: c.session.sourceIp, type: 'file.write', details: { path: full, loginUser: c.session.user } });
}

/** Splits text into lines, ignoring the final newline ("a\nb\n" -> ["a","b"]). */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Joins lines back, with a final newline (empty list -> empty string). */
export const joinLines = (lines: string[]) => (lines.length ? lines.join('\n') + '\n' : '');

/** "drwxr-xr-x" style permission string. */
export function modeString(node: FsNode): string {
  const bits = 'rwxrwxrwx';
  let s = node.type === 'dir' ? 'd' : '-';
  for (let i = 0; i < 9; i++) s += node.mode & (1 << (8 - i)) ? bits[i] : '-';
  if (node.mode & 0o1000) s = s.slice(0, 9) + (node.mode & 1 ? 't' : 'T'); // sticky bit
  return s;
}
