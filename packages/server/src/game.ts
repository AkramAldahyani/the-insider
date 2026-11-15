/**
 * OfficeGame - one running match: the simulated world plus the players'
 * bodies in the office.
 *
 * This class knows nothing about networking. It takes messages ("client X
 * says: move right") and produces messages ("tell client X: here is your
 * screen"). The Colyseus room (OfficeRoom.ts) is a thin wrapper that carries
 * those over the wire. Keeping them apart means the rules can be tested
 * without a network, and that every outgoing message passes one spot (`send`).
 *
 * Everything is server-authoritative: a browser only says what its player
 * WANTS (walk left, sit here, type this line); this class decides what
 * actually happens.
 */
import {
  advanceTime, cancelInput, createWorld, dateStamp, leaveTerminal, openTerminal, parseDuration, refreshTerminal,
  sendInput, serializeWorld, switchUser, touchTerminal, type Scenario, type TerminalResult, type World,
} from '@insider/engine';
import {
  INTERACT_DISTANCE, PLAYER_RADIUS, PLAYER_SPEED, moveWithCollision, parseOfficeMap,
  type ClientMessages, type Facing, type OfficeMap, type PublicState, type ServerMessages, type ServerMessageType, type TiledMap,
} from '@insider/shared';
import { checkMapAgainstScenario } from './mapCheck';
import { employeeChoices, onboardingCard, publicDesk, publicPlayer, termScreen, type Avatar } from './visibility';

export interface OfficeGameOptions {
  scenario: Scenario;
  map: TiledMap;
  mapName: string;
  seed?: number;
  /** Game seconds per real second (default 1). */
  speed?: number;
  /** Enables the developer messages (dev.*). MUST be false in production. */
  dev?: boolean;
  /** Dev only: saves a world dump and returns where it went. The game itself never touches the disk. */
  writeDump?: (json: string, name: string) => string;
}

/** A message waiting to be delivered to one client. */
export interface Outgoing {
  to: string;
  type: ServerMessageType;
  payload: unknown;
}

