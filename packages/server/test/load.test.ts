/**
 * Phase 6, part H: thirty people at the same time, for a few seconds. (The
 * long measurement is `pnpm load`.)
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import type { Room } from 'colyseus.js';
import { PARTY_ROOM_NAME, type PartyView } from '@insider/shared';
import { createGameServer } from '../src/app';
import type { OfficeGame } from '../src/game';

const PORT = 2593;
let server: ReturnType<typeof createGameServer>;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
beforeAll(async () => {
  server = createGameServer({ dev: false });
  await server.listen(PORT);
});
afterAll(async () => {
  await server.gracefullyShutdown(false);
});

it('thirty people in three lobbies: everybody is answered, nobody is dropped, and a match needs little time', async () => {
  const { Client } = await import('colyseus.js');
  const people: { room: Room; lobby: number; sent: number; answered: number; closed: number; playing: boolean; party: PartyView | null }[] = [];
  for (let n = 0; n < 30; n++) {
    const client = new Client(`ws://localhost:${PORT}`);
    const host = people.find((p) => p.lobby === Math.floor(n / 10));
    const room = host ? await client.joinById(host.room.roomId, { name: `P${n}` }) : await client.create(PARTY_ROOM_NAME, { name: `P${n}` });
    const p = { room, lobby: Math.floor(n / 10), sent: 0, answered: 0, closed: 0, playing: false, party: null as PartyView | null };
    room.onMessage('*', (type) => {
      if (type === 'move.ack') p.answered++;
      if (type === 'welcome') p.playing = true;
    });
    room.onMessage('party', (party: PartyView) => { p.party = party; });
    room.onLeave((code) => { p.closed = code; });
    people.push(p);
  }
  const hosts = people.filter((_, i) => i % 10 === 0);
  for (const p of people) if (!hosts.includes(p)) p.room.send('party.ready', { ready: true });
  for (let i = 0; i < 200 && !hosts.every((h) => h.party?.notYet === ''); i++) await wait(20);
  for (const h of hosts) h.room.send('party.start', {});
  for (let i = 0; i < 400 && !people.every((p) => p.playing); i++) await wait(20);
  expect(people.every((p) => p.playing)).toBe(true);

  // How long the matches themselves take per step (they share this process with the thirty browsers).
  let spent = 0, steps = 0;
  for (const h of hosts) {
    const game = (matchMaker.getLocalRoomById(h.room.roomId) as unknown as { game: OfficeGame }).game;
    const tick = game.tick.bind(game);
    game.tick = (ms) => {
      const start = performance.now();
      tick(ms);
      spent += performance.now() - start;
      steps++;
    };
  }
  for (let round = 0; round < 25; round++) {
    for (const p of people) {
      p.room.send('move', { dx: (round % 3) - 1, dy: (p.sent % 3) - 1, sequence: ++p.sent });
      if (round % 8 === 0) p.room.send('chat.send', { text: `round ${round}` });
    }
    await wait(100);
  }
  for (let i = 0; i < 250 && !people.every((p) => p.answered === p.sent); i++) await wait(20);
  expect(people.map((p) => p.answered)).toEqual(people.map((p) => p.sent));
  expect(people.every((p) => p.closed === 0)).toBe(true);
  expect(steps).toBeGreaterThan(50);
  expect(spent / steps).toBeLessThan(10); // a match has 50 ms for each step
  await Promise.all(people.map((p) => p.room.leave()));
}, 60_000);
