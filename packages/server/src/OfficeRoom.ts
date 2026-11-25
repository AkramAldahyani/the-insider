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
    this.onMessage('*', (client, type, payload) => this.received(client, String(type), payload));
    this.setSimulationInterval((deltaMs) => {
      this.game?.tick(deltaMs);
      this.lookForLost();
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