const MAX_LINE = 2000;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export class OfficeGame {
  readonly world: World;
  readonly map: OfficeMap;
  readonly dev: boolean;
  speed: number;

  private readonly scenario: Scenario;
  private readonly mapName: string;
  private readonly writeDump?: (json: string, name: string) => string;
  /** Everyone connected, including people still on the start screen. */
  private readonly clients = new Set<string>();
  /** clientId -> the body of a player who has chosen an employee. */
  private readonly avatars = new Map<string, Avatar>();
  private outbox: Outgoing[] = [];
  /** Fractions of a game millisecond left over from the last tick. */
  private carryMs = 0;

  constructor(options: OfficeGameOptions) {
    this.scenario = options.scenario;
    this.mapName = options.mapName;
    this.map = parseOfficeMap(options.map);
    // Fail loudly, before anyone joins, if the map and the scenario disagree.
    checkMapAgainstScenario(this.map, options.scenario, options.mapName);
    this.world = createWorld(options.scenario, options.seed ?? 1);
    this.speed = options.speed ?? 1;
    this.dev = options.dev ?? false;
    this.writeDump = options.writeDump;
  }

  // ───────────────────────────── Sending ─────────────────────────────

  /** The single exit for messages to browsers. The type parameter ties each message name to its payload shape. */
  private send<T extends ServerMessageType>(to: string, type: T, payload: ServerMessages[T]): void {
    this.outbox.push({ to, type, payload });
  }

  /** Hands over (and forgets) the messages produced since the last call. */
  drain(): Outgoing[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  /** The public physical state of the office: what every browser gets as patches. */
  publicState(): PublicState {
    const players: PublicState['players'] = {};
    const occupants: Record<string, string> = {};
    for (const avatar of this.avatars.values()) {
      players[avatar.playerId] = publicPlayer(avatar);
      if (avatar.seatedAt) occupants[avatar.seatedAt] = avatar.playerId;
    }
    const desks: PublicState['desks'] = {};
    for (const desk of this.map.desks) desks[desk.hostname] = publicDesk(this.world, desk.hostname, occupants[desk.hostname] ?? '');
    return { clock: this.world.time, speed: this.speed, players, desks };
  }

  private sendLobby(to: string): void {
    const taken = new Set([...this.avatars.values()].map((a) => a.playerId));
    this.send(to, 'lobby', {
      scenarioName: this.world.scenarioName,
      mapName: this.mapName,
      employees: employeeChoices(this.world, this.scenario, taken),
      dev: this.dev,
    });
  }

  // ───────────────────────────── Connecting ─────────────────────────────

  connect(clientId: string): void {
    this.clients.add(clientId);
    this.sendLobby(clientId);
  }

  disconnect(clientId: string): void {
    const avatar = this.avatars.get(clientId);
    // Leaving the game is like standing up: the PC stays exactly as it was.
    if (avatar?.seatedAt) leaveTerminal(this.world, avatar.terminalId);
    this.avatars.delete(clientId);
    this.clients.delete(clientId);
    // People on the start screen see that employee become free again.
    for (const other of this.clients) if (!this.avatars.has(other)) this.sendLobby(other);
  }

  // ───────────────────────────── Messages from a browser ─────────────────────────────

  /**
   * Handles one message. Browsers are not trusted: every field is checked,
   * and anything malformed or not allowed right now is ignored.
   */
  handle(clientId: string, type: string, payload: unknown): void {
    if (!this.clients.has(clientId)) return;
    const data = isRecord(payload) ? payload : {};
    const avatar = this.avatars.get(clientId);

    if (type === 'choose') return this.choose(clientId, data);
    if (!avatar) return; // everything below needs a body in the office

    switch (type as keyof ClientMessages) {
      case 'move': {
        const sign = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.sign(v) : 0);
        avatar.dx = sign(data.dx);
        avatar.dy = sign(data.dy);
        return;
      }
      case 'sit':
        return this.sit(avatar, data);
      case 'stand':
        return this.stand(avatar, 'You stand up. The PC stays as you left it.');
      case 'term.line': {
        if (!avatar.seatedAt || typeof data.text !== 'string') return;
        this.screen(avatar, sendInput(this.world, avatar.terminalId, data.text.slice(0, MAX_LINE)));
        return;
      }
      case 'term.cancel':
        if (avatar.seatedAt) this.screen(avatar, cancelInput(this.world, avatar.terminalId));
        return;
      case 'term.switchUser':
        if (avatar.seatedAt) this.screen(avatar, switchUser(this.world, avatar.terminalId));
        return;
      case 'term.activity':
        if (avatar.seatedAt) touchTerminal(this.world, avatar.terminalId);
        return;
      default:
        if (type.startsWith('dev.')) this.devMessage(avatar, type, data);
    }
  }

  private choose(clientId: string, data: Record<string, unknown>): void {
    if (this.avatars.has(clientId)) return; // already playing
    const player = this.world.players.find((p) => p.id === data.playerId);
    if (!player) return this.send(clientId, 'notice', { text: 'That employee does not exist.' });
    if ([...this.avatars.values()].some((a) => a.playerId === player.id)) {
      this.send(clientId, 'notice', { text: `${player.name} is already being played.` });
      return this.sendLobby(clientId);
    }
    const spawn = this.map.spawns[player.desk] ?? this.map.defaultSpawn;
    this.avatars.set(clientId, {
      clientId, playerId: player.id, name: player.name, x: spawn.x, y: spawn.y, facing: 'up', seatedAt: '', terminalId: '', dx: 0, dy: 0,
    });
    this.send(clientId, 'welcome', { playerId: player.id, card: onboardingCard(this.world, this.scenario, player.id) });
    for (const other of this.clients) if (!this.avatars.has(other)) this.sendLobby(other);
  }

  private sit(avatar: Avatar, data: Record<string, unknown>): void {
    if (avatar.seatedAt) return;
    const desk = this.map.desks.find((d) => d.hostname === data.hostname);
    if (!desk) return;
    // The browser says "I am at the desk"; the server measures it itself.
    if (Math.hypot(desk.seatX - avatar.x, desk.seatY - avatar.y) > INTERACT_DISTANCE) {
      return this.send(avatar.clientId, 'notice', { text: `You are too far from ${desk.hostname}.` });
    }
    const occupant = [...this.avatars.values()].find((a) => a.seatedAt === desk.hostname);
    if (occupant) return this.send(avatar.clientId, 'notice', { text: `${occupant.name} is sitting at ${desk.hostname}.` });

    const opened = openTerminal(this.world, desk.hostname, avatar.playerId);
    Object.assign(avatar, { seatedAt: desk.hostname, terminalId: opened.terminalId, x: desk.seatX, y: desk.seatY, facing: 'up' as Facing, dx: 0, dy: 0 });
    this.send(avatar.clientId, 'term.open', { hostname: desk.hostname, ...termScreen(opened) });
  }

  /** Standing up never locks or logs out: the screen stays exactly as it is. */
  private stand(avatar: Avatar, reason: string): void {
    if (!avatar.seatedAt) return;
    leaveTerminal(this.world, avatar.terminalId);
    avatar.seatedAt = '';
    avatar.terminalId = '';
    this.send(avatar.clientId, 'term.close', { reason });
  }

  private screen(avatar: Avatar, result: TerminalResult): void {
    this.send(avatar.clientId, 'term.output', termScreen(result));
  }

  // ───────────────────────────── Time ─────────────────────────────

  /** Advances the match by `realMs` of real time: the game clock, then the players. */
  tick(realMs: number): void {
    const gameMs = realMs * this.speed + this.carryMs;
    const whole = Math.floor(gameMs);
    this.carryMs = gameMs - whole;
    if (whole > 0) advanceTime(this.world, whole);

    const step = (PLAYER_SPEED * realMs) / 1000;
    for (const avatar of this.avatars.values()) {
      if (avatar.seatedAt) {
        // The screen may have changed without this player typing (auto-lock, a remote lock...).
        const changed = refreshTerminal(this.world, avatar.terminalId);
        if (changed) this.screen(avatar, changed);
        continue;
      }
      if (avatar.dx === 0 && avatar.dy === 0) continue;
      // Diagonal walking must not be faster than straight walking.
      const scale = avatar.dx !== 0 && avatar.dy !== 0 ? Math.SQRT1_2 : 1;
      const moved = moveWithCollision(this.map, avatar.x, avatar.y, avatar.dx * step * scale, avatar.dy * step * scale, PLAYER_RADIUS);
      avatar.x = moved.x;
      avatar.y = moved.y;
      avatar.facing = avatar.dx < 0 ? 'left' : avatar.dx > 0 ? 'right' : avatar.dy < 0 ? 'up' : 'down';
    }
  }

  // ───────────────────────────── Developer panel ─────────────────────────────

  /**
   * Developer tools. They can show secrets (the master event log), so they
   * exist only when the server was started with dev: true. In production this
   * method returns at its first line and no dev message does anything.
   */
  private devMessage(avatar: Avatar, type: string, data: Record<string, unknown>): void {
    if (!this.dev) return;
    const reply = (text: string) => this.send(avatar.clientId, 'dev.result', { action: type, text });

    switch (type) {
      case 'dev.speed': {
        const m = Number(data.multiplier);
        if (!(m >= 0 && m <= 3600)) return reply('Speed must be between 0 and 3600.');
        this.speed = m;
        return reply(`Speed: ${m} game seconds per real second.`);
      }
      case 'dev.jump': {
        const ms = parseDuration(String(data.duration ?? ''));
        if (ms === null || ms > 7 * 24 * 3600_000) return reply('Give a duration like +5m, +1h30m (at most 7 days).');
        advanceTime(this.world, ms);
        return reply(`Game time is now ${dateStamp(this.world.time)}.`);
      }
      case 'dev.events': {
        const count = Math.min(200, Math.max(1, Number(data.count) || 15));
        const lines = this.world.events.slice(-count).map((e) => {
          const time = new Date(e.time).toISOString().slice(11, 19);
          return `#${e.id} ${time} ${e.host} ${e.user || '-'} ${e.sourceIp ?? 'local'} ${e.type} [${e.origin}${e.actor ? ` ${e.actor}` : ''}] ${JSON.stringify(e.details)}`;
        });
        return reply(`Master event log: last ${lines.length} of ${this.world.events.length}\n${lines.join('\n')}`);
      }
      case 'dev.teleport': {
        const desk = this.map.desks.find((d) => d.hostname === data.hostname);
        const spawn = desk && this.map.spawns[desk.hostname];
        if (!desk || !spawn) return reply('Unknown desk.');
        this.stand(avatar, 'Teleported.');
        Object.assign(avatar, { x: spawn.x, y: spawn.y, facing: 'up' as Facing, dx: 0, dy: 0 });
        return reply(`Teleported to ${desk.hostname}.`);
      }
      case 'dev.dump': {
        if (!this.writeDump) return reply('This server cannot write dumps.');
        const stamp = new Date(this.world.time).toISOString().replace(/[:.]/g, '-');
        // The dump stays on the server's disk; only its location is sent back.
        return reply(`World saved to ${this.writeDump(serializeWorld(this.world, true), `${this.world.scenarioId}-${stamp}.json`)}`);
      }
      default:
        return;
    }
  }
}
