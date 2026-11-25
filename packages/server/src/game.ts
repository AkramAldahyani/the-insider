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
  activeHackers, addHacker, advanceTime, cancelInput, isHacker, createWorld, dateStamp, leaveTerminal, openTerminal, parseDuration, refreshTerminal, screenState,
  awaitingSecret, currentPrompt, escalate, glimpse, plugUsb, submitFlag, sendInput, serializeWorld, setHacker, shoulderSurf, switchUser, usbCooldown, type FsNode, type GameEvent, type OpenResult, type Scenario, type TerminalResult, type WeaknessChoice, type World,
} from '@insider/engine';
import {
  ALERT_BANNER_GAP_MS, BUTTON_DISTANCE, CHAT_BURST, HACKERS_GONE, HACKER_GONE, CHAT_EARSHOT, CHAT_REFILL_MS, DETAIN_DISTANCE, INTERACT_DISTANCE, MONITOR_SHOTS, PLAYER_RADIUS, REPUTATION_PER_FIRING, distanceToRect, isFree, PLAYER_SPEED, SURF_BEHIND, SURF_SIDE, USB_HOLD_MS, cleanChat, moveWithCollision, parseOfficeMap, roomAt,
  type ChatChannel, type ClientMessages, type Facing, type MeetingView, type OfficeMap, type PublicState, type ServerMessages, type ServerMessageType, type TiledMap,
} from '@insider/shared';
import { BotManager, type BotOptions } from './bots/manager';
import { Doors, type Walker } from './doors';
import { Random } from './bots/random';
import { Cctv, type Snapshot } from './cctv';
import { Debrief, nameList } from './debrief';
import { EvidenceBoard, type EvidenceItem } from './evidence';
import { comment, judgeAccusation, strongCase, type Judge, type Testimony, type Verdict } from './judge';
import { rate, rateInfiltration } from './rating';
import { DEFAULT_MEETING_TIMES, Meetings, type MeetingTimes } from './meeting';
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
  /** Meeting lengths and button uses (tests shorten them). */
  meetingTimes?: Partial<MeetingTimes>;
  /**
   * Today's weaknesses (DESIGN.md section 6): "random" picks 2-4 from the
   * seed, a list forces exactly those, [] gives an office without any.
   * Default "random".
   */
  weaknesses?: WeaknessChoice;
  /**
   * Anti-stall: every this many GAME minutes one real hacker action is
   * re-scored as a HIGH alert (default 10; 0 switches it off).
   */
  escalationMinutes?: number;
  /**
   * A solo match: the one human plays this employee. They are put in the office
   * as soon as they connect, and cannot choose anybody else or the hacker role.
   */
  soloPlayer?: string;
  /**
   * A lobby's match: the server decides who plays whom (`seat`). Nobody can choose, and nothing on the way says which employees are people.
   */
  assigned?: boolean;
  /** A lobby's match: the hackers the server has drawn, whoever plays them. */
  hackers?: string[];
  /** Infiltration: that human is the hacker, wins only with the flag, and the bots try to catch them. */
  soloHacker?: boolean;
  /** Infiltration and lobbies: game minutes after first reading the flag before it can be handed in (default 0). */
  handInMinutes?: number;
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
/** A text or a number from a browser; anything else is "" or NaN. (String() and Number() of a strange object can fail.) */
const word = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? `${v}` : '');
const amount = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);
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
  /** The shared evidence board. */
  readonly board = new EvidenceBoard();
  /** Who saw which evidence; builds the debrief when the match is over. */
  readonly debrief: Debrief;
  private readonly startedAt: number;
  /** Emergency meetings, with the record of every one (for the debrief). */
  readonly meetings: Meetings;
  /** Players voted out (humans and bots). They are out of the game for good. */
  readonly fired = new Set<string>();
  /**
   * Network id -> player id of the PEOPLE who are out and still watching (Phase 6, part E). They have no body. They are
   * sent what anybody could see or hear by standing in the office (every room's open chat, meetings, the board, alerts)
   * and no secrets: not who the hackers are, no screens, no private chat. All they can send is chat to each other.
   */
  private readonly ghosts = new Map<string, string>();
  /** Why each of them is out. */
  private readonly outBecause = new Map<string, string>();
  /**
   * A lobby's match (Phase 6, part F): network id -> player id of people who have been without a connection for so long that
   * a bot plays for them. They may come back any time.
   */
  private readonly absent = new Map<string, string>();
  /** A lobby's match: the employees of people who left for good, or are absent. */
  private readonly gone = new Set<string>();
  /** What everybody was told at the end, for those who come back after it. */
  private ending: { over: ServerMessages['match.over']; debrief: ServerMessages['debrief']['debrief'] } | null = null;
  /** Game time of the next anti-stall escalation (Infinity = off). */
  private nextEscalation: number;
  private readonly escalationMs: number;
  /** The company's reputation (0-100). */
  reputation = 100;
  /** Set when the match has ended. */
  over: { winner: 'hacker' | 'defenders'; at: number } | null = null;
  /** Guards who detained an innocent person and lost the power. */
  private readonly detainLost = new Set<string>();
  /** Every detention (for the debrief). */
  readonly detentions: { time: number; guardId: string; targetId: string; wasHacker: boolean }[] = [];
  /**
   * What the bots do in the current meeting (Phase 5, part G): when each one
   * speaks and votes, in real milliseconds since the phase began.
   */
  private botMeeting: { phase: string; elapsed: number; speak: { id: string; at: number; lines: { text: string; suspect: string }[]; about?: string }[]; vote: { id: string; at: number }[]; accuse?: { by: string; suspect: string; at: number } } | null = null;
  /** Do bots judge the evidence in the current meeting (see callMeeting)? */
  private judging = false;
  /** What bots told meetings about what they saw themselves (the judges remember it). */
  private readonly testimony: Testimony[] = [];
  /** Random numbers for when bots talk and what filler they say (its own sequence). */
  private readonly talk: Random;
  /** Every chat line, for the debrief. */
  readonly chatLog: { time: number; channel: ChatChannel; from: string; fromId: string; text: string }[] = [];
  /** Network id -> how many lines they may still write at once, and when that was last worked out (chat.ts). */
  private readonly mayWrite = new Map<string, { lines: number; at: number }>();
  /** Real milliseconds this game has been running. */
  private realMs = 0;
  /** Where people stand during a meeting: the free tiles around the meeting table. */
  private readonly meetingSpots: { x: number; y: number; facing: Facing }[];
  /** The cameras' recordings (server only). */
  readonly cctv: Cctv;
  /** Random numbers for what a shoulder-surfer happens to catch (its own sequence: it never disturbs the bots). */
  private readonly eyes: Random;
  readonly dev: boolean;
  speed: number;
  private readonly soloPlayer: string | null;
  private readonly soloHacker: boolean;
  private readonly assigned: boolean;
  /** A lobby's match: the employees people were given. */
  private readonly seats = new Set<string>();
  private readonly seatOf = new Map<string, string>();
  private readonly handInMs: number;
  /** When the hacker first read the flag (game time). */
  private flagReadAt: number | null = null;

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
    for (const id of options.hackers ?? []) addHacker(this.world, id);
    this.debrief = new Debrief(this.world);
    this.startedAt = this.world.time;
    this.collision = { ...this.map, solid: this.map.solid.map((row) => [...row]) };
    this.doors = new Doors(this.world, this.map, this.collision.solid, this.world.mission.onePersonDoors);
    this.speed = options.speed ?? 1;
    this.dev = options.dev ?? false;
    this.soloPlayer = options.soloPlayer ?? null;
    this.soloHacker = options.soloHacker ?? false;
    this.assigned = options.assigned ?? false;
    this.handInMs = (options.handInMinutes ?? 0) * 60_000;
    this.writeDump = options.writeDump;
    this.cctv = new Cctv(this.world, this.map);
    this.meetings = new Meetings({ ...DEFAULT_MEETING_TIMES, ...options.meetingTimes });
    this.meetingSpots = this.findMeetingSpots();
    this.eyes = new Random((options.seed ?? 1) ^ 0x5ee5);
    this.talk = new Random((options.seed ?? 1) ^ 0x7a1c);
    this.escalationMs = (options.escalationMinutes ?? 10) * 60_000;
    this.nextEscalation = this.escalationMs > 0 ? this.world.time + this.escalationMs : Infinity;
    this.alertCursor = this.world.events.length;
    this.tasks = new TaskBoard(this.world, this.scenario, this.map, new Random((options.seed ?? 1) ^ 0x7a5c));
    this.bots = options.bots === false
      ? null
      : new BotManager({
          world: this.world, scenario: this.scenario, map: this.map, collision: this.collision, doors: this.doors,
          walker: (a) => this.walker(a),
          addBody: (a) => void this.avatars.set(a.clientId, a),
          removeBody: (key) => this.removeBody(key),
          cameIn: (a) => this.throughEntrance(a, 'IN'),
          bodies: () => [...this.avatars.values()],
          // A bot acts through the same functions as a human's messages: same checks, same logs.
          sit: (a, hostname) => this.sitBody(a, hostname),
          stand: (a) => void this.standBody(a),
          type: (a, line) => this.typeLine(a, line),
          cancel: (a) => cancelInput(this.world, a.terminalId),
          switchUser: (a) => switchUser(this.world, a.terminalId),
          usb: (a, hostname) => this.startItem(a, { item: 'usb', hostname }),
          submit: (a, text) => this.submitFlag(a, text),
          pin: (a, text) => this.pinForBot(a, { kind: 'screen', title: `${a.seatedAt} screen`, text, shown: text }),
          pinPicture: (a, shot) => this.pinForBot(a, this.pictureItem(shot)),
          pinBadgeLine: (a, line) => this.pinForBot(a, { kind: 'log', title: 'Badge log', text: line }),
          board: () => this.board.items,
          atMonitors: (a) => this.atMonitors(a),
          pictures: (after) => this.cctv.cameras.flatMap((c) => this.cctv.recording(c.id).filter((s) => s.time > after)).sort((a, b) => a.time - b.time),
          badgeLines: () => this.badgeLines(),
          mayDetain: (a) => !this.detainLost.has(a.playerId),
          strongCase: (guard, saw) => this.strongSuspect(guard, saw),
          detain: (a, target) => this.detain(a, target),
          finished: () => this.over !== null,
          inMeeting: () => this.meetings.current !== null,
          convincingCase: (not) => this.convincingCase(not),
          whyNoMeeting: (a) => this.meetings.whyNot(a.playerId),
          callMeeting: (a, suspect) => this.callMeeting(a, suspect),
          tasks: this.tasks,
        }, options.seed ?? 1, options.botOptions);
  }

  // ───────────────────────────── Sending ─────────────────────────────

  /** The single exit for messages to browsers. The type parameter ties each message name to its payload shape. */
  private send<T extends ServerMessageType>(to: string, type: T, payload: ServerMessages[T]): void {
    if (!this.clients.has(to)) return; // a bot has no browser to send to
    this.outbox.push({ to, type, payload });
    // Remember what this player was shown, so their evidence pins can be checked (evidence.ts) and for the debrief.
    const viewer = this.avatars.get(to)?.playerId;
    if (type === 'term.open' || type === 'term.output') {
      const screen = payload as ServerMessages['term.output'];
      this.board.noteScreen(to, `${screen.output} ${screen.prompt}`);
      if (viewer) this.debrief.noteScreen(viewer, screen.output);
    } else if (type === 'monitors.frame') {
      const frame = payload as ServerMessages['monitors.frame'];
      this.board.noteShot(to, frame.id);
      if (viewer) this.debrief.notePicture(viewer, frame);
    } else if (type === 'monitors.index') {
      const index = payload as ServerMessages['monitors.index'];
      this.board.noteLines(to, [...index.badges, ...index.motion]);
      if (viewer) this.debrief.noteScreen(viewer, [...index.badges, ...index.motion].join('\n'));
    }
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
    // In the order of their ids: the order of the bodies would tell the people (who came first) from the bots.
    for (const avatar of [...this.avatars.values()].sort((a, b) => (a.playerId < b.playerId ? -1 : 1))) {
      players[avatar.playerId] = publicPlayer(avatar);
      if (avatar.seatedAt) occupants[avatar.seatedAt] = avatar.playerId;
    }
    const desks: PublicState['desks'] = {};
    for (const desk of this.map.desks) desks[desk.hostname] = publicDesk(this.world, desk.hostname, occupants[desk.hostname] ?? '');
    const doors: PublicState['doors'] = {};
    for (const door of this.doors.looks()) doors[door.id] = publicDoor(door.id, door.look);
    return { clock: this.world.time, speed: this.speed, reputation: this.reputation, players, desks, doors };
  }

  private sendLobby(to: string): void {
    // "Taken" means: a HUMAN plays this employee, or they were fired. An employee played by a bot can still be picked.
    // In a lobby's match that would say who is a person: there nobody chooses, so nobody is told.
    const taken = new Set(this.assigned ? [] : [...this.humans().map((a) => a.playerId), ...this.fired]);
    this.send(to, 'lobby', {
      scenarioName: this.world.scenarioName,
      mapName: this.mapName,
      employees: employeeChoices(this.world, this.scenario, taken),
      dev: this.dev,
      // Everybody knows a match has one hacker; whether the role is still free is no secret. WHO it is, is.
      hackerOpen: !this.assigned && this.world.mission.flag !== null && !this.humans().some((a) => isHacker(this.world, a.playerId)),
    });
  }

  // ───────────────────────────── Connecting ─────────────────────────────

  connect(clientId: string): void {
    this.clients.add(clientId);
    this.sendLobby(clientId);
    if (this.soloPlayer) this.choose(clientId, { playerId: this.soloPlayer, hacker: this.soloHacker });
  }

  /** A lobby's match: this browser plays this employee. */
  seat(clientId: string, playerId: string): void {
    this.seats.add(playerId);
    this.seatOf.set(clientId, playerId);
    this.connect(clientId);
    this.choose(clientId, { playerId });
  }

  /** A lobby's match, after everybody was seated: the bots are at work too. */
  everybodyIsIn(): void {
    this.bots?.arriveAll();
  }

  /** The bodies controlled by a browser. */
  private humans(): Avatar[] {
    return [...this.avatars.values()].filter((a) => this.clients.has(a.clientId));
  }

  /** Everybody who follows the match with a browser: the people in the office and those watching. */
  private audience(): string[] {
    return [...this.humans().map((a) => a.clientId), ...this.ghosts.keys()];
  }

  /** Takes a body out of the office. Like standing up: its PC stays exactly as it was. */
  private removeBody(key: string): void {
    const avatar = this.avatars.get(key);
    if (avatar?.seatedAt) leaveTerminal(this.world, avatar.terminalId);
    this.avatars.delete(key);
  }

  /** Somebody is gone for good. */
  disconnect(clientId: string): void {
    const avatar = this.avatars.get(clientId);
    if (this.assigned) {
      this.goAway(clientId);
      this.absent.delete(clientId);
    } else if (avatar) {
      // Going home: the badge system records the departure at the main entrance.
      this.throughEntrance(avatar, 'OUT');
      this.removeBody(clientId);
    }
    this.clients.delete(clientId);
    this.board.forget(clientId);
    this.ghosts.delete(clientId);
    this.outBecause.delete(clientId);
    this.mayWrite.delete(clientId);
    // The employee is not left empty: a bot comes to work in their place a little later (not if they were fired).
    if (!this.assigned && avatar && !this.fired.has(avatar.playerId)) this.bots?.schedule(avatar.playerId, 20);
    this.updateLobby();
  }

  // ───────────────────────────── Lost connections (Phase 6, part F) ─────────────────────────────

  /** The connection is lost. The body stays where it is, as of somebody who is reading or thinking, and nobody is told. */
  connectionLost(clientId: string): void {
    const avatar = this.avatars.get(clientId);
    if (!avatar) return;
    Object.assign(avatar, { dx: 0, dy: 0 });
    if (avatar.hold) this.endItem(avatar, 'The connection was lost. Nothing happened.');
  }

  /** The connection has been lost for long: in a lobby's match a bot plays until the player returns. */
  standIn(clientId: string): void {
    if (!this.assigned || this.over) return;
    const avatar = this.avatars.get(clientId);
    if (!avatar) return; // out already: they only watch
    this.absent.set(clientId, avatar.playerId);
    this.clients.delete(clientId);
    this.goAway(clientId);
  }

  /** A lobby's match: the person behind this body is gone. A bot goes on from the same spot; without bots the employee goes home. */
  private goAway(clientId: string): void {
    const avatar = this.avatars.get(clientId);
    if (!avatar) return;
    const { playerId, x, y, facing } = avatar;
    if (avatar.hold) this.endItem(avatar, '');
    if (!this.bots) this.throughEntrance(avatar, 'OUT');
    this.removeBody(clientId);
    if (this.over) return;
    this.bots?.takeOver(playerId, { x, y, facing });
    this.gone.add(playerId);
    this.checkHackerWins();
  }

  /** Somebody is connected again: they get their employee back where it is now, and everything their screen needs. */
  connectionBack(clientId: string): void {
    const playerId = this.absent.get(clientId);
    if (playerId !== undefined) {
      this.absent.delete(clientId);
      this.clients.add(clientId);
      if (this.fired.has(playerId)) {
        // The others voted the employee out while a bot played it.
        this.ghosts.set(clientId, playerId);
        this.outBecause.set(clientId, 'You were voted out or detained while you were away.');
      } else if (!this.over) {
        this.gone.delete(playerId);
        const bot = [...this.avatars.values()].find((a) => a.playerId === playerId);
        this.bots?.remove(playerId);
        const body = this.newBody(clientId, playerId, bot);
        if (!bot) {
          this.throughEntrance(body, 'IN');
          if (this.meetings.current) Object.assign(body, this.meetingSpots[this.avatars.size % this.meetingSpots.length]);
        }
      }
    }
    this.resume(clientId);
  }

  /** Sends a browser that knows nothing (any more) everything it needs to go on. */
  private resume(clientId: string): void {
    const avatar = this.avatars.get(clientId);
    const playerId = avatar?.playerId ?? this.ghosts.get(clientId) ?? this.absent.get(clientId);
    if (!this.clients.has(clientId)) return;
    this.sendLobby(clientId);
    const id = playerId ?? this.seatOf.get(clientId);
    if (id === undefined) return;
    this.send(clientId, 'welcome', { ...this.welcome(id), back: true });
    this.send(clientId, 'board', { items: this.board.view(avatar ? id : '') });
    this.send(clientId, 'meeting', this.meetingView(id));
    if (avatar) {
      this.send(clientId, 'tasks', taskList(this.tasks.view(id)));
      // Still at a PC: the screen as it is now.
      if (avatar.seatedAt) this.send(clientId, 'term.open', { hostname: avatar.seatedAt, ...termScreen(openTerminal(this.world, avatar.seatedAt, id)) });
    }
    if (this.ghosts.has(clientId)) this.send(clientId, 'fired', { reason: this.outBecause.get(clientId) ?? 'You are out.' });
    if (this.ending) {
      this.send(clientId, 'match.over', this.ending.over);
      this.send(clientId, 'debrief', { debrief: this.ending.debrief });
    }
  }

  /** People on the start screen see who can still be picked. (Watchers are not on it.) */
  private updateLobby(): void {
    for (const other of this.clients) if (!this.avatars.has(other) && !this.ghosts.has(other)) this.sendLobby(other);
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

    // People who are out watch. Whatever else their browser sends, they can only talk to each other (while the match runs).
    if (this.ghosts.has(clientId)) {
      if (type === 'chat.send' && !this.over) this.chat(clientId, data);
      return;
    }
    if (type === 'choose') return this.soloPlayer || this.assigned ? undefined : this.choose(clientId, data);
    if (!avatar) return; // everything below needs a body in the office
    if (this.over && !type.startsWith('dev.')) return; // the match is over: nothing changes any more
    // During a meeting everybody stands at the table: talking, accusing and voting only.
    if (this.meetings.current && !['chat.send', 'meeting.accuse', 'meeting.vote', 'evidence.unpin', 'move'].includes(type) && !type.startsWith('dev.')) return;

    switch (type as keyof ClientMessages) {
      case 'move': {
        const sign = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.sign(v) : 0);
        avatar.dx = sign(data.dx);
        avatar.dy = sign(data.dy);
        if (typeof data.sequence === 'number' && Number.isSafeInteger(data.sequence)) {
          this.send(clientId, 'move.ack', { sequence: data.sequence, dx: avatar.dx, dy: avatar.dy, x: avatar.x, y: avatar.y });
        }
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
        // What the player's own screen now shows (a password appears as stars).
        this.board.noteTyped(clientId, awaitingSecret(this.world, avatar.terminalId) ? '*'.repeat(data.text.length) : data.text);
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
      case 'evidence.pin':
        return this.pin(avatar, data);
      case 'evidence.unpin':
        if (typeof data.id === 'string' && this.board.remove(avatar.playerId, data.id)) this.sendBoard();
        return;
      case 'meeting.call':
        return this.callMeeting(avatar);
      case 'detain':
        return this.detain(avatar, word(data.target));
      case 'meeting.accuse': {
        const evidence = Array.isArray(data.evidence) ? data.evidence.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
        const error = this.meetings.accuse(avatar.playerId, word(data.suspect), evidence, new Set(this.board.items.map((i) => i.id)), this.living());
        if (error) return this.send(avatar.clientId, 'notice', { text: error });
        this.planComment();
        return this.sendMeeting();
      }
      case 'meeting.vote': {
        const error = this.meetings.vote(avatar.playerId, word(data.target));
        if (error) return this.send(avatar.clientId, 'notice', { text: error });
        return this.sendMeeting();
      }
      case 'chat.send':
        return this.chat(clientId, data);
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
    if (this.over) return this.send(clientId, 'notice', { text: 'The match is over. Go back to the menu to start a new one.' });
    if (this.avatars.has(clientId)) return; // already playing
    const player = this.world.players.find((p) => p.id === data.playerId);
    if (!player) return this.send(clientId, 'notice', { text: 'That employee does not exist.' });
    if (this.fired.has(player.id)) return this.send(clientId, 'notice', { text: `${player.name} is out of this match.` });
    if (this.humans().some((a) => a.playerId === player.id)) {
      this.send(clientId, 'notice', { text: `${player.name} is already being played.` });
      return this.sendLobby(clientId);
    }
    // Joining as the hacker: one per match. (Roles are assigned properly in Phase 5; until then a player asks for it.)
    // Taking over the same employee preserves their secret role, just as their workstation persists.
    // (In a lobby's match the roles are fixed: whoever was drawn is a hacker already.)
    const asHacker = !this.assigned && (data.hacker === true || (this.bots?.has(player.id) && isHacker(this.world, player.id)));
    if (asHacker) {
      const current = this.world.mission.hackers[0] ?? null;
      const taken = current !== null && current !== player.id && this.humans().some((a) => a.playerId === current);
      if (taken || this.world.mission.flag === null) {
        this.send(clientId, 'notice', { text: 'This match already has its hacker. Join as an employee.' });
        return this.sendLobby(clientId);
      }
      // The role moves with the player: a hacker who left is replaced by whoever asks next.
      if (current && current !== player.id) this.bots?.relinquishHacker(current);
      this.world.mission.hackers = [];
      setHacker(this.world, player.id);
    }
    // If this employee's bot is already in the building, the human simply takes over from it.
    const alreadyInside = this.bots?.isPresent(player.id) ?? false;
    this.bots?.remove(player.id);
    const avatar = this.newBody(clientId, player.id);
    // Otherwise they "came to work": the main entrance logs their arrival, as it does for everyone.
    if (!alreadyInside) this.throughEntrance(avatar, 'IN');
    this.send(clientId, 'welcome', this.welcome(player.id));
    this.tasks.assign(player.id);
    this.tasks.takeChanged();
    this.send(clientId, 'tasks', taskList(this.tasks.view(player.id)));
    this.send(clientId, 'board', { items: this.board.view(player.id) });
    this.send(clientId, 'meeting', this.meetingView(player.id));
    this.updateLobby();
  }

  /** The body of a person, at a place or next to their desk. */
  private newBody(clientId: string, playerId: string, at?: Pick<Avatar, 'x' | 'y' | 'facing'>): Avatar {
    const player = this.world.players.find((p) => p.id === playerId)!;
    const { x, y, facing } = at ?? { ...(this.map.spawns[player.desk] ?? this.map.defaultSpawn), facing: 'up' as Facing };
    const avatar: Avatar = { clientId, playerId, account: player.account, name: player.name, x, y, facing, seatedAt: '', terminalId: '', dx: 0, dy: 0 };
    this.avatars.set(clientId, avatar);
    return avatar;
  }

  private welcome(playerId: string): ServerMessages['welcome'] {
    return {
      playerId,
      card: onboardingCard(this.world, this.scenario, playerId),
      // Only the hacker's own browser ever receives a briefing.
      mission: isHacker(this.world, playerId) ? { ...missionBriefing(this.world, playerId), ...(this.handInMs > 0 ? { handInMinutes: this.handInMs / 60_000 } : {}) } : null,
    };
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
    for (const hacker of this.avatars.values()) if (isHacker(this.world, hacker.playerId)) this.watchedByHacker(hacker, typist, password);
  }

  private watchedByHacker(hacker: Avatar, typist: Avatar, password: string): void {
    const desk = this.map.desks.find((d) => d.hostname === typist.seatedAt);
    if (hacker === typist || hacker.seatedAt || !desk || !password) return;
    // "Right behind": just below the chair (people sit facing their desk, which is above them).
    const behind = hacker.y - desk.seatY;
    if (behind <= 4 || behind > SURF_BEHIND || Math.abs(hacker.x - desk.seatX) > SURF_SIDE) return;
    const prompt = currentPrompt(this.world, typist.terminalId);
    const pattern = glimpse(password, () => this.eyes.next());
    shoulderSurf(this.world, { hacker: hacker.playerId, victim: typist.playerId, host: desk.hostname, prompt, pattern });
    // A generic "Password:" on an unlocked shell might be somebody else's su password.
    // Only a visible unlock of the typist's account, or an explicitly named sudo prompt, is attributable.
    const lock = screenState(this.world, desk.hostname);
    if ((lock.state === 'locked' && lock.user === typist.account) || prompt === `[sudo] password for ${typist.account}: `) {
      this.bots?.glimpse(hacker.playerId, typist.playerId, pattern);
    }
    this.send(hacker.clientId, 'notice', { text: `You saw ${typist.name} type a password at ${desk.hostname} ("${prompt.trim()}"): ${pattern}  (saved in ~/.tools/loot/shoulder.txt)` });
    this.bots?.watchedBy(typist.playerId, hacker, roomAt(this.map, typist.x, typist.y), desk.hostname);
  }

  /** The hacker starts holding the USB stick against a PC. Every condition is checked here, not in the browser. */
  private startItem(avatar: Avatar, data: Record<string, unknown>): void {
    if (data.item !== 'usb' || avatar.hold || avatar.seatedAt) return;
    if (!isHacker(this.world, avatar.playerId)) return; // only a hacker has the stick
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
    this.bots?.itemResult(avatar.playerId, text);
    this.send(avatar.clientId, 'notice', { text });
  }

  // ───────────────────────────── The evidence board (Phase 5, part C) ─────────────────────────────

  /** Pins something to the board, if this player's screen really showed it. */
  private pin(avatar: Avatar, data: Record<string, unknown>): void {
    const no = (text: string) => this.send(avatar.clientId, 'notice', { text });
    const base = { time: this.world.time, pinnedBy: avatar.name, pinnedById: avatar.playerId };
    let item = null;
    if (data.kind === 'screen' && typeof data.text === 'string') {
      if (!avatar.seatedAt) return no('Sit at a PC to pin something from its screen.');
      if (!this.board.sawText(avatar.clientId, data.text)) return no('Only text your screen really showed can be pinned. Select it in the terminal.');
      item = this.board.add({ ...base, kind: 'screen', title: `${avatar.seatedAt} screen`, text: data.text, shown: this.board.withoutOwnWords(avatar.clientId, data.text) });
    } else if (data.kind === 'snapshot' && typeof data.snapshot === 'string') {
      const shot = this.cctv.find(data.snapshot);
      if (!shot || !this.board.sawShot(avatar.clientId, data.snapshot)) return no('You can pin a camera picture you are looking at on the monitors.');
      item = this.board.add({ ...base, ...this.pictureItem(shot) });
    } else if (data.kind === 'log' && typeof data.text === 'string' && (data.source === 'badges' || data.source === 'motion')) {
      if (!this.board.sawLine(avatar.clientId, data.text)) return no('You can pin a line the monitors showed you.');
      item = this.board.add({ ...base, kind: 'log', title: data.source === 'badges' ? 'Badge log' : 'Camera motion log', text: data.text.trim() });
    } else return;
    if (!item) return no('The board is full.');
    no(`Pinned to the evidence board as ${item.id}.`);
    this.sendBoard();
  }

  /** A camera picture as it goes on the board. */
  private pictureItem(shot: Snapshot): Pick<EvidenceItem, 'kind' | 'title' | 'text' | 'frame'> {
    const people = shot.people.map((p) => ({ name: p.name, x: p.x, y: p.y, facing: p.facing, seatedAt: p.seatedAt, activity: p.activity }));
    const who = people.length === 0 ? 'nobody in view' : people.map((p) => p.name + (p.seatedAt ? ` at ${p.seatedAt}` : '') + (p.activity === 'at-pc' ? ' (crouched at a PC)' : '')).join(', ');
    return { kind: 'snapshot', title: shot.camera, text: `${new Date(shot.time).toISOString().slice(11, 19)} ${who}`, frame: { camera: shot.camera, time: shot.time, people } };
  }

  /**
   * The strongest case on the board that would convince a meeting. The key
   * names the suspect and how much there is against them, so a case that failed
   * is raised again only when there is more. An old action the SIEM flagged
   * again does not count here: it may be an ordinary login, and somebody who
   * only does their job must not be dragged to a meeting for it.
   */
  private convincingCase(not: (key: string) => boolean): { suspect: string; key: string; pinnedBy: string[] } | null {
    if (this.board.items.length < 3) return null; // an accusation needs three pieces
    const judge = this.judge();
    const old = /threat-escalation/;
    const items = this.board.items.filter((i) => !old.test(i.text));
    const said = this.testimony.filter((t) => !old.test(t.text));
    let best: { suspect: string; key: string; pinnedBy: string[]; size: number } | null = null;
    for (const suspect of this.living()) {
      const v = judgeAccusation(items, suspect, judge, said);
      const key = `${suspect}/${v.pointing.length}/${v.unusual.length}`;
      const size = v.pointing.length + v.unusual.length;
      if (!v.convincing || not(key) || (best && best.size >= size)) continue;
      best = { suspect, key, size, pinnedBy: this.board.items.filter((i) => v.pointing.includes(i.id)).map((i) => i.pinnedById) };
    }
    return best;
  }

  /** The pieces a bot brings against somebody: what points at them first, then the rest of the board up to three. */
  private evidenceAgainst(suspect: string): string[] {
    const { pointing } = judgeAccusation(this.board.items, suspect, this.judge(), this.testimony);
    const others = this.board.items.map((i) => i.id).filter((id) => !pointing.includes(id));
    return [...pointing, ...others.slice(0, Math.max(0, 3 - pointing.length))];
  }

  /** Somebody against whom the evidence is strong, or null (see judge.ts). */
  private strongSuspect(guard: string, saw: { suspect: string; weight: number; caught: boolean }[]): string | null {
    const judge = this.judge();
    return [...this.living()].find((id) => id !== guard && strongCase(this.board.items, id, judge, saw)) ?? null;
  }

  /** A bot puts something it saw on the board, and the players are told. */
  private pinForBot(avatar: Avatar, what: Pick<EvidenceItem, 'kind' | 'title' | 'text' | 'shown' | 'frame'>): void {
    const item = this.board.add({ time: this.world.time, pinnedBy: avatar.name, pinnedById: avatar.playerId, ...what });
    if (!item) return;
    for (const c of this.audience()) this.send(c, 'notice', { text: `${avatar.name} pinned something to the evidence board (${item.id}).` });
    this.sendBoard();
  }

  /** Sends the board to every player (each sees which pins are their own). Watchers read it; they cannot take down anything, so nothing is marked as theirs. */
  private sendBoard(): void {
    for (const a of this.humans()) this.send(a.clientId, 'board', { items: this.board.view(a.playerId) });
    for (const c of this.ghosts.keys()) this.send(c, 'board', { items: this.board.view('') });
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
    this.send(avatar.clientId, 'monitors.index', {
      cameras: this.cctv.cameras.map((c) => ({
        id: c.id,
        shots: this.cctv.recording(c.id).slice(-MONITOR_SHOTS).map((s) => ({ id: s.id, time: s.time, count: s.people.length })),
      })),
      badges: this.badgeLines(),
      motion: this.logLines('/var/log/cctv/motion.log', 25),
    });
  }

  /** The last lines of a log on the badge server. */
  private logLines(path: string, n: number): string[] {
    return this.tail(this.world.badges.serverHost, path, n).split('\n').filter((l) => l && !l.startsWith('(no file'));
  }

  private badgeLines(): string[] {
    return this.logLines('/var/log/badge/access.log', 40);
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
  private submitFlag(avatar: Avatar, text: string): boolean {
    // Anything that happened since the last tick counts too: reading the file and handing it in at once must not slip past the wait.
    this.announceAlerts();
    // The contact who takes the file needs a while (Infiltration, lobbies). Reading it is what started the clock.
    const left = this.flagReadAt === null ? 0 : this.flagReadAt + this.handInMs - this.world.time;
    if (left > 0) {
      this.send(avatar.clientId, 'notice', { text: `Your contact is not here yet. Hand it in in ${left > 90_000 ? `${Math.ceil(left / 60_000)} minutes` : `${Math.ceil(left / 1000)} seconds`}.` });
      return false;
    }
    const result = submitFlag(this.world, avatar.playerId, text);
    if (!result.won) { this.send(avatar.clientId, 'notice', { text: result.text }); return false; }
    this.endMatch('hacker', this.several() ? `${avatar.name} got the flag out.` : 'The hacker got the flag out.');
    return true;
  }

  private several(): boolean {
    return this.world.mission.hackers.length > 1;
  }

  /** The end: everybody is told who won and who the hacker was (or the hackers were). */
  private endMatch(winner: 'hacker' | 'defenders', reason: string): void {
    const hackers = this.world.mission.hackers.map((id) => this.nameOf(id));
    const hackerName = nameList(hackers);
    this.over = { winner, at: this.world.time };
    for (const a of this.avatars.values()) if (a.hold) this.endItem(a, 'The match is over.');
    for (const a of [...this.avatars.values()]) if (a.seatedAt) this.stand(a, 'The match is over.');
    const over = { winner, hacker: hackerName, hackers, at: this.world.time, reason };
    for (const client of this.clients) this.send(client, 'match.over', over);
    // The match is over: now, and only now, everybody learns what really happened.
    const debrief = this.debrief.build({
      winner, reason, at: this.world.time, startedAt: this.startedAt, cctv: this.cctv, board: this.board.items,
      meetings: this.meetings.history, detentions: this.detentions, reputation: this.reputation,
      findings: this.world.players.map((p) => ({ playerId: p.id, list: this.bots?.findings(p.id) ?? [] })),
    });
    if (this.soloPlayer) debrief.rating = this.soloHacker ? this.infiltrationRating(winner, debrief.totals) : this.rating(winner, hackerName);
    for (const client of this.clients) this.send(client, 'debrief', { debrief });
    this.ending = { over, debrief };
  }

  /** Solo matches: how well did the player do? (See rating.ts.) */
  private rating(winner: 'hacker' | 'defenders', hackerName: string): ReturnType<typeof rate> {
    const hacker = this.world.mission.hackers[0] ?? '';
    const voted = this.meetings.current?.result?.wasHacker ? this.verdicts().get(hacker) : undefined;
    const player = this.soloPlayer!;
    return rate({
      winner, hacker: hackerName,
      verdict: voted ?? judgeAccusation(this.board.items, hacker, this.judge(), this.testimony),
      firedWrongly: [...this.fired].filter((id) => id !== hacker).map((id) => this.nameOf(id)),
      detainedWrongly: this.detentions.filter((d) => !d.wasHacker).map((d) => this.nameOf(d.targetId)),
      meetingsCalled: this.meetings.history.filter((m) => m.calledById === player).length,
      meetingsAllowed: this.meetings.times.usesPerPlayer,
      ms: this.world.time - this.startedAt,
      ownPins: this.board.items.filter((i) => i.pinnedById === player).length,
      otherPins: this.board.items.filter((i) => i.pinnedById !== player).length,
    });
  }

  private infiltrationRating(winner: 'hacker' | 'defenders', totals: { steps: number; pinned: number; missed: number }): ReturnType<typeof rate> {
    const hacker = this.soloPlayer!;
    return rateInfiltration({
      winner,
      verdict: judgeAccusation(this.board.items, hacker, this.judge(), this.testimony),
      detained: this.detentions.some((d) => d.wasHacker),
      blamed: [...new Set([...[...this.fired].filter((id) => id !== hacker), ...this.detentions.filter((d) => !d.wasHacker).map((d) => d.targetId)])].map((id) => this.nameOf(id)),
      meetings: this.meetings.history.length,
      ms: this.world.time - this.startedAt,
      steps: totals.steps, pinned: totals.pinned, missed: totals.missed,
    });
  }

  // ───────────────────────────── Guard and helpdesk (Phase 5, part E) ─────────────────────────────

  /**
   * The helpdesk gave an account a new password. The employee gets it (in
   * the office the helpdesk would hand them a slip): a human sees it on their
   * card, a bot simply knows it.
   */
  private passwordChanged(account: string): void {
    const player = this.world.players.find((p) => p.account === account);
    if (!player) return;
    const human = this.humans().find((a) => a.playerId === player.id);
    if (human) {
      this.send(human.clientId, 'card', { card: onboardingCard(this.world, this.scenario, player.id) });
      this.send(human.clientId, 'notice', { text: 'The helpdesk reset your password. Your new password is on your card (C).' });
    }
    this.bots?.passwordChanged(account, this.world.credentials[account]?.password ?? '');
  }

  /**
   * The guard detains the person next to them. Right: the hacker is caught;
   * when no other hacker is left, the defenders win. Wrong: the person is let go, everybody hears about
   * it, and this guard can never detain anyone again.
   */
  private detain(guard: Avatar, targetId: string): void {
    const no = (text: string) => this.send(guard.clientId, 'notice', { text });
    const role = this.world.players.find((p) => p.id === guard.playerId)?.role;
    if (role !== 'guard') return no('Only the security guard can detain people.');
    if (this.detainLost.has(guard.playerId)) return no('You detained an innocent person: you cannot detain anyone any more.');
    const target = [...this.avatars.values()].find((a) => a.playerId === targetId);
    if (!target || target === guard) return;
    if (Math.hypot(target.x - guard.x, target.y - guard.y) > DETAIN_DISTANCE) return no(`You must stand next to ${target.name} to detain them.`);
    const wasHacker = isHacker(this.world, target.playerId);
    this.detentions.push({ time: this.world.time, guardId: guard.playerId, targetId: target.playerId, wasHacker });
    if (wasHacker) {
      this.world.mission.caught.push(target.playerId);
      if (activeHackers(this.world).length === 0) return this.endMatch('defenders', `${guard.name} caught ${target.name} in the act.`);
      this.takeOut(target.playerId, 'You were detained.');
      for (const c of this.audience()) this.send(c, 'notice', { text: `${guard.name} detained ${target.name}, who was a hacker. ${this.hackersLeft()}` });
      return this.checkHackerWins();
    }
    this.detainLost.add(guard.playerId);
    for (const c of this.audience()) this.send(c, 'notice', { text: `${guard.name} detained ${target.name}, who was not the hacker, and had to let them go. ${guard.name} can no longer detain anyone.` });
  }

  // ───────────────────────────── Meetings (Phase 5, part D) ─────────────────────────────

  /** Player ids of everybody still at the company: bodies in the office, not fired. */
  private living(): Set<string> {
    return new Set([...this.avatars.values()].map((a) => a.playerId).filter((id) => !this.fired.has(id)));
  }

  private nameOf(playerId: string): string {
    return this.world.players.find((p) => p.id === playerId)?.name ?? playerId;
  }

  /** The free tiles around the meeting table, where people stand during a meeting. */
  private findMeetingSpots(): { x: number; y: number; facing: Facing }[] {
    const table = this.map.furniture.find((f) => f.name === 'Meeting table');
    if (!table) return [{ ...this.map.defaultSpawn, facing: 'up' }];
    const t = this.map.tile;
    const spots: { x: number; y: number; facing: Facing }[] = [];
    const c0 = Math.floor(table.x / t) - 1, c1 = Math.ceil((table.x + table.width) / t);
    const r0 = Math.floor(table.y / t) - 1, r1 = Math.ceil((table.y + table.height) / t);
    for (let c = c0; c <= c1; c++) for (const [r, facing] of [[r0, 'down'], [r1, 'up']] as const) spots.push({ x: (c + 0.5) * t, y: (r + 0.5) * t, facing });
    for (let r = r0 + 1; r < r1; r++) for (const [c, facing] of [[c0, 'right'], [c1, 'left']] as const) spots.push({ x: (c + 0.5) * t, y: (r + 0.5) * t, facing });
    return spots.filter((s) => isFree(this.map, s.x, s.y, PLAYER_RADIUS));
  }

  /** The emergency button (furniture of kind "button" in the meeting room). */
  private atButton(avatar: Avatar): boolean {
    const button = this.map.furniture.find((f) => f.kind === 'button');
    return !!button && !avatar.seatedAt && distanceToRect(button, avatar.x, avatar.y) <= BUTTON_DISTANCE;
  }

  /** `about`: a bot calls the meeting to accuse this person. */
  private callMeeting(avatar: Avatar, about = ''): void {
    if (!this.atButton(avatar)) return this.send(avatar.clientId, 'notice', { text: 'The emergency button is in the meeting room.' });
    const why = this.meetings.whyNot(avatar.playerId);
    if (why) return this.send(avatar.clientId, 'notice', { text: why });
    const meeting = this.meetings.call(avatar.playerId, this.world.time, [...this.living()]);
    // Solo: the bots are the jury. In a lobby they help to judge only while people are fewer than half of those present
    // (owner's rule, Phase 6 part G); otherwise people decide, and bots vote only on what they saw themselves.
    // Who lost the connection still counts as a person: otherwise the rule in force would show that somebody is away.
    const people = new Set([...this.humans().map((a) => a.playerId), ...this.absent.values()].filter((id) => meeting.voters.includes(id))).size;
    this.judging = this.bots !== null && (this.soloPlayer !== null || (this.assigned && people * 2 < meeting.voters.length));
    this.planBotMeeting(meeting.voters);
    if (about && this.botMeeting) this.botMeeting.accuse = { by: avatar.playerId, suspect: about, at: (0.1 + this.talk.next() * 0.1) * this.meetings.times.discussionMs };
    // Everybody comes to the table. PCs stay exactly as they were left (unlocked ones too).
    const bodies = [...this.avatars.values()];
    bodies.forEach((a, i) => {
      if (a.seatedAt) this.stand(a, 'An emergency meeting was called.');
      if (a.hold) this.endItem(a, 'An emergency meeting was called.');
      const spot = this.meetingSpots[i % this.meetingSpots.length];
      Object.assign(a, { x: spot.x, y: spot.y, facing: spot.facing, dx: 0, dy: 0, activity: '' });
    });
    this.bots?.interrupt();
    this.sendMeeting();
  }

  private tickMeeting(realMs: number): void {
    this.tickBotMeeting(realMs);
    const change = this.meetings.tick(realMs, (id) => isHacker(this.world, id));
    if (!change) return;
    const m = this.meetings.history.at(-1)!;
    if (change === 'decided' && m.result?.firedId) {
      if (m.result.wasHacker) {
        this.sendMeeting();
        this.world.mission.caught.push(m.result.firedId);
        if (activeHackers(this.world).length === 0) return this.endMatch('defenders', `${this.nameOf(m.result.firedId)} was voted out. They were the ${this.several() ? 'last ' : ''}hacker.`);
        this.takeOut(m.result.firedId, 'You were voted out at the meeting.');
        for (const c of this.audience()) this.send(c, 'notice', { text: `${this.nameOf(m.result.firedId)} was a hacker. ${this.hackersLeft()}` });
        this.checkHackerWins();
      } else this.fire(m.result.firedId);
    }
    this.sendMeeting();
  }

  /** Voted out and innocent: out of the game for good, and the company looks bad. */
  private fire(playerId: string): void {
    this.reputation = Math.max(0, this.reputation - REPUTATION_PER_FIRING);
    this.takeOut(playerId, 'You were voted out at the meeting.');
    this.checkHackerWins();
  }

  /** Out of the game for good: a human watches from now on. */
  private takeOut(playerId: string, reason: string): void {
    this.fired.add(playerId);
    const body = [...this.avatars.values()].find((a) => a.playerId === playerId);
    if (body && this.clients.has(body.clientId)) {
      this.removeBody(body.clientId);
      this.ghosts.set(body.clientId, playerId);
      this.outBecause.set(body.clientId, reason);
      this.send(body.clientId, 'fired', { reason });
      this.send(body.clientId, 'board', { items: this.board.view('') });
    } else this.bots?.remove(playerId);
  }

  /** How many hackers a match has is no secret (the lobby says it), so neither is how many are left. */
  private hackersLeft(): string {
    const left = activeHackers(this.world).length;
    return left === 1 ? 'One hacker is still out there.' : `${left} hackers are still out there.`;
  }

  /**
   * After a firing, or when somebody is gone: has the match been decided without the flag?
   *  - REPUTATION (owner's rule, Phase 5 part H): every wrong firing costs the
   *    company 25 points; at 0 % the company is ruined and the hacker wins.
   *    With the default 25 points that is the fourth wrong firing.
   *  - PARITY (DESIGN.md section 1): the defenders left are no more than the
   *    hackers left. Everybody on the company's staff list counts (present or
   *    not), except the fired. In an office of 11 that would take nine wrong
   *    firings, so reputation ends such a match first; parity matters for
   *    small offices and future settings.
   *  - NOBODY LEFT (owner's rules, Phase 6 part F, lobbies only). Without bots,
   *    people who are gone count no longer; if that leaves no hacker, the
   *    defenders win. With bots, somebody else goes on for whoever is gone, but
   *    bots do not investigate: when no person is left who could find the
   *    hackers, the hackers win.
   */
  private checkHackerWins(): void {
    let hackers = activeHackers(this.world);
    if (hackers.length === 0 || this.over) return;
    if (this.assigned && !this.bots) {
      hackers = hackers.filter((id) => !this.gone.has(id));
      if (hackers.length === 0) return this.endMatch('defenders', this.several() ? HACKERS_GONE : HACKER_GONE);
    }
    // Infiltration is won with the flag only: getting colleagues fired is not a way to win.
    if (this.soloHacker) return;
    if (this.reputation <= 0) {
      return this.endMatch('hacker', `The company's reputation hit 0 %: too many innocent people were fired. The ${this.several() ? 'hackers win' : 'hacker wins'}.`);
    }
    // A lobby's match without bots has only the people who were given a desk.
    const staff = this.assigned && !this.bots ? this.world.players.filter((p) => this.seats.has(p.id) && !this.gone.has(p.id)) : this.world.players;
    const defenders = staff.filter((p) => !isHacker(this.world, p.id) && !this.fired.has(p.id)).length;
    if (defenders <= hackers.length) this.endMatch('hacker', `Only ${defenders} defender${defenders === 1 ? ' is' : 's are'} left, as many as hackers: the ${this.several() ? 'hackers' : 'hacker'} took over the company.`);
    else if (this.assigned && this.bots && ![...this.seats].some((id) => !isHacker(this.world, id) && !this.fired.has(id) && !this.gone.has(id))) {
      this.endMatch('hacker', `Nobody is left who could find the ${this.several() ? 'hackers' : 'hacker'}: everybody who tried is out or has left.`);
    }
  }

  /** The meeting as one player sees it. */
  private meetingView(playerId: string): MeetingView {
    const m = this.meetings.current;
    const usesLeft = this.meetings.usesLeft(playerId);
    const { votesNeeded } = this.meetings.times;
    if (!m) return { active: false, usesLeft, number: 0, phase: '', calledBy: '', endsIn: 0, accusations: [], voted: [], myVote: '', canVote: false, votesNeeded, judged: false, result: null };
    return {
      active: true, usesLeft, number: m.number, phase: m.phase, calledBy: this.nameOf(m.calledById), endsIn: Math.max(0, Math.round(m.leftMs)),
      accusations: m.accusations.map((a) => ({ id: a.id, accuser: this.nameOf(a.accuserId), suspectId: a.suspectId, suspect: this.nameOf(a.suspectId), evidence: [...a.evidence] })),
      voted: Object.keys(m.votes).map((id) => this.nameOf(id)),
      myVote: m.votes[playerId] ?? '',
      canVote: m.voters.includes(playerId) && !this.fired.has(playerId),
      votesNeeded, judged: this.judging,
      result: m.result && {
        fired: m.result.firedId ? this.nameOf(m.result.firedId) : '',
        wasHacker: m.result.wasHacker,
        tally: Object.entries(m.result.tally).map(([id, votes]) => ({ id, name: this.nameOf(id), votes })),
        skips: m.result.skips,
        abstained: m.result.abstained,
      },
    };
  }

  /** Sends the meeting to everybody: players and those watching. */
  private sendMeeting(): void {
    for (const a of this.humans()) this.send(a.clientId, 'meeting', this.meetingView(a.playerId));
    for (const [clientId, playerId] of this.ghosts) this.send(clientId, 'meeting', this.meetingView(playerId));
  }

  /** A line somebody wrote: which channel it belongs to follows from where they are. */
  private chat(clientId: string, data: Record<string, unknown>): void {
    const text = cleanChat(data.text);
    const ghost = this.ghosts.get(clientId);
    const body = this.avatars.get(clientId);
    const fromId = ghost ?? body?.playerId;
    if (!text || !fromId) return;
    let channel: ChatChannel = ghost ? 'fired' : this.meetings.current ? 'meeting' : 'room';
    if (data.channel === 'hackers') {
      // Only hackers who are still in the game, and only if there is somebody to talk to.
      if (ghost || !this.several() || !isHacker(this.world, fromId)) return;
      channel = 'hackers';
    }
    if (channel === 'room' && this.soloPlayer) return this.send(clientId, 'notice', { text: 'You can talk to everybody during a meeting.' });
    if (!this.takeLine(clientId)) return this.send(clientId, 'notice', { text: 'You are writing too fast. Wait a moment.' });
    this.postChat(channel, fromId, text);
  }

  /** A few lines at once, then one every moment: nobody can flood the chat. */
  private takeLine(clientId: string): boolean {
    const old = this.mayWrite.get(clientId) ?? { lines: CHAT_BURST, at: this.realMs };
    const lines = Math.min(CHAT_BURST, old.lines + (this.realMs - old.at) / CHAT_REFILL_MS);
    const allowed = lines >= 1;
    this.mayWrite.set(clientId, { lines: allowed ? lines - 1 : lines, at: this.realMs });
    return allowed;
  }

  private postChat(channel: ChatChannel, fromId: string, text: string): void {
    const line = { channel, from: this.nameOf(fromId), fromId, text, time: this.world.time };
    this.chatLog.push(line);
    for (const c of this.listeners(channel, fromId)) this.send(c, 'chat', line);
    if (channel !== 'room') return;
    // People who are out hear every room, so they are told which one it was.
    const speaker = [...this.avatars.values()].find((a) => a.playerId === fromId);
    const room = (speaker && roomAt(this.map, speaker.x, speaker.y)) || 'Doorway';
    for (const c of this.ghosts.keys()) this.send(c, 'chat', { ...line, room });
  }

  /** Who hears a line (open chat: also everybody watching, see postChat). */
  private listeners(channel: ChatChannel, fromId: string): string[] {
    switch (channel) {
      case 'fired': // nobody alive hears them
        return [...this.ghosts.keys()];
      case 'meeting': // people who are out listen too
        return this.audience();
      case 'hackers':
        return this.humans().filter((a) => isHacker(this.world, a.playerId)).map((a) => a.clientId);
      case 'room': {
        const speaker = [...this.avatars.values()].find((a) => a.playerId === fromId);
        if (!speaker) return [];
        const here = roomAt(this.map, speaker.x, speaker.y);
        return this.humans().filter((a) => {
          const there = roomAt(this.map, a.x, a.y);
          // In a doorway, between two rooms, distance decides.
          return here && there ? here === there : Math.hypot(a.x - speaker.x, a.y - speaker.y) <= CHAT_EARSHOT;
        }).map((a) => a.clientId);
      }
    }
  }

  // ───────────────────────────── Bots in meetings (Phase 5, part G) ─────────────────────────────

  /** When each bot at this meeting will speak (it decides what to say now, from what it knows). */
  private planBotMeeting(voters: string[]): void {
    const bots = this.bots;
    if (!bots) return;
    const at = (from: number, to: number, ms: number) => Math.round((from + this.talk.next() * (to - from)) * ms);
    const speak = voters
      .filter((id) => bots.isPresent(id))
      .map((id) => ({ id, at: at(0.1, 0.6, this.meetings.times.discussionMs), lines: bots.speech(id, () => this.talk.next()) }))
      .filter((s) => s.lines.length > 0)
      .sort((a, b) => a.at - b.at);
    this.botMeeting = { phase: 'discussion', elapsed: 0, speak, vote: [] };
  }

  // ─────── Judging accusations (Phase 5a, part B; solo matches, and lobbies with few people) ───────

  /** What everybody at the company could know, for judging evidence (see judge.ts). */
  private judge(): Judge {
    return {
      staff: this.world.players.map((p) => ({
        id: p.id, name: p.name, account: p.account, desk: p.desk,
        ip: this.world.hosts[p.desk]?.ip ?? '',
        uid: this.uidOf(p.account),
        badge: this.world.badges.holders[p.account]?.id ?? '',
        it: p.role === 'sysadmin' || p.role === 'helpdesk',
      })),
      today: new Date(this.world.time).toISOString().slice(0, 10),
      roomAt: (x, y) => roomAt(this.map, x, y),
    };
  }

  private uidOf(account: string): number {
    const index = this.scenario.accounts.findIndex((a) => a.username === account);
    return this.scenario.accounts[index]?.uid ?? 1001 + index; // as the engine numbers them (core/world.ts)
  }

  /** The verdict on everybody accused in this meeting (the best accusation, if several name the same person). */
  private verdicts(): Map<string, Verdict> {
    const out = new Map<string, Verdict>();
    const judge = this.judge();
    for (const a of this.meetings.current?.accusations ?? []) {
      const verdict = judgeAccusation(this.board.items.filter((i) => a.evidence.includes(i.id)), a.suspectId, judge, this.testimony);
      const old = out.get(a.suspectId);
      if (!old || (verdict.convincing && !old.convincing) || (verdict.convincing === old.convincing && verdict.pointing.length > old.pointing.length)) out.set(a.suspectId, verdict);
    }
    return out;
  }

  /** Somebody was just accused: a few seconds later one colleague says what they make of the evidence. */
  private planComment(): void {
    const m = this.meetings.current;
    const plan = this.botMeeting;
    const a = m?.accusations.at(-1);
    if (!this.judging || !this.bots || !plan || !a) return;
    const bots = this.bots;
    const speakers = m!.voters.filter((id) => bots.isPresent(id) && id !== a.suspectId && id !== a.accuserId && this.living().has(id));
    if (speakers.length === 0) return;
    const total = this.meetings.times.discussionMs;
    const at = Math.min(total - 1, plan.elapsed + (0.04 + this.talk.next() * 0.05) * total);
    plan.speak.push({ id: this.talk.pick(speakers), at, lines: [], about: a.suspectId });
    plan.speak.sort((x, y) => x.at - y.at);
  }

  /** Bots say their piece during the discussion and vote during the vote, at human-like moments. */
  private tickBotMeeting(realMs: number): void {
    const m = this.meetings.current;
    const plan = this.botMeeting;
    if (!m || !plan || !this.bots) {
      this.botMeeting = null;
      return;
    }
    const bots = this.bots;
    if (plan.phase !== m.phase) {
      plan.phase = m.phase;
      plan.elapsed = 0;
      if (m.phase === 'voting') {
        plan.vote = m.voters.filter((id) => bots.isPresent(id)).map((id) => ({ id, at: Math.round((0.15 + this.talk.next() * 0.55) * this.meetings.times.votingMs) }));
      }
    }
    plan.elapsed += realMs;
    if (m.phase === 'discussion') {
      const a = plan.accuse;
      if (a && a.at <= plan.elapsed) {
        plan.accuse = undefined;
        const error = this.meetings.accuse(a.by, a.suspect, this.evidenceAgainst(a.suspect), new Set(this.board.items.map((i) => i.id)), this.living());
        if (!error) {
          this.postChat('meeting', a.by, `I called this meeting because of ${this.nameOf(a.suspect)}. Look at the evidence.`);
          this.planComment();
          this.sendMeeting();
        }
      }
      while (plan.speak.length > 0 && plan.speak[0].at <= plan.elapsed) {
        const s = plan.speak.shift()!;
        if (!this.living().has(s.id)) continue;
        // A comment on an accusation is worked out now, so it includes what was said in the meantime.
        const verdict = s.about ? this.verdicts().get(s.about) : undefined;
        if (s.about && verdict) s.lines.push({ text: comment(verdict, this.nameOf(s.about)), suspect: '' });
        for (const { text, suspect } of s.lines) {
          this.postChat('meeting', s.id, text);
          if (!s.about) this.testimony.push({ from: this.nameOf(s.id), text, suspect });
        }
      }
    } else if (m.phase === 'voting') {
      const accused = [...new Set(m.accusations.map((a) => a.suspectId))];
      let voted = false;
      // Where the bots judge, they look at the evidence. Otherwise the people do, and bots vote only on what they saw.
      const verdicts = this.judging ? this.verdicts() : undefined;
      for (const v of plan.vote.filter((x) => x.at <= plan.elapsed)) {
        const choice = bots.ballot(v.id, accused, verdicts);
        if (choice && this.meetings.vote(v.id, choice) === '') voted = true;
        else this.meetings.pass(v.id);
      }
      plan.vote = plan.vote.filter((x) => x.at > plan.elapsed);
      if (voted) this.sendMeeting();
    }
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
      if (e.type === 'password.change') this.passwordChanged(e.user);
      if (this.handInMs > 0 && this.flagReadAt === null && this.isFlagRead(e)) this.flagRead(e.time);
    }
    if (!fresh || this.world.time - this.lastBanner < ALERT_BANNER_GAP_MS) return;
    this.lastBanner = this.world.time;
    this.bots?.alarm();
    for (const c of this.audience()) this.send(c, 'alert', { text: 'SECURITY ALERT: unusual activity was detected on the company network.' });
  }

  /** The hacker read the flag file (in Infiltration that starts the wait for the contact). */
  private isFlagRead(e: GameEvent): boolean {
    const { flag } = this.world.mission;
    return e.type === 'file.read' && isHacker(this.world, e.actor) && e.host === flag?.host && e.details.path === flag.path && !e.details.denied;
  }

  private flagRead(at: number): void {
    this.flagReadAt = at;
    const minutes = Math.round(this.handInMs / 60_000);
    for (const a of this.humans()) {
      if (isHacker(this.world, a.playerId)) this.send(a.clientId, 'notice', { text: `You have the file. Your contact takes it in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}: do not get caught until then.` });
    }
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
    this.realMs += realMs;
    if (this.over) return;
    const gameMs = realMs * this.speed + this.carryMs;
    const whole = Math.floor(gameMs);
    this.carryMs = gameMs - whole;
    if (whole > 0) advanceTime(this.world, whole);

    this.tickMeeting(realMs);
    const step = (PLAYER_SPEED * realMs) / 1000;
    // During a meeting (and after the match) nobody walks.
    const frozen = this.meetings.current !== null || this.over !== null;
    for (const avatar of [...this.avatars.values()]) {
      if (frozen && !avatar.seatedAt) continue;
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
    if (!frozen) this.bots?.tick(realMs);
    if (this.over) return;
    // Anti-stall: the longer the match, the more of the hacker's trail the SIEM points at.
    if (!this.over && this.world.time >= this.nextEscalation) {
      escalate(this.world);
      this.nextEscalation += this.escalationMs;
    }
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
          `bot hacker difficulty: ${this.bots?.hackerDifficulty ?? 'disabled (no bots)'}`,
          `hacker:      ${m.hackers.length > 0 ? m.hackers.map((id) => `${id} ${name(id)}${m.caught.includes(id) ? ' (caught)' : this.humans().some((a) => a.playerId === id) ? '' : ' (not connected)'}`).join(', ') : 'nobody yet'}`,
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
        const m = amount(data.multiplier);
        if (!(m >= 0 && m <= 3600)) return reply('Speed must be between 0 and 3600.');
        this.speed = m;
        return reply(`Speed: ${m} game seconds per real second.`);
      }
      case 'dev.jump': {
        const ms = parseDuration(word(data.duration));
        if (ms === null || ms > 7 * 24 * 3600_000) return reply('Give a duration like +5m, +1h30m (at most 7 days).');
        advanceTime(this.world, ms);
        return reply(`Game time is now ${dateStamp(this.world.time)}.`);
      }
      case 'dev.events': {
        const count = Math.min(200, Math.max(1, amount(data.count) || 15));
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
        return reply(this.devShow(word(data.what), word(data.arg)));
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
