/**
 * The client's single source of truth.
 *
 * Three different technologies need the same data: React (menus and HUD),
 * Phaser (the map) and xterm.js (the PC screen). Instead of letting them talk
 * to each other, they all talk to this store:
 *
 *   server --> Store --> React   (through subscribe / getUi)
 *                   \--> Phaser  (reads `room.state` every frame)
 *                   \--> xterm   (through onTerm)
 *
 * The store also owns the network connection, so it is the only file that
 * sends messages to the server.
 */
import { Client, type Room } from 'colyseus.js';
import { readLadder, saveWin, type LadderProgress } from './ladderProgress';
import { Movement } from './movement';
import { readPlace, savePlace, type SavedPlace } from './savedPlace';
import {
  PARTY_REMOVED, PARTY_ROOM_NAME, ROOM_NAME, SERVER_PORT, SOLO_ROOM_NAME, ladderLevel, parseOfficeMap, withCameras,
  type ClientMessages, type EmployeeChoice, type EvidenceView, type MeetingView, type MissionBriefing, type OfficeMap, type OnboardingCard, type PartyView, type PublicDesk, type PublicDoor, type PublicPlayer,
  type ServerMessages, type SoloChoice, type TaskView, type TermScreen, type TiledMap,
} from '@insider/shared';

/** Every map file in maps/ is bundled with the page; the server says which one the match uses. */
const MAP_FILES = import.meta.glob<TiledMap>('../../../../maps/*.json', { eager: true, import: 'default' });

/** The synced room state as the client reads it (see the server's state.ts). */
export interface RoomState {
  clock: number;
  speed: number;
  reputation: number;
  players: { get(id: string): PublicPlayer | undefined; forEach(cb: (player: PublicPlayer, id: string) => void): void };
  desks: { get(hostname: string): PublicDesk | undefined; forEach(cb: (desk: PublicDesk, hostname: string) => void): void };
  doors: { get(id: string): PublicDoor | undefined; forEach(cb: (door: PublicDoor, id: string) => void): void };
}

/** After a lost connection: how often this page tries to come back, and how long it believes a server that says "no" (it may not have noticed yet that we are gone). */
const RETRY_MS = 2000;
const EXPIRED_AFTER_MS = 20_000;
/** In a running match the server sends something many times per second. This long without anything means the line is dead. */
const SILENCE_MS = 15_000;

/** Which room to join: the shared office, a solo match, a new lobby, or a friend's lobby. */
type Destination =
  | { kind: 'office' }
  | { kind: 'solo'; choice: SoloChoice }
  | { kind: 'create'; name: string }
  | { kind: 'join'; code: string; name: string };

/** What React draws. Replaced by a new object on every change. */
export interface UiState {
  phase: 'menu' | 'connecting' | 'party' | 'lobby' | 'playing' | 'error';
  /** The connection is lost and this page tries to come back. */
  reconnecting: boolean;
  /** Start menu: a match or lobby this tab was in before the page was reloaded. */
  place: SavedPlace | null;
  /** The lobby this player is in, also while its match runs (null = not in one). */
  party: PartyView | null;
  /** A lobby's match has just started: the screen that tells this player their part. */
  reveal: boolean;
  /** The solo match being played (null = the shared office or a lobby's match). */
  solo: SoloChoice | null;
  /** Levels of the scenario ladder won in this browser. */
  ladder: LadderProgress;
  error: string;
  scenarioName: string;
  employees: EmployeeChoice[];
  /** The server allows the developer panel. */
  dev: boolean;
  playerId: string;
  card: OnboardingCard | null;
  cardOpen: boolean;
  /** Start screen: is the hacker role still free, and did this player tick "join as the hacker"? */
  hackerOpen: boolean;
  asHacker: boolean;
  /** The shared evidence board, and whether it is shown (B). */
  board: EvidenceView[];
  boardOpen: boolean;
  /** Standing at the security-office monitors (for the "Press E" hint). */
  nearMonitors: boolean;
  /** What the monitors show (null = not using them), and the picture asked for last. */
  monitors: ServerMessages['monitors.index'] | null;
  monitorFrame: ServerMessages['monitors.frame'] | null;
  /** The latest security-alert banner ("" = none showing). */
  alert: string;
  /** Set when the match is over: who won and who the hacker was. */
  matchOver: ServerMessages['match.over'] | null;
  /** What really happened; arrives only after the match. */
  debrief: ServerMessages['debrief']['debrief'] | null;
  debriefOpen: boolean;
  /** The meeting as the server last described it, and when that message arrived (for the countdown). */
  meeting: MeetingView | null;
  meetingAt: number;
  /** Everything this player heard (all channels), and when it arrived. */
  chat: (ServerMessages['chat'] & { heardAt: number })[];
  /** The chat panel is open; a hacker with partners is looking at the private channel; people this player does not want to hear. */
  chatOpen: boolean;
  chatSecret: boolean;
  muted: string[];
  /** Why this player is out ("" = still at the company). Who is out watches: no body, a free view, and nothing they do reaches the match. */
  fired: string;
  /** Watching: the person the view follows ("" = it moves freely), and how close it is (1 = normal). */
  watch: string;
  zoom: number;
  /** Standing at the emergency button. */
  nearButton: boolean;
  /** The nearest other person within detaining distance (for the guard's hint). */
  nearPerson: { id: string; name: string } | null;
  /** The guard pressed X once: press again within 3 s to detain this person. */
  detainArmed: { id: string; until: number } | null;
  /** Watching: the view moves with the arrow keys; the direction held. */
  pan: { dx: number; dy: number };
  /** The hacker's private briefing (null for everybody else) and whether it is shown. */
  briefing: MissionBriefing | null;
  briefingOpen: boolean;
  /** Game time (ms since 1970, UTC) and speed, refreshed about once per second. */
  clock: number;
  speed: number;
  /** Room the player is standing in. */
  roomName: string;
  /** Desk within reach ("" = none), for the "Press E" hint. */
  nearDesk: string;
  /** Door with a badge reader within reach: its code ("" = none) and its name for the hint. */
  nearDoor: string;
  nearDoorName: string;
  /** Desk the player is sitting at ("" = walking). */
  seatedAt: string;
  notice: string;
  /** The player's own job tasks, how many they have finished, and whether the list is shown. */
  tasks: TaskView[];
  tasksCompleted: number;
  tasksOpen: boolean;
  devOpen: boolean;
  devLog: string[];
}

