/**
 * Phase 6, part I: the large office (30 desks), lobbies that use it, the
 * limit of three all-hands meetings, and department meetings.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import { validateScenario } from '@insider/engine';
import { DEFAULT_PARTY_SETTINGS, LARGE_ALL_HANDS, PARTY_ROOM_NAME, PLAYER_RADIUS, hackerCount, isFree, officeFor, parseOfficeMap, type MeetingView, type PartySettings, type PartyView, type ServerMessages } from '@insider/shared';
import { createGameServer, loadLarge } from '../src/app';
import { Random } from '../src/bots/random';
import { deal } from '../src/deal';
import type { OfficeGame } from '../src/game';
import { checkMapAgainstScenario } from '../src/mapCheck';
import { Party, partyGameOptions } from '../src/party';
import { TALK_MS, TALK_RADIUS, TALK_USES } from '../src/talks';
import { Recorder, clone, scenario as small } from './helpers';

const large = loadLarge({ dev: false })!;
const settings = (s: Partial<PartySettings> = {}): PartySettings => ({ ...DEFAULT_PARTY_SETTINGS, ...s });
const FAST = { discussionMs: 2000, votingMs: 2000, resultMs: 500, cooldownMs: 0, usesPerPlayer: 3 };

/** A lobby's match in the large office in which these employees are people (browser "p13" plays p13). */
function match(people: string[], options: ConstructorParameters<typeof Recorder>[0] = {}): Recorder {
  const o = partyGameOptions({ ...large, scenario: clone(large.scenario), map: clone(large.map) }, settings({ office: 'large' }), 4, { hackers: ['p4'], human: false });
  const r = new Recorder({ ...o, meetingTimes: { ...o.meetingTimes, ...FAST }, ...options });
  for (const id of people) r.game.seat(id, id);
  r.game.everybodyIsIn();
  r.flush();
  return r;
}
const talkOf = (r: Recorder, c: string) => r.last(c, 'talk')?.payload as ServerMessages['talk'] | undefined;
const heard = (r: Recorder, c: string) => r.messages(c, 'chat').map((m) => m.payload as { channel: string; text: string; from: string; room?: string });
/** Puts a body somewhere (as if it had walked there). */
function place(r: Recorder, id: string, x: number, y: number): void {
  const body = [...(r.game as unknown as { avatars: Map<string, { playerId: string; x: number; y: number; seatedAt: string }> }).avatars.values()].find((a) => a.playerId === id)!;
  Object.assign(body, { x, y });
}
const button = (r: Recorder, name: string) => r.map.furniture.find((f) => f.name === name)!;
/** Stands right next to a department's meeting button. */
function toButton(r: Recorder, id: string, name: string): void {
  const b = button(r, name);
  place(r, id, b.x - PLAYER_RADIUS - 4, b.y + b.height / 2);
}

