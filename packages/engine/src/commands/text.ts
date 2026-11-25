/** Text-processing commands: the ones you chain together with pipes. */
import { MAX_CONTEXT } from '../core/limits';
import { literal, pattern, type Matcher } from '../core/pattern';
import { getNode, listDir } from '../fs/vfs';
import type { CmdCtx, Handler } from './types';
import { fail } from './types';
import { abs, errText, joinLines, parseArgs, readTracked, splitLines } from './util';

const echo: Handler = (_c, args) => {
  let newline = true;
  let escapes = false;
  let i = 0;
  // echo's options must come first and look exactly like -n / -e / -ne
  while (i < args.length && /^-[ne]+$/.test(args[i])) {
    if (args[i].includes('n')) newline = false;
    if (args[i].includes('e')) escapes = true;
    i++;
  }
  let text = args.slice(i).join(' ');
  if (escapes) text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
  return { stdout: text + (newline ? '\n' : '') };
};

/**
 * Reads a grep pattern (see core/pattern.ts for why it is not a JavaScript RegExp).
 * Plain grep uses "basic" syntax where + ? | ( ) { } are ordinary characters
 * unless escaped.
 */
function grepRegex(text: string, opts: { fixed: boolean; extended: boolean; ignoreCase: boolean }): Matcher {
  if (opts.fixed) return literal(text, opts.ignoreCase);
  let source = text;
  if (!opts.extended) {
    source = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === '\\' && next !== undefined) {
        source += '+?|(){}'.includes(next) ? next : ch + next;
        i++;
      } else source += '+?|(){}'.includes(ch) ? `\\${ch}` : ch;
    }
  }
  return pattern(source, opts.ignoreCase) ?? literal(text, opts.ignoreCase); // not a valid pattern: search for it literally
}

const grep: Handler = (c, args, stdin) => {
  const { flags, values, rest } = parseArgs(args, 'ABC');
  const context = (v: string | undefined) => Math.min(MAX_CONTEXT, Math.max(0, parseInt(v ?? '0', 10) || 0));
  const after = context(values.A ?? values.C);
  const before = context(values.B ?? values.C);
  if (rest.length === 0) return fail("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.", 2);
  const [wanted, ...targets] = rest;
  const recursive = flags.has('r') || flags.has('R');
  const regex = grepRegex(wanted, { fixed: flags.has('F'), extended: flags.has('E'), ignoreCase: flags.has('i') });
  let err = '';

  // Work out the list of inputs: [label, text]
  const inputs: [string, string][] = [];
  const addFile = (shown: string) => {
    const node = getNode(c.host, abs(c, shown));
    try {
      if (node?.type === 'dir') {
        if (!recursive) {
          err += `grep: ${shown}: Is a directory\n`;
          return;
        }
        for (const name of listDir(c.host, abs(c, shown), c.cred, c.world.time).sort()) {
          addFile(shown.endsWith('/') ? shown + name : `${shown}/${name}`);
        }
      } else inputs.push([shown, readTracked(c, shown)]);
    } catch (e) {
      err += `grep: ${shown}: ${errText(e)}\n`;
    }
  };
  if (targets.length === 0 && !recursive) inputs.push(['(standard input)', stdin]);
  else for (const t of targets.length ? targets : ['.']) addFile(t);

  const showName = (recursive || targets.length > 1) && !flags.has('h');
  let out = '';
  let found = false;
  for (const [label, text] of inputs) {
    const lines = splitLines(text);
    const hit = lines.map((line) => regex.test(line) !== flags.has('v')); // -v inverts the match
    const count = hit.filter(Boolean).length;
    if (!(flags.has('c') || flags.has('l') || flags.has('q'))) {
      // -A/-B/-C: also show lines around each match, with "--" between separate groups.
      const show = hit.map((_, i) => hit.slice(Math.max(0, i - after), i + before + 1).some(Boolean));
      let previous = -1;
      lines.forEach((line, i) => {
        if (!show[i]) return;
        if ((before || after) && previous >= 0 && i > previous + 1) out += '--\n';
        previous = i;
        const sep = hit[i] ? ':' : '-';
        out += `${showName ? `${label}${sep}` : ''}${flags.has('n') ? `${i + 1}${sep}` : ''}${line}\n`;
      });
    }
    if (count > 0) found = true;
    if (flags.has('c')) out += `${showName ? `${label}:` : ''}${count}\n`;
    else if (flags.has('l') && count > 0) out += `${label}\n`;
  }
  // grep's exit code: 0 = found something, 1 = found nothing, 2 = error
  return { stdout: out, stderr: err, exit: found ? 0 : err ? 2 : 1 };
};

/** Shared "read the files, or stdin if none" for the small filters below. */
function gather(c: CmdCtx, name: string, files: string[], stdin: string): { text: string; err: string } {
  if (files.length === 0) return { text: stdin, err: '' };
  let text = '';
  let err = '';
  for (const f of files) {
    try {
      text += readTracked(c, f);
    } catch (e) {
      err += `${name}: ${f}: ${errText(e)}\n`;
    }
  }
  return { text, err };
}

const wc: Handler = (c, args, stdin) => {
  const { flags, rest } = parseArgs(args);
  const count = (text: string) => ({
    l: (text.match(/\n/g) ?? []).length,
    w: text.split(/\s+/).filter(Boolean).length,
    c: text.length,
  });
  const show = (n: { l: number; w: number; c: number }, label: string) => {
    const cols = (['l', 'w', 'c'] as const).filter((k) => flags.size === 0 || flags.has(k)).map((k) => String(n[k]));
    const body = cols.length === 1 ? cols[0] : cols.map((x) => x.padStart(7)).join(' ');
    return `${body}${label ? ` ${label}` : ''}\n`;
  };
  if (rest.length === 0) return { stdout: show(count(stdin), '') };
  let out = '';
  let err = '';
  const total = { l: 0, w: 0, c: 0 };
  for (const f of rest) {
    try {
      const n = count(readTracked(c, f));
      total.l += n.l;
      total.w += n.w;
      total.c += n.c;
      out += show(n, f);
    } catch (e) {
      err += `wc: ${f}: ${errText(e)}\n`;
    }
  }
  if (rest.length > 1) out += show(total, 'total');
  return { stdout: out, stderr: err, exit: err ? 1 : 0 };
};

const sort: Handler = (c, args, stdin) => {
  const { flags, rest } = parseArgs(args);
  const { text, err } = gather(c, 'sort', rest, stdin);
  let lines = splitLines(text);
  if (flags.has('n')) lines.sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
  else lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (flags.has('r')) lines.reverse();
  if (flags.has('u')) lines = lines.filter((l, i) => i === 0 || l !== lines[i - 1]);
  return { stdout: joinLines(lines), stderr: err, exit: err ? 2 : 0 };
};

/** uniq: collapse identical NEIGHBOURING lines (so usually used after sort). -c adds counts. */
const uniq: Handler = (c, args, stdin) => {
  const { flags, rest } = parseArgs(args);
  const { text, err } = gather(c, 'uniq', rest, stdin);
  const groups: [string, number][] = [];
  for (const line of splitLines(text)) {
    const last = groups[groups.length - 1];
    if (last && last[0] === line) last[1]++;
    else groups.push([line, 1]);
  }
  const lines = groups.map(([line, n]) => (flags.has('c') ? `${String(n).padStart(7)} ${line}` : line));
  return { stdout: joinLines(lines), stderr: err, exit: err ? 1 : 0 };
};

export const textCommands: Record<string, Handler> = { echo, grep, wc, sort, uniq };
