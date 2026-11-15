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
 * and each plays a different employee.
 */
import { Room, type Client } from '@colyseus/core';
import { TICK_RATE } from '@insider/shared';
import { OfficeGame, type OfficeGameOptions } from './game';
import { newOfficeState, syncState, type OfficeState } from './state';

export abstract class OfficeRoom extends Room<OfficeState> {
  private game!: OfficeGame;

  /** The match settings. They come from the server operator (see `officeRoom` below). */
  protected abstract gameOptions(): OfficeGameOptions;

  // Note what is NOT here: the options a browser sends when joining. A browser
  // must never be able to choose the settings (it could ask for dev: true).
  override onCreate(): void {
    this.game = new OfficeGame(this.gameOptions());
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
