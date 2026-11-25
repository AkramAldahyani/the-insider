/**
 * The Colyseus room "office": the network side of one match.
 *
 * It does three small things and no game logic:
 *  1. passes every message from a browser to the OfficeGame;
 *  2. runs the game clock in real time (TICK_RATE times per second);
 *  3. after each of those, copies the game's PUBLIC state into the synced
 *     room state and delivers the messages the game queued.
 *
 * One room = one match = one World. Several browsers can join the same room
 * and each plays a different employee. A solo match (DESIGN.md section 1a) is
 * a private room for one browser; a lobby (PartyRoom.ts) is a room whose match
 * starts later.
 *
 * Lost connections (Phase 6, part F; lobbies and solo matches): the place is
 * kept for HOLD_MS. The browser comes back with a secret token that Colyseus
 * gave it when it joined, and it gets the same network id again, so the game
 * hardly notices. Leaving with the button gives the place up at once.
 */
import { randomInt } from 'node:crypto';
import { Room, type Client } from '@colyseus/core';
import { HOLD_MS, TICK_RATE, parseSoloChoice } from '@insider/shared';
import { Allowance, MAX_WAITING, MESSAGE_POINTS, MESSAGE_REFILL, PER_EVENT, PER_MS, price } from './allowance';
import { OfficeGame, type OfficeGameOptions } from './game';
import { soloGameOptions } from './solo';
import { newOfficeState, syncState, type OfficeState } from './state';

/** A lost connection whose place is kept. `giveUp` ends the waiting. */
interface Lost {
  since: number;
  /** A bot has been playing since the minute was over. */
  covered: boolean;
  giveUp(): void;
}

/** A browser asked for too much at once (allowance.ts): its connection is closed. */
export const TOO_MANY = 4009;
/** The shared office takes this many browsers (people on its start screen included). */
const OFFICE_SIZE = 60;
/** A match whose clock failed so many times in a row is closed; so is a browser whose messages failed so often. */
const MAX_ERRORS = 50;
const MAX_BAD_MESSAGES = 20;

/** What one browser may ask for, and what it asked for too early. */
interface Queue {
  allowance: Allowance;
  /** How many of its messages ended in a mistake of the program. */
  bad: number;
  waiting: { client: Client; type: string; payload: unknown }[];
}

export abstract class OfficeRoom extends Room<OfficeState> {
  private readonly waitingFor = new Map<string, Lost>();

  /** The match. Null only in a lobby whose match has not started (PartyRoom.ts). */
  protected game: OfficeGame | null = null;

  abstract override onCreate(request: unknown): void;

  /**
   * Opens the room: messages and the clock are connected. There may be no match yet; if there
   * is one it was begun first, so that a match that cannot be built leaves no running clock behind.
   */
  protected open(): void {
    this.state = newOfficeState();
    if (this.game) syncState(this.state, this.game.publicState());
    this.onMessage('*', (client, type, payload) => this.arrived(client, String(type), payload));
    this.setSimulationInterval((deltaMs) => {
      this.serveWaiting();
      this.game?.tick(deltaMs);
      this.errors = 0; // it works (again)
      this.lookForLost();
      this.flush();
    }, 1000 / TICK_RATE);
  }

  /** Starts the match. */
  protected begin(options: OfficeGameOptions): void {
    this.game = new OfficeGame(options);
  }

  // ───────────────────────────── How much a browser may ask (Phase 6, part H) ─────────────────────────────

  private readonly queues = new Map<string, Queue>();

  /** A message has arrived. It is handled at once, unless this browser has asked for too much: then it waits, in order. */
  private arrived(client: Client, type: string, payload: unknown): void {
    let queue = this.queues.get(client.sessionId);
    if (!queue) this.queues.set(client.sessionId, (queue = { allowance: new Allowance(MESSAGE_POINTS, MESSAGE_REFILL), bad: 0, waiting: [] }));
    if (queue.waiting.length === 0 && queue.allowance.some) return this.handle(queue, { client, type, payload });
    queue.waiting.push({ client, type, payload });
    if (queue.waiting.length <= MAX_WAITING) return;
    queue.waiting = [];
    client.leave(TOO_MANY, 'Too many messages.');
  }

  private serveWaiting(): void {
    for (const [id, queue] of this.queues) {
      const here = this.clients.getById(id) !== undefined;
      if (!here) queue.waiting = [];
      while (queue.waiting.length > 0 && queue.allowance.some) this.handle(queue, queue.waiting.shift()!);
      if (!here && queue.allowance.full) this.queues.delete(id);
    }
  }

  private handle(queue: Queue, { client, type, payload }: Queue['waiting'][number]): void {
    const start = performance.now();
    const { game } = this;
    const before = game?.world.events.length ?? 0;
    try {
      this.received(client, type, payload);
    } catch (error) {
      // It costs the one who sent it, not the others.
      this.report(error, type);
      if (++queue.bad === MAX_BAD_MESSAGES) client.leave(TOO_MANY, 'Too many wrong messages.');
    }
    // (Starting a match makes a whole new world: its history is not the host's doing.)
    const events = game && game === this.game ? game.world.events.length - before : 0;
    queue.allowance.take(Math.min(MESSAGE_POINTS, price(type) + (performance.now() - start) * PER_MS + events * PER_EVENT));
  }

