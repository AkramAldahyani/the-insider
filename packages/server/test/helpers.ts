/** Test helpers for the server: build a game, and walk a player around like a browser would. */
import type { FsNode, Scenario } from '@insider/engine';
import { TAP_DISTANCE, TICK_RATE, nearestReaderDoor, type OfficeMap, type PublicState, type TiledMap } from '@insider/shared';
import { loadGameOptions } from '../src/app';
import { OfficeGame, type OfficeGameOptions, type Outgoing } from '../src/game';

const loaded = loadGameOptions({ dev: false });
export const scenario: Scenario = loaded.scenario;
export const tiledMap: TiledMap = loaded.map;
export const PW: Record<string, string> = Object.fromEntries(scenario.accounts.map((a) => [a.username, a.password]));
export const ROOT_PW = scenario.hosts.find((h) => h.rootPassword)!.rootPassword!.password;

const TICK_MS = 1000 / TICK_RATE;

/** Deep copy, so a test can break a map or a scenario without touching the files' data. */
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * A game plus a recording of EVERYTHING it sends: each message (per client)
 * and each public-state snapshot. The visibility tests search this recording.
 */
export class Recorder {
  game: OfficeGame;
  /** clientId -> every message sent to that client, in order. */
  sent = new Map<string, Outgoing[]>();
  /** Every public state the game produced. */
  states: PublicState[] = [];

  constructor(options: Partial<OfficeGameOptions> = {}) {
    // Tests get an empty office unless they ask for bots: other people walking about would make most checks unpredictable.
    this.game = new OfficeGame({ ...loaded, scenario: clone(scenario), map: clone(tiledMap), dev: false, bots: false, ...options });
  }

  get map(): OfficeMap {
    return this.game.map;
  }

  /** Collects what the game queued, like the room does after every step. */
  flush(): void {
    this.states.push(clone(this.game.publicState()));
    for (const m of this.game.drain()) {
      if (!this.sent.has(m.to)) this.sent.set(m.to, []);
      this.sent.get(m.to)!.push(clone(m));
    }
  }

  connect(clientId: string, playerId?: string): void {
    this.game.connect(clientId);
    if (playerId) this.game.handle(clientId, 'choose', { playerId });
    this.flush();
  }

  send(clientId: string, type: string, payload: unknown = {}): void {
    this.game.handle(clientId, type, payload);
    this.flush();
  }

  tick(times = 1): void {
    for (let i = 0; i < times; i++) {
      this.game.tick(TICK_MS);
      this.flush();
    }
  }

  /** Messages of one type sent to a client. */
  messages(clientId: string, type?: string): Outgoing[] {
    return (this.sent.get(clientId) ?? []).filter((m) => !type || m.type === type);
  }

  last(clientId: string, type?: string): Outgoing | undefined {
    return this.messages(clientId, type).pop();
  }

  /** Text of the most recent terminal screen sent to a client. */
  screen(clientId: string): { output: string; prompt: string; masked: boolean; screen: string } {
    const m = [...(this.sent.get(clientId) ?? [])].reverse().find((x) => x.type === 'term.open' || x.type === 'term.output');
    return m!.payload as { output: string; prompt: string; masked: boolean; screen: string };
  }

  position(playerId: string): { x: number; y: number } {
    return this.game.publicState().players[playerId];
  }

  /** Types a line at the PC the client is sitting at. */
  type(clientId: string, text: string): string {
    this.tick();
    this.send(clientId, 'term.line', { text });
    return this.screen(clientId).output;
  }