export type TermEvent =
  | { kind: 'open'; hostname: string; screen: TermScreen }
  | { kind: 'output'; screen: TermScreen };

type Listener = () => void;

/** A page that has just been opened (or has just left a match). */
const START: UiState = {
  phase: 'menu', reconnecting: false, place: null, party: null, reveal: false, solo: null, ladder: {}, error: '', scenarioName: '', employees: [], dev: false, playerId: '', card: null, cardOpen: false, hackerOpen: false, asHacker: false, briefing: null, briefingOpen: false, alert: '', matchOver: null, debrief: null, debriefOpen: false, meeting: null, meetingAt: 0, chat: [], chatOpen: false, chatSecret: false, muted: [], fired: '', watch: '', zoom: 1, nearButton: false, pan: { dx: 0, dy: 0 }, nearPerson: null, detainArmed: null, nearMonitors: false, monitors: null, monitorFrame: null, board: [], boardOpen: false,
  clock: 0, speed: 1, roomName: '', nearDesk: '', nearDoor: '', nearDoorName: '', seatedAt: '', notice: '', tasks: [], tasksCompleted: 0, tasksOpen: true, devOpen: false, devLog: [],
};

export class Store {
  movement = new Movement();
  room: Room<RoomState> | null = null;
  /** Where the middle of the map view is (written by the scene every frame; nobody else is told). */
  view = { x: 0, y: 0, zoom: 1 };
  map: OfficeMap | null = null;
  /** The map file as Tiled wrote it (the scene reads the tile colours from it). */
  rawMap: TiledMap | null = null;

  private ui: UiState = { ...START, ladder: readLadder(), place: readPlace() };
  /** When the server was last heard (see SILENCE_MS). */
  private heardAt = 0;
  private listeners = new Set<Listener>();
  private termListener: ((event: TermEvent) => void) | null = null;
  /** Terminal events that arrived before the terminal window was ready. */
  private termBacklog: TermEvent[] = [];
  private noticeTimer = 0;

  // ───────────────────────────── React side ─────────────────────────────

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getUi = (): UiState => this.ui;

