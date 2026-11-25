/**
 * Lobbies (Phase 6, part A): a group of friends who play a match together.
 *
 * In the code a lobby is called a "party", because the message "lobby" already
 * means the list of employees of a match. One party is one room on the server:
 * first its members gather, then the same room runs their match.
 *
 * Everything a browser sends is checked here before it is used, as in solo.ts.
 */
import { SOLO_DIFFICULTIES, type SoloDifficulty } from './solo';

/** Name of the Colyseus room type for lobbies (each one is a room of its own). */
export const PARTY_ROOM_NAME = 'party';

/** Connection close code: the host removed this player. */
export const PARTY_REMOVED = 4100;

/** At least this many people are needed to start... */
export const PARTY_MIN = 2;
/** ...and this many when one of them is the hacker: with two, the other one would know at once. */
export const PARTY_MIN_HUMAN = 3;
/** From this many people on the hacker is one of them, unless the host decides otherwise. */
export const PARTY_HUMAN_HACKER = 4;
/** A person who is the hacker waits this many game minutes between first reading the flag and handing it in. */
export const PARTY_HAND_IN_MINUTES = 3;

/**
 * Letters of a lobby code. Only consonants, so a random code never spells a
 * word, and no digits, so nothing can be confused with a letter (0 and O).
 */
export const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_LENGTH = 5;

/** Reads a typed code: small letters, spaces and dashes are fine. Null = cannot be a code. */
export function parseCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const code = value.replace(/[\s-]/g, '').toUpperCase();
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_LETTERS.includes(c)) ? code : null;
}

export const NAME_LENGTH = 20;

/**
 * A player's name as others will see it: letters of any language, numbers,
 * spaces and a few signs. Anything else (invisible characters, line breaks,
 * symbols that turn the writing direction around) is dropped, so a name cannot
 * break the screen.
 */
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.slice(0, 200).normalize('NFC').replace(/[^\p{L}\p{M}\p{N} ._'-]/gu, '')
    .replace(/(\p{M}{2})\p{M}+/gu, '$1') // a pile of accents on one letter
    .replace(/ +/g, ' ').trim();
  return [...text].slice(0, NAME_LENGTH).join('').trim();
}

/** How long meetings are. */
export const PARTY_MEETINGS = ['short', 'normal', 'long'] as const;
export type PartyMeetings = (typeof PARTY_MEETINGS)[number];

/** Who may be the hacker: drawn (see PARTY_HUMAN_HACKER), always a person, or the computer. */
export const PARTY_HACKERS = ['auto', 'human', 'bot'] as const;
export type PartyHacker = (typeof PARTY_HACKERS)[number];

/** What the host decides before the match. */
export interface PartySettings {
  /** Desks nobody plays are filled by the computer. */
  bots: boolean;
  hacker: PartyHacker;
  /** How many hackers: 0 = as many as suit the size of the match. */
  hackers: number;
  /** How much the computer's hacker knows, and how fast it is. */
  difficulty: SoloDifficulty;
  meetings: PartyMeetings;
}

export const DEFAULT_PARTY_SETTINGS: PartySettings = { bots: true, hacker: 'auto', hackers: 0, difficulty: 'normal', meetings: 'normal' };

/** Takes the valid fields of a change from the host; everything else stays as it was. */
export function changeSettings(old: PartySettings, change: unknown): PartySettings {
  if (typeof change !== 'object' || change === null) return old;
  const { bots, hacker, hackers, difficulty, meetings } = change as Record<string, unknown>;
  return {
    bots: typeof bots === 'boolean' ? bots : old.bots,
    hacker: PARTY_HACKERS.find((h) => h === hacker) ?? old.hacker,
    hackers: [0, 1, 2, 3].find((n) => n === hackers) ?? old.hackers,
    difficulty: SOLO_DIFFICULTIES.find((d) => d === difficulty) ?? old.difficulty,
    meetings: PARTY_MEETINGS.find((m) => m === meetings) ?? old.meetings,
  };
}

/**
 * How many hackers a match gets (DESIGN.md section 7): one up to 15 people, two
 * up to 25, then three. The host may want another number, but at most one
 * hacker for every three others, so that the defenders keep the majority.
 */
export function hackerCount(settings: PartySettings, people: number, desks: number): number {
  const total = settings.bots ? desks : people;
  const wanted = settings.hackers || (total <= 15 ? 1 : total <= 25 ? 2 : 3);
  return Math.max(1, Math.min(wanted, Math.floor((total - 1) / 3)));
}

export interface PartyMember {
  /** "m1": a number inside this lobby. It is not the network id. */
  id: string;
  name: string;
  ready: boolean;
  /** Still in the match (or reading its debrief), not in the lobby. */
  away: boolean;
}

/** Who played whom. Told only when a match is over. */
export interface PartyCast {
  /** The person's name in the lobby. */
  name: string;
  /** The employee they played. */
  employee: string;
  hacker: boolean;
}

/** The lobby as one of its members sees it. */
export interface PartyView {
  code: string;
  /** The receiver's own member id. */
  you: string;
  hostId: string;
  members: PartyMember[];
  /** How many people fit. */
  size: number;
  settings: PartySettings;
  /** How many hackers the match has (or would have now). */
  hackers: number;
  /** False = the host has closed the lobby: nobody else may come in. */
  open: boolean;
  /** Their match is running. */
  playing: boolean;
  /** The last match, when it is over: who was who. Empty before and during a match. */
  cast: PartyCast[];
  /** Why the host cannot start yet ("" = they can). */
  notYet: string;
}
