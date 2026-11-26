/**
 * Phase 6, part A: lobbies. Who may come in, who decides, when the match
 * starts, and that a lobby is closed to everybody without its code.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import {
  CODE_LENGTH, CODE_LETTERS, DEFAULT_PARTY_SETTINGS, NAME_LENGTH, PARTY_REMOVED, PARTY_ROOM_NAME, ROOM_NAME, changeSettings, cleanName, parseCode,
  type PartyView,
} from '@insider/shared';
import { createGameServer } from '../src/app';
import type { OfficeGame } from '../src/game';
import { Party, newCode, partyGameOptions } from '../src/party';
import { Recorder, clone, scenario, tiledMap } from './helpers';

const names = (p: Party) => p.view('').members.map((m) => m.name);

describe('what a browser may send', () => {
  it('codes: five consonants, however they are typed', () => {
    expect(parseCode('bcdfg')).toBe('BCDFG');
    expect(parseCode(' bc-d fg ')).toBe('BCDFG');
    for (const bad of ['', 'BCDF', 'BCDFGH', 'BCDFA', 'BCDF1', 'BCDF!', null, 5, ['BCDFG'], 'B'.repeat(100)]) expect(parseCode(bad), String(bad)).toBeNull();
    const codes = new Set(Array.from({ length: 2000 }, newCode));
    expect(codes.size).toBeGreaterThan(1990);
    for (const code of codes) expect(parseCode(code)).toBe(code);
    expect(CODE_LETTERS.length ** CODE_LENGTH).toBeGreaterThan(3_000_000);
  });

  it('names: any language, nothing invisible, not too long', () => {
    expect(cleanName('  Sara   Al-Harbi ')).toBe('Sara Al-Harbi');
    expect(cleanName('محمد')).toBe('محمد');
    expect(cleanName("Zoë O'Neil 2.0_x")).toBe("Zoë O'Neil 2.0_x");
    expect(cleanName('a\u202Eb\u200Bc\nd<e>\u0000')).toBe('abcde');
    expect(cleanName('🙂🙂')).toBe('');
    expect(cleanName('e' + '\u0301'.repeat(50)).length).toBeLessThanOrEqual(4);
    expect(cleanName('x'.repeat(10_000))).toBe('x'.repeat(NAME_LENGTH));
    for (const bad of [null, undefined, 5, {}, ['Sam'], '   ', '\u200B']) expect(cleanName(bad)).toBe('');
  });

  it('settings: only known fields with valid values', () => {
    const d = DEFAULT_PARTY_SETTINGS;
    expect(changeSettings(d, { difficulty: 'hard' })).toEqual({ ...d, difficulty: 'hard' });
    expect(changeSettings(d, { bots: false, hacker: 'human', meetings: 'long', dev: true, seed: 4, weaknesses: [], hackerId: 'p1', hackers: 7 })).toEqual({ ...d, bots: false, hacker: 'human', meetings: 'long' });
    for (const bad of [null, 'hard', 7, [], { difficulty: 'impossible', meetings: 5, bots: 'no' }, { meetings: 'toString' }, { hacker: 'p4' }, { hackers: -1 }, { hackers: '2' }, { hackers: 4 }]) expect(changeSettings(d, bad)).toEqual(d);
    expect(d).toEqual({ bots: true, hacker: 'auto', hackers: 0, difficulty: 'normal', meetings: 'normal' });
  });
});

describe('the rules of a lobby', () => {
  const make = (...who: string[]) => {
    const p = new Party('BCDFG', 4);
    for (const w of who) expect(p.join(w, w)).toBe('');
    return p;
  };

  it('the first one is the host; if they go, whoever has been here longest takes over', () => {
    const p = make('a', 'b', 'c');
    expect(p.isHost('a')).toBe(true);
    p.leave('a');
    expect(p.isHost('b')).toBe(true);
    p.join('a', 'a'); // coming back does not make them the host again
    expect(p.isHost('b')).toBe(true);
    for (const x of ['b', 'c', 'a']) p.leave(x);
    expect(p.clients()).toEqual([]);
    p.join('d', 'd');
    expect(p.isHost('d')).toBe(true);
    expect(p.isHost('')).toBe(false);
  });

  it('nobody has the same name as somebody else, and everybody has one', () => {
    const p = make();
    for (const [id, name] of [['1', 'Sam'], ['2', 'sam'], ['3', 'SAM'], ['4', '\u200B']]) p.join(id, name);
    expect(names(p)).toEqual(['Sam', 'sam 2', 'SAM 3', 'Player']);
  });

  it('a member number is never used twice, so a late "remove" cannot hit the wrong person', () => {
    const p = make('a', 'b');
    const old = p.view('b').you;
    p.leave('b');
    p.join('c', 'c');
    expect(p.view('c').you).not.toBe(old);
    expect(p.clientOf(old)).toBe('');
  });

  it('starts only with two people, and everybody but the host ready', () => {
    const p = make('a');
    expect(p.notYet()).toContain('At least 2');
    p.join('b', 'b');
    p.join('c', 'c');
    expect(p.notYet()).toBe('Waiting for b, c to be ready.');
    p.setReady('b', true);
    p.setReady('c', 'yes');
    expect(p.notYet()).toBe('Waiting for c to be ready.');
    p.setReady('c', true);
    expect(p.notYet()).toBe('');
    p.setReady('b', false);
    expect(p.notYet()).toContain('b');
    p.leave('b');
    expect(p.notYet()).toBe('');
    p.playing = true;
    expect(p.notYet()).not.toBe('');
  });

  it('is closed when the host says so, when it is full, and when the match runs', () => {
    const p = make('a', 'b', 'c', 'd');
    expect(p.join('e', 'e')).toBe('This lobby is full.');
    p.leave('d');
    p.open = false;
    expect(p.join('e', 'e')).toBe('The host has closed this lobby.');
    p.open = true;
    p.playing = true;
    expect(p.join('e', 'e')).toBe('This match has already started.');
    expect(p.clients()).toEqual(['a', 'b', 'c']);
  });

  it('after a match everybody comes back when they like, and the next one waits for them', () => {
    const p = make('a', 'b', 'c');
    for (const x of ['b', 'c']) p.setReady(x, true);
    p.begin(1);
    expect(p.view('a')).toMatchObject({ playing: true, cast: [] });
    p.back('a'); // (a room does not pass this on during a match)
    const cast = [{ name: 'a', employee: 'Sara', hacker: true }];
    p.end(cast);
    expect(p.view('b')).toMatchObject({ playing: false, cast, notYet: 'Waiting for b, c to come back from the last match.' });
    p.setReady('b', true); // not from the debrief
    p.back('b');
    expect(p.view('b').members.map((m) => [m.name, m.away, m.ready])).toEqual([['a', false, false], ['b', false, false], ['c', true, false]]);
    p.leave('c');
    expect(p.notYet()).toBe('Waiting for b to be ready.');
    p.setReady('b', true);
    expect(p.notYet()).toBe('');
    // New people may come in again, and the next match hides the old cast.
    expect(p.join('d', 'd')).toBe('');
    p.begin(1);
    expect(p.view('a').cast).toEqual([]);
    expect(p.join('e', 'e')).not.toBe('');
  });

  it('what a member sees has no network ids', () => {
    const p = make('net-id-one', 'net-id-two');
    p.leave('net-id-two');
    p.join('net-id-two', 'Two');
    p.leave('net-id-one');
    p.join('net-id-one', 'One');
    expect(JSON.stringify(p.view('net-id-one'))).not.toContain('net-id');
  });
});

describe('the match of a lobby', () => {
  const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small', dev: false, weaknesses: ['tailgate' as const], meetingTimes: { resultMs: 1000 } };
  const draw = { hackers: ['p4'], human: false };

  it('has what the host chose; the rest is the operator’s', () => {
    const o = partyGameOptions(base, { bots: false, hacker: 'auto', hackers: 0, difficulty: 'hard', meetings: 'long', office: 'auto' }, 9, draw);
    expect(o).toMatchObject({ seed: 9, bots: false, dev: false, weaknesses: ['tailgate'], botOptions: { hackerDifficulty: 'hard' }, meetingTimes: { discussionMs: 150_000, votingMs: 60_000, resultMs: 1000 } });
    expect(o.soloPlayer).toBeUndefined();
    expect(partyGameOptions(base, DEFAULT_PARTY_SETTINGS, 9, draw).meetingTimes).toEqual({ resultMs: 1000, votesNeeded: 2 });
    const short = new Recorder({ ...partyGameOptions(base, { bots: true, hacker: 'auto', hackers: 0, difficulty: 'easy', meetings: 'short', office: 'auto' }, 9, draw) });
    expect(short.game.bots).not.toBeNull();
    expect(base.meetingTimes).toEqual({ resultMs: 1000 });
  });
});

describe('over the network', () => {
  const PORT = 2597;
  const LIMIT = 3;
  let server: ReturnType<typeof createGameServer>;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const client = async () => new (await import('colyseus.js')).Client(`ws://localhost:${PORT}`);
  const game = (roomId: string) => (matchMaker.getLocalRoomById(roomId) as unknown as { game: OfficeGame | null }).game;

  /** A connected browser that remembers everything it was sent. */
  async function browser(code: string | null, name = 'Sam', extra: object = {}) {
    const c = await client();
    const options = { name, ...extra };
    const room = code ? await c.joinById(code, options) : await c.create(PARTY_ROOM_NAME, options);
    const messages: { type: string; payload: unknown }[] = [];
    let closed = 0;
    room.onMessage('*', (type, payload) => void messages.push({ type: String(type), payload }));
    room.onLeave((c2) => { closed = c2; });
    const party = () => messages.filter((m) => m.type === 'party').at(-1)?.payload as PartyView;
    /** Waits until what this browser was last told about the lobby fits. */
    const until = async (what: (p: PartyView) => boolean) => {
      for (let i = 0; i < 100 && !(party() && what(party())); i++) await wait(20);
      expect(what(party()), JSON.stringify(party())).toBe(true);
    };
    return { room, messages, party, until, closed: () => closed, leave: () => room.leave(), send: (t: string, p: unknown) => room.send(t, p) };
  }
  type Browser = Awaited<ReturnType<typeof browser>>;
  const gone = async (code: string) => {
    for (let i = 0; i < 100 && matchMaker.getLocalRoomById(code); i++) await wait(20);
    expect(matchMaker.getLocalRoomById(code)).toBeUndefined();
  };
  const leaveAll = async (...all: Browser[]) => {
    for (const b of all) await b.leave();
    await gone(all[0].room.roomId);
  };

  beforeAll(async () => {
    server = createGameServer({ dev: false, lobbyLimit: LIMIT });
    await server.listen(PORT);
  });
  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });

  it('friends gather with a code, and the host starts the match when everybody is ready', async () => {
    const a = await browser(null, 'Anna', { dev: true, seed: 7, bots: false });
    await a.until((p) => p.members.length === 1);
    const code = a.room.roomId;
    expect(parseCode(code)).toBe(code);
    expect(a.party()).toMatchObject({ code, hostId: a.party().you, size: scenario.players.length, open: true, playing: false, settings: DEFAULT_PARTY_SETTINGS });
    const b = await browser(code, 'Ben');
    await a.until((p) => p.members.length === 2);
    await b.until((p) => p.members.length === 2);
    expect(b.party().you).not.toBe(b.party().hostId);
    // There is no match yet: nothing of it can be done or seen.
    expect(game(code)).toBeNull();
    a.send('choose', { playerId: 'p4', hacker: true });
    b.send('term.line', { text: 'ls' });
    // Only the host decides, and only when everybody is ready.
    b.send('party.settings', { difficulty: 'hard' });
    b.send('party.open', { open: false });
    b.send('party.remove', { id: a.party().you });
    b.send('party.start', {});
    a.send('party.start', {});
    a.send('party.settings', { meetings: 'short', dev: true });
    await b.until((p) => p.settings.meetings === 'short');
    expect(b.party()).toMatchObject({ settings: { difficulty: 'normal', bots: true }, open: true, playing: false, notYet: 'Waiting for Ben to be ready.' });
    expect(b.party().members).toHaveLength(2);
    b.send('party.ready', { ready: true });
    await a.until((p) => p.notYet === '');
    expect(game(code)).toBeNull();
    a.send('party.start', {});
    await b.until((p) => p.playing);
    const match = game(code)!;
    expect(match.dev).toBe(false);
    expect(match.world.seed).not.toBe(7);
    expect(match.bots).not.toBeNull();
    // Both are told their own employee of the same match; choosing another does nothing.
    const parts = new Set<string>();
    for (const who of [a, b]) {
      for (let i = 0; i < 100 && !who.messages.some((m) => m.type === 'welcome'); i++) await wait(20);
      who.send('choose', { playerId: 'p4', hacker: true });
      parts.add((who.messages.find((m) => m.type === 'welcome')!.payload as { playerId: string }).playerId);
      expect(who.messages.filter((m) => m.type === 'welcome')).toHaveLength(1);
    }
    expect(parts.size).toBe(2);
    expect(Object.keys(match.publicState().players)).toHaveLength(scenario.players.length);
    expect(JSON.stringify(b.party())).not.toContain('Sara');
    // Starting again, or changing the lobby, does nothing now.
    a.send('party.start', {});
    a.send('party.settings', { difficulty: 'hard' });
    a.send('party.remove', { id: b.party().you });
    await wait(150);
    expect(game(code)).toBe(match);
    expect(b.closed()).toBe(0);
    // Nobody can come in, even with the code.
    await expect(browser(code, 'Late')).rejects.toThrow('locked');
    // Somebody leaving does not open it, and the host role moves on.
    await a.leave();
    await b.until((p) => p.members.length === 1 && p.hostId === p.you);
    await expect(browser(code, 'Late')).rejects.toThrow('locked');
    await leaveAll(b);
  }, 20_000);

  it('a wrong code finds nothing, and without the code nobody gets in', async () => {
    const a = await browser(null, 'Anna');
    await expect(browser('BBBBB')).rejects.toThrow('not found');
    // "Any lobby" makes a new one; and looking for one to join finds none.
    const other = await (await client()).joinOrCreate(PARTY_ROOM_NAME, { name: 'X' });
    other.onMessage('*', () => undefined);
    expect(other.roomId).not.toBe(a.room.roomId);
    await expect((await client()).join(PARTY_ROOM_NAME)).rejects.toThrow();
    const office = await (await client()).joinOrCreate(ROOM_NAME);
    office.onMessage('*', () => undefined);
    expect(office.roomId).not.toBe(a.room.roomId);
    await office.leave();
    await other.leave();
    await gone(other.roomId);
    await leaveAll(a);
  });

  it('the host can close the lobby, open it again, and remove somebody', async () => {
    const a = await browser(null, 'Anna');
    const b = await browser(a.room.roomId, 'Ben');
    await a.until((p) => p.members.length === 2);
    a.send('party.remove', { id: a.party().you }); // not oneself
    a.send('party.remove', { id: 'nobody' });
    a.send('party.remove', null);
    a.send('party.open', { open: 'no' });
    a.send('party.open', { open: false });
    await b.until((p) => !p.open);
    expect(b.party().members).toHaveLength(2);
    await expect(browser(a.room.roomId, 'Late')).rejects.toThrow('locked');
    a.send('party.remove', { id: b.party().you });
    await a.until((p) => p.members.length === 1);
    for (let i = 0; i < 100 && !b.closed(); i++) await wait(20);
    expect(b.closed()).toBe(PARTY_REMOVED);
    // Closed stays closed when somebody goes: the removed player cannot walk back in.
    await expect(browser(a.room.roomId, 'Ben')).rejects.toThrow('locked');
    a.send('party.open', { open: true });
    await a.until((p) => p.open);
    const c = await browser(a.room.roomId, 'Cleo');
    await a.until((p) => p.members.length === 2);
    await leaveAll(a, c);
  });

  it('when the host leaves the lobby, the next one can start it', async () => {
    const a = await browser(null, 'Anna');
    const b = await browser(a.room.roomId, 'Ben');
    const c = await browser(a.room.roomId, 'Cleo');
    await a.leave();
    await b.until((p) => p.members.length === 2 && p.hostId === p.you);
    c.send('party.ready', { ready: true });
    await b.until((p) => p.notYet === '');
    b.send('party.start', {});
    await c.until((p) => p.playing);
    await leaveAll(b, c);
  });

  it('after the match the same lobby plays again, with a new draw and new people', async () => {
    const a = await browser(null, 'Anna');
    const b = await browser(a.room.roomId, 'Ben');
    const code = a.room.roomId;
    b.send('party.ready', { ready: true });
    await a.until((p) => p.notYet === '');
    a.send('party.start', {});
    await b.until((p) => p.playing);
    const first = game(code)!;
    // During the match nothing about the parts is in the lobby's news, and nobody can be "back" already.
    b.send('party.back', {});
    await wait(100);
    expect(b.party()).toMatchObject({ cast: [], playing: true });
    expect(b.party().members.every((m) => m.away)).toBe(true);
    // The match ends (as by force: how matches end is tested elsewhere).
    (first as unknown as { endMatch(w: string, r: string): void }).endMatch('defenders', 'Test.');
    await b.until((p) => !p.playing);
    const cast = b.party().cast;
    expect(cast.map((c) => c.name)).toEqual(['Anna', 'Ben']);
    for (const c of cast) expect(scenario.players.some((p) => p.name === c.employee)).toBe(true);
    expect(b.messages.map((m) => m.type)).toContain('debrief');
    // Somebody new comes in while Ben still reads the debrief.
    const c = await browser(code, 'Cleo');
    await c.until((p) => p.members.length === 3);
    expect(c.messages.some((m) => m.type === 'welcome' || m.type === 'debrief')).toBe(false);
    c.send('party.ready', { ready: true });
    a.send('party.back', {});
    a.send('party.start', {});
    await a.until((p) => p.notYet === 'Waiting for Ben to come back from the last match.');
    expect(game(code)).toBe(first);
    b.send('party.back', {});
    b.send('party.ready', { ready: true });
    await a.until((p) => p.notYet === '');
    a.send('party.start', {});
    await c.until((p) => p.playing);
    const second = game(code)!;
    expect(second).not.toBe(first);
    expect(second.world.seed).not.toBe(first.world.seed);
    expect(second.over).toBeNull();
    for (const who of [a, b, c]) {
      for (let i = 0; i < 100 && who.messages.filter((m) => m.type === 'welcome').length < (who === c ? 1 : 2); i++) await wait(20);
      expect(who.messages.filter((m) => m.type === 'welcome')).toHaveLength(who === c ? 1 : 2);
      expect(who.party().cast).toEqual([]);
    }
    await expect(browser(code, 'Late')).rejects.toThrow('locked');
    await leaveAll(a, b, c);
  }, 20_000);

  it('a lobby the host closed stays closed after the match', async () => {
    const a = await browser(null, 'Anna');
    const b = await browser(a.room.roomId, 'Ben');
    b.send('party.ready', { ready: true });
    a.send('party.open', { open: false });
    await a.until((p) => p.notYet === '' && !p.open);
    a.send('party.start', {});
    await b.until((p) => p.playing);
    (game(a.room.roomId) as unknown as { endMatch(w: string, r: string): void }).endMatch('hacker', 'Test.');
    await b.until((p) => !p.playing);
    await expect(browser(a.room.roomId, 'Late')).rejects.toThrow('locked');
    // The host can remove somebody who never comes back from the debrief.
    a.send('party.back', {});
    a.send('party.remove', { id: b.party().you });
    await a.until((p) => p.members.length === 1);
    await leaveAll(a);
  });

  it('a full server says so, and a lobby that is gone makes room', async () => {
    const all: Browser[] = [];
    for (let i = 0; i < LIMIT; i++) all.push(await browser(null));
    await expect(browser(null)).rejects.toThrow('The server is full');
    await leaveAll(all[0]);
    const again = await browser(null);
    for (const b of [...all.slice(1), again]) await leaveAll(b);
  });

  it('no more people fit than there are employees', async () => {
    const a = await browser(null, 'Anna');
    const others: Browser[] = [];
    for (let i = 1; i < scenario.players.length; i++) others.push(await browser(a.room.roomId, 'Anna'));
    await a.until((p) => p.members.length === scenario.players.length);
    expect(new Set(a.party().members.map((m) => m.name)).size).toBe(scenario.players.length);
    await expect(browser(a.room.roomId)).rejects.toThrow('locked');
    await others[0].leave();
    await a.until((p) => p.members.length === scenario.players.length - 1);
    others[0] = await browser(a.room.roomId);
    await leaveAll(a, ...others);
  }, 20_000);
});
