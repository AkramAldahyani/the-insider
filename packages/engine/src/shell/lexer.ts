/**
 * Step 1 of running a command line: split the text into tokens.
 *
 *   echo "hello world" > out.txt && cat out.txt
 *   └word┘ └───word──┘ op └word─┘ op └word┘ └word┘
 *
 * A word is kept as a list of PARTS, each remembering how it was quoted,
 * because quoting decides what happens later: `*` expands to file names only
 * when unquoted, `$HOME` expands unless inside single quotes, and so on.
 */

export interface WordPart {
  text: string;
  /** '' = unquoted, "'" = single-quoted (fully literal), '"' = double-quoted. */
  quote: '' | "'" | '"';
}

export type Token = { type: 'word'; parts: WordPart[] } | { type: 'op'; value: string };

export class ShellSyntaxError extends Error {}

const OPERATORS = ['2>&1', '2>>', '2>', '&&', '||', '>>', '|', ';', '>', '<', '&'];

export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let parts: WordPart[] | null = null; // the word being built, if any

  const add = (text: string, quote: WordPart['quote']) => {
    if (!parts) parts = [];
    const last = parts[parts.length - 1];
    if (last && last.quote === quote) last.text += text;
    else parts.push({ text, quote });
  };
  const endWord = () => {
    if (parts) tokens.push({ type: 'word', parts });
    parts = null;
  };

  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    if (ch === ' ' || ch === '\t') {
      endWord();
      i++;
      continue;
    }
    // A '#' at the start of a word begins a comment.
    if (ch === '#' && !parts) break;

    if (ch === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new ShellSyntaxError("unexpected EOF while looking for matching `''");
      add(line.slice(i + 1, end), "'");
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      let text = '';
      let j = i + 1;
      for (;;) {
        if (j >= line.length) throw new ShellSyntaxError('unexpected EOF while looking for matching `"\'');
        if (line[j] === '"') break;
        // Inside double quotes a backslash only escapes these characters.
        if (line[j] === '\\' && '"\\$`'.includes(line[j + 1] ?? '')) {
          // "\$" must stay literal: hand it to the expander as a single-quoted piece.
          if (line[j + 1] === '$') {
            add(text, '"');
            add('$', "'");
            text = '';
          } else text += line[j + 1];
          j += 2;
          continue;
        }
        text += line[j++];
      }
      add(text, '"');
      i = j + 1;
      continue;
    }
    if (ch === '\\') {
      // Backslash outside quotes: the next character is taken literally.
      if (i + 1 < line.length) add(line[i + 1], "'");
      i += 2;
      continue;
    }

    // Operators. "2>" only counts when the 2 starts a new word (so "file2>x" is not stderr).
    const op = OPERATORS.find((o) => line.startsWith(o, i) && (!o.startsWith('2') || !parts));
    if (op) {
      endWord();
      tokens.push({ type: 'op', value: op });
      i += op.length;
      continue;
    }

    add(ch, '');
    i++;
  }
  endWord();
  return tokens;
}
