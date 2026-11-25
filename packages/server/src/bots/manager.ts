/**
 * The bot employees of a match.
 *
 * Every employee of the scenario that no human is playing is played by a bot.
 * A bot's body is an ordinary Avatar in the game's list of bodies, so a
 * browser receives it exactly like a human's: same fields, same name label,
 * same look. Nothing sent to a browser says "this one is a bot".
 *
 * Lifecycle of a bot:
 *   waiting  -> not in the building yet. Each bot gets an arrival time in the
 *               first few minutes of the match;
 *   present  -> appeared on the pavement outside, taps the main entrance and
 *               walks to its desk. From there its brain (brain.ts) decides
 *               what it does: work, breaks, locking or forgetting to lock.
 *
 * When a human picks an employee, that employee's bot leaves the game at
 * once; when the human disconnects, a bot takes the employee over again and
 * walks in through the entrance a little later.
 *
 * This file also keeps each bot's OBSERVATIONS (who it saw, where, and when)
 * and its FINDINGS (Phase 5, part G): the few things it would mention in an
 * emergency meeting, each with a weight saying how suspicious it is:
 *   3  somebody stood right behind me while I typed my password;
 *   3  somebody fiddled with my PC while standing at it (the USB stick);
 *   2  somebody sat at my PC while I was not there;
 *   2  somebody fiddled with a colleague's PC;
 *   1  somebody without an IT job sat at a colleague's PC;
 *   1  somebody without an IT job was in the server room;
 *   0  facts from checking my own PC (a login from another address, a program
 *      or connection I never started, a USB keyboard...): suspicious, but they
 *      name nobody.
 * In a meeting a bot says its strongest findings in the chat, and votes only
 * on what it knows itself (see `ballot`).
 */
import { commandNames, screenState, setHacker, type Scenario, type TerminalResult, type World } from '@insider/engine';
import { DETAIN_DISTANCE, PLAYER_RADIUS, isFree, roomAt, type MapDoor, type Point } from '@insider/shared';
import type { Avatar } from '../visibility';
import { CHECK_MINUTES, employeeTree, firstCheck, newMind, type BotSubject, type BrainWorld, type Mind, type Persona } from './brain';
import { FAST_INVESTIGATION, type InvestigationPace } from './investigation-pace';
import { Analyst, refusedBadge, suspicious, type StaffEntry } from './investigators';
import { Mover, type MoverWorld } from './mover';
import { Random } from './random';
import type { Snapshot } from '../cctv';
import type { EvidenceItem } from '../evidence';
import type { Verdict } from '../judge';
import type { TaskBoard } from '../tasks';
import { HackerBrain, type HackerPlan } from './hacker';
import { hackerKnowledge, type HackerDifficulty, type HackerKnowledge } from './hacker-knowledge';
import { paceFor, type HackerPace } from './hacker-pace';

/** What the bots need from the game (kept small, so bots cannot reach into things they should not). */
export interface BotHost extends Omit<MoverWorld, 'mayEnter'> {
  world: World;
  scenario: Scenario;
  /** Puts a body into the office / takes it out. */
  addBody(avatar: Avatar): void;
  removeBody(key: string): void;
  /** Every body in the office, humans and bots. */
  bodies(): Avatar[];
  /** The main entrance logs that this body came to work. */
  cameIn(avatar: Avatar): void;
  /** The same actions a human has, with the same checks. */
  sit(avatar: Avatar, hostname: string): TerminalResult | string;
  stand(avatar: Avatar): void;
  type(avatar: Avatar, line: string): TerminalResult;
  cancel(avatar: Avatar): TerminalResult;
  switchUser(avatar: Avatar): TerminalResult;
  usb(avatar: Avatar, hostname: string): void;
  submit(avatar: Avatar, text: string): boolean;
  /** Puts a line of the bot's own screen on the evidence board, or a picture or badge line from the monitors. */
  pin(avatar: Avatar, text: string): void;
  pinPicture(avatar: Avatar, shot: Snapshot): void;
  pinBadgeLine(avatar: Avatar, line: string): void;
  /** The evidence board, which everybody sees. */
  board(): readonly EvidenceItem[];
  /** Is this body standing at the security monitors? What they show: pictures after a time, and the badge log's last lines. */
  atMonitors(avatar: Avatar): boolean;
  pictures(after: number): Snapshot[];
  badgeLines(): string[];
  /** May this guard still detain people? And somebody against whom the evidence is strong, given what the guard saw (null = nobody). */
  mayDetain(avatar: Avatar): boolean;
  strongCase(guard: string, saw: { suspect: string; weight: number; caught: boolean }[]): string | null;
  detain(avatar: Avatar, target: string): void;
  /** Somebody against whom the evidence on the board would convince a meeting, with a key that changes when there is more of it. */
  convincingCase(not: (key: string) => boolean): { suspect: string; key: string; pinnedBy: string[] } | null;
  /** Why this body may not call a meeting now ("" = it may), where the button is, and pressing it. */
  whyNoMeeting(avatar: Avatar): string;
  callMeeting(avatar: Avatar, suspect: string): void;
  finished(): boolean;
  inMeeting(): boolean;
  /** Job tasks: hand a player their tasks, read the next step, give one up. */
  tasks: TaskBoard;
}

