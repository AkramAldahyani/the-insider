/** Commands that look at or change the filesystem. */
import { findUser, gidOf, readGroups, uidOf } from '../auth/accounts';
import { lsStamp, statStamp } from '../core/time';
import { wildcard } from '../core/pattern';
import { emit } from '../events/log';
import {
  FsError, basename, bytesIn, canExec, canRead, chmod, chown, cloneNode, dirname, getNode, listDir, makeDir,
  needRoom, nodesIn, remove, rename, sizeOf, walk, writeFile,
} from '../fs/vfs';
import type { FsNode } from '../types';
import type { CmdCtx, CmdResult, Handler } from './types';
import { fail } from './types';
import { abs, errText, joinLines, modeString, parseArgs, readTracked, splitLines, writeTracked } from './util';

// ───────────────────────────── cd / pwd ─────────────────────────────

const pwd: Handler = (c) => ({ stdout: `${c.session.cwd}\n` });

const cd: Handler = (c, args) => {
  const s = c.session;
  let target = args[0] ?? findUser(c.host, s.user)?.home ?? '/';
  let echo = '';
  if (target === '-') {
    target = s.oldCwd;
    echo = `${target}\n`; // `cd -` prints where it went
  }
  const path = abs(c, target);
  try {
    const node = walk(c.host, path, c.cred);
    if (node.type !== 'dir') return fail(`bash: cd: ${target}: Not a directory`);
    if (!canExec(node, c.cred)) return fail(`bash: cd: ${target}: Permission denied`);
  } catch (e) {
    return fail(`bash: cd: ${target}: ${errText(e)}`);
  }
  s.oldCwd = s.cwd;
  s.cwd = path;
  return { stdout: echo };
};

// ───────────────────────────── ls ─────────────────────────────

/** Sort like `ls`: ignore case and a leading dot. */
const lsOrder = (a: string, b: string) => {
  const key = (s: string) => s.replace(/^\./, '').toLowerCase();
  return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a < b ? -1 : 1;
};