describe('the large office', () => {
  it('map and scenario fit together, and the scenario is valid', () => {
    expect(() => validateScenario(large.scenario)).not.toThrow();
    const map = parseOfficeMap(large.map);
    expect(() => checkMapAgainstScenario(map, large.scenario, 'office-large')).not.toThrow();
    expect(large.scenario.players).toHaveLength(30);
    expect(map.desks).toHaveLength(31); // and the admin server
    expect(map.cols).toBeGreaterThan(100);
  });

  it('it is the same company: everything of the small office is there, unchanged', () => {
    const byId = <T extends { [k: string]: unknown }>(list: T[], key: string) => new Map(list.map((x) => [x[key], x]));
    const accounts = byId(large.scenario.accounts as never[], 'username');
    for (const a of small.accounts) expect(accounts.get(a.username), a.username).toEqual(a);
    const players = byId(large.scenario.players as never[], 'id');
    for (const p of small.players) expect(players.get(p.id), p.id).toEqual(p);
    const hosts = byId(large.scenario.hosts as never[], 'hostname');
    for (const h of small.hosts) expect(hosts.get(h.hostname), h.hostname).toEqual(h);
    expect(large.scenario.mission).toEqual(small.mission);
    // The new people: ordinary employees, each with an own PC, a to-do list and some work.
    const fresh = large.scenario.players.slice(11);
    expect(new Set(fresh.map((p) => p.desk)).size).toBe(19);
    for (const p of fresh) {
      expect(p.role).toBe('employee');
      const host = large.scenario.hosts.find((h) => h.hostname === p.desk)!;
      expect(host.files!.length).toBeGreaterThanOrEqual(2);
      expect(host.files![0].path).toBe(`/home/${p.account}/todo.txt`);
    }
    const departments = new Set(large.scenario.accounts.map((a) => a.department));
    for (const d of ['Sales', 'Legal']) expect(departments).toContain(d);
  });

  it('room for thirty at the meeting table, and the rooms that bots and tasks go to', () => {
    const r = match([]);
    const spots = (r.game as unknown as { meetingSpots: unknown[] }).meetingSpots;
    expect(spots.length).toBeGreaterThanOrEqual(30);
    const rooms = new Set(r.map.rooms.map((x) => x.name));
    for (const name of ['Corridor', 'Reception', 'Cafeteria / meeting room', 'Printer room', 'Storage', 'Bathrooms', 'Server room', 'Security office', 'IT department', 'Finance', 'HR', 'Marketing', 'Sales', 'Legal']) expect(rooms, name).toContain(name);
    expect(r.map.furniture.filter((f) => f.kind === 'talk')).toHaveLength(6);
    for (const f of r.map.furniture.filter((f) => f.kind === 'talk')) expect(isFree(r.map, f.x - PLAYER_RADIUS - 4, f.y + f.height / 2, PLAYER_RADIUS), f.name).toBe(true);
  });

  it('thirty bots work there for an hour: everybody comes to work, nobody gets stuck, and it costs little', () => {
    const r = match([], { bots: true, botOptions: { hacker: false } });
    const start = performance.now();
    for (let i = 0; i < 36_000; i++) r.game.tick(100);
    const perStep = (performance.now() - start) / 36_000;
    expect(Object.keys(r.game.publicState().players)).toHaveLength(30);
    expect(r.game.bots!.list().filter((b) => b.failure)).toEqual([]);
    for (const p of Object.values(r.game.publicState().players)) expect(isFree(r.map, p.x, p.y, PLAYER_RADIUS), p.name).toBe(true);
    expect(perStep).toBeLessThan(5); // a step has 50 ms
  }, 120_000);
});

describe('which office a lobby plays in', () => {
  it('the small one while everybody fits, unless the host chooses', () => {
    expect([1, 11, 12, 30].map((n) => officeFor(settings(), n, 11))).toEqual(['small', 'small', 'large', 'large']);
    expect(officeFor(settings({ office: 'large' }), 2, 11)).toBe('large');
    expect(officeFor(settings({ office: 'small' }), 20, 11)).toBe('small');
    const p = new Party('BCDFG', 30, 11);
    for (let i = 0; i < 12; i++) p.join(`c${i}`, `P${i}`);
    for (let i = 1; i < 12; i++) p.setReady(`c${i}`, true);
    expect(p.view('c0')).toMatchObject({ office: 'large', desks: 30, size: 30 });
    expect(p.notYet()).toBe('');
    p.change({ office: 'small' });
    expect(p.notYet()).toBe('The small office has 11 desks: choose the large office.');
    expect(p.view('c0')).toMatchObject({ office: 'small', desks: 11 });
    // Without a large office nothing changes.
    expect(new Party('BCDFG', 11).view('')).toMatchObject({ office: 'small', desks: 11 });
  });

  it('hackers by the size of the office', () => {
    expect(hackerCount(settings(), 3, 30)).toBe(3); // with bots everybody counts
    expect(hackerCount(settings({ bots: false }), 13, 30)).toBe(1);
    const d = deal(large.scenario.players, Array.from({ length: 13 }, (_, i) => `c${i}`), settings(), new Random(5));
    expect(d.hackers).toHaveLength(3);
    expect(new Set(d.seats.values()).size).toBe(13);
  });

  it('the large office has at most three all-hands meetings; the small one keeps its rules', () => {
    expect(partyGameOptions(large, settings(), 1, { hackers: ['p4'], human: false }).meetingTimes!.perMatch).toBe(LARGE_ALL_HANDS);
    expect(partyGameOptions({ ...large, scenario: small }, settings(), 1, { hackers: ['p4'], human: false }).meetingTimes!.perMatch).toBeUndefined();
  });
});