  /** Changes some UI fields and tells React. Does nothing if nothing really changed. */
  set(patch: Partial<UiState>): void {
    const keys = Object.keys(patch) as (keyof UiState)[];
    if (keys.every((k) => this.ui[k] === patch[k])) return;
    this.ui = { ...this.ui, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Watching: follow somebody ("" = move freely). Only for people who are out; only this browser knows. */
  follow(id: string): void {
    if (this.ui.fired) this.set({ watch: id });
  }

  /** Watching: follow the next (1) or previous (-1) person in the office. */
  followNext(step: 1 | -1): void {
    const ids: string[] = [];
    this.room?.state.players?.forEach((_p, id) => ids.push(id));
    ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (ids.length === 0) return;
    const at = ids.indexOf(this.ui.watch);
    this.follow(ids[at < 0 ? (step > 0 ? 0 : ids.length - 1) : (at + step + ids.length) % ids.length]);
  }

  /** Watching: closer (more than 1) or further away. The scene keeps it within what makes sense for the map. */
  zoomBy(factor: number): void {
    if (this.ui.fired) this.set({ zoom: Math.min(2, Math.max(0.3, this.ui.zoom * factor)) });
  }

  private alertTimer = 0;

  notice(text: string): void {
    this.set({ notice: text });
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => this.set({ notice: '' }), 3500);
  }

  // ───────────────────────────── Terminal side ─────────────────────────────

  /** The terminal window registers here; it first receives anything it missed. */
  onTerm(listener: (event: TermEvent) => void): () => void {
    this.termListener = listener;
    for (const event of this.termBacklog.splice(0)) listener(event);
    return () => {
      if (this.termListener === listener) this.termListener = null;
    };
  }

  private term(event: TermEvent): void {
    if (this.termListener) this.termListener(event);
    else this.termBacklog.push(event);
  }

  // ───────────────────────────── Network side ─────────────────────────────

  /** Sends one message to the server. The types make a wrong payload a compile error. */
  send<T extends keyof ClientMessages>(type: T, payload: ClientMessages[T]): void {
    if (this.ui.reconnecting) return; // nobody would get it
    if (type === 'move') {
      this.set({ nearDesk: '' }); // Clear the hint immediately, before any network round trip.
      this.room?.send(type, { ...payload, sequence: this.movement.request() });
      return;
    }
    this.room?.send(type, payload);
  }

  /** Joins the shared office: everybody who opens it plays in the same match. */
  enterOffice(): Promise<void> {
    return this.join({ kind: 'office' });
  }

  /** Opens a new lobby; this player is its host. */
  createParty(name: string): Promise<void> {
    return this.join({ kind: 'create', name });
  }

  /** Goes into a friend's lobby. */
  joinParty(code: string, name: string): Promise<void> {
    return this.join({ kind: 'join', code, name });
  }

  /** Starts a private match against bots. */
  startSolo(choice: SoloChoice): Promise<void> {
    return this.join({ kind: 'solo', choice });
  }

  /** Back to the start menu. Leaving a solo match ends it; in the shared office a bot takes over. */
  leave(): void {
    const room = this.room;
    this.reset();
    savePlace(null);
    void room?.leave().catch(() => undefined);
  }

  /** Start menu: go back to where this tab was before the page was reloaded. */
  goBack(): void {
    const place = this.ui.place;
    if (!place) return;
    this.set({ phase: 'connecting', solo: place.solo, place: null });
    void this.comeBack(place);
  }

  forgetPlace(): void {
    savePlace(null);
    this.set({ place: null });
  }

  /** The same kind of match again, with a new office (and in a solo match a new hacker); or another solo match, e.g. the next level. */
  async playAgain(solo: SoloChoice | null = this.ui.solo): Promise<void> {
    const room = this.room;
    this.reset();
    savePlace(null);
    this.set({ phase: 'connecting', solo });
    // Leave first, so that the old match is gone before the new one starts.
    await room?.leave().catch(() => undefined);
    await this.join(solo ? { kind: 'solo', choice: solo } : { kind: 'office' });
  }

  /** After a lobby's match: back to the same lobby, without leaving the room. */
  backToParty(): void {
    const { party, ladder } = this.ui;
    this.movement = new Movement();
    this.termBacklog = [];
    window.clearTimeout(this.alertTimer);
    this.set({ ...START, ladder, party, phase: 'party' });
    this.send('party.back', {});
  }

  /** Forgets everything about the last match. */
  private reset(): void {
    this.room = null;
    this.movement = new Movement();
    this.termBacklog = [];
    window.clearTimeout(this.noticeTimer);
    window.clearTimeout(this.alertTimer);
    this.set({ ...START, ladder: this.ui.ladder });
  }

  private connect(client: Client, to: Destination): Promise<Room<RoomState>> {
    switch (to.kind) {
      case 'office': return client.joinOrCreate(ROOM_NAME);
      case 'solo': return client.create(SOLO_ROOM_NAME, to.choice);
      case 'create': return client.create(PARTY_ROOM_NAME, { name: to.name });
      case 'join': return client.joinById(to.code, { name: to.name });
    }
  }

  private async join(to: Destination): Promise<void> {
    const solo = to.kind === 'solo' ? to.choice : null;
    this.set({ phase: 'connecting', error: '', solo, place: null });
    savePlace(null);
    const url = this.url();
    try {
      this.listen(await this.connect(new Client(url), to), solo);
    } catch (error) {
      // 4212: no room with this id, or one that takes nobody (full, closed, playing). The player cannot do anything different about it.
      if (to.kind === 'join' && (error as { code?: unknown }).code === 4212) return this.set({ phase: 'error', error: `No open lobby has the code ${to.code}. It may be full, closed, already playing, or mistyped.` });
      // An answer with a code is the server saying no (full, unknown match); without one there was no answer.
      const refused = typeof (error as { code?: unknown }).code === 'number' && (error as Error).message;
      this.set({ phase: 'error', error: refused || `Cannot reach the game server at ${url}. Is it running? (${(error as Error).message})` });
    }
  }

  private url(): string {
    const { protocol, host, hostname } = window.location;
    // In development Vite serves the page and the game has its own port. Otherwise both have one address.
    return (import.meta.env.VITE_SERVER_URL as string | undefined)
      ?? (import.meta.env.DEV ? `ws://${hostname}:${SERVER_PORT}` : `${protocol === 'https:' ? 'wss' : 'ws'}://${host}`);
  }

  // ───────────────────────────── Lost connections (Phase 6, part F) ─────────────────────────────

  /** The line to the server is gone. In a lobby or a solo match the server keeps the place: try to come back. */
  private lineLost(room: Room<RoomState>): void {
    if (this.room !== room) return;
    const place = readPlace();
    this.room = null;
    if (!place) return this.set({ phase: 'error', error: 'The connection to the game server was closed.' });
    this.set({ reconnecting: true, pan: { dx: 0, dy: 0 } });
    void room.leave(false).catch(() => undefined); // if only this page thinks it is gone
    void this.comeBack(place);
  }

  /** Tries again and again, until the server takes us back, says that the place is gone, or the player has had enough. */
  private async comeBack(place: SavedPlace): Promise<void> {
    this.set({ reconnecting: true });
    const since = Date.now();
    while (this.ui.reconnecting && !this.room) {
      try {
        const room = await new Client(this.url()).reconnect<RoomState>(place.token);
        if (!this.ui.reconnecting) return void room.leave(); // the player went back to the menu meanwhile
        this.movement = new Movement();
        this.termBacklog = [];
        this.set({ reconnecting: false, seatedAt: '', monitors: null, monitorFrame: null });
        return this.listen(room, place.solo);
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        // 4212: the room is gone. 4214: this place is not kept (or the server has not noticed yet that the old line is dead).
        if (code === 4212 || (code === 4214 && Date.now() - since > EXPIRED_AFTER_MS)) {
          savePlace(null);
          if (this.ui.reconnecting) this.set({ phase: 'error', reconnecting: false, error: 'Your place is gone: the match or the lobby is over, or you were away for too long.' });
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, RETRY_MS));
      }
    }
  }