  /**
   * Walks a player to a point using only `move` messages, the way a browser
   * does: finds a route around the walls, then holds direction keys. At a
   * closed door with a badge reader the player taps their badge (like pressing
   * E). Returns false if they never arrived, e.g. because a door refused them.
   */
  walkTo(clientId: string, playerId: string, x: number, y: number): boolean {
    const map = this.map;
    const start = this.position(playerId);
    const route = findRoute(map, start.x, start.y, x, y);
    let before = { x: NaN, y: NaN };
    for (const point of [...route, { x, y }]) {
      for (let guard = 0; guard < 2000; guard++) {
        const p = this.position(playerId);
        const dx = Math.abs(point.x - p.x) > 3 ? Math.sign(point.x - p.x) : 0;
        const dy = Math.abs(point.y - p.y) > 3 ? Math.sign(point.y - p.y) : 0;
        if (dx === 0 && dy === 0) break;
        if (guard === 1999) return false;
        // Blocked (the last step moved nothing) next to a closed badge door: tap, like pressing E.
        const near = nearestReaderDoor(map, p.x, p.y);
        if (p.x === before.x && p.y === before.y && near && near.distance <= TAP_DISTANCE && this.game.publicState().doors[near.door.code].look === 'closed') {
          this.game.handle(clientId, 'tap', { door: near.door.code });
        }
        before = p;
        this.game.handle(clientId, 'move', { dx, dy });
        // Short steps near the target, so the player does not overshoot it.
        this.game.tick(Math.min(TICK_MS, 12));
        this.flush();
      }
    }
    this.send(clientId, 'move', { dx: 0, dy: 0 });
    return true;
  }

  /** Walks to a desk's chair and presses E. Returns false if the player could not get there. */
  sitAt(clientId: string, playerId: string, hostname: string): boolean {
    const desk = this.map.desks.find((d) => d.hostname === hostname)!;
    const arrived = this.walkTo(clientId, playerId, desk.seatX, desk.seatY);
    if (arrived) this.send(clientId, 'sit', { hostname });
    return arrived;
  }

  /** Walks to the middle of a tile given as column and row. */
  walkToTile(clientId: string, playerId: string, col: number, row: number): boolean {
    return this.walkTo(clientId, playerId, (col + 0.5) * this.map.tile, (row + 0.5) * this.map.tile);
  }

  /** Text of a file on a simulated machine, "" if it does not exist (the server may read anything; this is a test). */
  file(hostname: string, path: string): string {
    let node: FsNode | undefined = this.game.world.hosts[hostname].fs;
    for (const part of path.split('/').filter(Boolean)) node = node?.children?.[part];
    return node?.content ?? '';
  }

  /** The text of the latest HUD notice sent to a client. */
  notice(clientId: string): string {
    return (this.last(clientId, 'notice')?.payload as { text: string } | undefined)?.text ?? '';
  }
}

/** Shortest walkable route between two points, as a list of tile centres (breadth-first search over free tiles). */
export function findRoute(map: OfficeMap, fromX: number, fromY: number, toX: number, toY: number): { x: number; y: number }[] {
  const tileOf = (v: number) => Math.floor(v / map.tile);
  const start = [tileOf(fromX), tileOf(fromY)] as const;
  const goal = [tileOf(toX), tileOf(toY)] as const;
  const key = (c: number, r: number) => r * map.cols + c;
  const previous = new Map<number, number>([[key(...start), -1]]);
  const queue: (readonly [number, number])[] = [start];
  while (queue.length > 0) {
    const [c, r] = queue.shift()!;
    if (c === goal[0] && r === goal[1]) break;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [nc, nr] = [c + dc, r + dr];
      if (map.solid[nr]?.[nc] !== false || previous.has(key(nc, nr))) continue;
      previous.set(key(nc, nr), key(c, r));
      queue.push([nc, nr]);
    }
  }
  if (!previous.has(key(...goal))) throw new Error(`No route to tile ${goal[0]},${goal[1]}`);
  const route: { x: number; y: number }[] = [];
  for (let k = key(...goal); k !== -1; k = previous.get(k)!) {
    route.unshift({ x: ((k % map.cols) + 0.5) * map.tile, y: (Math.floor(k / map.cols) + 0.5) * map.tile });
  }
  return route;
}

/** Only the turning points of a route: fewer, longer straight walks (kinder to a player steered over a network). */
export function corners(route: { x: number; y: number }[]): { x: number; y: number }[] {
  return route.filter((p, i) => {
    const a = route[i - 1];
    const b = route[i + 1];
    return !a || !b || (a.x === p.x) !== (p.x === b.x);
  });
}
