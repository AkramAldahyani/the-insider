/**
 * Line editing for the PC terminal, done in the browser.
 *
 * The server only ever receives FINISHED lines. Everything before Enter -
 * typing, Backspace, the arrow keys, command history, hiding passwords - is
 * handled here, so it feels instant and the server stays simple.
 *
 * xterm.js gives us raw key data ("a", "\r" for Enter, "\x1b[A" for Up...)
 * and draws whatever we write to it. This class keeps the text of the line
 * being typed and redraws it after every key.
 */

/** The little of xterm.js that the editor needs (also easy to fake in a test). */
export interface Screen {
  write(text: string): void;
  readonly cols: number;
}

export interface EditorEvents {
  /** Enter was pressed. */
  onLine(text: string): void;
  /** Ctrl+C. */
  onCancel(): void;
  /** Escape: stand up. */
  onEscape(): void;
  /** F2: switch user. */
  onSwitchUser(): void;
}

const ESC = '\x1b';

export class LineEditor {
  private prompt = '';
  private masked = false;
  private text = '';
  private cursor = 0;
  /** Lines sent earlier (never passwords), oldest first. */
  private history: string[] = [];
  /** Position while browsing history with Up/Down; history.length = "the new line". */
  private historyAt = 0;
  private draft = '';
  /** Screen row of the cursor, counted from the row where the prompt starts. */
  private cursorRow = 0;
  /** A line was sent and the answer has not arrived yet. */
  private waiting = false;
  /** Keys pressed while waiting. They are replayed when the answer arrives, so fast typing loses nothing. */
  private queued: string[] = [];

  constructor(
    private screen: Screen,
    private events: EditorEvents,
  ) {}

  /** Prints text from the server, then shows a fresh prompt. */
  show(output: string, prompt: string, masked: boolean): void {
    // If the server speaks while a line is half typed (the screen locked itself), start on a new row.
    if (!this.waiting && (this.text !== '' || this.cursorRow > 0)) this.screen.write('\r\n');
    this.waiting = false;
    let out = output.replace(/\r?\n/g, '\r\n');
    if (out !== '' && !out.endsWith('\n')) out += '\r\n';
    this.screen.write(out);
    this.prompt = prompt;
    this.masked = masked;
    this.text = '';
    this.cursor = 0;
    this.cursorRow = 0;
    this.historyAt = this.history.length;
    this.redraw();
    for (const data of this.queued.splice(0)) this.input(data);
  }

  /** What is shown for the typed text: the text itself, or stars for a password. */
  private shown(): string {
    return this.masked ? '*'.repeat(this.text.length) : this.text;
  }

  /** Redraws prompt + line and puts the cursor in the right place, also when the line wraps over several rows. */
  private redraw(): void {
    const cols = Math.max(1, this.screen.cols);
    const full = this.prompt + this.shown();
    let out = '';
    if (this.cursorRow > 0) out += `${ESC}[${this.cursorRow}A`; // back up to the row where the prompt starts
    out += `\r${ESC}[J${full}`; // clear from there to the end of the screen, write everything
    // A line that exactly fills a row leaves the cursor "hanging" at its end; nudge it onto the next row.
    if (full.length > 0 && full.length % cols === 0) out += ' \b';
    const endRow = Math.floor(full.length / cols);
    const at = this.prompt.length + this.cursor;
    const row = Math.floor(at / cols);
    const col = at % cols;
    if (endRow > row) out += `${ESC}[${endRow - row}A`;
    out += '\r';
    if (col > 0) out += `${ESC}[${col}C`;
    this.cursorRow = row;
    this.screen.write(out);
  }

  /** Moves the cursor past the end of the line and starts a new row (before sending or cancelling). */
  private finishLine(suffix = ''): void {
    this.cursor = this.text.length;
    this.redraw();
    this.screen.write(`${suffix}\r\n`);
    this.cursorRow = 0;
  }

  /** Feed with xterm's onData. One call may hold one key, or a whole pasted text. */
  input(data: string): void {
    if (this.waiting && data !== ESC) {
      this.queued.push(data);
      return;
    }
    // Keys with a multi-character code.
    switch (data) {
      case ESC: return this.events.onEscape();
      case `${ESC}OQ`: case `${ESC}[12~`: return this.events.onSwitchUser(); // F2
      case `${ESC}[A`: return this.browse(-1);
      case `${ESC}[B`: return this.browse(1);
      case `${ESC}[D`: return this.move(this.cursor - 1);
      case `${ESC}[C`: return this.move(this.cursor + 1);
      case `${ESC}[H`: case `${ESC}OH`: case `${ESC}[1~`: return this.move(0);
      case `${ESC}[F`: case `${ESC}OF`: case `${ESC}[4~`: return this.move(this.text.length);
      case `${ESC}[3~`: return this.erase(this.cursor, this.cursor + 1); // Delete
      default:
    }
    if (data.startsWith(ESC)) return; // any other special key: ignore
    // Plain characters and control keys (a paste arrives as many characters at once).
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      if (this.waiting) {
        // Enter was in the middle of a paste: the rest waits for the answer.
        this.queued.push(data.slice(i));
        return;
      }
      if (ch === '\r' || ch === '\n') this.submit();
      else if (ch === '\x7f' || ch === '\b') this.erase(this.cursor - 1, this.cursor);
      else if (ch === '\x03') this.cancel();
      else if (ch === '\x01') this.move(0); // Ctrl+A
      else if (ch === '\x05') this.move(this.text.length); // Ctrl+E
      else if (ch === '\x15') this.erase(0, this.cursor); // Ctrl+U
      else if (ch === '\x0b') this.erase(this.cursor, this.text.length); // Ctrl+K
      else if (ch === '\x0c') this.clearScreen(); // Ctrl+L
      else if (ch === '\t') this.insert('  ');
      else if (ch >= ' ') this.insert(ch);
    }
  }

  private insert(chars: string): void {
    this.text = this.text.slice(0, this.cursor) + chars + this.text.slice(this.cursor);
    this.cursor += chars.length;
    this.redraw();
  }

  private erase(from: number, to: number): void {
    if (from < 0 || from >= to) return;
    this.text = this.text.slice(0, from) + this.text.slice(to);
    this.cursor = from;
    this.redraw();
  }

  private move(to: number): void {
    this.cursor = Math.max(0, Math.min(this.text.length, to));
    this.redraw();
  }

  /** Up / Down: walk through earlier lines. Never while typing a password. */
  private browse(step: number): void {
    if (this.masked) return;
    const next = this.historyAt + step;
    if (next < 0 || next > this.history.length) return;
    if (this.historyAt === this.history.length) this.draft = this.text;
    this.historyAt = next;
    this.text = next === this.history.length ? this.draft : this.history[next];
    this.cursor = this.text.length;
    this.redraw();
  }

  private clearScreen(): void {
    this.screen.write(`${ESC}[H${ESC}[2J${ESC}[3J`);
    this.cursorRow = 0;
    this.redraw();
  }

  private submit(): void {
    const line = this.text;
    this.finishLine();
    // Passwords and empty lines are not remembered; neither are immediate repeats.
    if (!this.masked && line.trim() !== '' && this.history[this.history.length - 1] !== line) this.history.push(line);
    this.text = '';
    this.cursor = 0;
    this.waiting = true;
    this.events.onLine(line);
  }

  private cancel(): void {
    this.finishLine('^C');
    this.text = '';
    this.cursor = 0;
    this.waiting = true;
    this.events.onCancel();
  }
}
