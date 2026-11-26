/**
 * Every message that travels between the browser and the game server.
 *
 * THE VISIBILITY RULE. The server holds the whole simulated world, including
 * every password and the master event log. A browser must only ever receive
 * what its player could see by standing in the office:
 *   - public physical state (PublicState below, sent as automatic patches);
 *   - its own onboarding card (its own credentials only);
 *   - the text on the screen of the PC it is sitting at;
 *   - before the match: who is in its own lobby (no match exists yet).
 * The types in this file are that whole list. If something is not in here,
 * the client has no way to receive it.
 */

import type { ChatChannel } from './chat';
import type { PartySettings, PartyView } from './party';

// ───────────────────────────── State (sent as patches) ─────────────────────────────

export type Facing = 'up' | 'down' | 'left' | 'right';
/** What a monitor shows to someone walking past. */
export type DeskScreen = 'login' | 'locked' | 'unlocked';

export interface PublicPlayer {
  /** The scenario's player id ("p1"), not a network id. */
  id: string;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  /** Hostname of the desk the player sits at, "" when walking. */
  seatedAt: string;
  /**
   * Something anybody nearby can see the person doing: "" (nothing special) or
   * "at-pc" (crouched at a PC, fiddling with it while standing).
   */
  activity: Activity;
}

/** What a person is visibly busy with (see PublicPlayer.activity). */
export type Activity = '' | 'at-pc';

export interface PublicDesk {
  hostname: string;
  screen: DeskScreen;
  /** The username printed on a LOCK screen. "" for any other screen. */
  lockUser: string;
  /** Player id of whoever is sitting here, "" for nobody. */
  occupantId: string;
}

/**
 * What a door looks like from across the room:
 *  - "closed": shut;
 *  - "open":   anyone can walk through;
 *  - "denied": shut, and its reader is flashing red (a badge was just refused).
 */
export type DoorLook = 'closed' | 'open' | 'denied';

export interface PublicDoor {
  /** The door's code on the map, e.g. "SRV-ROOM". */
  id: string;
  look: DoorLook;
}

/** A meeting as one player sees it (sent whenever something changes). */
export interface MeetingView {
  /** False between meetings (then only `usesLeft` matters). */
  active: boolean;
  /** How many times this player may still press the emergency button. */
  usesLeft: number;
  number: number;
  phase: 'discussion' | 'voting' | 'result' | '';
  calledBy: string;
  /** Real milliseconds left in this phase when the message was sent. */
  endsIn: number;
  accusations: { id: string; accuser: string; suspectId: string; suspect: string; evidence: string[] }[];
  /** Names of those who have voted (not what they voted). */
  voted: string[];
  /** This player's own vote ("skip", a player id, or "" for none yet). */
  myVote: string;
  /** May this player vote (they were at the company when the meeting was called and are not fired)? */
  canVote: boolean;
  /** Nobody is voted out with fewer votes than this. */
  votesNeeded: number;
  /** Colleagues played by the computer judge the evidence of accusations (otherwise they vote only on what they saw). */
  judged: boolean;
  result: { fired: string; wasHacker: boolean; tally: { id: string; name: string; votes: number }[]; skips: number; abstained: number } | null;
}

// ───────────────────────────── The debrief (only after the match) ─────────────────────────────

/** One piece of evidence a step left, and whether anybody found it. */
export interface DebriefEvidenceView {
  /** The machine it is on ("" for a camera picture). */
  host: string;
  /** The log file, or the command that shows it. */
  where: string;
  text: string;
  /** The log cleaner removed it. */
  gone: boolean;
  found: 'pinned' | 'seen' | 'missed';
  foundBy: string[];
}