export interface BotOptions {
  /** An unclaimed employee is the simulated hacker by default. False keeps an ordinary office. */
  hacker?: boolean;
  hackerDifficulty?: HackerDifficulty;
  /** This employee must not be the simulated hacker (a solo player who chose to defend). */
  hackerNot?: string;
  /** This employee is the hacker (a lobby's match, where the server has drawn already). If a human plays them, so be it. */
  hackerId?: string;
  /** How fast the simulated hacker plays. Default: the pace that belongs to its difficulty. */
  hackerPace?: HackerPace;
  /** Bots put the clues they find on the evidence board themselves: at most this many in a match (default 0). */
  pinClues?: number;
  /** Everybody comes to work within this many game seconds of the start (default 240). */
  arriveSeconds?: number;
  /** The bot SOC analyst follows addresses and the bot guard watches the monitors and detains (see investigators.ts). */
  investigate?: boolean;
  /** How fast they do that (default: as fast as they can). */
  investigationPace?: InvestigationPace;
  /** Game minutes between two rounds of checks a bot makes of its own PC (default 8 to 20). */
  checkMinutes?: readonly [number, number];
  /** Probability that a bot leaves its desk without locking the screen (default 0.25). */
  forgetLock?: number;
  /**
   * Average game minutes between the starts of two job tasks of one bot
   * (default 3). Between tasks a bot types an everyday command now and then,
   * and otherwise sits idle.
   */
  taskMinutes?: number;
}

/** One thing a bot noticed: somebody came into view, sat down, or stood up. */
export interface Observation {
  /** Game time (ms). */
  time: number;
  /** Player id and name of the person seen. */
  who: string;
  name: string;
  room: string;
  /** Hostname of the desk they were sitting at, "" if they were standing. */
  desk: string;
  /** Something remarkable about it, e.g. "stood right behind me while I typed my password". */
  note?: string;
}

/** Something a bot would tell a meeting. */
export interface Finding {
  /** Game time (ms). */
  time: number;
  /** What it says, in its own words. */
  text: string;
  /** The person it points at ("" = nobody in particular). */
  suspect: string;
  /** How suspicious (0-3, see the top of this file). */
  weight: number;
  /** It was seen while it happened (somebody fiddling with a PC). */
  caught?: boolean;
}

/** A bot votes for an accused person when what it knows against them adds up to at least this. */
export const VOTE_THRESHOLD = 2;
/** A bot that strongly suspects somebody who was NOT accused votes "skip" instead of abstaining. */
const SKIP_THRESHOLD = 3;
const MAX_FINDINGS = 40;

export interface Bot {
  playerId: string;
  /** Game time at which the bot comes to work. */
  arriveAt: number;
  random: Random;
  /** Null while the bot is not in the building. */
  subject: BotSubject | null;
  observations: Observation[];
  /** What it would tell a meeting. Survives leaving and coming back to work (it is the person's memory). */
  findings: Finding[];
  /** Player id -> how the bot last saw them ("room|desk"), to record only changes. */
  lastSeen: Map<string, string>;
  hacker: HackerBrain | null;
  /** An investigating guard: whom it is after, when it may go after somebody again, and what it has looked at on the monitors. */
  chase: { suspect: string; until: number; replanAt: number } | null;
  nextChaseAt: number;
  considered: string;
  /** Whom the guard is thinking about, and when it will have made up its mind. */
  suspected: { id: string; since: number } | null;
  watchedUntil: number;
  badgeLines: Set<string>;
}

/** Bots arrive between these many game seconds after they are scheduled. */
const ARRIVE_MIN_S = 4;
const ARRIVE_MAX_S = 240;
/** A bot notices people in the same room up to this many pixels away (about 10 tiles). */
const SIGHT = 320;
const MAX_OBSERVATIONS = 300;
/** "09:42" from a game time. */
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** Shell commands of ordinary office work. Only those the engine really has are used. */
const EVERYDAY = [
  'ls', 'ls -la', 'ls Documents', 'date', 'whoami', 'pwd', 'uptime', 'w', 'history | tail -n 5', 'id', 'hostname',
  'mail', 'mail', 'mail 1',
  // A little web browsing, like in any office. (Simulated sites from the scenario; unknown names simply fail.)
  'curl http://intranet.nexora.local/', 'curl -s https://news.example/', 'curl -s https://weather.example/today', 'curl -I http://intranet.nexora.local/lunch-menu',
];
const IT_EXTRA = ['ps aux | head -n 8', 'ss -tlnp', 'tail -n 5 /var/log/syslog', 'ping -c 2 ADMIN-SRV-01', 'last | head -n 5', 'ip a', 'journalctl -n 5'];

export class BotManager {
  private readonly bots = new Map<string, Bot>();
  private readonly random: Random;
  readonly hackerDifficulty: HackerDifficulty;
  private readonly knowledge: HackerKnowledge;
  private lastLook = 0;
  private readonly pace: InvestigationPace;
  /** A meeting somebody is going to call: about whom, who, when, and until when they try. */
  private convening: { suspect: string; key: string; caller: string; at: number; until: number; replanAt: number } | null = null;
  private nextConsiderAt = 0;
  /** Cases a meeting was called about already (more evidence = a new case). */
  private readonly raised = new Set<string>();
  private pinned = 0;

