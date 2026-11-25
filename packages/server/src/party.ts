/**
 * The rules of a lobby (Phase 6, part A): who is in it, who is the host, who is
 * ready, when the match may start, and (part B) coming back after it. Like OfficeGame it knows nothing about
 * the network; PartyRoom.ts carries the messages.
 */
import { randomInt } from 'node:crypto';
import {
  CODE_LENGTH, CODE_LETTERS, DEFAULT_PARTY_SETTINGS, PARTY_HAND_IN_MINUTES, PARTY_MIN, PARTY_MIN_HUMAN, changeSettings, cleanName,
  type PartyCast, type PartyMeetings, type PartyMember, type PartySettings, type PartyView,
} from '@insider/shared';
import { whoMayHack, type Deal } from './deal';
import type { OfficeGameOptions } from './game';
import type { MeetingTimes } from './meeting';

/** A random lobby code. `randomInt` gives numbers that cannot be predicted from earlier ones. */
export function newCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
}

export class Party {
  settings: PartySettings = DEFAULT_PARTY_SETTINGS;
  /** May somebody else still come in? (The host can close the lobby.) */
  open = true;
  playing = false;
  /** Who was who in the last match. Filled only when it is over. */
  private cast: PartyCast[] = [];
  /** Network id -> member, in the order they came in. */
  private readonly members = new Map<string, PartyMember>();
  /** Network id of the host. */
  private host = '';
  private count = 0;

  constructor(readonly code: string, readonly size: number) {}

  /** The network ids of everybody here. */
  clients(): string[] {
    return [...this.members.keys()];
  }

  has(clientId: string): boolean {
    return this.members.has(clientId);
  }

  /** Somebody comes in. Returns why not, or "". The first one is the host. */
  join(clientId: string, wanted: unknown): string {
    if (this.playing) return 'This match has already started.';
    if (!this.open) return 'The host has closed this lobby.';
    if (this.members.size >= this.size) return 'This lobby is full.';
    this.members.set(clientId, { id: `m${++this.count}`, name: this.freeName(cleanName(wanted) || 'Player'), ready: false, away: false });
    if (!this.host) this.host = clientId;
    return '';
  }

  /** Two people with the same name could not be told apart: the second becomes "Sam 2". */
  private freeName(name: string): string {
    const taken = new Set([...this.members.values()].map((m) => m.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
  }

  /** Somebody goes. If it was the host, whoever has been here longest takes over. */
  leave(clientId: string): void {
    this.members.delete(clientId);
    if (this.host === clientId) this.host = this.members.keys().next().value ?? '';
  }

  isHost(clientId: string): boolean {
    return clientId !== '' && clientId === this.host;
  }

  /** The network id that belongs to a member id, or "". */
  clientOf(memberId: unknown): string {
    for (const [clientId, m] of this.members) if (m.id === memberId) return clientId;
    return '';
  }

  setReady(clientId: string, ready: unknown): void {
    const member = this.members.get(clientId);
    if (member && !member.away && typeof ready === 'boolean') member.ready = ready;
  }

  nameOf(clientId: string): string {
    return this.members.get(clientId)?.name ?? '';
  }

  /** The match starts: everybody goes to the office. */
  begin(): void {
    this.playing = true;
    this.cast = [];
    for (const m of this.members.values()) Object.assign(m, { away: true, ready: false });
  }

  /** The match is over. Everybody comes back when they have seen enough of the debrief. */
  end(cast: PartyCast[]): void {
    this.playing = false;
    this.cast = cast;
  }

  back(clientId: string): void {
    const member = this.members.get(clientId);
    if (member) member.away = false;
  }

  change(change: unknown): void {
    this.settings = changeSettings(this.settings, change);
  }

  /** Why the host cannot start yet, or "". The host starts the match, so only the others have to be ready. */
  notYet(): string {
    if (this.playing) return 'The match has already started.';
    if (this.members.size < PARTY_MIN) return `At least ${PARTY_MIN} people are needed. Share the code with a friend.`;
    if (whoMayHack(this.settings, this.members.size, this.size) === 'human' && this.members.size < PARTY_MIN_HUMAN) return `When one of you is the hacker, at least ${PARTY_MIN_HUMAN} people are needed.`;
    const away = [...this.members.values()].filter((m) => m.away).map((m) => m.name);
    if (away.length > 0) return `Waiting for ${away.join(', ')} to come back from the last match.`;
    const waiting = [...this.members].filter(([clientId, m]) => !this.isHost(clientId) && !m.ready).map(([, m]) => m.name);
    return waiting.length > 0 ? `Waiting for ${waiting.join(', ')} to be ready.` : '';
  }

  view(clientId: string): PartyView {
    return {
      code: this.code,
      you: this.members.get(clientId)?.id ?? '',
      hostId: this.members.get(this.host)?.id ?? '',
      members: [...this.members.values()].map((m) => ({ ...m })),
      size: this.size,
      settings: { ...this.settings },
      open: this.open,
      playing: this.playing,
      cast: this.cast.map((c) => ({ ...c })),
      notYet: this.notYet(),
    };
  }
}

/** Meeting lengths a host can choose. "Normal" is whatever the server is set to. */
const MEETINGS: Record<PartyMeetings, Partial<MeetingTimes>> = {
  short: { discussionMs: 45_000, votingMs: 30_000 },
  normal: {},
  long: { discussionMs: 150_000, votingMs: 60_000 },
};

/**
 * The settings of a lobby's match. Everything the host did not choose comes
 * from the server operator. If a human hacker leaves, the bot that takes their
 * place goes on as the hacker, as in the shared office.
 */
export function partyGameOptions(base: OfficeGameOptions, settings: PartySettings, seed: number, { hacker, human }: Pick<Deal, 'hacker' | 'human'>): OfficeGameOptions {
  return {
    ...base,
    seed,
    bots: settings.bots,
    botOptions: { ...base.botOptions, hacker: true, hackerId: hacker, hackerDifficulty: settings.difficulty },
    assigned: true,
    handInMinutes: human ? PARTY_HAND_IN_MINUTES : undefined,
    meetingTimes: { ...base.meetingTimes, ...MEETINGS[settings.meetings] },
  };
}
