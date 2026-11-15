/**
 * Step 3: turn each parsed word into the final argument(s) a command receives.
 * In order, like bash:
 *   1. tilde    ~  ~/x  ~bob      -> home directories
 *   2. variables $HOME $USER $?   -> their values (not inside single quotes)
 *   3. globs    *.txt  file?      -> matching file names (only when unquoted)
 *
 * One word can become several arguments (a glob with many matches) or none.
 */
import { findUser } from '../auth/accounts';
import { canRead, getNode, resolvePath, type Cred } from '../fs/vfs';
import type { Host } from '../types';
import type { WordPart } from './lexer';

export interface ExpandEnv {
  host: Host;
  cwd: string;
  cred: Cred;
  home: string;
  vars: Record<string, string>;
}

/** One character plus "is it literal?" (literal characters never act as wildcards). */
interface Ch {
  c: string;
  lit: boolean;
}

function expandVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\$(\{\w+\}|\w+|\?)/g, (_, name: string) => vars[name.replace(/[{}]/g, '')] ?? '');
}

export function expandWord(parts: WordPart[], env: ExpandEnv): string[] {
  const chars: Ch[] = [];
  const push = (text: string, lit: boolean) => {
    for (const c of text) chars.push({ c, lit });
  };

  parts.forEach((part, index) => {
    if (part.quote === "'") return push(part.text, true);
    if (part.quote === '"') return push(expandVars(part.text, env.vars), true);

    let text = part.text;
    if (index === 0 && text.startsWith('~')) {
      const slash = text.indexOf('/');
      const name = text.slice(1, slash < 0 ? undefined : slash);
      const home = name === '' ? env.home : findUser(env.host, name)?.home;
      if (home) {
        push(home, true);
        text = slash < 0 ? '' : text.slice(slash);
      }
    }
    push(expandVars(text, env.vars), false);
  });

  const plain = chars.map((x) => x.c).join('');
  const hasGlob = chars.some((x) => !x.lit && (x.c === '*' || x.c === '?'));
  if (!hasGlob) {
    // An unquoted word that expanded to nothing (e.g. $UNSET) disappears entirely.
    const quoted = parts.some((p) => p.quote !== '');
    return plain === '' && !quoted ? [] : [plain];
  }
  const matches = glob(chars, env);
  // Like bash: a pattern that matches nothing is passed through unchanged.
  return matches.length > 0 ? matches : [plain];
}

function glob(chars: Ch[], env: ExpandEnv): string[] {
  // Split the pattern into path components.
  const comps: Ch[][] = [[]];
  for (const ch of chars) {
    if (ch.c === '/') comps.push([]);
    else comps[comps.length - 1].push(ch);
  }
  const absolute = chars[0]?.c === '/';
  const pieces = comps.filter((c) => c.length > 0);
  const results: string[] = [];

  const visit = (dirPath: string, index: number, shown: string) => {
    const comp = pieces[index];
    const last = index === pieces.length - 1;
    const text = comp.map((x) => x.c).join('');
    const wild = comp.some((x) => !x.lit && (x.c === '*' || x.c === '?'));
    const dir = getNode(env.host, dirPath);
    if (!dir || dir.type !== 'dir') return;

    const step = (name: string) => {
      const child = dir.children![name];
      if (!child) return;
      const display = shown + name;
      if (last) results.push(display);
      else if (child.type === 'dir') visit(`${dirPath}/${name}`, index + 1, `${display}/`);
    };

    if (!wild) return step(text);
    if (!canRead(dir, env.cred)) return; // cannot list this directory
    const source = comp
      .map((x) => (!x.lit && x.c === '*' ? '[^/]*' : !x.lit && x.c === '?' ? '.' : x.c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('');
    const regex = new RegExp(`^${source}$`);
    const hiddenOk = text.startsWith('.'); // "*" does not match dot-files
    for (const name of Object.keys(dir.children!).sort()) {
      if (name.startsWith('.') && !hiddenOk) continue;
      if (regex.test(name)) step(name);
    }
  };

  if (pieces.length > 0) visit(absolute ? '/' : resolvePath(env.cwd, '.'), 0, absolute ? '/' : '');
  return results;
}
