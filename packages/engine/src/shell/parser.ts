/**
 * Step 2: group tokens into a small tree.
 *
 *   a | b > f ; c && d
 *
 * becomes a LIST of items, each item being a PIPELINE of simple commands,
 * followed by the operator that connects it to the next item:
 *
 *   [ { pipeline: [a, b(>f)], next: ';' },
 *     { pipeline: [c],        next: '&&' },
 *     { pipeline: [d],        next: null } ]
 *
 * The tree is plain JSON, so "the rest of the line" can be stored in the world
 * while a command waits for a password.
 */
import { ShellSyntaxError, tokenize, type WordPart } from './lexer';

export interface Redirect {
  /** 1 = stdout, 2 = stderr. */
  fd: 1 | 2;
  append: boolean;
  /** File to write to. null means "2>&1" (send stderr wherever stdout goes). */
  target: WordPart[] | null;
}

export interface SimpleCommand {
  words: WordPart[][];
  redirects: Redirect[];
  /** `< file` */
  stdin: WordPart[] | null;
}

export interface ListItem {
  pipeline: SimpleCommand[];
  next: ';' | '&&' | '||' | null;
}

const unexpected = (tok: string) => new ShellSyntaxError(`syntax error near unexpected token \`${tok}'`);

export function parse(line: string): ListItem[] {
  const tokens = tokenize(line);
  const items: ListItem[] = [];
  let pipeline: SimpleCommand[] = [];
  let cmd: SimpleCommand = { words: [], redirects: [], stdin: null };
  const isEmpty = (c: SimpleCommand) => c.words.length === 0 && c.redirects.length === 0 && !c.stdin;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'word') {
      cmd.words.push(tok.parts);
      continue;
    }
    const op = tok.value;
    if (op === '&') throw new ShellSyntaxError('background jobs (&) are not supported in this simulation');

    if (op === '|') {
      if (isEmpty(cmd)) throw unexpected(op);
      pipeline.push(cmd);
      cmd = { words: [], redirects: [], stdin: null };
    } else if (op === ';' || op === '&&' || op === '||') {
      if (isEmpty(cmd)) throw unexpected(op);
      pipeline.push(cmd);
      items.push({ pipeline, next: op });
      pipeline = [];
      cmd = { words: [], redirects: [], stdin: null };
    } else if (op === '2>&1') {
      cmd.redirects.push({ fd: 2, append: false, target: null });
    } else {
      // > >> 2> 2>> < : the next token must be the file name
      const next = tokens[++i];
      if (!next) throw unexpected('newline');
      if (next.type !== 'word') throw unexpected(next.value);
      if (op === '<') cmd.stdin = next.parts;
      else cmd.redirects.push({ fd: op.startsWith('2') ? 2 : 1, append: op.endsWith('>>'), target: next.parts });
    }
  }

  if (!isEmpty(cmd)) {
    pipeline.push(cmd);
    items.push({ pipeline, next: null });
  } else if (pipeline.length > 0) {
    // "ls |" - a pipe with nothing after it
    throw new ShellSyntaxError('syntax error: unexpected end of file');
  } else if (items.length > 0) {
    const last = items[items.length - 1];
    if (last.next === ';') last.next = null; // a trailing ";" is fine
    else throw new ShellSyntaxError('syntax error: unexpected end of file');
  }
  return items;
}
