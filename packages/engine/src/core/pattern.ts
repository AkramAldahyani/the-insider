/**
 * Search patterns typed by players (Phase 6, part H): grep's regular
 * expressions, and the * and ? of file names and SIEM searches.
 *
 * Why not JavaScript's own RegExp? With some patterns ("(a+)+$") it tries
 * every way to split a text, which takes longer than the universe has
 * existed. One player could freeze the server for everybody. The matcher here
 * never goes back: it reads a text once, keeping a list of all the places in
 * the pattern it could be at. The work is at most (length of the text) x
 * (length of the pattern).
 *
 * It answers one question, "does this line match?", and knows what grep -E
 * knows: . [] [^] [:digit:] ^ $ | ( ) * + ? {n,m} \w \d \s \b. It does not
 * know back-references and look-ahead (grep -E has no look-ahead either).
 */

/** The longest compiled pattern. "(a{100}){100}" would be a whole program of its own. */
const MAX_STEPS = 3000;
const MAX_REPEAT = 255;

export interface Matcher {
  test(text: string): boolean;
}

type Test = (ch: string) => boolean;
type Node =
  | { t: 'char'; ok: Test }
  | { t: 'assert'; what: '^' | '$' | 'b' | 'B' }
  | { t: 'seq'; parts: Node[] }
  | { t: 'alt'; ways: Node[] }
  | { t: 'repeat'; node: Node; min: number; max: number };

type Step =
  | { op: 'char'; ok: Test }
  | { op: 'assert'; what: '^' | '$' | 'b' | 'B' }
  | { op: 'split'; a: number; b: number }
  | { op: 'jump'; to: number }
  | { op: 'done' };