  constructor(private readonly host: BotHost, seed: number, private readonly options: BotOptions = {}) {
    this.random = new Random(seed ^ 0x5eed_b075);
    this.pace = options.investigationPace ?? FAST_INVESTIGATION;
    this.hackerDifficulty = options.hackerDifficulty ?? 'normal';
    this.knowledge = hackerKnowledge(this.hackerDifficulty, seed,
      this.hackerDifficulty === 'easy' ? [] : host.world.mission.weaknesses);
    for (const player of host.world.players) this.schedule(player.id);
    if (options.hacker !== false && host.world.mission.flag && !host.world.mission.hacker) {
      const others = host.world.players.filter((p) => p.id !== options.hackerNot);
      const employees = others.filter((p) => p.role === 'employee');
      const pool = employees.length ? employees : others;
      // Use a separate match-seeded draw: neither weaknesses nor their recipients influence identity.
      const selected = others.find((p) => p.id === options.hackerId) ?? new Random(seed ^ 0x4ac4e2).pick(pool);
      if (selected) setHacker(host.world, selected.id);
    }
  }

  /** The key of a bot's body in the game's list of bodies. Human keys are network ids and never start with "bot:". */
  static key(playerId: string): string {
    return `bot:${playerId}`;
  }

  /** Plans a bot's arrival at work. */
  schedule(playerId: string, earliestInSeconds = ARRIVE_MIN_S): void {
    if (this.bots.has(playerId)) return;
    const delay = this.random.between(earliestInSeconds, Math.max(earliestInSeconds + 10, this.options.arriveSeconds ?? ARRIVE_MAX_S));
    // Every bot has its own generator, so removing one bot does not change what the others do.
    const random = new Random(Math.floor(this.random.next() * 2 ** 32));
    this.bots.set(playerId, { playerId, arriveAt: this.host.world.time + delay * 1000, random, subject: null, observations: [], findings: [], lastSeen: new Map(), hacker: null, chase: null, nextChaseAt: 0, considered: '', suspected: null, watchedUntil: this.host.world.time, badgeLines: new Set() });
  }

  /** A human took this employee: the bot disappears (its PC, if it was at one, stays as it is). */
  remove(playerId: string): void {
    const bot = this.bots.get(playerId);
    if (!bot) return;
    if (bot.subject) this.host.removeBody(bot.subject.body.clientId);
    this.bots.delete(playerId);
  }

  has(playerId: string): boolean {
    return this.bots.has(playerId);
  }

  /** Is this employee's bot inside the building right now? */
  isPresent(playerId: string): boolean {
    return !!this.bots.get(playerId)?.subject;
  }

  /** Server-side view for tests and the developer panel. Never sent to a production browser. */
  list(): { playerId: string; present: boolean; moving: string; failure: string; seatedAt: string; doing: string }[] {
    return [...this.bots.values()].map((b) => ({
      playerId: b.playerId,
      present: b.subject !== null,
      moving: b.subject?.mover.state ?? 'waiting',
      failure: b.subject?.mover.failure ?? '',
      seatedAt: b.subject?.body.seatedAt ?? '',
      doing: b.subject?.mind.doing ?? 'not in the building yet',
    }));
  }

  /**
   * Everything the bots were doing is interrupted (an emergency meeting
   * gathered everybody at the table). Each bot forgets its walk and its
   * screen, and its routine starts again from where it now stands.
   */
  interrupt(): void {
    this.convening = null;
    for (const bot of this.bots.values()) {
      const s = bot.subject;
      if (!s) continue;
      bot.hacker?.interrupt();
      s.mover.stop();
      Object.assign(s.mind, { screen: null, breakSpot: null, breakRoom: '', atBreakSpot: false, breakUntil: 0, errand: '', errandMs: 0, leaving: 'undecided', loginSteps: 0, mailCommand: '' });
    }
  }

  /** An account got a new password: its bot knows it from now on (the helpdesk handed it over). */
  passwordChanged(account: string, password: string): void {
    for (const bot of this.bots.values()) if (bot.subject?.persona.account === account) bot.subject.persona.password = password;
  }

  /**
   * The security-alert banner went out. The SOC analyst saw it like everybody
   * else, and goes to look at the SIEM now instead of finishing a break or an errand.
   */
  alarm(): void {
    const now = this.host.world.time;
    for (const bot of this.bots.values()) {
      const s = bot.subject;
      if (s?.persona.role !== 'soc') continue;
      if (!s.body.seatedAt) s.mover.stop();
      Object.assign(s.mind, {
        alarmed: true, nextCheckAt: now + s.checks.between(...this.pace.alarmSeconds) * 1000, nextBreakAt: Math.max(s.mind.nextBreakAt, now + 120_000),
        breakSpot: null, breakRoom: '', atBreakSpot: false, breakUntil: 0, errand: '', errandMs: 0, leaving: 'undecided',
      });
    }
  }

  /** A bot's memory (tests and the developer panel). */
  mind(playerId: string): Mind | undefined {
    return this.bots.get(playerId)?.subject?.mind;
  }

  /** What a bot has seen so far, oldest first. */
  observations(playerId: string): Observation[] {
    return this.bots.get(playerId)?.observations ?? [];
  }

