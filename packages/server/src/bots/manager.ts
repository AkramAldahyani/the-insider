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
 * This file also keeps each bot's OBSERVATIONS: who it saw, where, and when.
 * Nothing uses them yet; in Phase 5 bots will talk and vote based on them.
 */
import { commandNames, screenState, type Scenario, type TerminalResult, type World } from '@insider/engine';
import { PLAYER_RADIUS, isFree, roomAt, type MapDoor, type Point } from '@insider/shared';
import type { Avatar } from '../visibility';
import { employeeTree, newMind, type BotSubject, type BrainWorld, type Mind, type Persona } from './brain';
import { Mover, type MoverWorld } from './mover';
import { Random } from './random';
import type { TaskBoard } from '../tasks';

/** What the bots need from the game (kept small, so bots cannot reach into things they should not). */
export interface BotHost extends Omit<MoverWorld, 'mayEnter'> {
  world: World;
  scenario: Scenario;
  /** Puts a body into the office / takes it out. */
  addBody(avatar: Avatar): void;
  removeBody(key: string): void;
  /** Every body in the office, humans and bots. */
  bodies(): Avatar[];
  /** The same actions a human has, with the same checks. */
  sit(avatar: Avatar, hostname: string): TerminalResult | string;
  stand(avatar: Avatar): void;
  type(avatar: Avatar, line: string): TerminalResult;
  cancel(avatar: Avatar): TerminalResult;
  switchUser(avatar: Avatar): TerminalResult;
  /** Job tasks: hand a player their tasks, read the next step, give one up. */
  tasks: TaskBoard;
}

export interface BotOptions {
  /** Probability that a bot leaves its desk without locking the screen (default 0.25). */
  forgetLock?: number;
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
}

export interface Bot {
  playerId: string;
  /** Game time at which the bot comes to work. */
  arriveAt: number;
  random: Random;
  /** Null while the bot is not in the building. */
  subject: BotSubject | null;
  observations: Observation[];
  /** Player id -> how the bot last saw them ("room|desk"), to record only changes. */
  lastSeen: Map<string, string>;
}

/** Bots arrive between these many game seconds after they are scheduled. */
const ARRIVE_MIN_S = 4;
const ARRIVE_MAX_S = 240;
/** A bot notices people in the same room up to this many pixels away (about 10 tiles). */
const SIGHT = 320;
const MAX_OBSERVATIONS = 300;

/** Shell commands of ordinary office work. Only those the engine really has are used. */
const EVERYDAY = ['ls', 'ls -la', 'ls Documents', 'date', 'whoami', 'pwd', 'uptime', 'w', 'df -h', 'history | tail -n 5', 'id', 'hostname'];
const IT_EXTRA = ['ps aux | head -n 8', 'ss -tlnp', 'tail -n 5 /var/log/syslog', 'ping -c 2 ADMIN-SRV-01', 'last | head -n 5', 'ip a', 'journalctl -n 5'];

export class BotManager {
  private readonly bots = new Map<string, Bot>();
  private readonly random: Random;
  private lastLook = 0;

  constructor(private readonly host: BotHost, seed: number, private readonly options: BotOptions = {}) {
    this.random = new Random(seed ^ 0x5eed_b075);
    for (const player of host.world.players) this.schedule(player.id);
  }

  /** The key of a bot's body in the game's list of bodies. Human keys are network ids and never start with "bot:". */
  static key(playerId: string): string {
    return `bot:${playerId}`;
  }

  /** Plans a bot's arrival at work. */
  schedule(playerId: string, earliestInSeconds = ARRIVE_MIN_S): void {
    if (this.bots.has(playerId)) return;
    const delay = this.random.between(earliestInSeconds, Math.max(earliestInSeconds + 10, ARRIVE_MAX_S));
    // Every bot has its own generator, so removing one bot does not change what the others do.
    const random = new Random(Math.floor(this.random.next() * 2 ** 32));
    this.bots.set(playerId, { playerId, arriveAt: this.host.world.time + delay * 1000, random, subject: null, observations: [], lastSeen: new Map() });
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

  /** A bot's memory (tests and the developer panel). */
  mind(playerId: string): Mind | undefined {
    return this.bots.get(playerId)?.subject?.mind;
  }

  /** What a bot has seen so far, oldest first. */
  observations(playerId: string): Observation[] {
    return this.bots.get(playerId)?.observations ?? [];
  }

  /** The game tells a seated bot that its screen changed by itself (it locked, a remote session closed...). */
  sees(playerId: string, screen: TerminalResult): void {
    const mind = this.bots.get(playerId)?.subject?.mind;
    if (mind) mind.screen = screen;
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
      forgetLock: this.options.forgetLock ?? 0.25,
    };
  }

  /** The brain's hands: each action is the game's own rule for a body, applied to this bot's body. */
  private brainWorld(body: Avatar, random: Random): BrainWorld {
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
          // The middle of a random tile of the room, if a person fits there.
          const col = Math.floor((rect.x + random.next() * rect.width) / map.tile);
          const row = Math.floor((rect.y + random.next() * rect.height) / map.tile);
          const spot: Point = { x: (col + 0.5) * map.tile, y: (row + 0.5) * map.tile };
          if (roomAt(map, spot.x, spot.y) === room && isFree(map, spot.x, spot.y, PLAYER_RADIUS)) return spot;
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
    };
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
    bot.subject = {
      persona: this.persona(player.id), body, mover, random: bot.random,
      mind: newMind(world.time, bot.random),
      world: this.brainWorld(body, bot.random),
    };
    this.host.addBody(body);
    this.host.tasks.assign(player.id);
  }

  // ───────────────────────────── Every tick ─────────────────────────────

  /** Advances every bot by `realMs` of real time. */
  tick(realMs: number): void {
    for (const bot of this.bots.values()) {
      if (!bot.subject) {
        if (this.host.world.time >= bot.arriveAt) this.arrive(bot);
        continue;
      }
      employeeTree(bot.subject); // decide
      bot.subject.mover.update(realMs); // walk
    }
    // Looking around once per game second is plenty.
    if (this.host.world.time - this.lastLook >= 1000) {
      this.lastLook = this.host.world.time;
      this.look();
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
      const visible = new Set<string>();
      for (const { body, room } of bodies) {
        if (body === me || !room || room !== myRoom || Math.hypot(body.x - me.x, body.y - me.y) > SIGHT) continue;
        visible.add(body.playerId);
        const how = `${room}|${body.seatedAt}`;
        if (bot.lastSeen.get(body.playerId) === how) continue;
        bot.lastSeen.set(body.playerId, how);
        bot.observations.push({ time: world.time, who: body.playerId, name: body.name, room, desk: body.seatedAt });
        if (bot.observations.length > MAX_OBSERVATIONS) bot.observations.shift();
      }
      // Out of sight: seeing them again later is a new observation.
      for (const id of [...bot.lastSeen.keys()]) if (!visible.has(id)) bot.lastSeen.delete(id);
    }
  }
}
