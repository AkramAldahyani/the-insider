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
 * "Work" is mostly the bot's job tasks (tasks.ts): it types the commands of
 * the next step, answers password questions (ssh, sudo) with its own
 * password, and walks to a room when a step says so. Between tasks it types
 * a few everyday commands.
 *
 * The decision logic is the behaviour tree at the bottom of this file. Read
 * it top-down: break time has priority over working.
 */
import { lastStamp, type TerminalResult } from '@insider/engine';
import type { Point } from '@insider/shared';
import type { Avatar } from '../visibility';
import type { Analyst } from './investigators';
import type { Mover } from './mover';
import type { Random } from './random';
import { condition, selector, sequence, type Node, type Status } from './tree';

const SECOND = 1000;
/** When a bot first checks its own PC after arriving, and how often after that (game seconds). */
export const CHECK_MINUTES: readonly [number, number] = [8, 20];
/** What an employee types to see whether anyone else used their PC. */
export const SELF_CHECKS = ['last -n 10', 'crontab -l', 'ps aux', 'ss -tnp', 'ss -tlnp', 'dmesg | tail -8'];
/** The SOC analyst's job is the SIEM: it looks at the newest alerts much more often. */
export const SOC_CHECK = 'siem source=alert | tail 5';
const SOC_CHECK_EVERY: [number, number] = [60, 150];

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
  /** The bot's next task step, if it has one. */
  nextStep(): { taskId: string; title: string; index: number; last: boolean; run?: string; visit?: string; stayMs: number } | null;
  /** Give up on a task that cannot be done. */
  abandon(taskId: string): void;
  /** Desks of other employees in the same department. */
  colleagueDesks(): string[];
  /** Every desk except the bot's own. */
  otherDesks(): string[];
  /** Where a guard who investigates stands to look at the monitors (null = this bot does not). */
  watchSpot(): Point | null;
  /** The address of the bot's own PC (what `ip a` would show). */
  myIp(): string;
  /** The bot noticed something odd while checking its own PC: it remembers it (and may tell a meeting). */
  report(finding: ClueReport): void;
  /** Whether the own inbox shows an unread IT reset subject; ordinary mail is part of everyday work. */
  hasUnreadMail(): boolean;
}

/** Something a bot noticed on its own screen; `line` is the screen line that shows it (for the evidence board). */
export interface ClueReport {
  text: string;
  suspect?: string;
  weight: number;
  line?: string;
  /** Pin the line even if the finding itself is an old story. */
  pin?: boolean;
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
  /** Game minutes between two rounds of checks of the own PC. */
  checkMinutes: readonly [number, number];
  /** Average game time between the starts of two job tasks (ms). */
  taskEveryMs: number;
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
  /** True once the bot itself has typed something since sitting down: a question on screen is then its own (ssh, sudo). */
  typing: boolean;
  /** A task step that sends the bot to a room: the room and how long to stay (game ms). "" = none. */
  errand: string;
  errandMs: number;
  /** Game time before which the bot does not START a new job task (it may finish the current one). */
  nextTaskAt: number;
  /** The task step last attempted and how often, to give up on one that never completes. */
  stepKey: string;
  stepTries: number;
  /** A short description of what it is doing, for the developer panel. */
  doing: string;
  /** Game time of the next look at its own PC for anything odd (Phase 5, part G). */
  nextCheckAt: number;
  /** The last password it typed was a slip of the finger. */
  slipped: boolean;
  /** Commands left of the round of checks going on. */
  checkQueue: string[];
  /** The SOC analyst saw the alert banner and has not looked at the SIEM since. */
  alarmed: boolean;
  /** The next inbox action learned from the bot's own terminal output. */
  mailCommand: string;
  /** A read message gets one response decision, even if ordinary work rereads it. */
  seenMail: string[];
}

export function newMind(now: number, random: Random, taskEveryMs: number): Mind {
  return {
    nextBreakAt: now + random.between(120, 360) * SECOND,
    breakSpot: null, breakRoom: '', atBreakSpot: false, breakUntil: 0,
    nextKeyAt: 0, screen: null, loginSteps: 0, leaving: 'undecided', doing: 'arriving',
    // The first task starts some time after sitting down, not all at once.
    typing: false, errand: '', errandMs: 0, nextTaskAt: now + random.between(0.2, 0.8) * taskEveryMs, stepKey: '', stepTries: 0,
    nextCheckAt: Infinity, // set by firstCheck() (its own random numbers)
    mailCommand: '', seenMail: [], alarmed: false, slipped: false, checkQueue: [],
  };
}

