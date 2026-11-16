/**
 * What a bot employee does with its day.
 *
 *   come in -> walk to own desk -> sit -> log in / unlock -> work
 *        -> (after a while) lock the screen, or forget to -> take a break
 *        -> come back -> ...
 *
 * The bot uses its PC exactly as a human does: it sits down through the same
 * game rules and types lines into the same engine terminal. So everything it
 * does lands in the same logs, under its own account, with realistic pauses.
 * It knows only what an employee knows: its own username and password.
 *
 * The decision logic is the behaviour tree at the bottom of this file. Read
 * it top-down: break time has priority over working.
 */
import type { TerminalResult } from '@insider/engine';
import type { Point } from '@insider/shared';
import type { Avatar } from '../visibility';
import type { Mover } from './mover';
import type { Random } from './random';
import { condition, selector, sequence, type Node, type Status } from './tree';

const SECOND = 1000;

/** What the brain may do in the world. Supplied by the BotManager. */
export interface BrainWorld {
  /** Game time now (ms). */
  now(): number;
  /** Sit at a desk. Returns the screen, or a sentence saying why not (too far, occupied). */
  sit(hostname: string): TerminalResult | string;
  stand(): void;
  /** Type one line and press Enter. */
  type(line: string): TerminalResult;
  /** Ctrl+C. */
  cancel(): TerminalResult;
  /** "Switch user" on a lock screen. */
  switchUser(): TerminalResult;
  /** The name printed on the lock screen of the PC the bot sits at ("" if it is not locked). */
  lockedBy(): string;
  /** A random free spot to stand in a room, or null if the room is unknown. */
  spotIn(room: string): Point | null;
  /** The point where a desk's owner stands when visiting it (two tiles below the chair), or null. */
  spotAtDesk(hostname: string): Point | null;
  /** Desks of other employees in the same department. */
  colleagueDesks(): string[];
  /** Every desk except the bot's own. */
  otherDesks(): string[];
}

/** Everything fixed about one bot. */
export interface Persona {
  playerId: string;
  account: string;
  password: string;
  role: string;
  desk: string;
  chair: Point;
  /** Things this employee types during ordinary work. */
  commands: string[];
  /** Probability of walking away without locking the screen. */
  forgetLock: number;
}

/** A bot's memory. Plain data, so it is easy to show in the developer panel. */
export interface Mind {
  /** Game time of the next break. */
  nextBreakAt: number;
  /** Where the current break is spent, and until when. */
  breakSpot: Point | null;
  breakRoom: string;
  atBreakSpot: boolean;
  breakUntil: number;
  /** Game time before which the bot does not touch the keyboard (thinking, reading, typing). */
  nextKeyAt: number;
  /** The screen as the bot last saw it (null = not looking at one). */
  screen: TerminalResult | null;
  /** Lines typed while trying to get to a shell; stops endless retries. */
  loginSteps: number;
  /** Did the bot already decide about locking for this departure? */
  leaving: 'undecided' | 'locking' | 'ready';
  /** A short description of what it is doing, for the developer panel. */
  doing: string;
}

export function newMind(now: number, random: Random): Mind {
  return {
    nextBreakAt: now + random.between(120, 360) * SECOND,
    breakSpot: null, breakRoom: '', atBreakSpot: false, breakUntil: 0,
    nextKeyAt: 0, screen: null, loginSteps: 0, leaving: 'undecided', doing: 'arriving',
  };
}

/** One bot: who it is, its body, its legs, its memory and its hands on the world. */
export interface BotSubject {
  persona: Persona;
  body: Avatar;
  mover: Mover;
  mind: Mind;
  random: Random;
  world: BrainWorld;
}

// ───────────────────────────── Helpers ─────────────────────────────

/** The account a shell prompt belongs to: "s.alharbi@FIN-LT-07:~$ " -> "s.alharbi". */
const promptUser = (screen: TerminalResult | null) => /^([^@\s]+)@/.exec(screen?.prompt ?? '')?.[1] ?? '';
const atOwnShell = (b: BotSubject) => b.mind.screen?.screen === 'shell' && !b.mind.screen.awaitingInput && promptUser(b.mind.screen) === b.persona.account;