  /**
   * Somebody stood right behind this bot while it typed a password. People
   * often notice that: the bot remembers it (7 times in 10), with the time.
   */
  watchedBy(playerId: string, watcher: { playerId: string; name: string }, room: string, desk: string): void {
    const bot = this.bots.get(playerId);
    if (!bot?.subject || !bot.random.chance(0.7)) return;
    bot.observations.push({ time: this.host.world.time, who: watcher.playerId, name: watcher.name, room, desk: '', note: `stood right behind me at ${desk} while I typed a password` });
    if (bot.observations.length > MAX_OBSERVATIONS) bot.observations.shift();
    this.find(bot, { suspect: watcher.playerId, weight: 3, text: `${watcher.name} stood right behind me at ${desk} while I typed my password, at ${clock(this.host.world.time)}.` });
  }

  /** What a bot would tell a meeting, oldest first. */
  findings(playerId: string): Finding[] {
    return this.bots.get(playerId)?.findings ?? [];
  }

  /** Adds a finding, unless the bot already remembers the same thing. */
  private find(bot: Bot, f: Omit<Finding, 'time'>): boolean {
    const same = bot.findings.find((x) => x.text === f.text || (f.suspect && x.suspect === f.suspect && x.weight === f.weight && this.host.world.time - x.time < 5 * 60_000));
    if (same && f.caught) same.caught = true;
    if (same) return false; // seen again within minutes: it is the same story
    bot.findings.push({ ...f, time: this.host.world.time });
    if (bot.findings.length > MAX_FINDINGS) bot.findings.shift();
    return true;
  }

  /**
   * What a bot says in a meeting: its strongest findings (at most two), or
   * now and then that it saw nothing. Every sentence is about things the bot
   * itself saw on its own screen or with its own eyes.
   */
  speech(playerId: string, random: () => number): { text: string; suspect: string }[] {
    const bot = this.bots.get(playerId);
    if (!bot) return [];
    const best = [...bot.findings].sort((a, b) => b.weight - a.weight || b.time - a.time).slice(0, 2);
    if (best.length > 0) return best.map((f) => ({ text: f.text, suspect: f.suspect }));
    return random() < 0.25 ? [{ text: random() < 0.5 ? 'Nothing odd on my side.' : 'I did not notice anything strange today.', suspect: '' }] : [];
  }

  /** How much a bot has against one person (the sum of its findings about them). */
  suspicion(playerId: string, suspect: string): number {
    return this.findings(playerId).filter((f) => f.suspect === suspect).reduce((sum, f) => sum + f.weight, 0);
  }

  /**
   * How a bot votes. It goes only by what it knows itself:
   *  - an accused person it has enough against (VOTE_THRESHOLD) -> that person
   *    (the one with the most, if several);
   *  - nothing against anyone accused, but strong suspicion of someone who
   *    was NOT accused -> "skip" (they are blaming the wrong person);
   *  - otherwise null: it does not vote (it has no evidence either way, so it
   *    leaves the decision to those who do).
   *
   * In a solo match (`verdicts` given, see judge.ts) it also looks at the
   * evidence: it votes for the person the evidence convinces it of, and
   * otherwise "skip" instead of nothing. Nobody is fired for weak evidence.
   */
  ballot(playerId: string, accused: string[], verdicts?: ReadonlyMap<string, Verdict>): string | null {
    const ranked = accused.filter((s) => s !== playerId).map((s) => ({ s, score: this.suspicion(playerId, s) })).sort((a, b) => b.score - a.score);
    if (ranked[0] && ranked[0].score >= VOTE_THRESHOLD) return ranked[0].s;
    const others = new Set(this.findings(playerId).map((f) => f.suspect).filter((s) => s && !accused.includes(s)));
    if ([...others].some((s) => this.suspicion(playerId, s) >= SKIP_THRESHOLD)) return 'skip';
    if (verdicts) {
      const strength = (s: string) => verdicts.get(s)!.pointing.length + verdicts.get(s)!.unusual.length;
      const convinced = accused.filter((s) => s !== playerId && verdicts.get(s)?.convincing).sort((a, b) => strength(b) - strength(a));
      return convinced[0] ?? 'skip';
    }
    return null;
  }

  /** The game tells a seated bot that its screen changed by itself (it locked, a remote session closed...). */
  sees(playerId: string, screen: TerminalResult): void {
    const mind = this.bots.get(playerId)?.subject?.mind;
    if (mind) mind.screen = screen;
  }

  /** Observations and item notices supplied through the same physical checks as a human. */
  glimpse(playerId: string, victim: string, pattern: string): void {
    this.bots.get(playerId)?.hacker?.glimpse(victim, pattern);
  }

  itemResult(playerId: string, text: string): void {
    this.bots.get(playerId)?.hacker?.itemResult(text);
  }

  /** Stop the previous bot controller immediately when a human takes the hacker role elsewhere. */
  relinquishHacker(playerId: string): void {
    const bot = this.bots.get(playerId);
    if (!bot) return;
    bot.hacker = null;
    if (bot.subject) {
      this.host.stand(bot.subject.body);
      bot.subject.body.hold = null;
      bot.subject.body.activity = '';
      bot.subject.mover.stop();
      bot.subject.mind.screen = null;
    }
  }