/** One bot: who it is, its body, its legs, its memory and its hands on the world. */
export interface BotSubject {
  persona: Persona;
  body: Avatar;
  mover: Mover;
  mind: Mind;
  random: Random;
  /** Separate random numbers for checking the own PC, so adding those checks did not reshuffle the rest of the day. */
  checks: Random;
  mailRandom: Random;
  world: BrainWorld;
  /** The SOC analyst's investigation, in matches where bots investigate. */
  analyst?: Analyst;
}

// ───────────────────────────── Helpers ─────────────────────────────

/** The account and machine of a shell prompt: "s.alharbi@FIN-LT-07:~$ " -> "s.alharbi", "FIN-LT-07". */
const promptUser = (screen: TerminalResult | null) => /^([^@\s]+)@/.exec(screen?.prompt ?? '')?.[1] ?? '';
const promptHost = (screen: TerminalResult | null) => /^[^@\s]+@([^:\s]+):/.exec(screen?.prompt ?? '')?.[1] ?? '';
/** A plain shell prompt (no question pending). */
const atShell = (b: BotSubject) => b.mind.screen?.screen === 'shell' && !b.mind.screen.awaitingInput;
/** ...of the bot's own account on its own PC (not inside an ssh session to somewhere else). */
const atOwnShell = (b: BotSubject) => atShell(b) && promptUser(b.mind.screen) === b.persona.account && promptHost(b.mind.screen) === b.persona.desk;
/** ...of the bot's own account on ANOTHER machine: it is inside an ssh session it opened. */
const inRemoteShell = (b: BotSubject) => atShell(b) && promptUser(b.mind.screen) === b.persona.account && promptHost(b.mind.screen) !== b.persona.desk;
/**
 * The password, with an occasional slip of the finger (which leaves an honest
 * failure in the log). After a slip people type slowly: never two in a row, or
 * three of them would look like somebody guessing (the auth-failures alert).
 */
function typedPassword(b: BotSubject): string {
  const slip = b.random.chance(0.06) && !b.mind.slipped;
  b.mind.slipped = slip;
  return slip ? b.persona.password.slice(0, -1) : b.persona.password;
}

/** Pauses like a person: the next key press is `min` to `max` seconds from now. */
function pause(b: BotSubject, min: number, max: number): void {
  b.mind.nextKeyAt = b.world.now() + b.random.between(min, max) * SECOND;
}
const ready = (b: BotSubject) => b.world.now() >= b.mind.nextKeyAt;

/** Reading mail during a task or ordinary work uses the same response decision. */
function typeWork(b: BotSubject, command: string): void {
  const own = atOwnShell(b);
  b.mind.screen = b.world.type(command);
  if (own && /^mail\s+\d+$/.test(command)) {
    const id = /^Message-ID: (.+)$/m.exec(b.mind.screen.output)?.[1];
    if (id && !b.mind.seenMail.includes(id)) {
      b.mind.seenMail.push(id);
      b.mind.mailCommand = resetLink(b.mind.screen.output, b.mailRandom.next());
    }
  }
}

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
  // Not a desk behind a door this badge does not open (the helpdesk and the security office).
  const reachable = (hosts: string[]) => hosts.filter((h) => { const at = world.spotAtDesk(h); return at !== null && b.mover.canReach(at.x, at.y); });
  const desk = (hostname: string | undefined) => (hostname ? { spot: world.spotAtDesk(hostname), room: `desk ${hostname}` } : room('Corridor'));
  if (b.mind.errand) return room(b.mind.errand); // a task sends the bot somewhere
  const roll = random.next();
  if (persona.role === 'guard') {
    // A patrol: mostly the corridor and the public rooms. An investigating guard also goes to the monitors.
    const watch = world.watchSpot();
    if (watch && b.checks.chance(0.5)) return { spot: watch, room: 'the monitors' };
    return room(random.pick(['Corridor', 'Corridor', 'Reception', 'Cafeteria / meeting room', 'Printer room', 'Storage']));
  }
  if (persona.role === 'helpdesk' && roll < 0.6) return desk(random.pick(reachable(world.otherDesks()))); // "have you tried turning it off and on?"
  if (persona.role === 'sysadmin' && roll < 0.3) return room('Server room');
  if (roll < 0.45) return room('Cafeteria / meeting room');
  if (roll < 0.7) return room('Bathrooms');
  if (roll < 0.88) return room('Printer room');
  return desk(random.pick(reachable(world.colleagueDesks())));
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
  // First finish what is on the screen: answer nothing, close remote sessions.
  if (mind.screen?.screen === 'shell' && (mind.screen.awaitingInput || inRemoteShell(b))) {
    if (!ready(b)) return 'running';
    mind.screen = mind.screen.awaitingInput ? b.world.cancel() : b.world.type('exit');
    pause(b, 0.8, 2);
    return 'running';
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
  mind.mailCommand = '';
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
  if (mind.errand) {
    const step = b.world.nextStep();
    if (step?.visit === mind.errand) b.world.abandon(step.taskId); // a task that cannot be done
  }
  endBreak(b);
  return 'failure';
}