/** Pauses like a person: the next key press is `min` to `max` seconds from now. */
function pause(b: BotSubject, min: number, max: number): void {
  b.mind.nextKeyAt = b.world.now() + b.random.between(min, max) * SECOND;
}
const ready = (b: BotSubject) => b.world.now() >= b.mind.nextKeyAt;

/** How often, and for how long, each role leaves its desk (game seconds). */
function rhythm(role: string): { work: [number, number]; away: [number, number] } {
  if (role === 'guard') return { work: [60, 150], away: [8, 20] }; // short stops on a patrol
  if (role === 'helpdesk') return { work: [120, 300], away: [25, 60] };
  return { work: [180, 480], away: [25, 80] };
}

/** Picks where to spend a break, by role. */
function chooseBreak(b: BotSubject): { spot: Point | null; room: string } {
  const { random, world, persona } = b;
  const room = (name: string) => ({ spot: world.spotIn(name), room: name });
  const desk = (hostname: string | undefined) => (hostname ? { spot: world.spotAtDesk(hostname), room: `desk ${hostname}` } : room('Corridor'));
  const roll = random.next();
  if (persona.role === 'guard') {
    // A patrol: mostly the corridor and the public rooms.
    return room(random.pick(['Corridor', 'Corridor', 'Reception', 'Cafeteria / meeting room', 'Printer room', 'Storage']));
  }
  if (persona.role === 'helpdesk' && roll < 0.6) return desk(random.pick(world.otherDesks())); // "have you tried turning it off and on?"
  if (persona.role === 'sysadmin' && roll < 0.3) return room('Server room');
  if (roll < 0.45) return room('Cafeteria / meeting room');
  if (roll < 0.7) return room('Bathrooms');
  if (roll < 0.88) return room('Printer room');
  return desk(random.pick(world.colleagueDesks()));
}

// ───────────────────────────── The steps (leaves of the tree) ─────────────────────────────

const isBreakTime: Node<BotSubject> = condition((b) => b.world.now() >= b.mind.nextBreakAt);

/** Before leaving: lock the screen (or forget to), then stand up. */
function leaveDesk(b: BotSubject): Status {
  const { mind, body } = b;
  if (!body.seatedAt) {
    mind.leaving = 'undecided';
    return 'success';
  }
  if (mind.leaving === 'undecided') {
    // Only an open shell of one's own can be locked; anything else is left as it is.
    const forget = !atOwnShell(b) || b.random.chance(b.persona.forgetLock);
    mind.leaving = forget ? 'ready' : 'locking';
    pause(b, 1, 3);
    mind.doing = forget ? 'leaving the desk (screen left as it is)' : 'locking the screen';
    return 'running';
  }
  if (!ready(b)) return 'running';
  if (mind.leaving === 'locking') {
    mind.screen = b.world.type('loginctl lock-session');
    mind.leaving = 'ready';
    pause(b, 0.5, 1.5);
    return 'running';
  }
  b.world.stand();
  mind.screen = null;
  mind.leaving = 'undecided';
  return 'success';
}

function walkToBreak(b: BotSubject): Status {
  const { mind, mover } = b;
  if (mind.atBreakSpot) return 'success';
  if (!mind.breakSpot) {
    const choice = chooseBreak(b);
    if (!choice.spot || !mover.goTo(choice.spot.x, choice.spot.y)) {
      // Nowhere to go (or no way there): skip this break and try again in a minute.
      mind.nextBreakAt = b.world.now() + 60 * SECOND;
      return 'failure';
    }
    mind.breakSpot = choice.spot;
    mind.breakRoom = choice.room;
    mind.doing = `walking to ${choice.room}`;
    return 'running';
  }
  if (mover.state === 'walking') return 'running';
  if (mover.state === 'arrived') {
    mind.atBreakSpot = true;
    return 'success';
  }
  // The walk failed (a door refused the badge, or something was in the way): the break ends here.
  endBreak(b);
  return 'failure';
}

