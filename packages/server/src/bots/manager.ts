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
 *               walks to its desk. From there its brain (brain.ts, part C)
 *               decides what it does.
 *
 * When a human picks an employee, that employee's bot leaves the game at
 * once; when the human disconnects, a bot takes the employee over again and
 * walks in through the entrance a little later.
 */
import type { MapDoor } from '@insider/shared';
import type { World } from '@insider/engine';
import type { Avatar } from '../visibility';
import { Mover, type MoverWorld } from './mover';
import { Random } from './random';

/** What the bots need from the game (kept small, so bots cannot reach into things they should not). */
export interface BotHost extends Omit<MoverWorld, 'mayEnter'> {
  world: World;
  /** Puts a body into the office / takes it out. */
  addBody(avatar: Avatar): void;
  removeBody(key: string): void;
}

export interface Bot {
  playerId: string;
  /** Game time at which the bot comes to work. */
  arriveAt: number;
  /** Null while the bot is not in the building. */
  body: Avatar | null;
  mover: Mover | null;
  random: Random;
}

/** Bots arrive between these many game seconds after they are scheduled. */
const ARRIVE_MIN_S = 4;
const ARRIVE_MAX_S = 240;

export class BotManager {
  private readonly bots = new Map<string, Bot>();
  private readonly random: Random;

  constructor(private readonly host: BotHost, seed: number) {
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
    this.bots.set(playerId, { playerId, arriveAt: this.host.world.time + delay * 1000, body: null, mover: null, random });
  }

  /** A human took this employee: the bot disappears (its PC, if it was at one, stays as it is). */
  remove(playerId: string): void {
    const bot = this.bots.get(playerId);
    if (!bot) return;
    if (bot.body) this.host.removeBody(bot.body.clientId);
    this.bots.delete(playerId);
  }

  has(playerId: string): boolean {
    return this.bots.has(playerId);
  }

  /** Server-side view for tests and the developer panel. Never sent to a production browser. */
  list(): { playerId: string; present: boolean; moving: string; failure: string }[] {
    return [...this.bots.values()].map((b) => ({ playerId: b.playerId, present: b.body !== null, moving: b.mover?.state ?? 'waiting', failure: b.mover?.failure ?? '' }));
  }

  private mayEnter(avatar: Avatar, door: MapDoor): boolean {
    return !door.restricted || (this.host.world.badges.holders[avatar.account]?.access.includes(door.zone) ?? false);
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
    bot.body = body;
    bot.mover = new Mover(body, { ...this.host, mayEnter: (a, d) => this.mayEnter(a, d) }, bot.random);
    this.host.addBody(body);
    const desk = map.desks.find((d) => d.hostname === player.desk);
    if (desk) bot.mover.goTo(desk.seatX, desk.seatY);
  }

  /** Advances every bot by `realMs` of real time. */
  tick(realMs: number): void {
    for (const bot of this.bots.values()) {
      if (!bot.body) {
        if (this.host.world.time >= bot.arriveAt) this.arrive(bot);
        continue;
      }
      bot.mover!.update(realMs);
    }
  }
}