function endBreak(b: BotSubject): void {
  const [min, max] = rhythm(b.persona.role).work;
  Object.assign(b.mind, { breakSpot: null, breakRoom: '', atBreakSpot: false, breakUntil: 0, errand: '', errandMs: 0 });
  b.mind.nextBreakAt = b.world.now() + b.random.between(min, max) * SECOND;
}

function linger(b: BotSubject): Status {
  const { mind } = b;
  if (mind.breakUntil === 0) {
    const [min, max] = rhythm(b.persona.role).away;
    // On an errand: as long as the task asks, plus a moment. Otherwise a normal break.
    mind.breakUntil = b.world.now() + (mind.errand ? mind.errandMs + b.random.between(2, 6) * SECOND : b.random.between(min, max) * SECOND);
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
  mind.typing = false;
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
  // A password question the bot caused itself (ssh, sudo): `work` answers it.
  if (screen.screen === 'shell' && mind.typing && (screen.awaitingInput || inRemoteShell(b))) return 'success';
  if (!ready(b)) return 'running';
  if (++mind.loginSteps > 10) {
    // Something is wrong with this PC (password changed?). Give up for now.
    b.world.stand();
    mind.screen = null;
    mind.nextBreakAt = b.world.now();
    return 'failure';
  }
  mind.doing = 'logging in';
  const password = () => typedPassword(b);
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

/**
 * Work: the next step of a job task, or an everyday command in between.
 * Never finishes; a break (or an errand) interrupts it.
 */
function work(b: BotSubject): Status {
  const { mind, persona } = b;
  if (!ready(b)) return 'running';
  const screen = mind.screen!;
  mind.typing = true;

  // A question on the screen: ssh or sudo asking for the password.
  if (screen.awaitingInput) {
    mind.screen = screen.awaitingInput.masked ? b.world.type(typedPassword(b)) : b.world.cancel();
    pause(b, 1.5, 4);
    return 'running';
  }

  // A queued read/click comes only from the inbox text this bot saw. Never act
  // on a message while using somebody else's account or a remote shell.
  if (atOwnShell(b) && mind.mailCommand) {
    const command = mind.mailCommand;
    mind.mailCommand = '';
    typeWork(b, command);
    mind.doing = 'reading mail';
    pause(b, 3, 8);
    return 'running';
  }

  // An investigating analyst follows its leads, one query at a time.
  if (b.analyst && !mind.alarmed && atOwnShell(b) && b.world.now() < mind.nextCheckAt) {
    const query = b.analyst.next();
    if (query) {
      mind.screen = b.world.type(query);
      for (const clue of b.analyst.read(mind.screen.output)) b.world.report(clue);
      mind.doing = 'investigating';
      mind.nextKeyAt = b.world.now() + b.checks.between(8, 20) * SECOND;
      return 'running';
    }
  }

  // The SOC analyst looks at the alerts before starting anything else (after an alert: leaving the server for it, too).
  if (mind.alarmed && inRemoteShell(b)) {
    mind.screen = b.world.type('exit');
    pause(b, 1, 3);
    return 'running';
  }
  if (persona.role === 'soc' && atOwnShell(b) && b.world.now() >= mind.nextCheckAt) return checkOwnPc(b);

  // The next task step - unless it would START a new task before it is time (task pace).
  const next = b.world.nextStep();
  const step = next && (next.index > 0 || inRemoteShell(b) || b.world.now() >= mind.nextTaskAt) ? next : null;
  if (step?.index === 0 && mind.stepKey !== `${step.taskId}/0`) {
    // Starting a task: the one after it may start about one pace from now (between 0.7 and 1.3 of it).
    mind.nextTaskAt = b.world.now() + b.random.between(0.7, 1.3) * persona.taskEveryMs;
  }
  if (step?.visit) {
    // A step somewhere else in the building: handled like a break with a destination.
    mind.errand = step.visit;
    mind.errandMs = step.stayMs;
    mind.nextBreakAt = b.world.now();
    mind.doing = `task: ${step.title}`;
    return 'running';
  }
  if (step?.run) {
    const key = `${step.taskId}/${step.index}`;
    mind.stepTries = mind.stepKey === key ? mind.stepTries + 1 : 1;
    mind.stepKey = key;
    if (mind.stepTries > 2) {
      // Typed twice and the step still is not done (the ssh login failed, a file is missing...): drop the task.
      b.world.abandon(step.taskId);
      mind.stepKey = '';
      pause(b, 2, 5);
      return 'running';
    }
    typeWork(b, step.run);
    mind.doing = `task: ${step.title}`;
    pause(b, 3, 10);
    return 'running';
  }

  if (atOwnShell(b) && b.world.hasUnreadMail()) {
    mind.screen = b.world.type('mail');
    const unread = [...mind.screen.output.matchAll(/^N\s*(\d+)\s/gm)].at(-1);
    mind.mailCommand = unread ? `mail ${unread[1]}` : '';
    mind.doing = 'checking mail';
    pause(b, 3, 8);
    return 'running';
  }

  // Every now and then: is anything odd on my own PC? (The defenders' side of the game.)
  if (!inRemoteShell(b) && b.world.now() >= mind.nextCheckAt) return checkOwnPc(b);

  // Nothing from a task right now: now and then an everyday command, otherwise
  // reading, thinking, a phone call... (idle time: no keys pressed at all).
  if (inRemoteShell(b)) {
    mind.screen = b.world.type('exit');
    pause(b, 2, 6);
    return 'running';
  }
  if (b.random.chance(0.6)) {
    typeWork(b, b.random.pick(persona.commands));
    mind.doing = 'working';
  } else mind.doing = 'reading';
  pause(b, 15, 50);
  return 'running';
}

/**
 * One look at the own PC, and what is odd about it. An employee runs all the
 * checks one after another (a round), in a different order each time; the SOC
 * analyst mostly looks at the SIEM instead.
 */
function checkOwnPc(b: BotSubject): Status {
  const { mind, persona } = b;
  if (mind.checkQueue.length === 0) {
    const soc = persona.role === 'soc' && (mind.alarmed || b.checks.chance(0.85));
    if (soc) mind.checkQueue = [SOC_CHECK];
    else {
      const left = [...SELF_CHECKS];
      while (left.length > 0) mind.checkQueue.push(left.splice(b.checks.int(0, left.length - 1), 1)[0]);
    }
  } else if (mind.alarmed) mind.checkQueue = [SOC_CHECK];
  mind.alarmed = false;
  const command = mind.checkQueue.shift()!;
  mind.screen = b.world.type(command);
  for (const finding of inspect(command, mind.screen.output, { account: persona.account, desk: persona.desk, ip: b.world.myIp(), today: today(b.world.now()) })) b.world.report(finding);
  if (command === SOC_CHECK && b.analyst) for (const clue of b.analyst.saw(mind.screen.output)) b.world.report(clue);
  if (mind.checkQueue.length === 0) {
    const [from, to] = persona.role === 'soc' ? SOC_CHECK_EVERY : [persona.checkMinutes[0] * 60, persona.checkMinutes[1] * 60];
    mind.nextCheckAt = b.world.now() + b.checks.between(from, to) * SECOND;
  }
  mind.doing = 'checking own PC';
  mind.nextKeyAt = b.world.now() + b.checks.between(5, 15) * SECOND;
  return 'running';
}

/** Only the fixed in-game reset links can become a bot command; mail text is never executable. */
export function resetLink(output: string, roll: number): string {
  const body = output.split('\n\n').slice(1).join('\n\n');
  const link = /^https:\/\/password-reset\.example\/reset\/[1-9]\d*$/m.exec(body)?.[0];
  return link && roll < 0.3 ? `curl ${link}` : '';
}

// ───────────────────────────── Checking the own PC ─────────────────────────────

/** When a newly arrived bot first checks its own PC: after about half the usual time. */
export function firstCheck(now: number, checks: Random, minutes: readonly [number, number] = CHECK_MINUTES): number {
  return now + checks.between(minutes[0] * 30, minutes[1] * 30) * SECOND;
}

/** "Mon Mar  2": how `last` writes today's date (the start of its time column). */
export function today(now: number): string {
  return lastStamp(now).slice(0, 10);
}

/**
 * What an employee concludes from a check of their own PC. Only what the
 * screen shows is used:
 *  - `last`: a login TODAY that came over the network (an address in the
 *    third column) - nobody but the owner should use this PC, and the owner
 *    sits in front of it. (Before today it is old news.)
 *  - `siem source=alert` (the SOC analyst): the alerts of today;
 *  - `ps aux`: a program that runs from a hidden folder, or calls itself a
 *    remote shell - employees start neither;
 *  - `ss -tnp`: a connection that is not ssh: between two high port numbers
 *    (its other end is an address: whose PC is that?);
 *  - `ss -tlnp`: something other than ssh waiting for connections;
 *  - `dmesg`: a USB keyboard plugged in after the PC started;
 *  - `crontab -l`: an "@reboot" line - ordinary employees never schedule
 *    anything, so this was not them.
 * Findings carry no suspect: the PC does not know WHO did it. The meeting
 * hears the facts and the investigators follow them up.
 */
export function inspect(command: string, output: string, me: { account: string; desk: string; ip: string; today: string }): ClueReport[] {
  const found: ClueReport[] = [];
  if (command.startsWith('last')) {
    for (const line of output.split('\n')) {
      const [user, tty, from] = line.trim().split(/\s+/);
      if (!user || !tty || !from || !line.includes(me.today)) continue;
      const at = /(\d\d:\d\d)/.exec(line.slice(line.indexOf(me.today)))?.[1] ?? '?';
      if (tty.startsWith('tty') && user !== me.account) {
        found.push({ text: `${user} logged in at my PC ${me.desk}, sitting in front of it, at ${at}.`, weight: 0, line: line.trim() });
        continue;
      }
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(from) || from === me.ip) continue;
      found.push({ text: `Someone logged in to my PC ${me.desk} as ${user} from ${from} at ${at}. That was not me.`, weight: 0, line: line.trim() });
    }
  }
  if (command.startsWith('crontab')) {
    for (const line of output.split('\n')) {
      if (line.trim().startsWith('@reboot')) found.push({ text: `My crontab on ${me.desk} has a line I never added: ${line.trim()}`, weight: 0, line: line.trim() });
    }
  }
  if (command === 'ps aux') {
    for (const line of output.split('\n')) {
      const program = line.trim().split(/\s+/).slice(10).join(' ');
      if (/^\S*\/\.[\w-]+\/\S*|^\S+: remote shell/.test(program)) found.push({ text: `A program I never started runs on my PC ${me.desk}: ${program}`, weight: 0, line: line.trim() });
    }
  }
  if (command.startsWith('ss ')) {
    for (const line of output.split('\n')) {
      const [state, , , local, peer, users] = line.trim().split(/\s+/);
      const port = Number(/:(\d+)$/.exec(local ?? '')?.[1]);
      const program = /\(\("([^"]+)"/.exec(users ?? '')?.[1];
      const by = program ? ` (${program})` : '';
      if (state === 'LISTEN' && port !== 22 && users) found.push({ text: `Something waits for connections on port ${port} of my PC ${me.desk}${by}.`, weight: 0, line: line.trim() });
      if (state === 'ESTAB' && port >= 1024 && Number(/:(\d+)$/.exec(peer ?? '')?.[1]) >= 1024) {
        found.push({ text: `My PC ${me.desk} has a connection with ${peer.slice(0, peer.lastIndexOf(':'))} on port ${port} that I did not make${by}.`, weight: 0, line: line.trim() });
      }
    }
  }
  if (command.startsWith('dmesg')) {
    for (const line of output.split('\n')) {
      // The seconds since the PC started: its own devices are found in the first moments.
      const m = /^\[ *(\d+)\.\d+\] usb .*Product: (.*Keyboard.*)$/i.exec(line.trim());
      if (m && Number(m[1]) > 300) found.push({ text: `A ${m[2]} was plugged into my PC ${me.desk}. That was not me.`, weight: 0, line: line.trim() });
    }
  }
  if (command === SOC_CHECK) {
    // Rows of today begin with the time: "09:10:03 SEC-SRV-01    alert    severity=high rule=flag-read src_ip=10.0.2.71"
    for (const line of output.split('\n')) {
      const m = /^(\d\d:\d\d:\d\d) \S+ +alert +(.+)$/.exec(line.trimEnd());
      if (m) found.push({ text: `The SIEM shows a security alert at ${m[1]}: ${m[2]}.`, weight: 0, line: line.trim() });
    }
  }
  return found;
}

// ───────────────────────────── The tree ─────────────────────────────

export const employeeTree: Node<BotSubject> = selector(
  sequence(isBreakTime, leaveDesk, walkToBreak, linger),
  sequence(beAtDesk, reachShell, work),
);
