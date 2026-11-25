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
 */
import { randomInt } from 'node:crypto';
import { Room, type Client } from '@colyseus/core';
import { TICK_RATE, parseSoloChoice } from '@insider/shared';
import { OfficeGame, type OfficeGameOptions } from './game';
import { soloGameOptions } from './solo';
import { newOfficeState, syncState, type OfficeState } from './state';

export abstract class OfficeRoom extends Room<OfficeState> {
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
    this.onMessage('*', (client, type, payload) => this.received(client, String(type), payload));
    this.setSimulationInterval((deltaMs) => {
      this.game?.tick(deltaMs);
      this.flush();
    }, 1000 / TICK_RATE);
  }

  /** Starts the match. */
  protected begin(options: OfficeGameOptions): void {
    this.game = new OfficeGame(options);
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

  override onLeave(client: Client): void {
    this.game?.disconnect(client.sessionId);
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

    override onDispose(): void {
      if (this.counted) running--;
    }
  };
}
