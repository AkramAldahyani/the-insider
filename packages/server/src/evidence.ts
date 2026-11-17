/**
 * The shared evidence board (DESIGN.md section 9).
 *
 * Players pin what they found: a piece of text from a PC's screen (a log
 * line, a command's output), a camera picture, or a line of the badge or
 * motion log seen on the security monitors. Everybody playing sees the board;
 * at a meeting (Phase 5, part D) an accusation must point at 3 or more of its
 * items.
 *
 * PINS MUST BE HONEST. A player could type anything into a "pin" message, so
 * the board only accepts what that player's own screen really showed:
 *  - screen text must appear in what the server sent to that player's PC
 *    screens (or what they typed there);
 *  - a camera picture must be one the server showed them on the monitors;
 *  - a badge or motion line must be one the monitors showed them.
 * The server keeps, per player, a running copy of what it sent them for this
 * check. It never leaves the server.
 *
 * Bots will pin too (part G); the board does not care who pins, only that the
 * evidence is real.
 */
import type { EvidenceView, MonitorPerson } from '@insider/shared';

export interface EvidenceItem {
  id: string;
  kind: 'screen' | 'snapshot' | 'log';
  /** Where it came from: "FIN-LT-07 screen", "CAM-04", "Badge log". */
  title: string;
  text: string;
  /** Game time it was pinned. */
  time: number;
  /** Who pinned it (name for everybody; player id for the debrief, never sent). */
  pinnedBy: string;
  pinnedById: string;
  /** Camera pictures: the picture itself. */
  frame?: { camera: string; time: number; people: MonitorPerson[] };
}

/** What one player has been shown, for checking their pins. */
interface Seen {
  /** Recent screen text (output, prompts and what they typed), whitespace squeezed. */
  screen: string;
  shots: Set<string>;
  lines: Set<string>;
}

/** How much recent screen text is remembered per player. */
const SCREEN_MEMORY = 60_000;
export const MAX_ITEMS = 200;
const MAX_TEXT = 1500;
const MAX_LINES = 30;

/** Squeezes all whitespace to single spaces: a selection's line breaks and the screen's do not have to match exactly. */
const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim();

export class EvidenceBoard {
  readonly items: EvidenceItem[] = [];
  private readonly seen = new Map<string, Seen>();
  private counter = 0;

  private of(clientId: string): Seen {
    let s = this.seen.get(clientId);
    if (!s) this.seen.set(clientId, (s = { screen: '', shots: new Set(), lines: new Set() }));
    return s;
  }

  /** The server showed this text on the player's PC screen (output and prompt). */
  noteScreen(clientId: string, text: string): void {
    const s = this.of(clientId);
    s.screen = (s.screen + ' ' + squeeze(text)).slice(-SCREEN_MEMORY);
  }

  /** The player typed a line (as it appears on their screen: stars for a password). */
  noteTyped(clientId: string, text: string): void {
    this.noteScreen(clientId, text);
  }

  noteShot(clientId: string, snapshotId: string): void {
    if (snapshotId) this.of(clientId).shots.add(snapshotId);
  }

  noteLines(clientId: string, lines: string[]): void {
    const s = this.of(clientId);
    for (const line of lines) s.lines.add(line.trim());
    if (s.lines.size > 2000) s.lines = new Set([...s.lines].slice(-1000));
  }

  forget(clientId: string): void {
    this.seen.delete(clientId);
  }

  /** Did this player's screen show this text? */
  sawText(clientId: string, text: string): boolean {
    const wanted = squeeze(text);
    return wanted.length >= 3 && (this.seen.get(clientId)?.screen.includes(wanted) ?? false);
  }

  sawShot(clientId: string, snapshotId: string): boolean {
    return this.seen.get(clientId)?.shots.has(snapshotId) ?? false;
  }

  sawLine(clientId: string, line: string): boolean {
    return this.seen.get(clientId)?.lines.has(line.trim()) ?? false;
  }

  /** Adds an item (already checked by the caller). */
  add(item: Omit<EvidenceItem, 'id'>): EvidenceItem | null {
    if (this.items.length >= MAX_ITEMS) return null;
    const lines = item.text.split('\n').map((l) => l.trimEnd());
    const text = lines.slice(0, MAX_LINES).join('\n').slice(0, MAX_TEXT).trim();
    const full: EvidenceItem = { ...item, text, id: `E${++this.counter}` };
    this.items.push(full);
    return full;
  }

  /** A player takes down their own pin. Returns false if it is not theirs. */
  remove(playerId: string, id: string): boolean {
    const index = this.items.findIndex((i) => i.id === id && i.pinnedById === playerId);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  /** The board as one player sees it (`mine` marks their own pins). */
  view(playerId: string): EvidenceView[] {
    return this.items.map((i) => ({
      id: i.id, kind: i.kind, title: i.title, text: i.text, time: i.time, pinnedBy: i.pinnedBy, mine: i.pinnedById === playerId,
      ...(i.frame ? { frame: { camera: i.frame.camera, time: i.frame.time, people: i.frame.people.map((p) => ({ ...p })) } } : {}),
    }));
  }
}
