/**
 * Phase 6, part F: lost connections. The place is kept, a bot goes on without
 * anybody noticing, the player gets everything back, and a match that nobody
 * can decide any more ends.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { matchMaker } from '@colyseus/core';
import type { Room } from 'colyseus.js';
import { HACKERS_GONE, HACKER_GONE, HOLD_MS, PARTY_ROOM_NAME, ROOM_NAME, SOLO_ROOM_NAME, type MissionBriefing, type OnboardingCard, type PartyView } from '@insider/shared';
import { createGameServer } from '../src/app';
import type { OfficeGame } from '../src/game';
import { Party } from '../src/party';
import { PW, Recorder, clone, scenario, tiledMap } from './helpers';

const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small', dev: false };
/** Sara and Rami sit in Finance, Lina in HR, Omar in Marketing, Maha at the reception. */
const CAST: Record<string, string> = { s: 'p1', r: 'p2', l: 'p3', o: 'p4', m: 'p9' };
const FAST = { discussionMs: 2000, votingMs: 2000, resultMs: 500, cooldownMs: 0, usesPerPlayer: 3 };

/** A lobby's match. Omar is the hacker, unless said otherwise. */
function match(options: ConstructorParameters<typeof Recorder>[0] = {}, who = Object.keys(CAST)): Recorder {
  const r = new Recorder({ ...base, assigned: true, hackers: ['p4'], meetingTimes: FAST, seed: 3, ...options, botOptions: { hacker: true, ...options.botOptions } });
  for (const c of who) r.game.seat(c, CAST[c]);
  r.game.everybodyIsIn();
  r.flush();
  return r;
}
const people = (r: Recorder) => r.game.publicState().players;
const drop = (r: Recorder, c: string) => { r.game.connectionLost(c); r.flush(); };
const standIn = (r: Recorder, c: string) => { r.game.standIn(c); r.flush(); };
const back = (r: Recorder, c: string) => { r.game.connectionBack(c); r.flush(); };
const leave = (r: Recorder, c: string) => { r.game.disconnect(c); r.flush(); };
const over = (r: Recorder, c: string) => r.last(c, 'match.over')?.payload as { winner: string; reason: string } | undefined;
function out(r: Recorder, id: string): void {
  (r.game as unknown as { takeOut(id: string, reason: string): void }).takeOut(id, 'You were voted out at the meeting.');
  r.flush();
}
/** What the browser was sent since it came back. */
function since(r: Recorder, c: string, from: number): string[] {
  return r.messages(c).slice(from).map((m) => m.type);
}

