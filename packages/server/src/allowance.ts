/**
 * How much one player may ask of the server (Phase 6, part H).
 *
 * An allowance is a jar of points that fills up slowly. Every message takes
 * some: a fixed price, plus what it really cost (the time it took, and how much
 * it added to the match's history). Somebody who plays never sees the bottom of
 * the jar. Somebody who floods the server empties it at once, and from then on
 * is served only as fast as it fills up, so the others do not notice.
 */
export class Allowance {
  private points: number;
  private at: number;

  constructor(private readonly size: number, private readonly perSecond: number, private readonly now: () => number = () => performance.now()) {
    this.points = size;
    this.at = now();
  }

  private fill(): void {
    const now = this.now();
    this.points = Math.min(this.size, this.points + (Math.max(0, now - this.at) / 1000) * this.perSecond);
    this.at = now;
  }

  /** Is anything left? */
  get some(): boolean {
    this.fill();
    return this.points > 0;
  }

  get full(): boolean {
    this.fill();
    return this.points >= this.size;
  }

  /** Takes points. It may go below zero: then it takes longer until there are some again. */
  take(points: number): void {
    this.fill();
    this.points -= points;
  }

  /** Takes points only if all of them are there. */
  tryTake(points: number): boolean {
    this.fill();
    if (this.points < points) return false;
    this.points -= points;
    return true;
  }
}

/** Messages: so many points at once, and so many per second. */
export const MESSAGE_POINTS = 120;
export const MESSAGE_REFILL = 40;
/** Messages that wait for points. Somebody with more than this is not a person: the connection is closed. */
export const MAX_WAITING = 200;
/** The price of a message before it is known what it really cost. */
export function price(type: string): number {
  if (type.startsWith('party.')) return 4; // everybody in the lobby is told
  if (type === 'term.line' || type.startsWith('dev.')) return 2;
  return 1;
}
/** Points per millisecond of work, and per entry in the match's history. */
export const PER_MS = 0.5;
export const PER_EVENT = 0.5;

/** Requests to come into a room, per network address: so many points at once, and so many per second. */
export const JOIN_POINTS = 200;
export const JOIN_REFILL = 1.5;
/** Guessing the code of a lobby must be slow: there are 3.2 million codes, and this allows one guess in about three seconds. */
export function joinPrice(method: string): number {
  return method === 'reconnect' ? 1 : method === 'joinById' || method === 'create' ? 5 : 2;
}

/** One allowance per network address. Full ones are forgotten, so the list does not grow for ever. */
export class Allowances {
  private readonly list = new Map<string, Allowance>();
  constructor(private readonly size: number, private readonly perSecond: number) {}

  of(address: string): Allowance {
    let a = this.list.get(address);
    if (!a) {
      if (this.list.size >= 1000) for (const [key, old] of this.list) if (old.full) this.list.delete(key);
      this.list.set(address, (a = new Allowance(this.size, this.perSecond)));
    }
    return a;
  }

  get count(): number {
    return this.list.size;
  }
}