function humanSize(n: number): string {
  if (n < 1024) return String(n);
  const units = ['K', 'M', 'G'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return (v < 10 ? v.toFixed(1) : String(Math.ceil(v))) + units[u];
}

const ls: Handler = (c, args) => {
  const { flags, rest } = parseArgs(args);
  const long = flags.has('l');
  const all = flags.has('a');
  const targets = rest.length ? rest : ['.'];
  const now = c.world.time;
  let out = '';
  let err = '';
  let exit = 0;

  const format = (entries: [string, FsNode][]): string => {
    if (!long) return entries.length ? entries.map((e) => e[0]).join(c.piped ? '\n' : '  ') + '\n' : '';
    const rows = entries.map(([name, n]) => ({
      mode: modeString(n),
      links: String(n.type === 'dir' ? 2 + Object.values(n.children!).filter((k) => k.type === 'dir').length : 1),
      owner: n.owner,
      group: n.group,
      size: flags.has('h') ? humanSize(sizeOf(n)) : String(sizeOf(n)),
      date: lsStamp(n.mtime, now),
      name,
    }));
    const w = (k: 'links' | 'owner' | 'group' | 'size') => Math.max(...rows.map((r) => r[k].length));
    const [wl, wo, wg, ws] = [w('links'), w('owner'), w('group'), w('size')];
    return rows
      .map((r) => `${r.mode} ${r.links.padStart(wl)} ${r.owner.padEnd(wo)} ${r.group.padEnd(wg)} ${r.size.padStart(ws)} ${r.date} ${r.name}\n`)
      .join('');
  };

  const files: [string, FsNode][] = [];
  const dirs: [string, FsNode][] = [];
  for (const t of targets) {
    try {
      const node = walk(c.host, abs(c, t), c.cred);
      (node.type === 'dir' && !flags.has('d') ? dirs : files).push([t, node]);
    } catch (e) {
      err += `ls: cannot access '${t}': ${errText(e)}\n`;
      exit = 2;
    }
  }
  out += format(files);

  for (const [t, node] of dirs) {
    let names: string[];
    try {
      names = listDir(c.host, abs(c, t), c.cred, now);
    } catch (e) {
      err += `ls: cannot open directory '${t}': ${errText(e)}\n`;
      exit = 2;
      continue;
    }
    if (targets.length > 1) out += `${out ? '\n' : ''}${t}:\n`;
    const entries: [string, FsNode][] = names
      .filter((n) => all || !n.startsWith('.'))
      .sort(lsOrder)
      .map((n) => [n, node.children![n]]);
    if (all) entries.unshift(['.', node], ['..', getNode(c.host, dirname(abs(c, t))) ?? node]);
    if (long) out += `total ${entries.reduce((sum, [, n]) => sum + Math.ceil(sizeOf(n) / 4096) * 4, 0)}\n`;
    out += format(entries);
  }
  return { stdout: out, stderr: err, exit };
};

// ───────────────────────────── cat / head / tail / less ─────────────────────────────

/** Reads each named file (or stdin when there are none); collects errors in Linux wording. */
function readInputs(c: CmdCtx, name: string, files: string[], stdin: string): { texts: [string, string][]; err: string } {
  if (files.length === 0) return { texts: [['(standard input)', stdin]], err: '' };
  const texts: [string, string][] = [];
  let err = '';
  for (const f of files) {
    if (f === '-') {
      texts.push(['(standard input)', stdin]);
      continue;
    }
    try {
      texts.push([f, readTracked(c, f)]);
    } catch (e) {
      err += `${name}: ${f}: ${errText(e)}\n`;
    }
  }
  return { texts, err };
}

const cat: Handler = (c, args, stdin) => {
  const { flags, rest } = parseArgs(args);
  const { texts, err } = readInputs(c, 'cat', rest, stdin);
  let out = texts.map((t) => t[1]).join('');
  if (flags.has('n')) out = joinLines(splitLines(out).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`));
  return { stdout: out, stderr: err, exit: err ? 1 : 0 };
};

/** `less` and `more` just print the file: there is no pager in this simulation. */
const less: Handler = (c, args, stdin) => {
  const { rest } = parseArgs(args);
  const { texts, err } = readInputs(c, 'less', rest, stdin);
  return { stdout: texts.map((t) => t[1]).join(''), stderr: err, exit: err ? 1 : 0 };
};

function headTail(which: 'head' | 'tail'): Handler {
  return (c, args, stdin) => {
    // Accept the old shorthand `-5` for `-n 5`.
    const { values, rest } = parseArgs(args.map((a) => (/^-\d+$/.test(a) ? `-n${a.slice(1)}` : a)), 'nc');
    const spec = values.n ?? '10';
    const count = parseInt(spec.replace(/^\+/, ''), 10);
    if (Number.isNaN(count)) return fail(`${which}: invalid number of lines: '${spec}'`);
    const { texts, err } = readInputs(c, which, rest, stdin);
    let out = '';
    texts.forEach(([name, text], i) => {
      const lines = splitLines(text);
      let picked: string[];
      if (which === 'head') picked = lines.slice(0, count);
      else if (spec.startsWith('+')) picked = lines.slice(count - 1); // tail -n +3 = from line 3
      else picked = count === 0 ? [] : lines.slice(-count);
      if (texts.length > 1) out += `${i > 0 ? '\n' : ''}==> ${name} <==\n`;
      out += joinLines(picked);
    });
    return { stdout: out, stderr: err, exit: err ? 1 : 0 };
  };
}

// ───────────────────────────── stat / file ─────────────────────────────

const stat: Handler = (c, args) => {
  const { rest } = parseArgs(args);
  if (rest.length === 0) return fail("stat: missing operand\nTry 'stat --help' for more information.");
  let out = '';
  let err = '';
  for (const f of rest) {
    try {
      const n = walk(c.host, abs(c, f), c.cred);
      const size = sizeOf(n);
      const kind = n.type === 'dir' ? 'directory' : size === 0 ? 'regular empty file' : 'regular file';
      const links = n.type === 'dir' ? 2 + Object.values(n.children!).filter((k) => k.type === 'dir').length : 1;
      const octal = (n.mode & 0o7777).toString(8).padStart(4, '0');
      out += `  File: ${f}\n`;
      out += `  Size: ${String(size).padEnd(10)}\tBlocks: ${String(Math.ceil(size / 4096) * 8).padEnd(10)} IO Block: 4096   ${kind}\n`;
      out += `Device: 802h/2050d\tInode: ${String(n.ino).padEnd(11)} Links: ${links}\n`;
      out += `Access: (${octal}/${modeString(n)})  Uid: (${String(uidOf(c.host, n.owner) ?? '?').padStart(5)}/${n.owner.padStart(8)})   Gid: (${String(gidOf(c.host, n.group) ?? '?').padStart(5)}/${n.group.padStart(8)})\n`;
      out += `Access: ${statStamp(n.atime)}\nModify: ${statStamp(n.mtime)}\nChange: ${statStamp(n.ctime)}\n Birth: -\n`;
    } catch (e) {
      err += `stat: cannot statx '${f}': ${errText(e)}\n`;
    }
  }
  return { stdout: out, stderr: err, exit: err ? 1 : 0 };
};

/** Guesses a file's type from its name and first bytes, like file(1). */
function describe(name: string, node: FsNode): string {
  if (node.type === 'dir') return 'directory';
  const text = node.content ?? '';
  if (text === '') return 'empty';
  if (text.startsWith('\x7fELF')) return 'ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, stripped';
  if (text.startsWith('#!')) return `${text.includes('python') ? 'Python script' : 'Bourne-Again shell script'}, ASCII text executable`;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  const byExt: Record<string, string> = {
    csv: 'CSV text', json: 'JSON text data', pdf: 'PDF document, version 1.7', xml: 'XML 1.0 document, ASCII text',
    xlsx: 'Microsoft Excel 2007+', docx: 'Microsoft Word 2007+', zip: 'Zip archive data, at least v2.0 to extract',
    gz: 'gzip compressed data', png: 'PNG image data', jpg: 'JPEG image data', sh: 'Bourne-Again shell script, ASCII text executable',
  };
  if (Object.hasOwn(byExt, ext)) return byExt[ext];
  if (name === 'wtmp' || name === 'btmp' || name === 'lastlog') return 'data';
  return splitLines(text).some((l) => l.length > 300) ? 'ASCII text, with very long lines' : 'ASCII text';
}

const file: Handler = (c, args) => {
  const { rest } = parseArgs(args);
  if (rest.length === 0) return fail('Usage: file [-bchiklLNnprsvzZ0] [--apple] [--extension] [--mime-encoding]\n            [--mime-type] [-e <testname>] [-F <separator>]  [-f <namefile>]\n            [-m <magicfiles>] [-P <parameter=value>] <file> ...');
  let out = '';
  for (const f of rest) {
    try {
      const node = walk(c.host, abs(c, f), c.cred);
      if (node.type === 'file' && !canRead(node, c.cred)) out += `${f}: regular file, no read permission\n`;
      else out += `${f}: ${describe(basename(abs(c, f)), node)}\n`;
    } catch (e) {
      out += `${f}: cannot open \`${f}' (${errText(e)})\n`;
    }
  }
  return { stdout: out };
};