function endBreak(b: BotSubject): void {
  const [min, max] = rhythm(b.persona.role).work;
  Object.assign(b.mind, { breakSpot: null, breakRoom: '', atBreakSpot: false, breakUntil: 0 });
  b.mind.nextBreakAt = b.world.now() + b.random.between(min, max) * SECOND;
}

function linger(b: BotSubject): Status {
  const { mind } = b;
  if (mind.breakUntil === 0) {
    const [min, max] = rhythm(b.persona.role).away;
    mind.breakUntil = b.world.now() + b.random.between(min, max) * SECOND;
    mind.doing = `in ${mind.breakRoom}`;
  }
  if (b.world.now() < mind.breakUntil) return 'running';
  endBreak(b);
  return 'success';
}

/** Walk to the own chair and sit down. */
function beAtDesk(b: BotSubject): Status {
  const { mind, mover, body, persona } = b;
  if (body.seatedAt === persona.desk) return 'success';
  const atChair = Math.hypot(body.x - persona.chair.x, body.y - persona.chair.y) < 2;
  if (!atChair) {
    if (mover.state !== 'walking') {
      mind.doing = 'walking to the desk';
      if (!mover.goTo(persona.chair.x, persona.chair.y)) {
        mind.nextBreakAt = b.world.now(); // cannot reach the desk: go and do something else
        return 'failure';
      }
    }
    return 'running';
  }
  const result = b.world.sit(persona.desk);
  if (typeof result === 'string') {
    // Somebody is sitting at my desk. Walk off and come back later.
    mind.doing = `cannot sit: ${result}`;
    mind.nextBreakAt = b.world.now();
    return 'failure';
  }
  mind.screen = result;
  mind.loginSteps = 0;
  pause(b, 1, 2.5);
  mind.doing = 'sitting down';
  return 'running';
}

/** From whatever the screen shows to an open shell of the bot's own account. */
function reachShell(b: BotSubject): Status {
  const { mind, persona } = b;
  const screen = mind.screen;
  if (!screen) return 'failure';
  if (atOwnShell(b)) return 'success';
  if (!ready(b)) return 'running';
  if (++mind.loginSteps > 10) {
    // Something is wrong with this PC (password changed?). Give up for now.
    b.world.stand();
    mind.screen = null;
    mind.nextBreakAt = b.world.now();
    return 'failure';
  }
  mind.doing = 'logging in';
  const password = () => {
    // Now and then a finger slips, which leaves an honest "authentication failure" in the log.
    const typo = b.random.chance(0.06);
    return typo ? `${persona.password.slice(0, -1)}` : persona.password;
  };
  if (screen.screen === 'locked') {
    // My own lock screen: type my password. Someone else's session locked on my PC: log in next to it.
    mind.screen = b.world.lockedBy() === persona.account || !screen.canSwitchUser ? b.world.type(password()) : b.world.switchUser();
  } else if (screen.screen === 'login') {
    mind.screen = screen.awaitingInput?.masked ? b.world.type(password()) : b.world.type(persona.account);
  } else if (screen.awaitingInput) {
    mind.screen = b.world.cancel(); // a question left on screen by someone else
  } else {
    mind.screen = b.world.type('exit'); // somebody else's shell: close it
  }
  pause(b, 1.2, 3.5);
  return 'running';
}

/** Ordinary work: a command every now and then. Never finishes; a break interrupts it. */
function work(b: BotSubject): Status {
  const { mind, persona } = b;
  if (!ready(b)) return 'running';
  mind.screen = b.world.type(b.random.pick(persona.commands));
  mind.doing = 'working';
  pause(b, 6, 24);
  return 'running';
}

// ───────────────────────────── The tree ─────────────────────────────

export const employeeTree: Node<BotSubject> = selector(
  sequence(isBreakTime, leaveDesk, walkToBreak, linger),
  sequence(beAtDesk, reachShell, work),
);