  private hackerBrain(b: BotSubject): HackerBrain {
    const { world, scenario, map } = this.host;
    const admin = world.players.find((p) => p.role === 'sysadmin');
    const desk = admin && map.desks.find((d) => d.hostname === admin.desk);
    const { rumours, confirmed } = this.knowledge;
    const possible = (id: keyof typeof confirmed) => rumours.includes(id) && confirmed[id] !== false;
    // Only confirmed knowledge may consult the corresponding scenario fact.
    const backup = confirmed['plaintext-password'] ? scenario.mission?.plaintextPassword : undefined;
    const knownSudo = b.persona.role === 'sysadmin' || (confirmed['extra-sudo'] === true && world.mission.extraSudoAccount === b.persona.account);
    const plan: HackerPlan = {
      flag: { ...world.mission.flag! },
      backup: backup && backup.host === world.mission.flag!.host ? { host: backup.host, path: backup.path } : undefined,
      discoverBackup: possible('plaintext-password') && !backup,
      ownSudo: knownSudo || (possible('extra-sudo') && confirmed['extra-sudo'] === undefined),
      weakAdmin: possible('weak-admin-password'),
      preferred: [ ...(backup ? ['backup' as const] : []), ...(knownSudo ? ['sudo' as const] : []),
        ...(confirmed['weak-admin-password'] ? ['weak-password' as const] : []) ],
      admin: admin && desk ? { playerId: admin.id, account: admin.account, desk: admin.desk, chair: { x: desk.seatX, y: desk.seatY } } : undefined,
    };
    const pace = this.options.hackerPace ?? paceFor(this.hackerDifficulty);
    return new HackerBrain(plan, {
      look: (hostname) => {
        const at = map.desks.find((d) => d.hostname === hostname);
        if (!at || roomAt(map, b.body.x, b.body.y) !== roomAt(map, at.seatX, at.seatY)
          || Math.hypot(b.body.x - at.seatX, b.body.y - at.seatY) > SIGHT) return null;
        return { unlocked: screenState(world, hostname).state === 'unlocked', occupied: this.host.bodies().some((a) => a.seatedAt === hostname) };
      },
      usb: (hostname) => this.host.usb(b.body, hostname),
      submit: (text) => this.host.submit(b.body, text),
    }, pace, world.time + b.random.between(...pace.coverMinutes) * 60_000);
  }

  private mayEnter(avatar: Avatar, door: MapDoor): boolean {
    return !door.restricted || (this.host.world.badges.holders[avatar.account]?.access.includes(door.zone) ?? false);
  }

  // ───────────────────────────── Building a bot ─────────────────────────────

  private persona(playerId: string): Persona {
    const { world, scenario, map } = this.host;
    const player = world.players.find((p) => p.id === playerId)!;
    const desk = map.desks.find((d) => d.hostname === player.desk)!;
    const known = new Set(commandNames());
    const home = `/home/${player.account}/`;
    // Files this employee has on their own PC: something to open during the day.
    const files = (scenario.hosts.find((h) => h.hostname === player.desk)?.files ?? [])
      .map((f) => f.path)
      .filter((path) => path.startsWith(home) && !path.slice(home.length).startsWith('.'))
      .map((path) => `cat ${path.slice(home.length)}`);
    const it = player.role === 'sysadmin' || player.role === 'helpdesk';
    const commands = [...EVERYDAY, ...files, ...files, ...(it ? IT_EXTRA : [])].filter((line) => known.has(line.split(' ')[0]));
    return {
      playerId, account: player.account, role: player.role, desk: player.desk,
      password: world.credentials[player.account]?.password ?? '',
      chair: { x: desk.seatX, y: desk.seatY },
      commands: commands.length > 0 ? commands : ['ls'],
      // Today's match may have a sysadmin who is careless about locking (a weakness, see engine mission.ts).
      checkMinutes: this.options.checkMinutes ?? CHECK_MINUTES,
      pace: this.pace,
      forgetLock: world.mission.carelessPlayer === playerId
        ? (scenario.mission?.carelessAdmin?.forgetLock ?? 0.8)
        : (this.options.forgetLock ?? 0.25),
      taskEveryMs: (this.options.taskMinutes ?? 3) * 60_000,
    };
  }

