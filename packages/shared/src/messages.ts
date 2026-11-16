/**
 * Every message that travels between the browser and the game server.
 *
 * THE VISIBILITY RULE. The server holds the whole simulated world, including
 * every password and the master event log. A browser must only ever receive
 * what its player could see by standing in the office:
 *   - public physical state (PublicState below, sent as automatic patches);
 *   - its own onboarding card (its own credentials only);
 *   - the text on the screen of the PC it is sitting at.
 * The types in this file are that whole list. If something is not in here,
 * the client has no way to receive it.
 */

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
}

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

export interface PublicState {
  /** Game time, milliseconds since 1970 (UTC). */
  clock: number;
  /** How many game seconds pass per real second. */
  speed: number;
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
  /** Sent on connect: who can be played. */
  lobby: { scenarioName: string; mapName: string; employees: EmployeeChoice[]; dev: boolean };
  /** Sent after choosing an employee. */
  welcome: { playerId: string; card: OnboardingCard };
  /** The player sat down: the screen as it was left. */
  'term.open': TermScreen & { hostname: string };
  /** New text on the screen of the PC the player is sitting at. */
  'term.output': TermScreen;
  /** The player is no longer at a PC. */
  'term.close': { reason: string };
  /** The player's own task list (sent whenever it changes). */
  tasks: { tasks: TaskView[]; completed: number };
  /** A short note for the HUD ("Too far from the desk"). */
  notice: { text: string };
  /** Developer panel replies. Never sent by a production server. */
  'dev.result': { action: string; text: string };
}

// ───────────────────────────── Client -> server messages ─────────────────────────────

export interface ClientMessages {
  /** Pick an employee on the start screen. */
  choose: { playerId: string };
  /** Which way the player wants to walk: each of dx, dy is -1, 0 or 1. The SERVER decides the position. */
  move: { dx: number; dy: number };
  /** Sit at a desk (the server checks the distance). */
  sit: { hostname: string };
  stand: Record<string, never>;
  /** Hold the badge against a door's reader (the server checks the distance and decides). */
  tap: { door: string };
  /** One finished line typed at the PC. */
  'term.line': { text: string };
  /** Ctrl+C. */
  'term.cancel': Record<string, never>;
  /** "Switch user" on a lock screen. */
  'term.switchUser': Record<string, never>;
  /** A key was pressed but the line is not finished (keeps the screen from auto-locking while typing). */
  'term.activity': Record<string, never>;
  /** Developer panel (ignored by a production server). */
  'dev.speed': { multiplier: number };
  'dev.jump': { duration: string };
  'dev.events': { count: number };
  'dev.teleport': { hostname: string };
  'dev.dump': Record<string, never>;
}

export type ServerMessageType = keyof ServerMessages;
export type ClientMessageType = keyof ClientMessages;