describe('the first minute: the place is kept', () => {
  it('the body stops and stays, and nobody is told anything', () => {
    const r = match({ bots: true });
    r.send('s', 'move', { dx: 1, dy: 0 });
    const others = ['r', 'l', 'o', 'm'];
    const told = others.map((c) => r.messages(c).length);
    drop(r, 's');
    const at = people(r).p1;
    expect(others.map((c) => r.messages(c).length)).toEqual(told);
    r.tick(40);
    expect(people(r).p1).toMatchObject({ x: at.x, y: at.y });
    expect(r.game.bots!.has('p1')).toBe(false);
  });

  it('back within the minute: same body, same PC with the screen as it is now, own tasks and card', () => {
    const r = match();
    r.sitAt('s', 'p1', 'FIN-LT-07');
    r.type('s', PW['s.alharbi']);
    r.type('s', 'echo before');
    drop(r, 's');
    r.tick(40);
    const from = r.messages('s').length;
    back(r, 's');
    expect(since(r, 's', from)).toEqual(['lobby', 'welcome', 'board', 'meeting', 'tasks', 'term.open']);
    expect(r.last('s', 'welcome')!.payload).toMatchObject({ playerId: 'p1', back: true, mission: null, card: { username: 's.alharbi' } });
    expect(r.screen('s')).toMatchObject({ screen: 'shell', prompt: 's.alharbi@FIN-LT-07:~$ ' });
    expect(r.type('s', 'echo after')).toContain('after');
    expect(people(r).p1.seatedAt).toBe('FIN-LT-07');
  });

  it('the first welcome of a match has no "back"', () => {
    const r = match();
    expect(Object.keys(r.messages('s', 'welcome')[0].payload as object).sort()).toEqual(['card', 'mission', 'playerId']);
  });

  it('a meeting meanwhile: they are brought to the table, and find it when they are back', () => {
    const r = match();
    r.sitAt('s', 'p1', 'FIN-LT-07');
    drop(r, 's');
    const b = r.map.furniture.find((f) => f.kind === 'button')!;
    expect(r.walkTo('m', 'p9', b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
    r.send('m', 'meeting.call');
    const from = r.messages('s').length;
    back(r, 's');
    expect(since(r, 's', from)).toEqual(['lobby', 'welcome', 'board', 'meeting', 'tasks']); // stood up: no screen
    expect(r.last('s', 'meeting')!.payload).toMatchObject({ active: true });
    r.send('s', 'chat.send', { text: 'I am back' });
    expect(r.last('m', 'chat')!.payload).toMatchObject({ channel: 'meeting', text: 'I am back' });
  });

  it('a USB stick being held is let go', () => {
    const r = match();
    const desk = r.map.desks.find((d) => d.hostname === 'HR-LT-05')!;
    expect(r.walkTo('o', 'p4', desk.seatX, desk.seatY)).toBe(true);
    r.send('o', 'item.start', { item: 'usb', hostname: 'HR-LT-05' });
    expect(people(r).p4.activity).toBe('at-pc');
    drop(r, 'o');
    expect(people(r).p4.activity).toBe('');
    r.tick(200);
    expect(r.game.world.events.some((e) => e.type.startsWith('usb'))).toBe(false);
  });
});

describe('after the minute: a bot goes on', () => {
  it('from the same spot: nobody leaves, nobody arrives, and it looks as before', () => {
    const r = match({ bots: true });
    r.walkTo('s', 'p1', people(r).p1.x + 60, people(r).p1.y + 40);
    const at = people(r).p1;
    const badges = () => r.game.world.events.filter((e) => e.type.startsWith('badge') || e.type.startsWith('door')).length;
    const before = badges();
    const told = ['r', 'l', 'm'].map((c) => r.messages(c).length);
    drop(r, 's');
    standIn(r, 's');
    expect(people(r).p1).toEqual(at);
    expect(Object.keys(people(r))).toHaveLength(scenario.players.length);
    expect(badges()).toBe(before);
    expect(['r', 'l', 'm'].map((c) => r.messages(c).length)).toEqual(told);
    expect(r.game.bots!.has('p1')).toBe(true);
    // It lives on: sooner or later it goes somewhere.
    r.tick(3000);
    expect(r.game.over).toBeNull();
    expect(r.game.bots!.list().find((b) => b.playerId === 'p1')!.present).toBe(true);
    // Nothing is sent to the browser that is not there.
    expect(r.messages('s', 'term.output')).toEqual([]);
  });

  it('leaving with the button looks exactly the same', () => {
    const r = match({ bots: true });
    const at = people(r).p1;
    const told = ['r', 'l', 'm'].map((c) => r.messages(c).length);
    leave(r, 's');
    expect(people(r).p1).toEqual(at);
    expect(['r', 'l', 'm'].map((c) => r.messages(c).length)).toEqual(told);
    expect(r.game.bots!.has('p1')).toBe(true);
  });

  it('the player gets the employee back where the bot is, as often as needed', () => {
    const r = match({ bots: true });
    for (let n = 0; n < 3; n++) {
      drop(r, 's');
      standIn(r, 's');
      r.send('s', 'move', { dx: 1, dy: 0 }); // a browser that is not there
      r.tick(1500);
      const at = people(r).p1;
      const from = r.messages('s').length;
      back(r, 's');
      expect(since(r, 's', from).slice(0, 5)).toEqual(['lobby', 'welcome', 'board', 'meeting', 'tasks']);
      expect(people(r).p1).toMatchObject({ x: at.x, y: at.y, seatedAt: '' });
      expect(r.game.bots!.has('p1')).toBe(false);
      expect(Object.keys(people(r))).toHaveLength(scenario.players.length);
      r.sitAt('s', 'p1', 'FIN-LT-07');
      expect(r.last('s', 'term.open')).toBeDefined();
      r.send('s', 'stand');
    }
  });

  it('a hacker’s bot is a hacker too, and the returning player has the briefing', () => {
    const r = match({ bots: true, hackers: ['p4', 'p3'] });
    drop(r, 'o');
    standIn(r, 'o');
    expect(r.game.world.mission.hackers).toEqual(['p4', 'p3']);
    r.send('l', 'chat.send', { text: 'are you there?', channel: 'hackers' });
    expect(JSON.stringify(r.messages('o', 'chat'))).not.toContain('are you there');
    back(r, 'o');
    const mission = (r.last('o', 'welcome')!.payload as { mission: MissionBriefing }).mission;
    expect(mission.partners.map((p) => p.id)).toEqual(['p3']);
    r.send('l', 'chat.send', { text: 'good', channel: 'hackers' });
    expect(r.last('o', 'chat')!.payload).toMatchObject({ channel: 'hackers', text: 'good' });
  });

  it('a new password is on the card of the player who returns', () => {
    const r = match({ bots: true });
    drop(r, 's');
    standIn(r, 's');
    r.game.world.credentials['s.alharbi'].password = 'NewOne-42';
    back(r, 's');
    expect((r.last('s', 'welcome')!.payload as { card: OnboardingCard }).card.password).toBe('NewOne-42');
  });

  it('without bots the employee goes home, and comes to work again', () => {
    const r = match();
    drop(r, 's');
    standIn(r, 's');
    expect(people(r).p1).toBeUndefined();
    r.tick(20);
    back(r, 's');
    const spawn = r.map.spawns['FIN-LT-07'];
    expect(people(r).p1).toMatchObject({ x: spawn.x, y: spawn.y });
    expect(r.game.over).toBeNull();
  });

  it('voted out while a bot played: the player returns as a watcher, and the place stays empty', () => {
    const r = match({ bots: true });
    drop(r, 's');
    standIn(r, 's');
    out(r, 'p1');
    expect(people(r).p1).toBeUndefined();
    back(r, 's');
    expect(r.last('s', 'fired')!.payload).toEqual({ reason: 'You were voted out or detained while you were away.' });
    expect(people(r).p1).toBeUndefined();
    r.send('s', 'move', { dx: 1, dy: 0 });
    r.send('s', 'chat.send', { text: 'hello' });
    expect(r.last('s', 'chat')!.payload).toMatchObject({ channel: 'fired' });
  });

  it('a watcher who is lost and returns still watches; nothing changes for the others', () => {
    const r = match({ bots: true });
    out(r, 'p1');
    const before = JSON.stringify(people(r));
    drop(r, 's');
    standIn(r, 's');
    expect(JSON.stringify(people(r))).toBe(before);
    back(r, 's');
    expect(r.last('s', 'fired')!.payload).toEqual({ reason: 'You were voted out at the meeting.' });
    expect(since(r, 's', 0)).not.toContain('term.open');
    expect(JSON.stringify(people(r))).toBe(before);
  });

  it('the match ended meanwhile: the end and the debrief are there', () => {
    for (const covered of [false, true]) {
      const r = match({ bots: true });
      drop(r, 's');
      if (covered) standIn(r, 's');
      (r.game as unknown as { endMatch(w: string, why: string): void }).endMatch('defenders', 'Test.');
      r.flush();
      const from = r.messages('s').length;
      back(r, 's');
      expect(since(r, 's', from).slice(-2)).toEqual(['match.over', 'debrief']);
      expect(over(r, 's')).toMatchObject({ winner: 'defenders', reason: 'Test.' });
    }
  });
});

describe('a match nobody can decide any more ends (the owner’s rules)', () => {
  it('without bots: the hacker is gone, the defenders win', () => {
    for (const how of ['leave', 'lost'] as const) {
      const r = match();
      if (how === 'leave') leave(r, 'o');
      else {
        drop(r, 'o');
        r.tick(20);
        expect(r.game.over).toBeNull(); // the minute is not over
        standIn(r, 'o');
      }
      expect(over(r, 's')).toMatchObject({ winner: 'defenders', reason: HACKER_GONE });
    }
  });

  it('without bots, two hackers: only when both are gone; a caught one does not count', () => {
    const r = match({ hackers: ['p4', 'p3'] });
    leave(r, 'o');
    expect(r.game.over).toBeNull();
    leave(r, 'l');
    expect(over(r, 's')).toMatchObject({ winner: 'defenders', reason: HACKERS_GONE });
    const c = match({ hackers: ['p4', 'p3'] });
    c.game.world.mission.caught.push('p4');
    out(c, 'p4');
    leave(c, 'l');
    expect(over(c, 's')).toMatchObject({ winner: 'defenders', reason: HACKERS_GONE });
  });

  it('without bots: who is gone counts no longer as a defender, and counts again when back', () => {
    const r = match({}, ['s', 'r', 'l', 'o']);
    leave(r, 'l');
    expect(r.game.over).toBeNull(); // two defenders against one hacker
    drop(r, 'r');
    standIn(r, 'r');
    expect(over(r, 's')).toMatchObject({ winner: 'hacker' });
    expect(over(r, 's')!.reason).toContain('Only 1 defender is left');
    const q = match({}, ['s', 'r', 'l', 'o']);
    drop(q, 'l');
    standIn(q, 'l');
    back(q, 'l');
    leave(q, 'r');
    expect(q.game.over).toBeNull();
    leave(q, 's');
    expect(over(q, 'l')).toMatchObject({ winner: 'hacker' });
  });

  it('with bots: the last person who could find the hacker is out or gone, the hacker wins', () => {
    // A computer hacker against two people: one is voted out, the other leaves.
    const r = match({ bots: true, hackers: ['p3'] }, ['s', 'r']);
    out(r, 'p1');
    (r.game as unknown as { checkHackerWins(): void }).checkHackerWins();
    expect(r.game.over).toBeNull();
    drop(r, 'r');
    r.tick(20);
    expect(r.game.over).toBeNull();
    standIn(r, 'r');
    expect(over(r, 's')).toMatchObject({ winner: 'hacker' }); // Sara watched to the end
    expect(over(r, 's')!.reason).toContain('Nobody is left who could find the hacker');
    // A person as the hacker against one person.
    const q = match({ bots: true }, ['s', 'r', 'o']);
    leave(q, 's');
    expect(q.game.over).toBeNull();
    leave(q, 'o'); // the hacker's bot goes on: Rami can still find it
    expect(q.game.over).toBeNull();
    leave(q, 'r');
    expect(q.game.over?.winner).toBe('hacker');
  });

  it('the shared office has none of these rules', () => {
    const r = new Recorder({ bots: true });
    r.connect('a', 'p1');
    r.game.world.mission.hackers = ['p4'];
    r.game.disconnect('a');
    r.tick(20);
    expect(r.game.over).toBeNull();
    expect(people(r).p1).toBeUndefined(); // they go home, as before
  });
});

describe('the lobby', () => {
  const make = () => {
    const p = new Party('BCDFG', 6);
    for (const w of ['a', 'b', 'c']) p.join(w, w);
    return p;
  };
  it('the host role moves on at once and does not come back', () => {
    const p = make();
    p.lose('a');
    expect(p.isHost('b')).toBe(true);
    p.returned('a');
    expect(p.isHost('b')).toBe(true);
    p.lose('b');
    expect(p.isHost('a')).toBe(true);
    for (const x of ['a', 'c']) p.lose(x);
    p.returned('c'); // nobody else is connected
    expect(p.isHost('c')).toBe(true);
  });

  it('a lost member is shown, is not ready, and the start waits; during a match nothing is shown', () => {
    const p = make();
    for (const w of ['b', 'c']) p.setReady(w, true);
    p.lose('b');
    expect(p.notYet()).toBe('b lost the connection. Their place is kept for a minute.');
    expect(p.view('a').members.map((m) => [m.lost, m.ready])).toEqual([[false, false], [true, false], [false, true]]);
    p.returned('b');
    expect(p.notYet()).toBe('Waiting for b to be ready.');
    p.setReady('b', true);
    p.begin(1);
    p.lose('b');
    expect(p.view('a').members.some((m) => m.lost)).toBe(false);
    p.end([]);
    expect(p.view('a').members.map((m) => m.lost)).toEqual([false, true, false]);
  });
});

describe('over the network', () => {
  const PORT = 2596;
  let server: ReturnType<typeof createGameServer>;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const client = async () => new (await import('colyseus.js')).Client(`ws://localhost:${PORT}`);
  const game = (roomId: string) => (matchMaker.getLocalRoomById(roomId) as unknown as { game: OfficeGame | null }).game;
  const exists = (roomId: string) => matchMaker.getLocalRoomById(roomId) !== undefined;
  async function eventually(what: () => boolean): Promise<void> {
    for (let i = 0; i < 150 && !what(); i++) await wait(20);
    expect(what()).toBe(true);
  }
  /** Time passes for the server's clock of lost connections. */
  const later = (ms: number) => {
    const real = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => real.call(Date) + ms);
  };
  afterEach(() => void vi.restoreAllMocks());

  function watch(room: Room) {
    const messages: { type: string; payload: unknown }[] = [];
    room.onMessage('*', (type, payload) => void messages.push({ type: String(type), payload }));
    const last = (type: string) => messages.filter((m) => m.type === type).at(-1)?.payload;
    return { room, messages, last, party: () => last('party') as PartyView };
  }
  type Browser = ReturnType<typeof watch>;
  const join = async (code: string | null, name: string) => watch(code ? await (await client()).joinById(code, { name }) : await (await client()).create(PARTY_ROOM_NAME, { name }));
  /** The line breaks (no goodbye). */
  const cut = async (b: Browser) => {
    const token = b.room.reconnectionToken;
    void b.room.leave(false);
    await wait(150); // until the server has noticed
    return token;
  };
  const comeBack = async (token: string) => watch(await (await client()).reconnect(token));
  async function started(...names: string[]): Promise<Browser[]> {
    const host = await join(null, names[0]);
    const all = [host];
    for (const name of names.slice(1)) all.push(await join(host.room.roomId, name));
    host.room.send('party.settings', { hacker: 'bot' });
    for (const b of all.slice(1)) b.room.send('party.ready', { ready: true });
    await eventually(() => host.party()?.notYet === '');
    host.room.send('party.start', {});
    await eventually(() => all.every((b) => b.last('tasks') !== undefined));
    return all;
  }

  beforeAll(async () => {
    server = createGameServer({ dev: false });
    await server.listen(PORT);
  });
  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });

  it('a match: the place is kept, a bot covers, the player returns with the same employee, and another time', async () => {
    const [a, b] = await started('Anna', 'Ben');
    const code = a.room.roomId;
    const mine = (b.last('welcome') as { playerId: string }).playerId;
    const token = await cut(b);
    await wait(300);
    const told = a.messages.filter((m) => m.type === 'party').length;
    expect(game(code)!.bots!.has(mine)).toBe(false);
    expect(a.party().members.some((m) => m.lost)).toBe(false); // nobody is told during a match
    later(HOLD_MS + 1000);
    await eventually(() => game(code)!.bots!.has(mine));
    vi.restoreAllMocks();
    expect(a.messages.filter((m) => m.type === 'party')).toHaveLength(told);
    // A locked room with a match in it still takes its own player back.
    const again = await comeBack(token);
    await eventually(() => again.last('tasks') !== undefined);
    expect(again.messages.map((m) => m.type).slice(0, 3)).toEqual(['party', 'lobby', 'welcome']);
    expect(again.last('welcome')).toMatchObject({ playerId: mine, back: true });
    expect(game(code)!.bots!.has(mine)).toBe(false);
    expect((again.room.state as { players: Map<string, unknown> }).players.get(mine)).toBeDefined();
    // The old token is worth nothing now, also while somebody holds the new one.
    await expect(comeBack(token)).rejects.toThrow();
    await expect(comeBack(again.room.reconnectionToken)).rejects.toThrow();
    const third = await comeBack(await cut(again));
    await eventually(() => third.last('welcome') !== undefined);
    expect(third.last('welcome')).toMatchObject({ playerId: mine });
    await a.room.leave();
    await third.room.leave();
    await eventually(() => !exists(code));
  }, 20_000);

  it('leaving with the button gives the place up at once', async () => {
    const [a, b] = await started('Anna', 'Ben');
    const token = b.room.reconnectionToken;
    await b.room.leave();
    await eventually(() => a.party().members.length === 1);
    await expect(comeBack(token)).rejects.toThrow();
    await a.room.leave();
    await eventually(() => !exists(a.room.roomId));
  });

  it('if everybody is lost, the room is gone after a minute, not earlier', async () => {
    const [a, b] = await started('Anna', 'Ben');
    const code = a.room.roomId;
    const token = await cut(a);
    await cut(b);
    await wait(300);
    expect(exists(code)).toBe(true);
    const back = await comeBack(token);
    await eventually(() => back.last('welcome') !== undefined);
    await cut(back);
    await wait(200);
    later(HOLD_MS + 1000);
    await eventually(() => !exists(code));
  }, 20_000);

  it('the match ends while somebody is lost: they may still come to see it; after a minute the lobby does not wait', async () => {
    const [a, b, c] = await started('Anna', 'Ben', 'Cleo');
    const code = a.room.roomId;
    const token = await cut(b);
    await cut(c);
    await wait(200);
    (game(code) as unknown as { endMatch(w: string, r: string): void }).endMatch('defenders', 'Test.');
    await eventually(() => a.party().playing === false);
    expect(a.party().members.map((m) => m.lost)).toEqual([false, true, true]);
    expect(a.party().cast).toHaveLength(3);
    const again = await comeBack(token);
    await eventually(() => again.last('debrief') !== undefined);
    expect(again.party().cast).toHaveLength(3);
    a.room.send('party.back', {});
    again.room.send('party.back', {});
    await eventually(() => a.party().notYet.startsWith('Cleo lost the connection.'));
    later(HOLD_MS + 1000);
    await eventually(() => a.party().members.length === 2);
    expect(a.party().notYet).toBe('Waiting for Ben to be ready.');
    vi.restoreAllMocks();
    await a.room.leave();
    await again.room.leave();
    await eventually(() => !exists(code));
  }, 20_000);

  it('in the lobby: the host role moves on, the place is kept for a minute, and the host can remove who is lost', async () => {
    const a = await join(null, 'Anna');
    const code = a.room.roomId;
    const b = await join(code, 'Ben');
    const c = await join(code, 'Cleo');
    await eventually(() => c.party()?.members.length === 3);
    const token = await cut(a);
    await eventually(() => b.party().hostId === b.party().you);
    expect(b.party().members.map((m) => [m.name, m.lost])).toEqual([['Anna', true], ['Ben', false], ['Cleo', false]]);
    const back = await comeBack(token);
    await eventually(() => b.party().members.every((m) => !m.lost));
    await eventually(() => back.party() !== undefined);
    expect(back.party().you).toBe(b.party().members[0].id);
    expect(back.party().hostId).toBe(b.party().you);
    // Removed while lost: the token is worth nothing.
    const lost = await cut(c);
    await eventually(() => b.party().members.some((m) => m.lost));
    b.room.send('party.remove', { id: b.party().members.find((m) => m.lost)!.id });
    await eventually(() => b.party().members.length === 2);
    await expect(comeBack(lost)).rejects.toThrow();
    // And who was removed while connected cannot use theirs either.
    const anna = back.room.reconnectionToken;
    b.room.send('party.remove', { id: b.party().members[0].id });
    await eventually(() => b.party().members.length === 1);
    await expect(comeBack(anna)).rejects.toThrow();
    await b.room.leave();
    await eventually(() => !exists(code));
  }, 20_000);

  it('a solo match survives a reload; the shared office keeps no place', async () => {
    const solo = watch(await (await client()).create(SOLO_ROOM_NAME, { mode: 'investigation', role: 'soc', difficulty: 'easy' }));
    await eventually(() => solo.last('welcome') !== undefined);
    const world = game(solo.room.roomId)!.world;
    const again = await comeBack(await cut(solo));
    await eventually(() => again.last('welcome') !== undefined);
    expect(again.last('welcome')).toMatchObject({ back: true });
    expect(game(again.room.roomId)!.world).toBe(world);
    await cut(again);
    await wait(200);
    later(HOLD_MS + 1000);
    await eventually(() => !exists(again.room.roomId));
    vi.restoreAllMocks();
    const office = watch(await (await client()).joinOrCreate(ROOM_NAME));
    await expect(comeBack(await cut(office))).rejects.toThrow();
  }, 20_000);

  it('nobody can come back with an invented token', async () => {
    const [a, b] = await started('Anna', 'Ben');
    await cut(b);
    await wait(200);
    for (const bad of ['x', '', 'toString', '__proto__', 'constructor']) await expect((await client()).reconnect(`${a.room.roomId}:${bad}`)).rejects.toThrow();
    await a.room.leave();
    await eventually(() => a.messages.length > 0);
  });
});