  /** The brain's hands: each action is the game's own rule for a body, applied to this bot's body. */
  private brainWorld(body: Avatar, mover: Mover, random: Random): BrainWorld {
    const { host } = this;
    const { map, scenario } = host;
    const own = scenario.hosts.find((h) => h.hostname === host.world.players.find((p) => p.id === body.playerId)?.desk);
    const workstations = scenario.hosts.filter((h) => h.kind === 'workstation' && !h.headless && h.hostname !== own?.hostname);
    return {
      now: () => host.world.time,
      sit: (hostname) => host.sit(body, hostname),
      stand: () => host.stand(body),
      type: (line) => host.type(body, line),
      cancel: () => host.cancel(body),
      switchUser: () => host.switchUser(body),
      lockedBy: () => {
        const screen = body.seatedAt ? screenState(host.world, body.seatedAt) : null;
        return screen?.state === 'locked' ? (screen.user ?? '') : '';
      },
      spotIn: (room) => {
        const rects = map.rooms.filter((r) => r.name === room);
        if (rects.length === 0) return null;
        for (let attempt = 0; attempt < 20; attempt++) {
          const rect = random.pick(rects);
          // The middle of a random tile of the room, if a person fits there and there is a way to it
          // (the inside of the toilet cubicles is free floor nobody can reach).
          const col = Math.floor((rect.x + random.next() * rect.width) / map.tile);
          const row = Math.floor((rect.y + random.next() * rect.height) / map.tile);
          const spot: Point = { x: (col + 0.5) * map.tile, y: (row + 0.5) * map.tile };
          if (roomAt(map, spot.x, spot.y) === room && isFree(map, spot.x, spot.y, PLAYER_RADIUS) && mover.canReach(spot.x, spot.y)) return spot;
        }
        return null;
      },
      spotAtDesk: (hostname) => map.spawns[hostname] ?? null,
      nextStep: () => {
        const next = host.tasks.nextStep(body.playerId);
        if (!next) return null;
        const { task, step } = next;
        const index = task.steps.indexOf(step);
        return { taskId: task.id, title: task.title, index, last: index === task.steps.length - 1, run: step.run, visit: step.visit, stayMs: step.stayMs ?? 0 };
      },
      abandon: (taskId) => host.tasks.abandon(body.playerId, taskId),
      colleagueDesks: () => workstations.filter((h) => h.department === own?.department).map((h) => h.hostname),
      otherDesks: () => workstations.map((h) => h.hostname),
      watchSpot: () => {
        const station = map.furniture.find((f) => f.kind === 'monitors');
        return this.options.investigate && station ? { x: station.x + station.width / 2, y: station.y - 16 } : null;
      },
      myIp: () => (own ? host.world.hosts[own.hostname]?.ip ?? '' : ''),
      hasUnreadMail: () => host.world.mail.messages.some((m) => m.to.includes(body.account) && !m.readBy.includes(body.account) && m.subject === 'IT password reset'),
      report: (f) => {
        const bot = this.bots.get(body.playerId);
        // The hacker checks its own PC like everybody (it would stand out otherwise), but tells nobody about its own traces.
        if (!bot || host.world.mission.hacker === body.playerId) return;
        const fresh = this.find(bot, { suspect: f.suspect ?? '', weight: f.weight, text: f.text });
        if ((fresh || f.pin) && f.line && this.mayPin(f.line)) host.pin(body, f.line);
      },
    };
  }

  /** Everybody who has not come to work yet appears next to their desk, as a human does. The entrance logs them, as it does for a human. */
  arriveAll(): void {
    for (const bot of this.bots.values()) {
      if (bot.subject) continue;
      this.arrive(bot);
      const body = bot.subject!.body as Avatar;
      const desk = this.host.world.players.find((p) => p.id === bot.playerId)!.desk;
      Object.assign(body, this.host.map.spawns[desk] ?? this.host.map.defaultSpawn);
      this.host.cameIn(body);
    }
  }

  private arrive(bot: Bot): void {
    const { world, map } = this.host;
    const player = world.players.find((p) => p.id === bot.playerId)!;
    // Spread along the pavement so two bots arriving together do not appear on the same spot.
    const x = Math.min(map.width - 2 * map.tile, Math.max(2 * map.tile, map.outsideSpawn.x + bot.random.between(-3, 3) * map.tile));
    const body: Avatar = {
      clientId: BotManager.key(player.id), playerId: player.id, account: player.account, name: player.name,
      x, y: map.outsideSpawn.y, facing: 'up', seatedAt: '', terminalId: '', dx: 0, dy: 0,
    };
    const mover = new Mover(body, { ...this.host, mayEnter: (a, d) => this.mayEnter(a, d) }, bot.random);
    const persona = this.persona(player.id);
    // Its own sequence for checking the PC, from the player id (it takes nothing from the bot's other random numbers).
    const checks = new Random([...player.id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 0xc4ec1d));
    bot.subject = {
      persona, body, mover, random: bot.random, checks,
      mailRandom: new Random([...player.id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, world.seed ^ 0x6d61696c)),
      mind: newMind(world.time, bot.random, persona.taskEveryMs),
      world: this.brainWorld(body, mover, bot.random),
    };
    if (this.options.investigate && player.role === 'soc') bot.subject.analyst = new Analyst(player.id, this.staff(), () => [...this.host.board()]);
    bot.subject.mind.nextCheckAt = firstCheck(world.time, checks, persona.checkMinutes);
    this.host.addBody(body);
    this.host.tasks.assign(player.id);
  }

  // ───────────────────────────── Investigating (Phase 5a, part E) ─────────────────────────────

  private staff(): StaffEntry[] {
    return this.host.world.players.map((p) => ({ id: p.id, name: p.name, account: p.account, desk: p.desk, it: p.role === 'sysadmin' || p.role === 'helpdesk' }));
  }

  /** Counts a pin against the limit of the match. The same line is never pinned twice. */
  private mayPin(text: string): boolean {
    if (this.pinned >= (this.options.pinClues ?? 0) || this.host.board().some((i) => i.text === text)) return false;
    this.pinned++;
    return true;
  }

