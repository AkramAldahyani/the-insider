/**
 * The Colyseus room of one lobby and its matches (Phase 6, parts A and B). Its
 * room id IS the code friends type. Before a match it only passes the party
 * messages to the rules in party.ts; during one it is an ordinary office room.
 * After it everybody goes back to the lobby when they like, and the host can
 * start the next match.
 *
 * The room is private: nobody is ever put into it without giving its code.
 */
import { randomInt } from 'node:crypto';
import { matchMaker, type Client } from '@colyseus/core';
import { PARTY_REMOVED, type PartyCast } from '@insider/shared';
import { OfficeRoom } from './OfficeRoom';
import { Random } from './bots/random';
import { deal } from './deal';
import type { OfficeGameOptions } from './game';
import { Party, newCode, partyGameOptions } from './party';

const field = (payload: unknown, name: string): unknown => (typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)[name] : undefined);

/** Makes the room class for lobbies. At most `limit` exist at the same time. */
export function partyRoom(base: OfficeGameOptions, { seed, limit = 20 }: { seed?: number; limit?: number } = {}): new () => OfficeRoom {
  let running = 0;
  return class ConfiguredPartyRoom extends OfficeRoom {
    private party!: Party;
    private counted = false;
    /** Who plays whom in the running match. SECRET until it is over. */
    private cast: PartyCast[] = [];

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
      if (type === 'party.back') {
        party.back(client.sessionId);
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
      const { party } = this;
      const matchSeed = seed ?? randomInt(1, 2 ** 31);
      const dealt = deal(base.scenario.players, party.clients(), party.settings, new Random(matchSeed ^ 0xdea1));
      this.begin(partyGameOptions(base, party.settings, matchSeed, dealt));
      const game = this.game!;
      const nameOf = (id: string) => base.scenario.players.find((p) => p.id === id)!.name;
      this.cast = [...dealt.seats].map(([clientId, id]) => ({ name: party.nameOf(clientId), employee: nameOf(id), hacker: dealt.hackers.includes(id) }));
      void this.lock();
      party.begin(dealt.hackers.length);
      this.sendParty();
      for (const [clientId, id] of dealt.seats) game.seat(clientId, id);
      // The computer's colleagues are at work from the first moment, like everybody else: who walks in later would be known to be one.
      game.everybodyIsIn();
      this.flush();
    }

    /** The match is over: who was who may be told, and the lobby takes people again. */
    protected override finished(): void {
      if (!this.party.playing) return;
      this.party.end(this.cast);
      if (this.party.open) void this.unlock();
      this.sendParty();
    }

    /** Tells every member how the lobby looks now. */
    private sendParty(): void {
      for (const clientId of this.party.clients()) this.clients.getById(clientId)?.send('party', this.party.view(clientId));
    }
  };
}