// ───────────────────────────── touch / mkdir / rm ─────────────────────────────

const touch: Handler = (c, args) => {
  const { rest } = parseArgs(args);
  if (rest.length === 0) return fail("touch: missing file operand\nTry 'touch --help' for more information.");
  let err = '';
  const now = c.world.time;
  for (const f of rest) {
    try {
      const existing = (() => {
        try {
          return walk(c.host, abs(c, f), c.cred);
        } catch (e) {
          if (e instanceof FsError && e.code === 'ENOENT') return undefined;
          throw e;
        }
      })();
      if (!existing) writeTracked(c, f, '');
      else if (c.cred.user !== 'root' && existing.owner !== c.cred.user && !((existing.mode >> (c.cred.groups.includes(existing.group) ? 3 : 0)) & 2)) {
        throw new FsError('EACCES');
      } else existing.mtime = existing.atime = existing.ctime = now;
    } catch (e) {
      err += `touch: cannot touch '${f}': ${errText(e)}\n`;
    }
  }
  return { stderr: err, exit: err ? 1 : 0 };
};

const mkdir: Handler = (c, args) => {
  const { flags, rest } = parseArgs(args);
  if (rest.length === 0) return fail("mkdir: missing operand\nTry 'mkdir --help' for more information.");
  let err = '';
  for (const d of rest) {
    try {
      if (flags.has('p')) {
        // create each missing level in turn: a, a/b, a/b/c
        const parts = abs(c, d).split('/').filter(Boolean);
        let path = '';
        for (const part of parts) {
          path += `/${part}`;
          if (!getNode(c.host, path)) makeDir(c.host, path, c.cred, c.world.time);
        }
      } else makeDir(c.host, abs(c, d), c.cred, c.world.time);
    } catch (e) {
      err += `mkdir: cannot create directory '${d}': ${errText(e)}\n`;
    }
  }
  return { stderr: err, exit: err ? 1 : 0 };
};