  /** The guard at the monitors: the pictures and badge lines since it last looked. */
  private watch(bot: Bot): void {
    const body = bot.subject!.body;
    const { world, map } = this.host;
    const since = bot.watchedUntil;
    bot.watchedUntil = world.time;
    const staff = this.staff();
    for (const shot of this.host.pictures(since)) {
      for (const p of shot.people) {
        if (p.playerId === bot.playerId) continue;
        const clue = suspicious({ ...p, room: roomAt(map, p.x, p.y) }, shot.camera, clock(shot.time), staff);
        if (clue && this.find(bot, { suspect: clue.suspect!, weight: clue.weight, text: clue.text, caught: clue.caught }) && this.mayPin(`picture ${shot.id}`)) this.host.pinPicture(body, shot);
      }
    }
    for (const line of this.host.badgeLines()) {
      if (bot.badgeLines.has(line)) continue;
      bot.badgeLines.add(line);
      const clue = refusedBadge(line, staff);
      if (clue && clue.suspect !== bot.playerId && this.find(bot, { suspect: clue.suspect!, weight: clue.weight, text: clue.text }) && this.mayPin(line)) this.host.pinBadgeLine(body, line);
    }
  }

  /**
   * The guard goes after somebody against whom the evidence is strong. True
   * while it does (it then follows no routine). It gives up after five game
   * minutes and thinks again three minutes later.
   */
  private pursue(bot: Bot): boolean {
    const s = bot.subject!;
    if (!this.options.investigate || s.persona.role !== 'guard') return false;
    const now = this.host.world.time;
    if (!bot.chase) {
      if (now < bot.nextChaseAt) return false;
      bot.nextChaseAt = now + 5000;
      if (!this.host.mayDetain(s.body)) return false;
      // Think again only when there is something new to think about.
      const known = `${this.host.board().length}/${bot.findings.length}/${bot.findings.filter((f) => f.caught).length}`;
      if (known === bot.considered) return false;
      bot.considered = known;
      const suspect = this.host.strongCase(bot.playerId, bot.findings.map((f) => ({ suspect: f.suspect, weight: f.weight, caught: f.caught ?? false })));
      if (!suspect || suspect === bot.playerId) {
        bot.suspected = null;
        return false;
      }
      // Thinking it over first (the pace of the match).
      if (bot.suspected?.id !== suspect) bot.suspected = { id: suspect, since: now + s.checks.between(...this.pace.guardMinutes) * 60_000 };
      if (now < bot.suspected.since) {
        bot.considered = ''; // still the same evidence: look again in a few seconds
        return false;
      }
      bot.chase = { suspect, until: now + 5 * 60_000, replanAt: 0 };
      if (s.body.seatedAt) this.host.stand(s.body);
      s.mover.stop();
      Object.assign(s.mind, { screen: null, breakSpot: null, breakRoom: '', atBreakSpot: false, breakUntil: 0, errand: '', errandMs: 0, leaving: 'undecided', loginSteps: 0 });
    }
    const chase = bot.chase;
    const target = this.host.bodies().find((b) => b.playerId === chase.suspect);
    if (!target || now > chase.until || !this.host.mayDetain(s.body)) {
      bot.chase = null;
      bot.considered = ''; // the same evidence is still strong: try again later
      bot.nextChaseAt = now + 3 * 60_000;
      s.mover.stop();
      return false;
    }
    s.mind.doing = `going to ${target.name}`;
    if (Math.hypot(target.x - s.body.x, target.y - s.body.y) <= DETAIN_DISTANCE - 16 && roomAt(this.host.map, target.x, target.y) === roomAt(this.host.map, s.body.x, s.body.y)) {
      s.mover.stop();
      bot.chase = null;
      bot.nextChaseAt = now + 3 * 60_000;
      this.host.detain(s.body, target.playerId);
      return true;
    }
    if (now >= chase.replanAt) {
      chase.replanAt = now + 1500;
      s.mover.goTo(target.x, target.y); // if there is no way (a door this badge does not open): wait and try again
    }
    return true;
  }

  /**
   * Calling a meeting about a convincing case (Phase 5a, part F). One bot goes
   * to the emergency button: the SOC analyst if it can, otherwise somebody who
   * found a part of it. True while THIS bot is on its way.
   */
  private convene(bot: Bot): boolean {
    const c = this.convening;
    const now = this.host.world.time;
    if (!c || c.caller !== bot.playerId || now < c.at) return false;
    const s = bot.subject!;
    const button = this.host.map.furniture.find((f) => f.kind === 'button');
    if (!button || now > c.until || this.host.whyNoMeeting(s.body) !== '') {
      this.convening = null;
      s.mover.stop();
      return false;
    }
    if (s.body.seatedAt) this.host.stand(s.body);
    Object.assign(s.mind, { screen: null, breakSpot: null, breakRoom: '', atBreakSpot: false, breakUntil: 0, errand: '', errandMs: 0, leaving: 'undecided', loginSteps: 0, doing: 'going to call a meeting' });
    const spot = { x: button.x + button.width / 2, y: button.y + button.height + 14 };
    if (Math.hypot(s.body.x - spot.x, s.body.y - spot.y) <= 6) {
      s.mover.stop();
      this.convening = null;
      // The case as it stands now: more may have been pinned since, or it fell apart.
      const still = this.host.convincingCase((key) => this.raised.has(key));
      if (!still) return false;
      this.raised.add(c.key).add(still.key);
      this.host.callMeeting(s.body, still.suspect);
      return true;
    }
    if (s.mover.state !== 'walking' && now >= c.replanAt) {
      c.replanAt = now + 2000;
      s.mover.goTo(spot.x, spot.y);
    }
    return true;
  }

