/**
 * How well did the player investigate? (Phase 5a, part C; solo matches only.)
 *
 * Catching the hacker is not enough for a good rating: the point is to PROVE
 * it. So the rating looks at the same thing the colleagues looked at (judge.ts)
 * and at what it cost. It is shown at the top of the debrief.
 */
import type { RatingView } from '@insider/shared';
import type { Verdict } from './judge';

export interface RatingInput {
  winner: 'hacker' | 'defenders';
  hacker: string;
  /** The evidence against the hacker: of the winning accusation, or (no vote) of the whole board. */
  verdict: Verdict;
  /** Innocent people fired by a vote, or detained. */
  firedWrongly: string[];
  detainedWrongly: string[];
  meetingsCalled: number;
  meetingsAllowed: number;
  /** Game time the match took. */
  ms: number;
  /** Pieces pinned by the player, and by colleagues. */
  ownPins: number;
  otherPins: number;
}

const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`);

export function rate(r: RatingInput): RatingView {
  const { pointing, unusual, convincing, testimony } = r.verdict;
  const mistakes = r.firedWrongly.length + r.detainedWrongly.length;
  const title = r.winner === 'defenders'
    ? (!convincing ? 'Lucky guess' : mistakes > 0 ? 'Case proven, at a price' : 'Case proven')
    : convincing ? 'So close' : 'The hacker got away';

  const lines: string[] = [];
  if (r.winner === 'defenders') {
    lines.push(convincing
      ? `You had evidence against ${r.hacker}: ${list(pointing)}${testimony ? `, and what ${testimony} told the meeting` : ''}.`
      : `You were right about ${r.hacker}, but the evidence did not show it${pointing.length > 0 ? ` (only ${list(pointing)} said anything about them${unusual.length === 0 ? ', and it was ordinary work' : ''})` : ''}.`);
  } else {
    lines.push(convincing
      ? `Your board already pointed at ${r.hacker} (${list(pointing)}): an accusation would have convinced your colleagues.`
      : pointing.length > 0 ? `Only ${list(pointing)} on the board said anything about ${r.hacker}.` : `Nothing on the board said anything about ${r.hacker}.`);
  }
  if (r.firedWrongly.length > 0) lines.push(`Innocent people fired: ${list(r.firedWrongly)}.`);
  if (r.detainedWrongly.length > 0) lines.push(`Innocent people detained: ${list(r.detainedWrongly)}.`);
  const minutes = Math.round(r.ms / 60_000);
  lines.push(`${minutes} game ${minutes === 1 ? 'minute' : 'minutes'}, ${r.meetingsCalled} of ${r.meetingsAllowed} meetings called, ${r.ownPins} ${r.ownPins === 1 ? 'piece' : 'pieces'} of evidence pinned by you${r.otherPins > 0 ? ` and ${r.otherPins} by colleagues` : ''}.`);
  return { title, lines };
}

// ───────────────────────────── Infiltration: how quietly did the hacker work? ─────────────────────────────

export interface InfiltrationInput {
  winner: 'hacker' | 'defenders';
  /** What the board says about the player at the end. */
  verdict: Verdict;
  /** Caught by the guard (otherwise by a vote). */
  detained: boolean;
  /** Innocent colleagues who were fired or detained in the player's place. */
  blamed: string[];
  meetings: number;
  ms: number;
  /** Suspicious steps that left evidence: all of them, found, and never looked at. */
  steps: number;
  pinned: number;
  missed: number;
}

export function rateInfiltration(r: InfiltrationInput): RatingView {
  const { pointing, convincing } = r.verdict;
  const title = r.winner === 'hacker'
    ? (convincing ? 'By a hair' : pointing.length > 0 ? 'Clean getaway' : 'Like a ghost')
    : r.detained ? 'Detained' : 'Voted out';
  const lines: string[] = [];
  if (r.winner === 'hacker') {
    lines.push(convincing
      ? `The evidence already pointed at you (${list(pointing)}). A little longer, and they would have had you.`
      : pointing.length > 0 ? `${list(pointing)} ${pointing.length === 1 ? 'says' : 'say'} something about you, but nobody would be convinced.`
        : 'Nothing on the evidence board says anything about you.');
  } else lines.push(pointing.length > 0 ? `What gave you away: ${list(pointing)} on the evidence board.` : 'What gave you away is what people saw with their own eyes.');
  if (r.blamed.length > 0) lines.push(`Blamed in your place: ${list(r.blamed)}.`);
  const minutes = Math.round(r.ms / 60_000);
  lines.push(`${minutes} game ${minutes === 1 ? 'minute' : 'minutes'}, ${r.meetings} ${r.meetings === 1 ? 'meeting' : 'meetings'}. Of ${r.steps} suspicious ${r.steps === 1 ? 'action' : 'actions'} that left evidence, ${r.pinned} ended up on the board and nobody looked at ${r.missed}.`);
  return { title, lines };
}
