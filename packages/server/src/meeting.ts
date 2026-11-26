/**
 * Emergency meetings and voting (DESIGN.md section 9).
 *
 *   someone presses the emergency button
 *     -> everybody is brought to the meeting table and stands still
 *   DISCUSSION (90 s): meeting chat; anybody alive may ACCUSE someone, which
 *     needs at least 3 items of the evidence board linked to the accused
 *   DEFENCE (10 s for each accused, at most three): the accused have the floor,
 *     one after the other, to answer in the chat before anybody votes
 *   VOTING (45 s): each living player votes for one of the accused, or skip
 *   RESULT (8 s): the most votes wins; a tie, or skip winning, fires nobody.
 *     The hacker voted out = the defenders win. An innocent person voted out
 *     is FIRED: they are out of the game, and the company's reputation drops.
 *
 * This file holds the rules and the record of every meeting (kept for the
 * debrief). The game (game.ts) moves people, fires them and sends messages.
 * Timers count REAL time, like walking: a meeting lasts as long for everyone
 * whatever speed the game clock runs at.
 */

export type MeetingPhase = 'discussion' | 'defence' | 'voting' | 'result';

/** At most this many accused get the floor in the defence (the vote is about all of them anyway). */
export const MAX_FLOOR = 3;

export interface MeetingTimes {
  discussionMs: number;
  /** How long EACH accused has the floor before the vote (0 = no defence). */
  defenceMs: number;
  votingMs: number;
  resultMs: number;
  /** Real time after a meeting before the button works again. */
  cooldownMs: number;
  /** How often each player may press the emergency button in a match. */
  usesPerPlayer: number;
  /** Nobody is voted out with fewer votes than this (lobbies: 2, owner's rule; otherwise 1). */
  votesNeeded: number;
  /** Meetings in a whole match, whoever calls them (the large office: 3, owner's rule; otherwise no limit). */
  perMatch: number;
}

export const DEFAULT_MEETING_TIMES: MeetingTimes = { discussionMs: 90_000, defenceMs: 10_000, votingMs: 45_000, resultMs: 8_000, cooldownMs: 60_000, usesPerPlayer: 1, votesNeeded: 1, perMatch: Infinity };

export interface Accusation {
  /** "A1" */
  id: string;
  accuserId: string;
  suspectId: string;
  /** Evidence board item ids (3 or more). */
  evidence: string[];
}

export interface MeetingResult {
  /** The player voted out, or null. */
  firedId: string | null;
  wasHacker: boolean;
  /** suspect id -> votes. */
  tally: Record<string, number>;
  skips: number;
  /** Players who did not vote at all. */
  abstained: number;
}

export interface Meeting {
  /** 1, 2, 3... */
  number: number;
  calledById: string;
  /** Game time it was called (for the debrief). */
  startedAt: number;
  phase: MeetingPhase;
  /** Real milliseconds left in this phase. */
  leftMs: number;
  accusations: Accusation[];
  /** The defence: the accused in the order they speak, and whose turn it is (an index into `floor`). */
  floor: string[];
  floorAt: number;
  /** voter id -> suspect id or "skip". */
  votes: Record<string, string>;
  /** Everyone alive when the meeting was called (only they may vote). */
  voters: string[];
  /** Voters who will not vote (bots without an opinion): the vote does not wait for them. Never sent to anybody. */
  passed: string[];
  result: MeetingResult | null;
}

/** Counts the votes. The single highest suspect wins if they have more votes than "skip", and as many as are needed; otherwise nobody. */
export function countVotes(votes: Record<string, string>, voters: string[], needed = 1): Omit<MeetingResult, 'wasHacker'> {
  const tally: Record<string, number> = {};
  let skips = 0;
  for (const voter of voters) {
    const target = votes[voter];
    if (target === undefined) continue;
    if (target === 'skip') skips++;
    else tally[target] = (tally[target] ?? 0) + 1;
  }
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const firedId = top && top[1] >= needed && top[1] > skips && (!second || second[1] < top[1]) ? top[0] : null;
  return { firedId, tally, skips, abstained: voters.filter((v) => votes[v] === undefined).length };
}

/** The meetings of one match. */
export class Meetings {
  current: Meeting | null = null;
  readonly history: Meeting[] = [];
  /** player id -> times they pressed the button. */
  private readonly used = new Map<string, number>();
  /** Real ms until the button works again. */
  private cooldownLeft = 0;

  constructor(readonly times: MeetingTimes = DEFAULT_MEETING_TIMES) {}

  usesLeft(playerId: string): number {
    return Math.max(0, Math.min(this.times.perMatch - this.history.length, this.times.usesPerPlayer - (this.used.get(playerId) ?? 0)));
  }