  /** Is there something to call a meeting about? */
  private consider(): void {
    const now = this.host.world.time;
    if (this.convening || now < this.nextConsiderAt) return;
    this.nextConsiderAt = now + 5000;
    const found = this.host.convincingCase((key) => this.raised.has(key));
    if (!found) return;
    const callers = [...this.bots.values()].filter((b) => b.subject && b.playerId !== found.suspect && !b.chase && this.host.whyNoMeeting(b.subject.body) === '');
    const caller = callers.find((b) => b.subject!.persona.role === 'soc') ?? callers.find((b) => found.pinnedBy.includes(b.playerId)) ?? callers[0];
    if (!caller) return;
    const at = now + caller.subject!.checks.between(...this.pace.meetingMinutes) * 60_000;
    this.convening = { suspect: found.suspect, key: found.key, caller: caller.playerId, at, until: at + 4 * 60_000, replanAt: 0 };
  }

  // ───────────────────────────── Every tick ─────────────────────────────

  /** Advances every bot by `realMs` of real time. */
  tick(realMs: number): void {
    for (const bot of this.bots.values()) {
      if (!bot.subject) {
        if (this.host.world.time >= bot.arriveAt) this.arrive(bot);
        continue;
      }
      const isHacker = this.options.hacker !== false && this.host.world.mission.hacker === bot.playerId && this.host.world.mission.flag !== null;
      if (isHacker && !bot.hacker) bot.hacker = this.hackerBrain(bot.subject);
      if (!isHacker && bot.hacker) this.relinquishHacker(bot.playerId);
      if ((!isHacker || !bot.hacker!.tick(bot.subject)) && !this.pursue(bot) && !this.convene(bot)) employeeTree(bot.subject); // decide
      if (this.host.finished() || this.host.inMeeting()) return; // it just ended the match, or called a meeting
      bot.subject.mover.update(realMs); // walk
    }
    // Looking around once per game second is plenty.
    if (this.host.world.time - this.lastLook >= 1000) {
      this.lastLook = this.host.world.time;
      this.look();
      if (this.options.investigate) this.consider();
      if (this.options.investigate) for (const bot of this.bots.values()) if (bot.subject?.persona.role === 'guard' && this.host.atMonitors(bot.subject.body)) this.watch(bot);
    }
  }

  /**
   * Each bot notes who is in the same room and close enough to see. Walls
   * block sight (a different room is never seen). Only CHANGES are recorded:
   * "Sara appeared in Finance", "Sara sat down at FIN-LT-07", not one line per second.
   */
  private look(): void {
    const { map, world } = this.host;
    const bodies = this.host.bodies().map((body) => ({ body, room: roomAt(map, body.x, body.y) }));
    for (const bot of this.bots.values()) {
      const me = bot.subject?.body;
      if (!me) continue;
      const myRoom = roomAt(map, me.x, me.y);
      const myDesk = bot.subject!.persona.desk;
      const visible = new Set<string>();
      for (const { body, room } of bodies) {
        if (body === me || !room || room !== myRoom || Math.hypot(body.x - me.x, body.y - me.y) > SIGHT) continue;
        visible.add(body.playerId);
        const how = `${room}|${body.seatedAt}|${body.hold?.hostname ?? ''}`;
        if (bot.lastSeen.get(body.playerId) === how) continue;
        bot.lastSeen.set(body.playerId, how);
        bot.observations.push({ time: world.time, who: body.playerId, name: body.name, room, desk: body.seatedAt });
        if (bot.observations.length > MAX_OBSERVATIONS) bot.observations.shift();
        // Is any of this worth telling a meeting?
        const at = clock(world.time);
        if (body.seatedAt === myDesk) this.find(bot, { suspect: body.playerId, weight: 2, text: `I saw ${body.name} sitting at my PC ${myDesk} at ${at}, while I was away from it.` });
        if (body.hold?.hostname === myDesk) this.find(bot, { suspect: body.playerId, weight: 3, caught: true, text: `I saw ${body.name} doing something to my PC ${myDesk} at ${at}, standing at it, not sitting.` });
        const job = world.players.find((p) => p.id === body.playerId)?.role;
        // At somebody else's PC? (The helpdesk and the administrator work there.)
        const owner = (hostname: string) => world.players.find((p) => p.desk === hostname && p.id !== body.playerId);
        const theirs = body.seatedAt && body.seatedAt !== myDesk ? owner(body.seatedAt) : undefined;
        const held = body.hold && body.hold.hostname !== myDesk ? owner(body.hold.hostname) : undefined;
        if (theirs && job !== 'sysadmin' && job !== 'helpdesk') this.find(bot, { suspect: body.playerId, weight: 1, text: `I saw ${body.name} sitting at the PC of ${theirs.name} at ${at}.` });
        if (held) this.find(bot, { suspect: body.playerId, weight: 2, caught: true, text: `I saw ${body.name} doing something to the PC of ${held.name} at ${at}, standing at it, not sitting.` });
        if (room === 'Server room' && job !== 'sysadmin' && job !== 'helpdesk') this.find(bot, { suspect: body.playerId, weight: 1, text: `I saw ${body.name} in the server room at ${at}. They do not work in IT.` });
      }
      // Out of sight: seeing them again later is a new observation.
      for (const id of [...bot.lastSeen.keys()]) if (!visible.has(id)) bot.lastSeen.delete(id);
    }
  }
}
