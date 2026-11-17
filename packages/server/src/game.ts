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
  awaitingSecret, currentPrompt, glimpse, plugUsb, submitFlag, sendInput, serializeWorld, setHacker, shoulderSurf, switchUser, usbCooldown, type FsNode, type OpenResult, type Scenario, type TerminalResult, type WeaknessChoice, type World,
} from '@insider/engine';
import {
  ALERT_BANNER_GAP_MS, INTERACT_DISTANCE, MONITOR_SHOTS, PLAYER_RADIUS, distanceToRect, PLAYER_SPEED, SURF_BEHIND, SURF_SIDE, USB_HOLD_MS, moveWithCollision, parseOfficeMap, roomAt,
  type ClientMessages, type Facing, type OfficeMap, type PublicState, type ServerMessages, type ServerMessageType, type TiledMap,
} from '@insider/shared';
import { BotManager, type BotOptions } from './bots/manager';
import { Doors, type Walker } from './doors';
import { Random } from './bots/random';
import { Cctv } from './cctv';
import { checkMapAgainstScenario } from './mapCheck';
import { TaskBoard } from './tasks';
import { employeeChoices, missionBriefing, onboardingCard, publicDesk, publicDoor, publicPlayer, taskList, termScreen, type Avatar } from './visibility';

export interface OfficeGameOptions {
  scenario: Scenario;
  map: TiledMap;
  mapName: string;
  seed?: number;
  /** Game seconds per real second (default 1). */
  speed?: number;
  /** Bots play every employee no human has picked (default true). */
  bots?: boolean;
  /** How the bots behave (see BotOptions). */
  botOptions?: BotOptions;
  /**
   * Today's weaknesses (DESIGN.md section 6): "random" picks 2-4 from the
   * seed, a list forces exactly those, [] gives an office without any.
   * Default "random".
   */
  weaknesses?: WeaknessChoice;
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
  /** The map as drawn. Doors are NOT part of its `solid` grid (use it to plan routes). */
  readonly map: OfficeMap;
  /** The same map with closed doors added to `solid`: what bodies are moved against. */
  private readonly collision: OfficeMap;
  readonly doors: Doors;
  /** Null when the match runs without bots. */
  readonly bots: BotManager | null;
  /** Everybody's job tasks. */
  readonly tasks: TaskBoard;
  /** The cameras' recordings (server only). */
  readonly cctv: Cctv;
  /** Random numbers for what a shoulder-surfer happens to catch (its own sequence: it never disturbs the bots). */
  private readonly eyes: Random;
  readonly dev: boolean;
  speed: number;

  private readonly scenario: Scenario;
  private readonly mapName: string;
  private readonly writeDump?: (json: string, name: string) => string;
  /** Everyone connected, including people still on the start screen. */
  private readonly clients = new Set<string>();
  /**
   * Every body in the office: humans (key = their network id) and bots
   * (key = "bot:<player id>"). Bots are not in `clients`, which is how the
   * server tells them apart; browsers are never told.
   */
  private readonly avatars = new Map<string, Avatar>();
  private outbox: Outgoing[] = [];
  /** Index of the next master event to look at for security alerts, and when the last banner went out. */
  private alertCursor = 0;
  private lastBanner = -Infinity;
  /** Fractions of a game millisecond left over from the last tick. */
  private carryMs = 0;

  constructor(options: OfficeGameOptions) {
    this.scenario = options.scenario;
    this.mapName = options.mapName;
    this.map = parseOfficeMap(options.map);
    // Fail loudly, before anyone joins, if the map and the scenario disagree.
    checkMapAgainstScenario(this.map, options.scenario, options.mapName);
    this.world = createWorld(options.scenario, options.seed ?? 1, { weaknesses: options.weaknesses ?? 'random' });
    this.collision = { ...this.map, solid: this.map.solid.map((row) => [...row]) };
    this.doors = new Doors(this.world, this.map, this.collision.solid, this.world.mission.onePersonDoors);
    this.speed = options.speed ?? 1;
    this.dev = options.dev ?? false;
    this.writeDump = options.writeDump;
    this.cctv = new Cctv(this.world, this.map);
    this.eyes = new Random((options.seed ?? 1) ^ 0x5ee5);
    this.alertCursor = this.world.events.length;
    this.tasks = new TaskBoard(this.world, this.scenario, this.map, new Random((options.seed ?? 1) ^ 0x7a5c));
    this.bots = options.bots === false
      ? null
      : new BotManager({
          world: this.world, scenario: this.scenario, map: this.map, collision: this.collision, doors: this.doors,
          walker: (a) => this.walker(a),
          addBody: (a) => void this.avatars.set(a.clientId, a),
          removeBody: (key) => this.removeBody(key),
          bodies: () => [...this.avatars.values()],
          // A bot acts through the same functions as a human's messages: same checks, same logs.
          sit: (a, hostname) => this.sitBody(a, hostname),
          stand: (a) => void this.standBody(a),
          type: (a, line) => this.typeLine(a, line),
          cancel: (a) => cancelInput(this.world, a.terminalId),
          switchUser: (a) => switchUser(this.world, a.terminalId),
          tasks: this.tasks,
        }, options.seed ?? 1, options.botOptions);
  }