  /** Why this player cannot call a meeting now ("" = they can). */
  whyNot(playerId: string): string {
    if (this.current) return 'A meeting is already going on.';
    if (this.history.length >= this.times.perMatch) return `All ${this.times.perMatch} all-hands meetings of this match have been held.`;
    if (this.usesLeft(playerId) === 0) return 'You have already used your emergency meeting.';
    if (this.cooldownLeft > 0) return `The button works again in ${Math.ceil(this.cooldownLeft / 1000)} s.`;
    return '';
  }

  call(playerId: string, gameTime: number, voters: string[]): Meeting {
    this.used.set(playerId, (this.used.get(playerId) ?? 0) + 1);
    this.current = {
      number: this.history.length + 1, calledById: playerId, startedAt: gameTime,
      phase: 'discussion', leftMs: this.times.discussionMs, accusations: [], floor: [], floorAt: 0, votes: {}, voters: [...voters], passed: [], result: null,
    };
    this.history.push(this.current);
    return this.current;
  }

  /** Files an accusation. Returns an error sentence, or "" when accepted. */
  accuse(accuserId: string, suspectId: string, evidence: string[], boardIds: Set<string>, living: Set<string>): string {
    const m = this.current;
    if (!m || m.phase !== 'discussion') return 'Accusations can only be made during the discussion.';
    if (!living.has(accuserId)) return 'Only people still at the company can accuse.';
    if (!living.has(suspectId) || suspectId === accuserId) return 'Choose someone else who is still at the company.';
    if (m.accusations.some((a) => a.accuserId === accuserId)) return 'You have already made an accusation in this meeting.';
    const items = [...new Set(evidence)].filter((id) => boardIds.has(id));
    if (items.length < 3) return 'An accusation needs at least 3 items from the evidence board.';
    m.accusations.push({ id: `A${m.accusations.length + 1}`, accuserId, suspectId, evidence: items });
    return '';
  }

  /** Records a vote. Returns an error sentence, or "" when accepted. */
  vote(voterId: string, target: string): string {
    const m = this.current;
    if (!m || m.phase !== 'voting') return 'There is no vote right now.';
    if (!m.voters.includes(voterId)) return 'You cannot vote in this meeting.';
    if (m.votes[voterId] !== undefined) return 'You have already voted.';
    if (target !== 'skip' && !m.accusations.some((a) => a.suspectId === target)) return 'You can only vote for someone who was accused, or skip.';
    m.votes[voterId] = target;
    return '';
  }

  /** This voter will not vote. */
  pass(voterId: string): void {
    this.current?.passed.push(voterId);
  }

  /**
   * Advances the timers. Returns what happened: a phase change, the moment a
   * result is decided (so the game can fire someone), or the end.
   */
  tick(realMs: number, isHacker: (playerId: string) => boolean): 'defence' | 'floor' | 'voting' | 'decided' | 'ended' | null {
    if (!this.current) {
      this.cooldownLeft = Math.max(0, this.cooldownLeft - realMs);
      return null;
    }
    const m = this.current;
    // Everybody has voted: no need to wait for the clock.
    if (m.phase === 'voting' && m.voters.every((v) => m.votes[v] !== undefined || m.passed.includes(v))) m.leftMs = 0;
    m.leftMs -= realMs;
    if (m.phase === 'defence' && m.leftMs > 0) {
      // The next accused has the floor when the one before has had their time.
      const at = Math.min(m.floor.length - 1, Math.floor((m.floor.length * this.times.defenceMs - m.leftMs) / this.times.defenceMs));
      if (at !== m.floorAt) {
        m.floorAt = at;
        return 'floor';
      }
    }
    if (m.leftMs > 0) return null;
    if (m.phase === 'discussion') {
      // Nobody was accused: there is nothing to vote on.
      if (m.accusations.length === 0) return this.decide(isHacker);
      if (this.times.defenceMs > 0) {
        m.phase = 'defence';
        m.floor = [...new Set(m.accusations.map((a) => a.suspectId))].slice(0, MAX_FLOOR);
        m.floorAt = 0;
        m.leftMs = m.floor.length * this.times.defenceMs;
        return 'defence';
      }
      return this.startVoting(m);
    }
    if (m.phase === 'defence') return this.startVoting(m);
    if (m.phase === 'voting') return this.decide(isHacker);
    this.current = null;
    this.cooldownLeft = this.times.cooldownMs;
    return 'ended';
  }

  private startVoting(m: Meeting): 'voting' {
    m.phase = 'voting';
    m.leftMs = this.times.votingMs;
    return 'voting';
  }

  private decide(isHacker: (playerId: string) => boolean): 'decided' {
    const m = this.current!;
    const counted = countVotes(m.votes, m.voters, this.times.votesNeeded);
    m.result = { ...counted, wasHacker: counted.firedId !== null && isHacker(counted.firedId) };
    m.phase = 'result';
    m.leftMs = this.times.resultMs;
    return 'decided';
  }
}