  /** Starts listening to a room this page is in. */
  private listen(room: Room<RoomState>, solo: SoloChoice | null): void {
      this.room = room;
      this.heardAt = Date.now();
      // (In the shared office no place is kept.)
      if (room.name !== ROOM_NAME) savePlace({ token: room.reconnectionToken, solo, code: room.name === PARTY_ROOM_NAME ? room.roomId : '' });
      // The office clock never stands still during a match. (Not a listener of Colyseus: its `remove` can take away somebody else's.)
      let clock: number | undefined;
      const watch = window.setInterval(() => {
        if (this.room !== room) return window.clearInterval(watch);
        if (room.state?.clock !== clock) {
          clock = room.state?.clock;
          this.heardAt = Date.now();
        }
        if (this.ui.phase === 'playing' && !this.ui.debrief && Date.now() - this.heardAt > SILENCE_MS) this.lineLost(room);
      }, 2000);
      /** Messages of a match this page has already left are ignored. */
      const on = <T extends keyof ServerMessages>(type: T, handler: (payload: ServerMessages[T]) => void) =>
        room.onMessage(type, (payload: ServerMessages[T]) => { if (this.room === room) handler(payload); });

      on('party', (party) => this.set({ party, ...(this.ui.phase === 'connecting' ? { phase: 'party' } : {}) }));
      on('lobby', (lobby) => {
        const file = Object.entries(MAP_FILES).find(([path]) => path.endsWith(`/${lobby.mapName}.json`));
        if (!file) return this.set({ phase: 'error', error: `This page does not have the map "${lobby.mapName}".` });
        // Some levels of the ladder have more cameras (the server records with the same ones).
        this.rawMap = withCameras(file[1], ladderLevel(this.ui.solo?.level)?.cameras);
        this.map = parseOfficeMap(this.rawMap);
        this.set({ scenarioName: lobby.scenarioName, employees: lobby.employees, dev: lobby.dev, hackerOpen: lobby.hackerOpen, asHacker: this.ui.asHacker && lobby.hackerOpen, phase: this.ui.phase === 'playing' || this.ui.solo || this.ui.party ? this.ui.phase : 'lobby' }); // solo and lobbies: the server has already chosen; "welcome" follows
      });
      on('welcome', ({ playerId, card, mission, back }) => {
        if (back) {
          // Back after a lost connection: go on as before, without the opening screens.
          this.set({ phase: 'playing', playerId, card, briefing: mission, tasks: [], tasksCompleted: 0, reveal: this.ui.reveal && this.ui.phase === 'playing', ...(this.ui.phase === 'playing' ? {} : { briefingOpen: true }) });
          this.send('move', { dx: 0, dy: 0 });
          this.notice('You are back.');
          return;
        }
        this.set({ phase: 'playing', playerId, card, cardOpen: true, briefing: mission, briefingOpen: mission !== null || this.ui.solo !== null || this.ui.party !== null, reveal: this.ui.party !== null });
        this.send('move', { dx: 0, dy: 0 });
      });
      on('move.ack', (reply) => this.movement.acknowledge(reply));
      on('term.open', ({ hostname, ...screen }) => {
        this.termBacklog = [];
        this.term({ kind: 'open', hostname, screen });
        this.set({ seatedAt: hostname, cardOpen: false });
      });
      on('term.output', (screen) => this.term({ kind: 'output', screen }));
      on('term.close', () => {
        this.set({ seatedAt: '' });
        this.send('move', { dx: 0, dy: 0 });
      });
      on('notice', ({ text }) => this.notice(text));
      on('alert', ({ text }) => {
        this.set({ alert: text });
        window.clearTimeout(this.alertTimer);
        this.alertTimer = window.setTimeout(() => this.set({ alert: '' }), 8000);
      });
      on('match.over', (over) => this.set({ matchOver: over }));
      on('debrief', ({ debrief }) => {
        this.set({ debrief });
        if (solo?.level && debrief.winner === 'hacker') this.set({ ladder: saveWin(solo.level, debrief.rating?.title ?? '') });
      });
      on('monitors.index', (index) => this.set({ monitors: index }));
      on('board', ({ items }) => this.set({ board: items }));
      on('meeting', (meeting) => {
        // A new meeting closes everything else and starts a fresh chat.
        const fresh = meeting.active && (!this.ui.meeting?.active || this.ui.meeting.number !== meeting.number);
        this.set({ meeting, meetingAt: Date.now(), ...(fresh ? { chat: this.ui.chat.filter((l) => l.channel !== 'meeting'), chatOpen: false, boardOpen: false, monitors: null, cardOpen: false } : {}) });
      });
      on('chat', (line) => this.set({ chat: [...this.ui.chat.slice(-200), { ...line, heardAt: Date.now() }] }));
      on('fired', ({ reason }) => this.set({
        // Everything that belongs to having a body goes away (the briefing stays known: it says which side this player was on).
        fired: reason, seatedAt: '', watch: '', zoom: 1, cardOpen: false, tasksOpen: false, briefingOpen: false, chatOpen: false, devOpen: false,
        monitors: null, monitorFrame: null, nearDesk: '', nearDoor: '', nearDoorName: '', nearMonitors: false, nearButton: false, nearPerson: null, detainArmed: null,
      }));
      on('card', ({ card }) => this.set({ card }));
      on('monitors.frame', (frame) => this.set({ monitorFrame: frame })); 
      on('tasks', ({ tasks, completed }) => {
        if (completed > this.ui.tasksCompleted && this.ui.tasks.length > 0) this.notice('Task finished.');
        this.set({ tasks, tasksCompleted: completed });
      });
      on('dev.result', ({ text }) => this.set({ devLog: [...this.ui.devLog.slice(-30), text] }));

      room.onLeave((code) => {
        if (this.room !== room) return;
        // 4000: the server closed it on purpose (it is shutting down).
        if (code !== PARTY_REMOVED && code !== 4000) return this.lineLost(room);
        savePlace(null);
        this.set({ phase: 'error', error: code === PARTY_REMOVED ? 'The host removed you from the lobby.' : 'The connection to the game server was closed.' });
      });
      room.onError((_code, message) => { if (this.room === room) this.lineLost(room); else console.warn(message); });
  }
}

export const store = new Store();
