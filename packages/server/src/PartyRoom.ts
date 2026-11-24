/**
 * The Colyseus room of one lobby and its match (Phase 6, part A). Its room id
 * IS the code friends type. Before the match it only passes the party messages
 * to the rules in party.ts; after the start it is an ordinary office room.
 *
 * The room is private: nobody is ever put into it without giving its code.
 */
import { randomInt } from 'node:crypto';
import { matchMaker, type Client } from '@colyseus/core';
import { PARTY_REMOVED } from '@insider/shared';
import { OfficeRoom } from './OfficeRoom';
import type { OfficeGameOptions } from './game';
import { Party, newCode, partyGameOptions } from './party';

const field = (payload: unknown, name: string): unknown => (typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)[name] : undefined);

/** Makes the room class for lobbies. At most `limit` exist at the same time. */
export function partyRoom(base: OfficeGameOptions, { seed, limit = 20 }: { seed?: number; limit?: number } = {}): new () => OfficeRoom {
  let running = 0;
  return class ConfiguredPartyRoom extends OfficeRoom {
    private party!: Party;
    private counted = false;

    /** What the creating browser sent is not used here; its name arrives again in onJoin. */
    override onCreate(): void {
      if (running >= limit) throw new Error('The server is full. Try again in a few minutes.');
      // Two lobbies with one code would mix up two groups.
      do this.roomId = newCode(); while (matchMaker.getLocalRoomById(this.roomId));
      const size = base.scenario.players.length;
      this.maxClients = size;
      this.party = new Party(this.roomId, size);
      this.open();
      void this.setPrivate();
      running++;
      this.counted = true;
    }

    override onJoin(client: Client, request?: unknown): void {
      const refused = this.party.join(client.sessionId, field(request, 'name'));
      if (refused) throw new Error(refused);
      this.sendParty();
    }

    override onLeave(client: Client): void {
      super.onLeave(client);
      this.party.leave(client.sessionId);
      this.sendParty();
    }

    override onDispose(): void {
      if (this.counted) running--;
    }

    protected override received(client: Client, type: string, payload: unknown): void {
      if (!type.startsWith('party.')) return super.received(client, type, payload);
      const { party } = this;
      if (!party.has(client.sessionId) || party.playing) return;
      if (type === 'party.ready') {
        party.setReady(client.sessionId, field(payload, 'ready'));
        return this.sendParty();
      }
      // The rest is only for the host.
      if (!party.isHost(client.sessionId)) return;
      switch (type) {
        case 'party.settings':
          party.change(payload);
          break;
        case 'party.open': {
          const open = field(payload, 'open');
          if (typeof open !== 'boolean') return;
          party.open = open;
          void (open ? this.unlock() : this.lock());
          break;
        }
        case 'party.remove': {
          const target = party.clientOf(field(payload, 'id'));
          if (!target || target === client.sessionId) return;
          // Out at once, whatever their browser does with the goodbye.
          party.leave(target);
          this.clients.getById(target)?.leave(PARTY_REMOVED, 'The host removed you from the lobby.');
          break;
        }
        case 'party.start':
          return this.start();
        default:
          return;
      }
      this.sendParty();
    }

    /** Everybody in the lobby goes to the office. From now on nobody can come in. */
    private start(): void {
      if (this.party.notYet()) return;
      // Built first, so that a problem with the match leaves the lobby as it was.
      this.begin(partyGameOptions(base, this.party.settings, seed ?? randomInt(1, 2 ** 31)));
      void this.lock();
      this.party.playing = true;
      this.sendParty();
      for (const clientId of this.party.clients()) this.game!.connect(clientId);
      this.flush();
    }

    /** Tells every member how the lobby looks now. */
    private sendParty(): void {
      for (const clientId of this.party.clients()) this.clients.getById(clientId)?.send('party', this.party.view(clientId));
    }
  };
}
