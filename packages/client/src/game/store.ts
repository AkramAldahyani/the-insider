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
import {
  ROOM_NAME, SERVER_PORT, parseOfficeMap,
  type ClientMessages, type EmployeeChoice, type MissionBriefing, type OfficeMap, type OnboardingCard, type PublicDesk, type PublicDoor, type PublicPlayer,
  type ServerMessages, type TaskView, type TermScreen, type TiledMap,
} from '@insider/shared';

/** Every map file in maps/ is bundled with the page; the server says which one the match uses. */
const MAP_FILES = import.meta.glob<TiledMap>('../../../../maps/*.json', { eager: true, import: 'default' });

/** The synced room state as the client reads it (see the server's state.ts). */
export interface RoomState {
  clock: number;
  speed: number;
  players: { get(id: string): PublicPlayer | undefined; forEach(cb: (player: PublicPlayer, id: string) => void): void };
  desks: { get(hostname: string): PublicDesk | undefined; forEach(cb: (desk: PublicDesk, hostname: string) => void): void };
  doors: { get(id: string): PublicDoor | undefined; forEach(cb: (door: PublicDoor, id: string) => void): void };
}

/** What React draws. Replaced by a new object on every change. */
export interface UiState {
  phase: 'connecting' | 'lobby' | 'playing' | 'error';
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
  /** The latest security-alert banner ("" = none showing). */
  alert: string;
  /** Set when the match is over: who won and who the hacker was. */
  matchOver: { winner: 'hacker'; hacker: string; at: number } | null;
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

export class Store {
  room: Room<RoomState> | null = null;
  map: OfficeMap | null = null;
  /** The map file as Tiled wrote it (the scene reads the tile colours from it). */
  rawMap: TiledMap | null = null;

  private ui: UiState = {
    phase: 'connecting', error: '', scenarioName: '', employees: [], dev: false, playerId: '', card: null, cardOpen: false, hackerOpen: false, asHacker: false, briefing: null, briefingOpen: false, alert: '', matchOver: null,
    clock: 0, speed: 1, roomName: '', nearDesk: '', nearDoor: '', nearDoorName: '', seatedAt: '', notice: '', tasks: [], tasksCompleted: 0, tasksOpen: true, devOpen: false, devLog: [],
  };
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
    this.room?.send(type, payload);
  }

  async connect(): Promise<void> {
    const url = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? `ws://${window.location.hostname}:${SERVER_PORT}`;
    try {
      const room = await new Client(url).joinOrCreate<RoomState>(ROOM_NAME);
      this.room = room;
      const on = <T extends keyof ServerMessages>(type: T, handler: (payload: ServerMessages[T]) => void) => room.onMessage(type, handler);

      on('lobby', (lobby) => {
        const file = Object.entries(MAP_FILES).find(([path]) => path.endsWith(`/${lobby.mapName}.json`));
        if (!file) return this.set({ phase: 'error', error: `This page does not have the map "${lobby.mapName}".` });
        this.rawMap = file[1];
        this.map = parseOfficeMap(file[1]);
        this.set({ scenarioName: lobby.scenarioName, employees: lobby.employees, dev: lobby.dev, hackerOpen: lobby.hackerOpen, asHacker: this.ui.asHacker && lobby.hackerOpen, phase: this.ui.phase === 'playing' ? 'playing' : 'lobby' });
      });
      on('welcome', ({ playerId, card, mission }) => this.set({ phase: 'playing', playerId, card, cardOpen: true, briefing: mission, briefingOpen: mission !== null }));
      on('term.open', ({ hostname, ...screen }) => {
        this.termBacklog = [];
        this.term({ kind: 'open', hostname, screen });
        this.set({ seatedAt: hostname, cardOpen: false });
      });
      on('term.output', (screen) => this.term({ kind: 'output', screen }));
      on('term.close', () => this.set({ seatedAt: '' }));
      on('notice', ({ text }) => this.notice(text));
      on('alert', ({ text }) => {
        this.set({ alert: text });
        window.clearTimeout(this.alertTimer);
        this.alertTimer = window.setTimeout(() => this.set({ alert: '' }), 8000);
      });
      on('match.over', (over) => this.set({ matchOver: over })); 
      on('tasks', ({ tasks, completed }) => {
        if (completed > this.ui.tasksCompleted) this.notice('Task finished.');
        this.set({ tasks, tasksCompleted: completed });
      });
      on('dev.result', ({ text }) => this.set({ devLog: [...this.ui.devLog.slice(-30), text] }));

      room.onLeave(() => this.set({ phase: 'error', error: 'The connection to the game server was closed.' }));
      room.onError((_code, message) => this.set({ phase: 'error', error: message ?? 'Network error.' }));
    } catch (error) {
      this.set({ phase: 'error', error: `Cannot reach the game server at ${url}. Is it running? (${(error as Error).message})` });
    }
  }
}

export const store = new Store();