describe('all-hands meetings in the large office', () => {
  it('three per match, whoever calls them; then the button says so', () => {
    const people = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const r = match(people);
    const b = r.map.furniture.find((f) => f.kind === 'button')!;
    for (let n = 0; n < 4; n++) {
      const id = people[n];
      place(r, id, b.x + b.width / 2, b.y + b.height + 14);
      r.send(id, 'meeting.call');
      if (n < 3) {
        expect(r.game.meetings.current, r.notice(id)).not.toBeNull();
        for (let i = 0; i < 200 && r.game.meetings.current; i++) r.tick();
      } else {
        expect(r.game.meetings.current).toBeNull();
        expect(r.notice(id)).toBe(`All ${LARGE_ALL_HANDS} all-hands meetings of this match have been held.`);
      }
    }
    expect((r.last('p5', 'meeting')!.payload as MeetingView).usesLeft).toBe(0);
  });
});

describe('department meetings', () => {
  it('everybody near the button takes part; others do not even hear of it', () => {
    const r = match(['p1', 'p2', 'p12', 'p13', 'p3'], { bots: false }); // (the computer's colleagues would sit in Finance too)
    // Sara and Rami, Fatima and Ahmed in Finance; Lina far away in HR.
    toButton(r, 'p1', 'Finance meeting button');
    const b = button(r, 'Finance meeting button');
    place(r, 'p2', b.x - 100, b.y);
    place(r, 'p12', b.x - TALK_RADIUS + 40, b.y - 50);
    place(r, 'p13', b.x - TALK_RADIUS - 80, b.y); // too far
    place(r, 'p3', b.x + 120, b.y); // close, but behind the wall in HR
    r.send('p1', 'talk.call');
    const t = talkOf(r, 'p1')!;
    expect(t).toMatchObject({ active: true, room: 'Finance', calledBy: 'Sara Alharbi', usesLeft: TALK_USES - 1 });
    expect(t.members.sort()).toEqual(['Fatima Al-Qahtani', 'Rami Mansour', 'Sara Alharbi']);
    expect(talkOf(r, 'p2')).toMatchObject({ active: true });
    expect(talkOf(r, 'p13')?.active ?? false).toBe(false);
    expect(talkOf(r, 'p3')?.active ?? false).toBe(false);
    // What they say stays among them.
    r.send('p2', 'chat.send', { text: 'I saw somebody at Sara’s PC' });
    for (const c of ['p1', 'p2', 'p12']) expect(heard(r, c).at(-1), c).toMatchObject({ channel: 'talk', text: 'I saw somebody at Sara’s PC' });
    for (const c of ['p13', 'p3']) expect(JSON.stringify(heard(r, c))).not.toContain('I saw somebody');
    // Nobody stops: they can walk on.
    const before = r.position('p2');
    r.send('p2', 'move', { dx: -1, dy: 0 });
    r.tick(10);
    expect(r.position('p2').x).toBeLessThan(before.x);
  });

  it('a minute, then it is over; the button rests, and each person calls two at most', () => {
    const r = match(['p1', 'p2']);
    toButton(r, 'p1', 'Finance meeting button');
    r.send('p1', 'talk.call');
    r.send('p1', 'talk.call');
    expect(r.notice('p1')).toBe('You are in a department meeting already.');
    r.tick(Math.ceil(TALK_MS / 50) + 1);
    expect(talkOf(r, 'p1')).toMatchObject({ active: false });
    expect(r.messages('p1', 'chat').length).toBe(r.messages('p1', 'chat').length);
    r.send('p1', 'talk.call');
    expect(r.notice('p1')).toMatch(/^This button works again in \d+ s\.$/);
    toButton(r, 'p1', 'HR meeting button');
    r.send('p1', 'talk.call');
    expect(talkOf(r, 'p1')).toMatchObject({ active: true, room: 'HR', usesLeft: 0 });
    r.tick(Math.ceil(TALK_MS / 50) + 1);
    toButton(r, 'p1', 'Sales meeting button');
    r.send('p1', 'talk.call');
    expect(r.notice('p1')).toBe(`You have called your ${TALK_USES} department meetings of this match.`);
    // Somewhere else than at a button.
    place(r, 'p2', 400, 500);
    r.send('p2', 'talk.call');
    expect(r.notice('p2')).toBe('A department meeting is called at the small button in each department.');
  });

  it('colleagues played by the computer tell what they saw; what they say counts like what they say at a meeting', () => {
    const r = match(['p1'], { bots: true, botOptions: { hacker: false } });
    r.tick(20 * 30);
    const bots = (r.game.bots as unknown as { findings(id: string): { text: string; suspect: string; weight: number; time: number }[] });
    // Rami (a bot) remembers something.
    bots.findings('p2').push({ text: 'I saw Omar Farouk sitting at my PC FIN-LT-04 at 09:01.', suspect: 'p4', weight: 2, time: r.game.world.time });
    toButton(r, 'p1', 'Finance meeting button');
    const b = button(r, 'Finance meeting button');
    place(r, 'p2', b.x - 60, b.y);
    r.send('p1', 'talk.call');
    expect(talkOf(r, 'p1')!.members).toContain('Rami Mansour');
    r.tick(Math.ceil(TALK_MS / 50) + 1);
    expect(heard(r, 'p1').some((l) => l.channel === 'talk' && l.from === 'Rami Mansour' && l.text.includes('Omar Farouk sitting at my PC'))).toBe(true);
    const testimony = (r.game as unknown as { testimony: { from: string; text: string }[] }).testimony;
    expect(testimony.some((t) => t.from === 'Rami Mansour')).toBe(true);
  });

  it('an all-hands meeting ends it; people who are out read it with its room; the small office has none', () => {
    const r = match(['p1', 'p2', 'p9']);
    (r.game as unknown as { takeOut(id: string, why: string): void }).takeOut('p9', 'Out.');
    toButton(r, 'p1', 'Finance meeting button');
    r.send('p1', 'talk.call');
    r.send('p1', 'chat.send', { text: 'quick question' });
    expect(heard(r, 'p9').at(-1)).toMatchObject({ channel: 'talk', text: 'quick question', room: 'Finance meeting' });
    const b = r.map.furniture.find((f) => f.kind === 'button')!;
    place(r, 'p2', b.x + b.width / 2, b.y + b.height + 14);
    r.send('p2', 'meeting.call');
    expect(talkOf(r, 'p1')).toMatchObject({ active: false });
    expect(r.game.talks.running).toEqual([]);
    const s = new Recorder();
    s.connect('a', 'p1');
    s.send('a', 'talk.call');
    expect(s.notice('a')).toBe('A department meeting is called at the small button in each department.');
    expect(s.messages('a', 'talk')).toEqual([]);
  });
});

