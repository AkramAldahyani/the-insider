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
 * a private room for one browser.
 */
import { randomInt } from 'node:crypto';
import { Room, type Client } from '@colyseus/core';
import { TICK_RATE, parseSoloChoice } from '@insider/shared';
import { OfficeGame, type OfficeGameOptions } from './game';
import { soloGameOptions } from './solo';
import { newOfficeState, syncState, type OfficeState } from './state';

export abstract class OfficeRoom extends Room<OfficeState> {
  private game!: OfficeGame;

  /**
   * The match settings. They come from the server operator (see `officeRoom` below).
   * `request` is what the browser sent. It is ignored, except by a solo room, which accepts a mode, a role
   * and a difficulty from fixed lists and nothing else. (A browser could ask for dev: true.)
   */
  protected abstract gameOptions(request: unknown): OfficeGameOptions;

  override onCreate(request: unknown): void {
    this.game = new OfficeGame(this.gameOptions(request));
    this.state = newOfficeState();
    syncState(this.state, this.game.publicState());

    this.onMessage('*', (client, type, payload) => {
      this.game.handle(client.sessionId, String(type), payload);
      this.flush();
    });
    this.setSimulationInterval((deltaMs) => {
      this.game.tick(deltaMs);
      this.flush();
    }, 1000 / TICK_RATE);
  }

  override onJoin(client: Client): void {
    this.game.connect(client.sessionId);
    this.flush();
  }

  override onLeave(client: Client): void {
    this.game.disconnect(client.sessionId);
    this.flush();
  }

  /** Publishes the public state and delivers queued messages to their one recipient each. */
  private flush(): void {
    // A finished match takes no new players: whoever joins now gets a new room (and so a new match).
    if (this.game.over && !this.locked) void this.lock();
    syncState(this.state, this.game.publicState());
    for (const message of this.game.drain()) {
      this.clients.getById(message.to)?.send(message.type, message.payload);
    }
  }
}

/** Makes the room class for one configuration (scenario, map, speed, dev on/off). */
export function officeRoom(options: OfficeGameOptions): new () => OfficeRoom {
  return class ConfiguredOfficeRoom extends OfficeRoom {
    protected override gameOptions(): OfficeGameOptions {
      return options;
    }
  };
}

/**
 * The room class for solo matches: private, for one browser, gone when that
 * browser leaves. Every match gets a new random seed, unless the operator set
 * one (`seed`, for tests). At most `limit` run at the same time, because each
 * one is a whole simulated company.
 */
export function soloRoom(base: OfficeGameOptions, { seed, limit = 20 }: { seed?: number; limit?: number } = {}): new () => OfficeRoom {
  let running = 0;
  return class ConfiguredSoloRoom extends OfficeRoom {
    private counted = false;

    protected override gameOptions(request: unknown): OfficeGameOptions {
      const choice = parseSoloChoice(request);
      if (!choice) throw new Error('This kind of match does not exist.');
      if (running >= limit) throw new Error('The server is full. Try again in a few minutes.');
      return soloGameOptions(base, choice, seed ?? randomInt(1, 2 ** 31));
    }

    override onCreate(request: unknown): void {
      super.onCreate(request);
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