/** One thing the hacker did. */
export interface DebriefStepView {
  time: number;
  until: number;
  count: number;
  by: string;
  host: string;
  account: string;
  title: string;
  /** MITRE ATT&CK technique ("T1021.004"), or null when there is none. */
  technique: { id: string; name: string } | null;
  lesson: string;
  typed: string;
  /** False for things an honest employee does too. */
  suspicious: boolean;
  alerts: string[];
  /** The anti-stall rule pointed at it. */
  flagged: boolean;
  evidence: DebriefEvidenceView[];
  /** Further evidence not listed. */
  more: number;
  /** The best of its evidence; "none" = it left none. */
  status: 'pinned' | 'seen' | 'missed' | 'none';
}

/** Solo matches: how well the player investigated. */
export interface RatingView {
  title: string;
  lines: string[];
}

export interface DebriefView {
  winner: 'hacker' | 'defenders';
  reason: string;
  /** All of them in one text ("A and B"), and as a list. */
  hacker: string;
  hackers: string[];
  startedAt: number;
  at: number;
  reputation: number;
  steps: DebriefStepView[];
  /** Suspicious steps that left evidence, by what happened to it. */
  totals: { steps: number; pinned: number; seen: number; missed: number };
  weaknesses: string[];
  /** What bot employees noticed about the hacker. */
  witnesses: { time: number; name: string; text: string }[];
  meetings: {
    number: number; time: number; calledBy: string;
    accusations: { accuser: string; suspect: string; right: boolean; evidence: string[] }[];
    votes: { voter: string; target: string }[];
    fired: string; wasHacker: boolean;
  }[];
  detentions: { time: number; guard: string; target: string; right: boolean }[];
  /** Only in solo matches. */
  rating?: RatingView;
}

export interface PublicState {
  /** Game time, milliseconds since 1970 (UTC). */
  clock: number;
  /** How many game seconds pass per real second. */
  speed: number;
  /** The company's reputation, 0-100: it drops each time an innocent person is fired. */
  reputation: number;
  players: Record<string, PublicPlayer>;
  desks: Record<string, PublicDesk>;
  doors: Record<string, PublicDoor>;
}

// ───────────────────────────── Server -> client messages ─────────────────────────────

/** One row of the start screen. Public information only: no passwords. */
export interface EmployeeChoice {
  id: string;
  name: string;
  title: string;
  department: string;
  desk: string;
  /** Another player already picked this employee. */
  taken: boolean;
}

/** The card a new employee gets from IT: THEIR OWN credentials and machine. */
export interface OnboardingCard {
  name: string;
  title: string;
  department: string;
  username: string;
  password: string;
  hostname: string;
  ip: string;
  mac: string;
  location: string;
  /** The player's role ("SOC analyst") and what it lets them do. For the hacker: the role of the employee they pose as. */
  role: string;
  abilities: string[];
  /** The number on the player's own badge ("" = no badge). */
  badgeId: string;
  /** Restricted zones the player's own badge opens. */
  badgeAccess: string[];
}

/** One of the player's OWN job tasks. */
export interface TaskView {
  id: string;
  title: string;
  done: boolean;
  steps: {
    text: string;
    /** A command that does the step ("" for steps that are not commands). */
    hint: string;
    done: boolean;
  }[];
}

/** The hacker's private briefing (only the hacker's own browser ever receives one). */
export interface MissionBriefing {
  /** Infiltration: game minutes between first reading the flag and the moment it can be handed in (absent = none). */
  handInMinutes?: number;
  goal: string;
  /** Matches with several hackers: the others. Hackers know each other. */
  partners: { id: string; name: string }[];
  /** Where the tools folder is on the hacker's own PC. */
  toolsPath: string;
  /** Things that MIGHT be wrong with this office. Which of them are true today is not told. */
  rumours: string[];
}

/** One item on the shared evidence board, as one player sees it. */
export interface EvidenceView {
  /** "E12" */
  id: string;
  /** Text from a PC's screen, a camera picture, or a line of the badge / motion log. */
  kind: 'screen' | 'snapshot' | 'log';
  /** Where it came from: "FIN-LT-07 screen", "CAM-04", "Badge log". */
  title: string;
  text: string;
  /** Game time it was pinned. */
  time: number;
  /** Name of who pinned it. */
  pinnedBy: string;
  /** True for the receiving player's own pins (only those can be taken down). */
  mine: boolean;
  /** Camera pictures only: the picture. */
  frame?: { camera: string; time: number; people: MonitorPerson[] };
}