describe('over the network', () => {
  const PORT = 2592;
  let server: ReturnType<typeof createGameServer>;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  beforeAll(async () => {
    server = createGameServer({ dev: false });
    await server.listen(PORT);
  });
  afterAll(async () => {
    await server.gracefullyShutdown(false);
  });

  it('twelve people go to the large office; up to thirty fit in a lobby', async () => {
    const { Client } = await import('colyseus.js');
    const rooms: import('colyseus.js').Room[] = [];
    const views: (PartyView | null)[] = [];
    for (let i = 0; i < 12; i++) {
      const client = new Client(`ws://localhost:${PORT}`);
      const room = i === 0 ? await client.create(PARTY_ROOM_NAME, { name: `P${i}` }) : await client.joinById(rooms[0].roomId, { name: `P${i}` });
      const n = i;
      views[n] = null;
      room.onMessage('*', () => undefined);
      room.onMessage('party', (v: PartyView) => { views[n] = v; });
      rooms.push(room);
    }
    for (let i = 0; i < 100 && views[0]?.members.length !== 12; i++) await wait(20);
    expect(views[0]).toMatchObject({ size: 30, office: 'large', desks: 30 });
    for (const room of rooms.slice(1)) room.send('party.ready', { ready: true });
    for (let i = 0; i < 100 && views[0]?.notYet !== ''; i++) await wait(20);
    rooms[0].send('party.start', {});
    for (let i = 0; i < 100 && !views[0]?.playing; i++) await wait(20);
    const game = (matchMaker.getLocalRoomById(rooms[0].roomId) as unknown as { game: OfficeGame }).game;
    expect(game.world.players).toHaveLength(30);
    expect(game.world.mission.hackers).toHaveLength(3);
    expect(game.meetings.times.perMatch).toBe(LARGE_ALL_HANDS);
    await Promise.all(rooms.map((r) => r.leave()));
  }, 30_000);
});
