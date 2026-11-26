/**
 * Department meetings (Phase 6, part I; the owner's rules for the large office).
 *
 * In an office of thirty an all-hands meeting stops everybody for minutes, so
 * there are at most three of them. For everything in between, each department
 * has a small button: whoever is in that room, within about ten tiles of it, when it is
 * pressed talks together for a minute, in a chat only they read. Nobody stops
 * working, nobody is accused and nobody votes: that is for the all-hands
 * meetings. Colleagues played by the computer say what they saw, as at a meeting.
 *
 * This file holds the rules; game.ts finds the people and sends the messages.
 */

/** How long a department meeting lasts (real milliseconds). */
export const TALK_MS = 60_000;
/** Who takes part: everybody within this many pixels of the button (10 tiles). */
export const TALK_RADIUS = 320;
/** How often one person may call one, in a match. */
export const TALK_USES = 2;
/** A button rests this long after a department meeting ended (real milliseconds). */
export const TALK_REST_MS = 120_000;

export interface Talk {
  /** The button's name ("Finance meeting button") and the room it is in. */
  button: string;
  room: string;
  calledBy: string;
  /** Player ids of everybody taking part. */
  members: string[];
  leftMs: number;
  /** Game time it began (for the debrief and tests). */
  startedAt: number;
}

export class Talks {
  readonly running: Talk[] = [];
  readonly history: Talk[] = [];
  private readonly used = new Map<string, number>();
  /** Button -> real milliseconds until it works again. */
  private readonly resting = new Map<string, number>();

  usesLeft(playerId: string): number {
    return Math.max(0, TALK_USES - (this.used.get(playerId) ?? 0));
  }

  /** The department meeting this person takes part in, if any. */
  of(playerId: string): Talk | undefined {
    return this.running.find((t) => t.members.includes(playerId));
  }

  /** Why this person cannot call one at this button now ("" = they can). */
  whyNot(playerId: string, button: string): string {
    if (this.of(playerId)) return 'You are in a department meeting already.';
    if (this.usesLeft(playerId) === 0) return `You have called your ${TALK_USES} department meetings of this match.`;
    if (this.running.some((t) => t.button === button)) return 'There is a department meeting here already.';
    const rest = this.resting.get(button) ?? 0;
    if (rest > 0) return `This button works again in ${Math.ceil(rest / 1000)} s.`;
    return '';
  }

  /** Starts one. `nearby`: everybody within reach, the caller included; those already in another one stay there. */
  call(playerId: string, button: string, room: string, nearby: string[], gameTime: number): Talk {
    this.used.set(playerId, (this.used.get(playerId) ?? 0) + 1);
    const members = [playerId, ...nearby.filter((id) => id !== playerId && !this.of(id))];
    const talk: Talk = { button, room, calledBy: playerId, members, leftMs: TALK_MS, startedAt: gameTime };
    this.running.push(talk);
    this.history.push(talk);
    return talk;
  }

  /** Advances the clocks. Returns the department meetings that just ended. */
  tick(realMs: number): Talk[] {
    for (const [button, rest] of this.resting) {
      if (rest <= realMs) this.resting.delete(button);
      else this.resting.set(button, rest - realMs);
    }
    const ended: Talk[] = [];
    for (const talk of [...this.running]) {
      talk.leftMs -= realMs;
      if (talk.leftMs <= 0) ended.push(talk);
    }
    for (const talk of ended) this.end(talk);
    return ended;
  }

  /** Ends all of them at once (an all-hands meeting was called, or the match is over). */
  endAll(): Talk[] {
    const all = [...this.running];
    for (const talk of all) this.end(talk);
    return all;
  }

  /** Somebody is no longer there (out of the game, or gone). */
  leave(playerId: string): void {
    for (const talk of this.running) talk.members = talk.members.filter((id) => id !== playerId);
  }

  private end(talk: Talk): void {
    this.running.splice(this.running.indexOf(talk), 1);
    this.resting.set(talk.button, TALK_REST_MS);
  }
}