  /** A mistake in the program must not take everybody's match down with it. It is written to the server's log. */
  private report(error: unknown, where: string): void {
    console.error(`[insider] room ${this.roomId}, ${where.slice(0, 40)}:`, error);
  }

  private errors = 0;
  override onUncaughtException(error: Error, where: string): void {
    // A refusal ("The server is full") is not a mistake: Colyseus tells the browser.
    if (where === 'onCreate' || where === 'onJoin') return;
    this.report((error as { cause?: unknown }).cause ?? error, where);
    if (where === 'setSimulationInterval' && ++this.errors === MAX_ERRORS) void this.disconnect();
  }

  /** A message from a browser. */
  protected received(client: Client, type: string, payload: unknown): void {
    this.game?.handle(client.sessionId, type, payload);
    this.flush();
  }

  override onJoin(client: Client): void {
    this.game?.connect(client.sessionId);
    this.flush();
  }

  override onLeave(client: Client, consented?: boolean): void {
    const id = client.sessionId;
    if (consented || !this.keeps(id)) return this.left(id);
    const reconnection = this.allowReconnection(client, 'manual');
    this.waitingFor.set(id, { since: Date.now(), covered: false, giveUp: () => void reconnection.reject?.(false) });
    this.lost(id);
    // (Colyseus' own promise type does not know that a promise can also fail.)
    Promise.resolve(reconnection as unknown as PromiseLike<Client>).then(
      () => {
        this.waitingFor.delete(id);
        this.returned(id);
        this.flush();
      },
      () => {
        this.waitingFor.delete(id);
        this.left(id);
      },
    );
  }

  /** Is this player's place kept when the connection is lost? (In the shared office people simply choose an employee again.) */
  protected keeps(_clientId: string): boolean {
    return false;
  }

  /** Is it kept longer than HOLD_MS, with a bot playing? */
  protected keepsOn(): boolean {
    return false;
  }

  /** Looks after everybody whose connection is lost. */
  private lookForLost(): void {
    for (const [id, who] of this.waitingFor) {
      if (Date.now() - who.since < HOLD_MS) continue;
      if (!this.keepsOn()) who.giveUp();
      else if (!who.covered) {
        who.covered = true;
        this.game?.standIn(id);
      }
    }
  }

  /** Those who are missing get another HOLD_MS (the match is over: they may still come to see the end). */
  protected holdAgain(): void {
    for (const who of this.waitingFor.values()) who.since = Date.now();
  }

  /** This player is not waited for any longer. */
  protected giveUp(clientId: string): void {
    this.waitingFor.get(clientId)?.giveUp();
  }

  protected lost(clientId: string): void {
    this.game?.connectionLost(clientId);
    this.flush();
  }

  protected returned(clientId: string): void {
    this.game?.connectionBack(clientId);
  }

  protected left(clientId: string): void {
    this.game?.disconnect(clientId);
    this.flush();
  }

  /** Called again and again once the match is over. It takes no new players: whoever joins now gets a new room (and so a new match). */
  protected finished(): void {
    if (!this.locked) void this.lock();
  }

  /** Publishes the public state and delivers queued messages to their one recipient each. */
  protected flush(): void {
    if (!this.game) return;
    if (this.game.over) this.finished();
    syncState(this.state, this.game.publicState());
    for (const message of this.game.drain()) {
      this.clients.getById(message.to)?.send(message.type, message.payload);
    }
  }
}

/**
 * Makes the room class of the shared office for one configuration (scenario, map, speed, dev on/off).
 * The settings come from the server operator; what a browser sends is ignored (it could ask for dev: true).
 */
export function officeRoom(options: OfficeGameOptions): new () => OfficeRoom {
  return class ConfiguredOfficeRoom extends OfficeRoom {
    override onCreate(): void {
      this.maxClients = OFFICE_SIZE;
      this.begin(options);
      this.open();
    }
  };
}

/**
 * The room class for solo matches: private, for one browser, gone when that
 * browser leaves. The browser may choose a mode, a role and a difficulty from
 * fixed lists and nothing else. Every match gets a new random seed, unless the operator set
 * one (`seed`, for tests). At most `limit` run at the same time, because each
 * one is a whole simulated company.
 */
export function soloRoom(base: OfficeGameOptions, { seed, limit = 20 }: { seed?: number; limit?: number } = {}): new () => OfficeRoom {
  let running = 0;
  return class ConfiguredSoloRoom extends OfficeRoom {
    private counted = false;

    override onCreate(request: unknown): void {
      const choice = parseSoloChoice(request);
      if (!choice) throw new Error('This kind of match does not exist.');
      if (running >= limit) throw new Error('The server is full. Try again in a few minutes.');
      this.begin(soloGameOptions(base, choice, seed ?? randomInt(1, 2 ** 31)));
      this.open();
      this.maxClients = 1;
      void this.setPrivate();
      running++;
      this.counted = true;
    }

    /** Closing the page by mistake, or reloading it, does not end the match. */
    protected override keeps(): boolean {
      return true;
    }

    override onDispose(): void {
      if (this.counted) running--;
    }
  };
}
