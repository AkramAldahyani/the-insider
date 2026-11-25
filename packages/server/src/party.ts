/**
 * The rules of a lobby (Phase 6, part A): who is in it, who is the host, who is
 * ready, when the match may start, and (part B) coming back after it. Like OfficeGame it knows nothing about
 * the network; PartyRoom.ts carries the messages.
 */
import { randomInt } from 'node:crypto';
import {
  CODE_LENGTH, CODE_LETTERS, DEFAULT_PARTY_SETTINGS, PARTY_HAND_IN_MINUTES, PARTY_MIN, PARTY_MIN_HUMAN, PARTY_VOTES_NEEDED, changeSettings, cleanName, hackerCount,
  type PartyCast, type PartyMeetings, type PartyMember, type PartySettings, type PartyView,
} from '@insider/shared';
import { whoMayHack, type Deal } from './deal';
import type { OfficeGameOptions } from './game';
import type { MeetingTimes } from './meeting';
import { LEVELS, pickWeaknesses } from './solo';

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
  /** How many hackers the running match has (people leaving does not change that). */
  private matchHackers = 1;
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
    this.members.set(clientId, { id: `m${++this.count}`, name: this.freeName(cleanName(wanted) || 'Player'), ready: false, away: false, lost: false });
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
    if (this.host === clientId) this.host = '';
    this.findHost();
  }

  /** There is always a host who is connected (if anybody is): whoever has been here longest. */
  private findHost(): void {
    if (this.members.get(this.host)?.lost === false) return;
    const next = [...this.members].find(([, m]) => !m.lost) ?? [...this.members][0];
    this.host = next?.[0] ?? '';
  }

  /** The connection was lost. The place is kept; being the host moves on at once, and does not come back. */
  lose(clientId: string): void {
    const member = this.members.get(clientId);
    if (!member) return;
    Object.assign(member, { lost: true, ready: false });
    this.findHost();
  }

  returned(clientId: string): void {
    const member = this.members.get(clientId);
    if (member) member.lost = false;
    this.findHost();
  }

  /** In a match (or reading its debrief)? */
  isAway(clientId: string): boolean {
    return this.members.get(clientId)?.away ?? false;
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
  begin(hackers: number): void {
    this.playing = true;
    this.matchHackers = hackers;
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
    const lost = [...this.members.values()].filter((m) => m.lost).map((m) => m.name);
    if (lost.length > 0) return `${lost.join(', ')} lost the connection. Their place is kept for a minute.`;
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
      members: [...this.members.values()].map((m) => ({ ...m, lost: m.lost && !this.playing })),
      size: this.size,
      settings: { ...this.settings },
      hackers: this.playing ? this.matchHackers : hackerCount(this.settings, this.members.size, this.size),
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
 *
 * The difficulty is the defenders': how many ways in the office has, how often
 * colleagues leave their screens open, and how well a computer hacker plays.
 * It means the same for a person as the hacker, so the office itself never
 * tells whether the hacker is one.
 */
export function partyGameOptions(base: OfficeGameOptions, settings: PartySettings, seed: number, { hackers, human, seats }: Pick<Deal, 'hackers' | 'human'> & Partial<Pick<Deal, 'seats'>>): OfficeGameOptions {
  const level = LEVELS[settings.difficulty];
  const admin = base.scenario.players.find((p) => p.role === 'sysadmin')?.id ?? '';
  const botAdmin = settings.bots && ![...(seats?.values() ?? [])].includes(admin);
  return {
    ...base,
    seed,
    bots: settings.bots,
    // (A clue a bot pins is announced with its name, which would tell who is played by the computer: bots pin nothing in a lobby.)
    botOptions: { ...base.botOptions, hacker: true, hackerDifficulty: settings.difficulty, forgetLock: level.forgetLock, pinClues: 0 },
    // The operator may force certain weaknesses (VULNS).
    weaknesses: Array.isArray(base.weaknesses) ? base.weaknesses : pickWeaknesses(base.scenario, botAdmin, seed, level.weaknesses),
    assigned: true,
    hackers,
    handInMinutes: human ? PARTY_HAND_IN_MINUTES : undefined,
    meetingTimes: { ...base.meetingTimes, ...MEETINGS[settings.meetings], votesNeeded: PARTY_VOTES_NEEDED },
  };
}