/** A person as a camera recorded them. */
export interface MonitorPerson {
  name: string;
  x: number;
  y: number;
  facing: Facing;
  /** Desk they sat at, "" when standing. */
  seatedAt: string;
  /** What they were visibly doing ("at-pc": crouched at a PC). */
  activity: string;
}

/** What a PC's screen shows after something happened. */
export interface TermScreen {
  /** Text to print. */
  output: string;
  /** Prompt for the next line. */
  prompt: string;
  /** The next line is a password: show stars instead of the characters. */
  masked: boolean;
  /** Which screen this is. */
  screen: 'login' | 'locked' | 'shell';
  /** True on a lock screen: "switch user" is available. */
  canSwitchUser: boolean;
}

export interface ServerMessages {
  /** The lobby this browser is in (sent whenever something about it changes). */
  party: PartyView;
  /** Acknowledges this player's movement input and its authoritative position. */
  'move.ack': { sequence: number; dx: number; dy: number; x: number; y: number };
  /** Sent on connect: who can be played. */
  lobby: { scenarioName: string; mapName: string; employees: EmployeeChoice[]; dev: boolean; hackerOpen: boolean };
  /** Sent after choosing an employee, and (with `back`) to somebody whose connection was lost and who has returned. */
  welcome: { playerId: string; card: OnboardingCard; mission: MissionBriefing | null; back?: true };
  /** The player sat down: the screen as it was left. */
  'term.open': TermScreen & { hostname: string };
  /** New text on the screen of the PC the player is sitting at. */
  'term.output': TermScreen;
  /** The player is no longer at a PC. */
  'term.close': { reason: string };
  /** The player's own task list (sent whenever it changes). */
  tasks: { tasks: TaskView[]; completed: number };
  /**
   * A security alert, shown to EVERY player as a banner. Deliberately vague:
   * it says that something happened, never where or by whom (that is in the
   * alert log, for those who can read it).
   */
  alert: { text: string };
  /** The match is over. Sent to everybody, including people on the start screen. */
  'match.over': { winner: 'hacker' | 'defenders'; hacker: string; hackers: string[]; at: number; reason: string };
  /** Right after match.over: everything the hacker did, and what was found or missed. Never sent during a match. */
  debrief: { debrief: DebriefView };
  /** Your onboarding card changed (the helpdesk gave you a new password). Only ever sent to its owner. */
  card: { card: OnboardingCard };
  /** The current meeting (or none), as this player sees it. */
  meeting: MeetingView;
  /**
   * A chat line this player hears (see chat.ts for the channels). `fromId` is the employee's id, for muting.
   * `room`: where an open line was said. Only people who are out get it: they hear every room.
   */
  chat: { channel: ChatChannel; from: string; fromId: string; text: string; time: number; room?: string };
  /**
   * A department meeting this player takes part in (large office), or that it is over (`active` false). `usesLeft`:
   * how many this player may still call.
   */
  talk: { active: boolean; room: string; calledBy: string; endsIn: number; members: string[]; usesLeft: number };
  /** You are out (voted out or detained): from now on you watch, and talk only with others who are out. */
  fired: { reason: string };
  /**
   * The security-office monitors (only for someone standing at them): what
   * each camera has recorded, and the latest badge and camera-motion lines.
   */
  'monitors.index': { cameras: { id: string; shots: { id: string; time: number; count: number }[] }[]; badges: string[]; motion: string[] };
  /** One recorded picture of a camera: who stood where. `id` is "" when the camera has nothing for that time. */
  'monitors.frame': { camera: string; id: string; time: number; people: MonitorPerson[] };
  /** The shared evidence board (sent to every player whenever it changes). */
  board: { items: EvidenceView[] };
  /** A short note for the HUD ("Too far from the desk"). */
  notice: { text: string };
  /** Developer panel replies. Never sent by a production server. */
  'dev.result': { action: string; text: string };
}