  // ───────────────────────────── Sending ─────────────────────────────

  /** The single exit for messages to browsers. The type parameter ties each message name to its payload shape. */
  private send<T extends ServerMessageType>(to: string, type: T, payload: ServerMessages[T]): void {
    if (!this.clients.has(to)) return; // a bot has no browser to send to
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
    const doors: PublicState['doors'] = {};
    for (const door of this.doors.looks()) doors[door.id] = publicDoor(door.id, door.look);
    return { clock: this.world.time, speed: this.speed, players, desks, doors };
  }

  private sendLobby(to: string): void {
    // "Taken" means: a HUMAN plays this employee. An employee played by a bot can still be picked.
    const taken = new Set(this.humans().map((a) => a.playerId));
    this.send(to, 'lobby', {
      scenarioName: this.world.scenarioName,
      mapName: this.mapName,
      employees: employeeChoices(this.world, this.scenario, taken),
      dev: this.dev,
      // Everybody knows a match has one hacker; whether the role is still free is no secret. WHO it is, is.
      hackerOpen: this.world.mission.flag !== null && !this.humans().some((a) => a.playerId === this.world.mission.hacker),
    });
  }

  // ───────────────────────────── Connecting ─────────────────────────────

  connect(clientId: string): void {
    this.clients.add(clientId);
    this.sendLobby(clientId);
  }

  /** The bodies controlled by a browser. */
  private humans(): Avatar[] {
    return [...this.avatars.values()].filter((a) => this.clients.has(a.clientId));
  }

  /** Takes a body out of the office. Like standing up: its PC stays exactly as it was. */
  private removeBody(key: string): void {
    const avatar = this.avatars.get(key);
    if (avatar?.seatedAt) leaveTerminal(this.world, avatar.terminalId);
    this.avatars.delete(key);
  }