const rm: Handler = (c, args) => {
  const { flags, rest } = parseArgs(args);
  const recursive = flags.has('r') || flags.has('R');
  const force = flags.has('f');
  if (rest.length === 0) return force ? {} : fail("rm: missing operand\nTry 'rm --help' for more information.");
  let err = '';
  for (const f of rest) {
    try {
      remove(c.host, abs(c, f), c.cred, c.world.time, recursive);
      emit(c.world, { host: c.host.hostname, user: c.cred.user, sourceIp: c.session.sourceIp, type: 'file.delete', details: { path: abs(c, f), loginUser: c.session.user } });
    } catch (e) {
      if (force && e instanceof FsError && e.code === 'ENOENT') continue;
      err += `rm: cannot remove '${f}': ${errText(e)}\n`;
    }
  }
  return { stderr: err, exit: err ? 1 : 0 };
};

// ───────────────────────────── cp / mv ─────────────────────────────

/** If `dst` is an existing directory, things are copied/moved INTO it. */
function destinationFor(c: CmdCtx, src: string, dst: string): string {
  const full = abs(c, dst);
  return getNode(c.host, full)?.type === 'dir' ? `${full}/${basename(abs(c, src))}` : full;
}

const cp: Handler = (c, args) => {
  const { flags, rest } = parseArgs(args);
  const recursive = flags.has('r') || flags.has('R') || flags.has('a');
  if (rest.length < 2) return fail(rest.length ? `cp: missing destination file operand after '${rest[0]}'` : 'cp: missing file operand');
  const dst = rest[rest.length - 1];
  const sources = rest.slice(0, -1);
  if (sources.length > 1 && getNode(c.host, abs(c, dst))?.type !== 'dir') return fail(`cp: target '${dst}' is not a directory`);
  let err = '';
  for (const src of sources) {
    try {
      const node = walk(c.host, abs(c, src), c.cred);
      const target = destinationFor(c, src, dst);
      if (node.type === 'dir') {
        if (!recursive) {
          err += `cp: -r not specified; omitting directory '${src}'\n`;
          continue;
        }
        if (!canRead(node, c.cred)) throw new FsError('EACCES');
        // makeDir checks we may create the target; then we fill it with a deep copy.
        makeDir(c.host, target, c.cred, c.world.time);
        needRoom(c.host, nodesIn(node), bytesIn(node));
        getNode(c.host, target)!.children = cloneNode(c.host, node, c.cred, c.world.time).children;
      } else {
        const existed = !!getNode(c.host, target);
        writeFile(c.host, target, readTracked(c, src), c.cred, c.world.time);
        if (!existed) getNode(c.host, target)!.mode = node.mode & 0o777; // new copies keep the source's mode
      }
      emit(c.world, { host: c.host.hostname, user: c.cred.user, sourceIp: c.session.sourceIp, type: 'file.write', details: { path: target, copiedFrom: abs(c, src), loginUser: c.session.user } });
    } catch (e) {
      const text = errText(e);
      err += e instanceof FsError && e.code === 'ENOENT' ? `cp: cannot stat '${src}': ${text}\n` : `cp: cannot copy '${src}' to '${dst}': ${text}\n`;
    }
  }
  return { stderr: err, exit: err ? 1 : 0 };
};

