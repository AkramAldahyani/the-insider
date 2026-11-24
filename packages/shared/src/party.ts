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

/** At least this many people are needed to start. */
export const PARTY_MIN = 2;

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

/** What the host decides before the match. */
export interface PartySettings {
  /** Desks nobody plays are filled by the computer. */
  bots: boolean;
  /** How much the computer's hacker knows, and how fast it is. */
  difficulty: SoloDifficulty;
  meetings: PartyMeetings;
}

export const DEFAULT_PARTY_SETTINGS: PartySettings = { bots: true, difficulty: 'normal', meetings: 'normal' };

/** Takes the valid fields of a change from the host; everything else stays as it was. */
export function changeSettings(old: PartySettings, change: unknown): PartySettings {
  if (typeof change !== 'object' || change === null) return old;
  const { bots, difficulty, meetings } = change as Record<string, unknown>;
  return {
    bots: typeof bots === 'boolean' ? bots : old.bots,
    difficulty: SOLO_DIFFICULTIES.find((d) => d === difficulty) ?? old.difficulty,
    meetings: PARTY_MEETINGS.find((m) => m === meetings) ?? old.meetings,
  };
}

export interface PartyMember {
  /** "m1": a number inside this lobby. It is not the network id. */
  id: string;
  name: string;
  ready: boolean;
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
  /** False = the host has closed the lobby: nobody else may come in. */
  open: boolean;
  /** Their match is running (or has ended). */
  playing: boolean;
  /** Why the host cannot start yet ("" = they can). */
  notYet: string;
}