  disconnect(clientId: string): void {
    const avatar = this.avatars.get(clientId);
    // Going home: the badge system records the departure at the main entrance.
    if (avatar) this.throughEntrance(avatar, 'OUT');
    this.removeBody(clientId);
    this.clients.delete(clientId);
    // The employee is not left empty: a bot comes to work in their place a little later.
    if (avatar) this.bots?.schedule(avatar.playerId, 20);
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
      case 'tap': {
        if (typeof data.door !== 'string') return;
        const result = this.doors.tap(this.walker(avatar), data.door);
        if (result) this.send(avatar.clientId, 'notice', { text: result.text });
        return;
      }
      case 'term.line': {
        if (!avatar.seatedAt || typeof data.text !== 'string') return;
        this.screen(avatar, this.typeLine(avatar, data.text));
        return;
      }
      case 'item.start':
        return this.startItem(avatar, data);
      case 'item.stop':
        if (avatar.hold) this.endItem(avatar, 'You let go before it was done. Nothing happened.');
        return;
      case 'monitors.open':
        return this.monitorsOpen(avatar);
      case 'monitors.frame':
        return this.monitorsFrame(avatar, data);
      case 'flag.submit':
        if (typeof data.text === 'string') this.submitFlag(avatar, data.text.slice(0, 500));
        return;
      case 'term.cancel':
        if (avatar.seatedAt) this.screen(avatar, cancelInput(this.world, avatar.terminalId));
        return;
      case 'term.switchUser':
        if (avatar.seatedAt) this.screen(avatar, switchUser(this.world, avatar.terminalId));
        return;
      default:
        if (type.startsWith('dev.')) this.devMessage(avatar, type, data);
    }
  }

  private choose(clientId: string, data: Record<string, unknown>): void {
    if (this.avatars.has(clientId)) return; // already playing
    const player = this.world.players.find((p) => p.id === data.playerId);
    if (!player) return this.send(clientId, 'notice', { text: 'That employee does not exist.' });
    if (this.humans().some((a) => a.playerId === player.id)) {
      this.send(clientId, 'notice', { text: `${player.name} is already being played.` });
      return this.sendLobby(clientId);
    }
    // Joining as the hacker: one per match. (Roles are assigned properly in Phase 5; until then a player asks for it.)
    const asHacker = data.hacker === true;
    if (asHacker) {
      const current = this.world.mission.hacker;
      const taken = current !== null && current !== player.id && this.humans().some((a) => a.playerId === current);
      if (taken || this.world.mission.flag === null) {
        this.send(clientId, 'notice', { text: 'This match already has its hacker. Join as an employee.' });
        return this.sendLobby(clientId);
      }
      // The role moves with the player: a hacker who left is replaced by whoever asks next.
      this.world.mission.hacker = null;
      setHacker(this.world, player.id);
    }
    // If this employee's bot is already in the building, the human simply takes over from it.
    const alreadyInside = this.bots?.isPresent(player.id) ?? false;
    this.bots?.remove(player.id);
    const spawn = this.map.spawns[player.desk] ?? this.map.defaultSpawn;
    const avatar: Avatar = {
      clientId, playerId: player.id, account: player.account, name: player.name, x: spawn.x, y: spawn.y, facing: 'up', seatedAt: '', terminalId: '', dx: 0, dy: 0,
    };
    this.avatars.set(clientId, avatar);
    // Otherwise they "came to work": the main entrance logs their arrival, as it does for everyone.
    if (!alreadyInside) this.throughEntrance(avatar, 'IN');
    this.send(clientId, 'welcome', {
      playerId: player.id,
      card: onboardingCard(this.world, this.scenario, player.id),
      // Only the hacker's own browser ever receives a briefing.
      mission: this.world.mission.hacker === player.id ? missionBriefing(this.world) : null,
    });
    this.tasks.assign(player.id);
    this.tasks.takeChanged();
    this.send(clientId, 'tasks', taskList(this.tasks.view(player.id)));
    for (const other of this.clients) if (!this.avatars.has(other)) this.sendLobby(other);
  }

  /**
   * A body (human or bot) sits down at a desk. Returns the PC's screen, or a
   * sentence saying why it cannot: the rules are the same for everyone.
   */
  private sitBody(avatar: Avatar, hostname: unknown): OpenResult | string {
    const desk = this.map.desks.find((d) => d.hostname === hostname);
    if (!desk || avatar.seatedAt) return '';
    // The browser says "I am at the desk"; the server measures it itself.
    if (Math.hypot(desk.seatX - avatar.x, desk.seatY - avatar.y) > INTERACT_DISTANCE) return `You are too far from ${desk.hostname}.`;
    // One occupant per PC.
    const occupant = [...this.avatars.values()].find((a) => a.seatedAt === desk.hostname);
    if (occupant) return `${occupant.name} is sitting at ${desk.hostname}.`;

    const opened = openTerminal(this.world, desk.hostname, avatar.playerId);
    Object.assign(avatar, { seatedAt: desk.hostname, terminalId: opened.terminalId, x: desk.seatX, y: desk.seatY, facing: 'up' as Facing, dx: 0, dy: 0 });
    return opened;
  }

  private sit(avatar: Avatar, data: Record<string, unknown>): void {
    const result = this.sitBody(avatar, data.hostname);
    if (typeof result === 'string') {
      if (result) this.send(avatar.clientId, 'notice', { text: result });
      return;
    }
    this.send(avatar.clientId, 'term.open', { hostname: avatar.seatedAt, ...termScreen(result) });
  }

  /** Standing up never locks or logs out: the screen stays exactly as it is. */
  private standBody(avatar: Avatar): boolean {
    if (!avatar.seatedAt) return false;
    leaveTerminal(this.world, avatar.terminalId);
    avatar.seatedAt = '';
    avatar.terminalId = '';
    return true;
  }

  private stand(avatar: Avatar, reason: string): void {
    if (this.standBody(avatar)) this.send(avatar.clientId, 'term.close', { reason });
  }

  /** Records an arrival or departure at the building's main entrance (badge tap, door open, one person through). */
  private throughEntrance(avatar: Avatar, direction: 'IN' | 'OUT'): void {
    const entrance = this.scenario.badgeSystem?.entranceDoor;
    if (entrance) this.doors.passThrough(this.walker(avatar), entrance, direction);
  }

  // ───────────────────────────── Physical tools (Phase 4, part C) ─────────────────────────────

  /**
   * One line typed at a PC, by a human or a bot. Before it reaches the PC: if
   * it answers a password question and the hacker stands right behind the
   * chair, the hacker catches a glimpse of it (shoulder surfing).
   */
  private typeLine(typist: Avatar, text: string): TerminalResult {
    const line = text.slice(0, MAX_LINE);
    if (typist.seatedAt && awaitingSecret(this.world, typist.terminalId)) this.watchPassword(typist, line);
    return sendInput(this.world, typist.terminalId, line);
  }

  private watchPassword(typist: Avatar, password: string): void {
    const hackerId = this.world.mission.hacker;
    const hacker = [...this.avatars.values()].find((a) => a.playerId === hackerId && this.clients.has(a.clientId));
    const desk = this.map.desks.find((d) => d.hostname === typist.seatedAt);
    if (!hacker || hacker === typist || hacker.seatedAt || !desk || !password) return;
    // "Right behind": just below the chair (people sit facing their desk, which is above them).
    const behind = hacker.y - desk.seatY;
    if (behind <= 4 || behind > SURF_BEHIND || Math.abs(hacker.x - desk.seatX) > SURF_SIDE) return;
    const prompt = currentPrompt(this.world, typist.terminalId);
    const pattern = glimpse(password, () => this.eyes.next());
    shoulderSurf(this.world, { hacker: hacker.playerId, victim: typist.playerId, host: desk.hostname, prompt, pattern });
    this.send(hacker.clientId, 'notice', { text: `You saw ${typist.name} type a password at ${desk.hostname} ("${prompt.trim()}"): ${pattern}  (saved in ~/.tools/loot/shoulder.txt)` });
    this.bots?.watchedBy(typist.playerId, hacker, roomAt(this.map, typist.x, typist.y), desk.hostname);
  }

  /** The hacker starts holding the USB stick against a PC. Every condition is checked here, not in the browser. */
  private startItem(avatar: Avatar, data: Record<string, unknown>): void {
    if (data.item !== 'usb' || avatar.hold || avatar.seatedAt) return;
    if (this.world.mission.hacker !== avatar.playerId) return; // only the hacker has the stick
    const desk = this.map.desks.find((d) => d.hostname === data.hostname);
    if (!desk) return;
    const notice = (text: string) => this.send(avatar.clientId, 'notice', { text });
    if (Math.hypot(desk.seatX - avatar.x, desk.seatY - avatar.y) > INTERACT_DISTANCE) return notice(`You are too far from ${desk.hostname}.`);
    const occupant = [...this.avatars.values()].find((a) => a.seatedAt === desk.hostname);
    if (occupant) return notice(`${occupant.name} is sitting at ${desk.hostname}.`);
    const wait = usbCooldown(this.world, avatar.playerId);
    if (wait > 0) return notice(`You need ${wait} s before you can use the USB stick again.`);
    Object.assign(avatar, { hold: { item: 'usb', hostname: desk.hostname, ms: 0 }, activity: 'at-pc', dx: 0, dy: 0, facing: 'up' as Facing });
    notice(`Plugging the USB stick into ${desk.hostname}... keep holding U and stand still (${USB_HOLD_MS / 1000} s).`);
  }

  private holdItem(avatar: Avatar, realMs: number): void {
    const hold = avatar.hold!;
    const desk = this.map.desks.find((d) => d.hostname === hold.hostname)!;
    if (avatar.dx !== 0 || avatar.dy !== 0 || Math.hypot(desk.seatX - avatar.x, desk.seatY - avatar.y) > INTERACT_DISTANCE) {
      return this.endItem(avatar, 'You moved away. Nothing happened.');
    }
    const occupant = [...this.avatars.values()].find((a) => a.seatedAt === desk.hostname);
    if (occupant) return this.endItem(avatar, `${occupant.name} sat down at ${desk.hostname}. You stopped.`);
    hold.ms += realMs;
    if (hold.ms < USB_HOLD_MS) return;
    const result = plugUsb(this.world, hold.hostname, avatar.playerId);
    this.endItem(avatar, result.text);
  }

  private endItem(avatar: Avatar, text: string): void {
    avatar.hold = null;
    avatar.activity = '';
    this.send(avatar.clientId, 'notice', { text });
  }

  // ───────────────────────────── The security-office monitors (Phase 5, part B) ─────────────────────────────

  /**
   * Is this person standing at the CCTV monitors? They are furniture of kind
   * "monitors" on the map (in the security office). Being physically there is
   * the only requirement: the room's door is what keeps people out.
   */
  private atMonitors(avatar: Avatar): boolean {
    const station = this.map.furniture.find((f) => f.kind === 'monitors');
    return !!station && !avatar.seatedAt && distanceToRect(station, avatar.x, avatar.y) <= INTERACT_DISTANCE;
  }

  /** The list of recordings and the latest badge and motion lines, for someone at the monitors. */
  private monitorsOpen(avatar: Avatar): void {
    if (!this.atMonitors(avatar)) return this.send(avatar.clientId, 'notice', { text: 'The security monitors are in the security office.' });
    const host = this.world.badges.serverHost;
    const lines = (path: string, n: number) => this.tail(host, path, n).split('\n').filter((l) => l && !l.startsWith('(no file'));
    this.send(avatar.clientId, 'monitors.index', {
      cameras: this.cctv.cameras.map((c) => ({
        id: c.id,
        shots: this.cctv.recording(c.id).slice(-MONITOR_SHOTS).map((s) => ({ id: s.id, time: s.time, count: s.people.length })),
      })),
      badges: lines('/var/log/badge/access.log', 40),
      motion: lines('/var/log/cctv/motion.log', 25),
    });
  }

  /** One recorded picture (the latest at or before `time`), for someone at the monitors. */
  private monitorsFrame(avatar: Avatar, data: Record<string, unknown>): void {
    if (!this.atMonitors(avatar)) return;
    const camera = this.cctv.cameras.find((c) => c.id === data.camera);
    if (!camera) return;
    const time = typeof data.time === 'number' && Number.isFinite(data.time) ? Math.min(data.time, this.world.time) : this.world.time;
    const shot = this.cctv.at(camera.id, time);
    this.send(avatar.clientId, 'monitors.frame', {
      camera: camera.id,
      id: shot?.id ?? '',
      time: shot?.time ?? time,
      // Exactly what the camera recorded, field by field (no player ids: a picture shows faces, not accounts).
      people: (shot?.people ?? []).map((p) => ({ name: p.name, x: p.x, y: p.y, facing: p.facing, seatedAt: p.seatedAt, activity: p.activity })),
    });
  }

  // ───────────────────────────── Winning and alerts (Phase 4, part F) ─────────────────────────────

  /** The hacker hands in the flag. On success the match ends for everybody and the hacker is named. */
  private submitFlag(avatar: Avatar, text: string): void {
    const result = submitFlag(this.world, avatar.playerId, text);
    if (!result.won) return this.send(avatar.clientId, 'notice', { text: result.text });
    this.stand(avatar, 'The match is over.');
    for (const client of this.clients) this.send(client, 'match.over', { winner: 'hacker', hacker: avatar.name, at: this.world.time });
  }

  /**
   * New security alerts (written by the engine's rules) become one vague
   * banner for everybody who is playing, at most one a minute of game time.
   */
  private announceAlerts(): void {
    let fresh = false;
    for (; this.alertCursor < this.world.events.length; this.alertCursor++) {
      const e = this.world.events[this.alertCursor];
      if (e.type === 'security.alert' && e.details.severity !== 'low') fresh = true;
    }
    if (!fresh || this.world.time - this.lastBanner < ALERT_BANNER_GAP_MS) return;
    this.lastBanner = this.world.time;
    for (const a of this.humans()) this.send(a.clientId, 'alert', { text: 'SECURITY ALERT: unusual activity was detected on the company network.' });
  }

  /** An avatar as the doors see it. */
  private walker(a: Avatar): Walker {
    return { key: a.clientId, playerId: a.playerId, account: a.account, x: a.x, y: a.y, seated: a.seatedAt !== '' };
  }

  private screen(avatar: Avatar, result: TerminalResult): void {
    if (!this.clients.has(avatar.clientId)) return void this.bots?.sees(avatar.playerId, result); // a bot looks at its screen
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
    for (const avatar of [...this.avatars.values()]) {
      if (avatar.seatedAt) {
        // The screen may have changed without this player typing (a remote lock, a closed connection...).
        const changed = refreshTerminal(this.world, avatar.terminalId);
        if (changed) this.screen(avatar, changed);
        continue;
      }
      if (avatar.dx === 0 && avatar.dy === 0) continue;
      // Diagonal walking must not be faster than straight walking.
      const scale = avatar.dx !== 0 && avatar.dy !== 0 ? Math.SQRT1_2 : 1;
      const moved = this.doors.withAccess(avatar.clientId, avatar.x, avatar.y, () =>
        moveWithCollision(this.collision, avatar.x, avatar.y, avatar.dx * step * scale, avatar.dy * step * scale, PLAYER_RADIUS));
      avatar.x = moved.x;
      avatar.y = moved.y;
      avatar.facing = avatar.dx < 0 ? 'left' : avatar.dx > 0 ? 'right' : avatar.dy < 0 ? 'up' : 'down';
    }
    this.bots?.tick(realMs);
    // Job tasks: tick off what was just typed or reached, and tell the humans whose list changed.
    this.announceAlerts();
    this.tasks.update([...this.avatars.values()]);
    for (const playerId of this.tasks.takeChanged()) {
      const human = this.humans().find((a) => a.playerId === playerId);
      if (human) this.send(human.clientId, 'tasks', taskList(this.tasks.view(playerId)));
    }
    for (const avatar of this.avatars.values()) if (avatar.hold) this.holdItem(avatar, realMs);
    this.cctv.update([...this.avatars.values()]);
    // Doors last: they look at where everybody ended up.
    this.doors.tick(realMs, [...this.avatars.values()].map((a) => this.walker(a)));
  }

  // ───────────────────────────── Developer panel ─────────────────────────────

  /** The end of a file on a simulated machine, read directly (no permission checks: this is the developer looking in). */
  private tail(hostname: string, path: string, count: number): string {
    let node: FsNode | undefined = this.world.hosts[hostname]?.fs;
    for (const part of path.split('/').filter(Boolean)) node = node?.children?.[part];
    if (!node || node.content === undefined) return `(no file ${path} on ${hostname})`;
    return node.content.trimEnd().split('\n').slice(-count).join('\n');
  }

  /** Text views of server-only state, for `dev.show`. Reached only when `dev` is true. */
  private devShow(what: string, arg: string): string {
    const clock = (t: number) => new Date(t).toISOString().slice(11, 19);
    const badgeHost = this.world.badges.serverHost;
    switch (what) {
      case 'bots': {
        if (!this.bots) return 'This office has no bots (BOTS=0).';
        const rows = this.bots.list().map((b) => {
          const name = this.world.players.find((p) => p.id === b.playerId)?.name ?? b.playerId;
          return `${b.playerId.padEnd(4)} ${name.padEnd(15)} ${(b.seatedAt || (b.present ? 'walking' : 'outside')).padEnd(13)} tasks done ${String(this.tasks.completed(b.playerId)).padStart(2)}  ${b.doing}${b.failure ? ` [last walk failed: ${b.failure}]` : ''}`;
        });
        const humans = this.humans().map((a) => `${a.playerId.padEnd(4)} ${a.name.padEnd(15)} HUMAN`);
        return `Bots (${rows.length}) and humans (${humans.length})\n${[...rows, ...humans].join('\n')}`;
      }
      case 'doors':
        return `Doors\n${this.map.doors.map((d) => {
          const state = this.doors.inspect(d.code)!;
          return `${d.code.padEnd(11)} ${(d.reader ? (d.restricted ? `badge, zone ${d.zone}` : 'badge') : 'opens by itself').padEnd(28)} ${state.open ? `OPEN  passages ${state.passages}` : 'closed'}`;
        }).join('\n')}`;
      case 'badges':
        return `Badge taps (${badgeHost}:/var/log/badge/access.log)\n${this.tail(badgeHost, '/var/log/badge/access.log', 15)}\n\nDoors (doors.log)\n${this.tail(badgeHost, '/var/log/badge/doors.log', 8)}`;
      case 'tasks':
        return `Tasks finished / given up: ${this.world.players.reduce((n, p) => n + this.tasks.completed(p.id), 0)} / ${this.tasks.abandoned}\n${this.world.players.map((p) => {
          const next = this.tasks.nextStep(p.id);
          return `${p.id.padEnd(4)} ${p.name.padEnd(15)} done ${String(this.tasks.completed(p.id)).padStart(2)}  next: ${next ? `${next.task.title} -> ${next.step.text}` : '-'}`;
        }).join('\n')}`;
      case 'cctv': {
        const camera = this.cctv.cameras.find((c) => c.id === arg) ?? this.cctv.cameras[0];
        if (!camera) return 'This map has no cameras.';
        const shot = this.cctv.at(camera.id, this.world.time);
        const people = shot?.people.map((p) => `  ${p.name.padEnd(15)} tile ${Math.floor(p.x / this.map.tile)},${Math.floor(p.y / this.map.tile)} facing ${p.facing}${p.seatedAt ? `, sitting at ${p.seatedAt}` : ''}`) ?? [];
        return `${camera.name} (watches ${camera.covers}; ${this.cctv.recording(camera.id).length} snapshots stored)\n` +
          (shot ? `${shot.id} at ${clock(shot.time)}: ${people.length} in view\n${people.join('\n')}` : 'no snapshot yet') +
          `\n\nMotion log\n${this.tail(badgeHost, '/var/log/cctv/motion.log', 8)}`;
      }
      case 'unlocked': {
        const name = (id: string | null) => this.world.players.find((p) => p.id === id)?.name ?? id ?? '-';
        const rows = this.world.unattended.slice(-15).map((w) => {
          const minutes = (((w.to ?? this.world.time) - w.from) / 60_000).toFixed(1);
          const end = w.to === null ? 'STILL OPEN' : w.endedBy === 'locked' ? `locked by ${name(w.lockedBy?.playerId ?? null)}` : w.endedBy;
          const visitors = w.visitors.map((v) => `${name(v.playerId)} (${v.lines} lines)`).join(', ') || 'nobody';
          return `${clock(w.from)} ${w.host.padEnd(12)} ${w.account.padEnd(10)} ${minutes.padStart(5)} min  ${String(end).padEnd(22)} used by: ${visitors}`;
        });
        return `PCs left unlocked by their user (last ${rows.length} of ${this.world.unattended.length})\n${rows.join('\n') || '(none yet)'}`;
      }
      case 'mission': {
        const m = this.world.mission;
        const name = (id: string | null) => this.world.players.find((p) => p.id === id)?.name ?? '-';
        return [
          'Mission (match secrets)',
          `hacker:      ${m.hacker ? `${m.hacker} ${name(m.hacker)}${this.humans().some((a) => a.playerId === m.hacker) ? '' : ' (not connected)'}` : 'nobody yet'}`,
          `flag:        ${m.flag ? `${m.flag.host}:${m.flag.path}` : '-'}`,
          `weaknesses:  ${m.weaknesses.join(', ') || 'none'}`,
          `extra sudo:  ${m.extraSudoAccount || '-'}`,
          `careless:    ${m.carelessPlayer ? `${m.carelessPlayer} ${name(m.carelessPlayer)}` : '-'}`,
          `one-person doors: ${m.onePersonDoors.join(', ') || 'none (the server room can be tailgated)'}`,
          `won:         ${m.won ? clock(m.won) : 'no'}`,
          `backdoors:   ${this.world.toolkit.backdoors.map((b) => `${b.host}:${b.port} (${b.account})${this.world.hosts[b.host]?.processes.some((p) => p.pid === b.pid) ? '' : ' [dead]'}`).join(', ') || 'none'}`,
          `alerts:      ${this.world.events.filter((e) => e.type === 'security.alert').length}`,
        ].join('\n');
      }
      case 'saw': {
        const seen = this.bots?.observations(arg) ?? [];
        return `What ${arg} noticed (last ${Math.min(15, seen.length)} of ${seen.length})\n${seen.slice(-15).map((o) => `${clock(o.time)} ${o.name.padEnd(15)} in ${o.room}${o.desk ? `, sitting at ${o.desk}` : ''}`).join('\n') || '(nothing: not a bot, or not arrived yet)'}`;
      }
      case 'file': {
        const [hostname, ...rest] = arg.split(':');
        return `${arg}\n${this.tail(hostname, rest.join(':'), 15)}`;
      }
      default:
        return 'Unknown view. Try: bots, doors, badges, tasks, unlocked, mission, cctv, saw, file.';
    }
  }

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
      case 'dev.show':
        return reply(this.devShow(String(data.what ?? ''), String(data.arg ?? '')));
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