const mv: Handler = (c, args) => {
  const { rest } = parseArgs(args);
  if (rest.length < 2) return fail(rest.length ? `mv: missing destination file operand after '${rest[0]}'` : 'mv: missing file operand');
  const dst = rest[rest.length - 1];
  const sources = rest.slice(0, -1);
  if (sources.length > 1 && getNode(c.host, abs(c, dst))?.type !== 'dir') return fail(`mv: target '${dst}' is not a directory`);
  let err = '';
  for (const src of sources) {
    try {
      walk(c.host, abs(c, src), c.cred);
    } catch (e) {
      err += `mv: cannot stat '${src}': ${errText(e)}\n`;
      continue;
    }
    try {
      const target = destinationFor(c, src, dst);
      rename(c.host, abs(c, src), target, c.cred, c.world.time);
      emit(c.world, { host: c.host.hostname, user: c.cred.user, sourceIp: c.session.sourceIp, type: 'file.move', details: { from: abs(c, src), to: target, loginUser: c.session.user } });
    } catch (e) {
      err += `mv: cannot move '${src}' to '${dst}': ${errText(e)}\n`;
    }
  }
  return { stderr: err, exit: err ? 1 : 0 };
};

// ───────────────────────────── chmod / chown ─────────────────────────────

/** Applies "755" or symbolic modes like "u+x,go-w" to an existing mode. Returns null if invalid. */
function applyMode(spec: string, current: number, isDir: boolean): number | null {
  if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8);
  let mode = current;
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)([+\-=])([rwxXt]*)$/.exec(clause);
    if (!m) return null;
    const who = m[1] === '' || m[1].includes('a') ? 'ugo' : m[1];
    let bits = 0;
    for (const ch of m[3]) {
      const bit = ch === 'r' ? 4 : ch === 'w' ? 2 : ch === 'x' || (ch === 'X' && (isDir || current & 0o111)) ? 1 : 0;
      for (const w of who) bits |= bit << (w === 'u' ? 6 : w === 'g' ? 3 : 0);
      if (ch === 't') bits |= 0o1000;
    }
    const mask = [...who].reduce((acc, w) => acc | (7 << (w === 'u' ? 6 : w === 'g' ? 3 : 0)), 0);
    if (m[2] === '+') mode |= bits;
    else if (m[2] === '-') mode &= ~bits;
    else mode = (mode & ~mask) | bits;
  }
  return mode;
}

/** Calls `fn` for a path and, with -R, everything below it. */
function eachPath(c: CmdCtx, path: string, recursive: boolean, fn: (p: string, n: FsNode) => void): void {
  const node = walk(c.host, path, c.cred);
  fn(path, node);
  if (recursive && node.type === 'dir') {
    for (const name of Object.keys(node.children!)) eachPath(c, `${path}/${name}`, true, fn);
  }
}

const chmodCmd: Handler = (c, args) => {
  // A mode like "-x" looks like an option, so pull the mode out by hand.
  const recursive = args.includes('-R');
  const rest = args.filter((a) => a !== '-R');
  if (rest.length < 2) return fail(rest.length ? `chmod: missing operand after '${rest[0]}'` : 'chmod: missing operand');
  const [spec, ...files] = rest;
  let err = '';
  for (const f of files) {
    try {
      let bad = false;
      eachPath(c, abs(c, f), recursive, (p, n) => {
        const mode = applyMode(spec, n.mode, n.type === 'dir');
        if (mode === null) bad = true;
        else chmod(c.host, p, mode, c.cred, c.world.time);
      });
      if (bad) return fail(`chmod: invalid mode: '${spec}'`);
    } catch (e) {
      const text = errText(e);
      err += e instanceof FsError && e.code === 'EPERM' ? `chmod: changing permissions of '${f}': ${text}\n` : `chmod: cannot access '${f}': ${text}\n`;
    }
  }
  return { stderr: err, exit: err ? 1 : 0 };
};