const isWord = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9_]/.test(ch);
const CLASSES: Record<string, Test> = {
  w: isWord, W: (c) => !isWord(c), d: (c) => c >= '0' && c <= '9', D: (c) => !(c >= '0' && c <= '9'), s: (c) => /\s/.test(c), S: (c) => !/\s/.test(c),
};
const POSIX: Record<string, RegExp> = {
  alpha: /[A-Za-z]/, digit: /\d/, alnum: /[A-Za-z0-9]/, upper: /[A-Z]/, lower: /[a-z]/, space: /\s/, punct: /[!-/:-@[-`{-~]/, xdigit: /[0-9A-Fa-f]/, blank: /[ \t]/,
};
const ESCAPES: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f', v: '\v' };

class PatternError extends Error {}

class Parser {
  private i = 0;
  constructor(private readonly src: string, private readonly ignoreCase: boolean) {}

  parse(): Node {
    const node = this.alternatives();
    if (this.i < this.src.length) throw new PatternError('unmatched )');
    return node;
  }

  private alternatives(): Node {
    const ways = [this.sequence()];
    while (this.src[this.i] === '|') {
      this.i++;
      ways.push(this.sequence());
    }
    return ways.length === 1 ? ways[0] : { t: 'alt', ways };
  }

  private sequence(): Node {
    const parts: Node[] = [];
    while (this.i < this.src.length && this.src[this.i] !== '|' && this.src[this.i] !== ')') parts.push(this.repeated());
    return { t: 'seq', parts };
  }

  private repeated(): Node {
    let node = this.atom();
    for (;;) {
      const ch = this.src[this.i];
      const braces = ch === '{' ? /^\{(\d{1,4})(,(\d{0,4}))?\}/.exec(this.src.slice(this.i, this.i + 12)) : null;
      let min: number, max: number;
      if (ch === '*') [min, max] = [0, Infinity];
      else if (ch === '+') [min, max] = [1, Infinity];
      else if (ch === '?') [min, max] = [0, 1];
      else if (braces) {
        min = Number(braces[1]);
        max = !braces[2] ? min : braces[3] === '' ? Infinity : Number(braces[3]);
        if (max < min || min > MAX_REPEAT || (max !== Infinity && max > MAX_REPEAT)) throw new PatternError('bad repeat');
      } else return node;
      if (node.t === 'assert') throw new PatternError('nothing to repeat');
      this.i += braces ? braces[0].length : 1;
      if (this.src[this.i] === '?') this.i++; // "as few as possible" changes what is found first, not whether
      node = { t: 'repeat', node, min, max };
      if ('*+?'.includes(this.src[this.i] ?? ' ')) throw new PatternError('nothing to repeat');
    }
  }

  private anyCase(ok: Test): Test {
    return this.ignoreCase ? (c) => ok(c) || ok(c.toLowerCase()) || ok(c.toUpperCase()) : ok;
  }

  private one(ok: Test): Node {
    return { t: 'char', ok: this.anyCase(ok) };
  }

  private atom(): Node {
    const ch = this.src[this.i++];
    switch (ch) {
      case '(': {
        if (this.src[this.i] === '?') {
          if (this.src[this.i + 1] !== ':') throw new PatternError('look-around');
          this.i += 2;
        }
        const node = this.alternatives();
        if (this.src[this.i++] !== ')') throw new PatternError('unmatched (');
        return node;
      }
      case '*': case '+': case '?': throw new PatternError('nothing to repeat');
      case '.': return this.one((c) => c !== '\n' && c !== '\r');
      case '^': case '$': return { t: 'assert', what: ch };
      case '[': return { t: 'char', ok: this.set() };
      case '\\': {
        const next = this.src[this.i++];
        if (next === undefined) throw new PatternError('trailing backslash');
        if (next === 'b' || next === 'B') return { t: 'assert', what: next };
        if (/[1-9]/.test(next)) throw new PatternError('back-reference');
        if (CLASSES[next]) return this.one(CLASSES[next]);
        const want = ESCAPES[next] ?? next;
        return this.one((c) => c === want);
      }
      default: return this.one((c) => c === ch);
    }
  }

  /** The inside of [...]. */
  private set(): Test {
    const negate = this.src[this.i] === '^';
    if (negate) this.i++;
    const tests: Test[] = [];
    for (let first = true; ; first = false) {
      const ch = this.src[this.i];
      if (ch === undefined) throw new PatternError('unmatched [');
      if (ch === ']' && !first) break;
      if (ch === ']' && first) {
        this.i++;
        if (negate) return () => true; // "[^]" is any character, "[]" none (as in JavaScript)
        return () => false;
      }
      const posix = /^\[:([a-z]+):\]/.exec(this.src.slice(this.i, this.i + 12));
      if (posix && Object.hasOwn(POSIX, posix[1])) {
        const re = POSIX[posix[1]];
        tests.push((c) => re.test(c));
        this.i += posix[0].length;
        continue;
      }
      const low = this.setChar();
      if (typeof low !== 'string') {
        tests.push(low);
        continue;
      }
      if (this.src[this.i] === '-' && this.src[this.i + 1] !== ']' && this.src[this.i + 1] !== undefined) {
        this.i++;
        const high = this.setChar();
        if (typeof high !== 'string') {
          tests.push((c) => c === low || c === '-', high);
          continue;
        }
        if (high < low) throw new PatternError('bad range');
        tests.push((c) => c >= low && c <= high);
      } else tests.push((c) => c === low);
    }
    this.i++;
    const inside = this.anyCase((c) => tests.some((t) => t(c)));
    return (c) => inside(c) !== negate;
  }

  private setChar(): string | Test {
    const ch = this.src[this.i++];
    if (ch !== '\\') return ch;
    const next = this.src[this.i++];
    if (next === undefined) throw new PatternError('trailing backslash');
    if (next === 'b') return '\b';
    return CLASSES[next] ?? ESCAPES[next] ?? next;
  }
}

/** Turns the pattern into a list of steps. */
function compile(node: Node): Step[] {
  const steps: Step[] = [];
  const add = (step: Step): number => {
    if (steps.length >= MAX_STEPS) throw new PatternError('too long');
    return steps.push(step) - 1;
  };
  const emit = (n: Node): void => {
    switch (n.t) {
      case 'char': add({ op: 'char', ok: n.ok }); return;
      case 'assert': add({ op: 'assert', what: n.what }); return;
      case 'seq': n.parts.forEach(emit); return;
      case 'alt': {
        const ends: number[] = [];
        n.ways.forEach((way, i) => {
          if (i === n.ways.length - 1) return emit(way);
          const split = add({ op: 'split', a: steps.length + 1, b: 0 });
          emit(way);
          ends.push(add({ op: 'jump', to: 0 }));
          (steps[split] as { b: number }).b = steps.length;
        });
        for (const e of ends) (steps[e] as { to: number }).to = steps.length;
        return;
      }
      case 'repeat': {
        for (let i = 0; i < n.min; i++) emit(n.node);
        if (n.max === Infinity) {
          const split = add({ op: 'split', a: steps.length + 1, b: 0 });
          emit(n.node);
          add({ op: 'jump', to: split });
          (steps[split] as { b: number }).b = steps.length;
          return;
        }
        const splits: number[] = [];
        for (let i = n.min; i < n.max; i++) {
          splits.push(add({ op: 'split', a: steps.length + 1, b: 0 }));
          emit(n.node);
        }
        for (const s of splits) (steps[s] as { b: number }).b = steps.length;
      }
    }
  };
  emit(node);
  add({ op: 'done' });
  return steps;
}

class Program implements Matcher {
  /** Step -> the last round in which it was put on the list (so nothing is on it twice). */
  private readonly seen: Uint32Array;
  private round = 0;
  constructor(private readonly steps: Step[]) {
    this.seen = new Uint32Array(steps.length);
  }

  test(text: string): boolean {
    let now: number[] = [];
    let next: number[] = [];
    for (let at = 0; at <= text.length; at++) {
      // A match may begin anywhere. (Steps already on the list for this position are not added again.)
      if (at === 0) this.round++;
      if (this.add(now, 0, text, at)) return true;
      if (at === text.length) return false;
      this.round++;
      next = [];
      for (const i of now) {
        const step = this.steps[i];
        if (step.op === 'char' && step.ok(text[at]) && this.add(next, i + 1, text, at + 1)) return true;
      }
      now = next;
    }
    return false;
  }

  /** Puts a step (and everything that can follow it without reading a character) on the list. True = the end was reached. */
  private add(list: number[], start: number, text: string, at: number): boolean {
    const todo = [start];
    while (todo.length > 0) {
      const i = todo.pop()!;
      if (this.seen[i] === this.round) continue;
      this.seen[i] = this.round;
      const step = this.steps[i];
      switch (step.op) {
        case 'done': return true;
        case 'char': list.push(i); break;
        case 'jump': todo.push(step.to); break;
        case 'split': todo.push(step.b, step.a); break;
        case 'assert': {
          const edge = isWord(text[at - 1]) !== isWord(text[at]);
          if (step.what === '^' ? at === 0 : step.what === '$' ? at === text.length : step.what === 'b' ? edge : !edge) todo.push(i + 1);
        }
      }
    }
    return false;
  }
}

/** The plain text, anywhere. */
export function literal(text: string, ignoreCase: boolean): Matcher {
  const wanted = ignoreCase ? text.toLowerCase() : text;
  return { test: (line) => (ignoreCase ? line.toLowerCase() : line).includes(wanted) };
}

/** A regular expression in "extended" syntax. Null if it is not one this matcher knows (then search for it literally). */
export function pattern(source: string, ignoreCase = false): Matcher | null {
  // Most searches are for plain words.
  if (!/[\\^$.*+?()[\]{}|]/.test(source)) return literal(source, ignoreCase);
  try {
    return new Program(compile(new Parser(source, ignoreCase).parse()));
  } catch (e) {
    if (e instanceof PatternError || e instanceof RangeError) return null; // (RangeError: thousands of nested brackets)
    throw e;
  }
}

/** One piece of a file-name pattern: a character, or a wildcard. */
export type WildPart = string | { wild: '*' | '?' };

/** Does the whole text match? It goes back at most to the last star, so it is never slow. */
export function wildMatch(parts: readonly WildPart[], text: string): boolean {
  let p = 0, t = 0, star = -1, from = 0;
  while (t < text.length) {
    const part = parts[p];
    if (part !== undefined && (typeof part === 'string' ? part === text[t] : part.wild === '?')) {
      p++;
      t++;
    } else if (typeof part === 'object' && part.wild === '*') {
      star = p++;
      from = t;
    } else if (star >= 0) {
      p = star + 1;
      t = ++from;
    } else return false;
  }
  while (typeof parts[p] === 'object' && (parts[p] as { wild: string }).wild === '*') p++;
  return p === parts.length;
}

/** "*.txt" as a matcher for whole names. `question`: "?" is a wildcard too. */
export function wildcard(source: string, { ignoreCase = false, question = true } = {}): Matcher {
  const fold = (s: string) => (ignoreCase ? s.toLowerCase() : s);
  const parts: WildPart[] = [...fold(source)].flatMap((c): WildPart[] => (c === '*' || (question && c === '?') ? [{ wild: c as '*' | '?' }] : [...c].length === 1 && c.length > 1 ? c.split('') : [c]));
  return { test: (text) => wildMatch(parts, fold(text)) };
}
