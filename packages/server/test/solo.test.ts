/**
 * Phase 5a, part A: solo matches. What a browser may ask for, what it gets,
 * and that every match is private and new.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import { ROOM_NAME, SOLO_MEETINGS, SOLO_ROOM_NAME, parseSoloChoice, type SoloChoice } from '@insider/shared';
import { createGameServer } from '../src/app';
import type { OfficeGame } from '../src/game';
import { soloGameOptions } from '../src/solo';
import { Recorder, clone, scenario, tiledMap } from './helpers';

const CHOICE: SoloChoice = { mode: 'investigation', role: 'soc', difficulty: 'normal' };
const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small' };

/** A solo match as the room creates it. */
const solo = (choice: Partial<SoloChoice> = {}, seed = 1): Recorder => new Recorder(soloGameOptions(base, { ...CHOICE, ...choice }, seed));

describe('what a browser may ask for', () => {
  it('only a known mode, role and difficulty; everything else is dropped', () => {
    expect(parseSoloChoice(CHOICE)).toEqual(CHOICE);
    expect(parseSoloChoice({ ...CHOICE, dev: true, seed: 1, bots: false, weaknesses: [], soloPlayer: 'p4' })).toEqual(CHOICE);
    for (const bad of [null, undefined, 'investigation', 7, [], {}, { ...CHOICE, mode: 'office' }, { ...CHOICE, mode: 'infiltration' }, { ...CHOICE, role: 'hacker' }, // (Infiltration as the SOC analyst)
      { ...CHOICE, role: ['soc'] }, { ...CHOICE, difficulty: 'impossible' }, { ...CHOICE, difficulty: undefined }, { ...CHOICE, mode: 'toString' }]) {
      expect(parseSoloChoice(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('a solo match', () => {
  it('puts the player in the office as the chosen role, without a start screen', () => {
    for (const role of ['employee', 'soc', 'guard', 'sysadmin', 'helpdesk'] as const) {
      const r = solo({ role });
      r.connect('me');
      const welcome = r.messages('me', 'welcome');
      expect(welcome, role).toHaveLength(1);
      const { playerId, mission } = welcome[0].payload as { playerId: string; mission: unknown };
      expect(scenario.players.find((p) => p.id === playerId)!.role ?? 'employee').toBe(role);
      expect(mission).toBeNull();
      expect(r.position(playerId)).toBeDefined();
    }
  });

  it('is against a hacker who is never the player', () => {
    const hackers = new Set<string>();
    const players = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const r = solo({ role: 'employee' }, seed);
      r.connect('me');
      const { playerId } = r.last('me', 'welcome')!.payload as { playerId: string };
      const hacker = r.game.world.mission.hackers[0];
      expect(hacker).not.toBeNull();
      expect(hacker, `seed ${seed}`).not.toBe(playerId);
      expect(r.game.bots!.has(hacker!)).toBe(true);
      hackers.add(hacker!);
      players.add(playerId);
    }
    const employees = scenario.players.filter((p) => (p.role ?? 'employee') === 'employee').length;
    expect(hackers.size).toBe(employees); // anybody can be it...
    expect(players.size).toBe(employees); // ...and "employee" is not always the same person
  });

  it('choosing somebody else, or the hacker role, does nothing', () => {
    const r = solo();
    r.connect('me');
    const hacker = r.game.world.mission.hackers[0];
    const before = r.messages('me').length;
    r.send('me', 'choose', { playerId: 'p4', hacker: true });
    r.send('me', 'choose', { playerId: hacker });
    expect(r.messages('me').length).toBe(before);
    expect(r.game.world.mission.hackers[0]).toBe(hacker);
    expect(Object.keys(r.game.publicState().players)).toEqual(['p11']);
    // Nor for a connection without a body (there is none in a real solo room).
    r.connect('other');
    r.send('other', 'choose', { playerId: 'p4', hacker: true });
    expect(r.messages('other', 'welcome')).toEqual([]);
  });

  it('has the chosen difficulty, its bots and hacker whatever the office is set to, and two meetings', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const r = new Recorder(soloGameOptions({ ...base, bots: false, botOptions: { hacker: false } }, { ...CHOICE, difficulty }, 3));
      expect(r.game.bots!.hackerDifficulty).toBe(difficulty);
      expect(r.game.world.mission.hackers).toHaveLength(1);
      r.connect('me');
      expect(r.last('me', 'meeting')!.payload).toMatchObject({ usesLeft: SOLO_MEETINGS });
    }
    expect(SOLO_MEETINGS).toBe(2);
  });

  it('starting and playing one changes nothing in the content other matches use', () => {
    const content = JSON.stringify(base);
    const r = new Recorder({ ...soloGameOptions(base, CHOICE, 5), scenario: base.scenario, map: base.map });
    r.connect('me');
    for (let i = 0; i < 3000; i++) r.game.tick(100);
    expect(JSON.stringify(base)).toBe(content);
  });

  it('a role nobody has stops the match from being created', () => {
    const small = clone(scenario);
    small.players = small.players.filter((p) => p.role !== 'guard');
    expect(() => soloGameOptions({ ...base, scenario: small }, { ...CHOICE, role: 'guard' }, 1)).toThrow('role "guard"');
  });
});

describe('over the network', () => {
  const PORT = 2598;
  const LIMIT = 3;
  let server: ReturnType<typeof createGameServer>;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const client = async () => new (await import('colyseus.js')).Client(`ws://localhost:${PORT}`);
  const game = (roomId: string) => (matchMaker.getLocalRoomById(roomId) as unknown as { game: OfficeGame }).game;

  beforeAll(async () => {
    server = createGameServer({ dev: false, bots: false, soloLimit: LIMIT });
    await server.listen(PORT);
  });
  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });

  it('every match is a private room of its own with a new seed; the office settings cannot be changed', async () => {
    const a = await (await client()).create(SOLO_ROOM_NAME, { ...CHOICE, dev: true, seed: 7 });
    const b = await (await client()).create(SOLO_ROOM_NAME, CHOICE);
    a.onMessage('*', () => undefined);
    b.onMessage('*', () => undefined);
    expect(a.roomId).not.toBe(b.roomId);
    expect(game(a.roomId).world.seed).not.toBe(game(b.roomId).world.seed);
    expect(game(a.roomId).world.seed).not.toBe(7);
    expect(game(a.roomId).dev).toBe(false);
    // Nobody can join somebody else's match, not even knowing its id.
    await expect((await client()).joinById(a.roomId)).rejects.toThrow();
    // Joining "any" solo match makes a new one instead of entering theirs.
    const c = await (await client()).joinOrCreate(SOLO_ROOM_NAME, CHOICE);
    c.onMessage('*', () => undefined);
    expect([a.roomId, b.roomId]).not.toContain(c.roomId);
    // Full: a clear answer. One leaves: there is room again.
    await expect((await client()).create(SOLO_ROOM_NAME, CHOICE)).rejects.toThrow('The server is full');
    const left = a.roomId;
    await a.leave();
    for (let i = 0; i < 50 && matchMaker.getLocalRoomById(left); i++) await wait(20);
    expect(matchMaker.getLocalRoomById(left)).toBeUndefined();
    const d = await (await client()).create(SOLO_ROOM_NAME, CHOICE);
    d.onMessage('*', () => undefined);
    for (const room of [b, c, d]) await room.leave();
  });

  it('a match that does not exist is refused, and does not use up a place', async () => {
    for (let i = 0; i < LIMIT + 1; i++) {
      await expect((await client()).create(SOLO_ROOM_NAME, { mode: 'infiltration', role: 'guard', difficulty: 'easy' })).rejects.toThrow('does not exist');
    }
    await expect((await client()).create(SOLO_ROOM_NAME)).rejects.toThrow('does not exist');
    for (const choice of [CHOICE, { mode: 'infiltration', role: 'any', difficulty: 'easy' }]) {
      const room = await (await client()).create(SOLO_ROOM_NAME, choice);
      room.onMessage('*', () => undefined);
      expect(game(room.roomId).world.mission.hackers).toHaveLength(1);
      await room.leave();
    }
  });

  it('a finished match in the shared office takes no new players: they get a new one', async () => {
    const first = await (await client()).joinOrCreate(ROOM_NAME);
    first.onMessage('*', () => undefined);
    const same = await (await client()).joinOrCreate(ROOM_NAME);
    same.onMessage('*', () => undefined);
    expect(same.roomId).toBe(first.roomId);
    game(first.roomId).over = { winner: 'hacker', at: 0 };
    await wait(200); // a few server ticks
    const next = await (await client()).joinOrCreate(ROOM_NAME);
    next.onMessage('*', () => undefined);
    expect(next.roomId).not.toBe(first.roomId);
    // Somebody leaving the old one does not open it again.
    await same.leave();
    await wait(100);
    const third = await (await client()).joinOrCreate(ROOM_NAME);
    third.onMessage('*', () => undefined);
    expect(third.roomId).toBe(next.roomId);
    for (const room of [first, next, third]) await room.leave();
  });
});