const chownCmd: Handler = (c, args) => {
  const { flags, rest } = parseArgs(args);
  if (rest.length < 2) return fail(rest.length ? `chown: missing operand after '${rest[0]}'` : 'chown: missing operand');
  const [spec, ...files] = rest;
  const [owner, group] = spec.split(':');
  if (owner && !findUser(c.host, owner)) return fail(`chown: invalid user: '${spec}'`);
  if (group && !readGroups(c.host).some((g) => g.name === group)) return fail(`chown: invalid group: '${spec}'`);
  let err = '';
  for (const f of files) {
    try {
      eachPath(c, abs(c, f), flags.has('R'), (p) => chown(c.host, p, owner || null, group || null, c.cred, c.world.time));
    } catch (e) {
      const text = errText(e);
      err += e instanceof FsError && e.code === 'EPERM' ? `chown: changing ownership of '${f}': ${text}\n` : `chown: cannot access '${f}': ${text}\n`;
    }
  }
  return { stderr: err, exit: err ? 1 : 0 };
};

// ───────────────────────────── find ─────────────────────────────

const find: Handler = (c, args) => {
  const paths: string[] = [];
  let i = 0;
  while (i < args.length && !args[i].startsWith('-')) paths.push(args[i++]);
  if (paths.length === 0) paths.push('.');

  const tests: ((name: string, node: FsNode) => boolean)[] = [];
  let maxDepth = Infinity;
  for (; i < args.length; i++) {
    const pred = args[i];
    const value = args[i + 1];
    const needValue = ['-name', '-iname', '-type', '-user', '-group', '-maxdepth'].includes(pred);
    if (needValue && value === undefined) return fail(`find: missing argument to \`${pred}'`);
    if (pred === '-name' || pred === '-iname') {
      const re = wildcard(value, { ignoreCase: pred === '-iname' });
      tests.push((name) => re.test(name));
    } else if (pred === '-type') tests.push((_, n) => (value === 'd' ? n.type === 'dir' : value === 'f' ? n.type === 'file' : false));
    else if (pred === '-user') tests.push((_, n) => n.owner === value);
    else if (pred === '-group') tests.push((_, n) => n.group === value);
    else if (pred === '-maxdepth') maxDepth = Number(value);
    else if (pred === '-print') continue;
    else return fail(`find: unknown predicate \`${pred}'`);
    if (needValue) i++;
  }

  let out = '';
  let err = '';
  const visit = (shown: string, full: string, node: FsNode, depth: number) => {
    if (tests.every((t) => t(basename(full), node))) out += `${shown}\n`;
    if (node.type !== 'dir' || depth >= maxDepth) return;
    let names: string[];
    try {
      names = listDir(c.host, full, c.cred, c.world.time);
      if (!canExec(node, c.cred)) throw new FsError('EACCES'); // also need search permission
    } catch {
      err += `find: ‘${shown}’: Permission denied\n`;
      return;
    }
    for (const name of names.sort()) {
      visit(shown.endsWith('/') ? shown + name : `${shown}/${name}`, `${full}/${name}`, node.children![name], depth + 1);
    }
  };
  for (const p of paths) {
    try {
      visit(p, abs(c, p), walk(c.host, abs(c, p), c.cred), 0);
    } catch (e) {
      err += `find: ‘${p}’: ${errText(e)}\n`;
    }
  }
  return { stdout: out, stderr: err, exit: err ? 1 : 0 };
};

export const fileCommands: Record<string, Handler> = {
  pwd, cd, ls, cat, less, more: less, head: headTail('head'), tail: headTail('tail'),
  stat, file, touch, mkdir, rm, cp, mv, chmod: chmodCmd, chown: chownCmd, find,
};

export type { CmdResult };