// ───────────────────────────── Client -> server messages ─────────────────────────────

export interface ClientMessages {
  /** In a lobby: "I am ready", or not any more. */
  'party.ready': { ready: boolean };
  /** The host of a lobby: change settings, close or open it, remove somebody, start the match. Ignored from others. */
  'party.settings': Partial<PartySettings>;
  'party.open': { open: boolean };
  'party.remove': { id: string };
  'party.start': Record<string, never>;
  /** After a match: this player is in the lobby again. */
  'party.back': Record<string, never>;
  /** Pick an employee on the start screen. */
  choose: { playerId: string; hacker?: boolean };
  /** Which way the player wants to walk: each of dx, dy is -1, 0 or 1. The SERVER decides the position. */
  move: { dx: number; dy: number; sequence?: number };
  /** Sit at a desk (the server checks the distance). */
  sit: { hostname: string };
  stand: Record<string, never>;
  /** Hold the badge against a door's reader (the server checks the distance and decides). */
  tap: { door: string };
  /**
   * Start / stop using a physical item (hold the key down / let go). Only the
   * hacker has one: the USB stick, used on the PC of `hostname`. The server
   * checks everything and counts the 5 seconds itself.
   */
  'item.start': { item: 'usb'; hostname: string };
  'item.stop': Record<string, never>;
  /** Use the security-office monitors (the server checks that you stand at them). */
  'monitors.open': Record<string, never>;
  /** Show a camera's picture at a time (game ms; omitted = the latest). */
  'monitors.frame': { camera: string; time?: number };
  /**
   * Pin something to the evidence board: text from the PC screen you sit at
   * (`text`), a camera picture you are looking at (`camera` + `snapshot`), or a
   * badge / motion log line from the monitors (`source` + `text`). The server
   * checks it really appeared on your screen.
   */
  'evidence.pin': { kind: 'screen' | 'snapshot' | 'log'; text?: string; camera?: string; snapshot?: string; source?: 'badges' | 'motion' };
  /** Take one of your own pins down. */
  'evidence.unpin': { id: string };
  /** The guard detains the person next to them (the server checks role, distance and that the power is still there). */
  detain: { target: string };
  /** Press the emergency button (the server checks you stand at it). */
  'meeting.call': Record<string, never>;
  /** Press a department's meeting button (large office; the server checks that you stand at one). */
  'talk.call': Record<string, never>;
  /** Accuse someone in a meeting, pointing at 3 or more evidence-board items. */
  'meeting.accuse': { suspect: string; evidence: string[] };
  /** Vote for an accused player's id, or "skip". */
  'meeting.vote': { target: string };
  /**
   * Say something. Without a channel, or with "room": at a meeting to everybody, when out of the game to the others who
   * are out, otherwise to the room. "hackers": to the partners only (ignored from anybody else).
   */
  'chat.send': { text: string; channel?: 'room' | 'hackers' };
  /** The hacker hands in the flag (the text of the flag file). */
  'flag.submit': { text: string };
  /** One finished line typed at the PC. */
  'term.line': { text: string };
  /** Ctrl+C. */
  'term.cancel': Record<string, never>;
  /** "Switch user" on a lock screen. */
  'term.switchUser': Record<string, never>;
  /** Developer panel (ignored by a production server). */
  'dev.speed': { multiplier: number };
  'dev.jump': { duration: string };
  'dev.events': { count: number };
  'dev.teleport': { hostname: string };
  'dev.dump': Record<string, never>;
  /**
   * Print something only the server knows. `what` is one of: bots, doors,
   * badges, tasks, unlocked, mission, cctv (arg = camera id), saw (arg = player id),
   * file (arg = "HOST:/path", shows the end of that file).
   */
  'dev.show': { what: string; arg?: string };
}

export type ServerMessageType = keyof ServerMessages;
export type ClientMessageType = keyof ClientMessages;
