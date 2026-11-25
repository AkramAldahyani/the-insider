/**
 * Phase 6, part B: secret parts. The draw is fair, follows the host's choice,
 * and nothing a browser receives during the match tells who is the hacker, or
 * which employees are people.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARTY_SETTINGS, PARTY_HAND_IN_MINUTES, type PartySettings } from '@insider/shared';
import { Random } from '../src/bots/random';
import { deal, whoMayHack } from '../src/deal';
import { Party, partyGameOptions } from '../src/party';
import { PW, Recorder, clone, scenario, tiledMap } from './helpers';

const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small', dev: false };
const settings = (s: Partial<PartySettings> = {}): PartySettings => ({ ...DEFAULT_PARTY_SETTINGS, ...s });
const people = (n: number) => Array.from({ length: n }, (_, i) => `net${i}`);
const ordinary = scenario.players.filter((p) => (p.role ?? 'employee') === 'employee').map((p) => p.id);
const many = (n: number, s: Partial<PartySettings> = {}, times = 600) => Array.from({ length: times }, (_, seed) => deal(scenario.players, people(n), settings(s), new Random(seed)));

describe('the draw', () => {
  it('everybody gets a different employee, and the hacker is an ordinary one', () => {
    for (let n = 2; n <= scenario.players.length; n++) {
      for (const s of [{}, { hacker: 'human' as const }, { hacker: 'bot' as const }, { bots: false }]) {
        for (const d of many(n, s, 40)) {
          expect([...d.seats.keys()]).toEqual(people(n));
          expect(new Set(d.seats.values()).size).toBe(n);
          for (const id of d.seats.values()) expect(scenario.players.some((p) => p.id === id)).toBe(true);
          expect(d.hackers).toHaveLength(1);
          expect(ordinary).toContain(d.hackers[0]);
          expect(d.human).toBe([...d.seats.values()].includes(d.hackers[0]));
        }
      }
    }
  });

  it('who may be the hacker: the host decides, otherwise a person from four people on', () => {
    expect([2, 3, 4, 10, 11].map((n) => whoMayHack(settings(), n, 11))).toEqual(['any', 'any', 'human', 'human', 'human']);
    expect([2, 10, 11].map((n) => whoMayHack(settings({ hacker: 'bot' }), n, 11))).toEqual(['bot', 'bot', 'human']);
    expect(whoMayHack(settings({ hacker: 'human' }), 2, 11)).toBe('human');
    expect(whoMayHack(settings({ bots: false, hacker: 'bot' }), 2, 11)).toBe('human');
    expect(many(4).every((d) => d.human)).toBe(true);
    expect(many(10, { hacker: 'bot' }).some((d) => d.human)).toBe(false);
  });

  it('is fair: everybody is the hacker about equally often, at every ordinary desk', () => {
    const d = many(4, {}, 4000);
    const count = new Map<string, number>();
    for (const x of d) for (const [client, id] of x.seats) if (id === x.hackers[0]) count.set(client, (count.get(client) ?? 0) + 1);
    for (const client of people(4)) expect(Math.abs(count.get(client)! / 4000 - 1 / 4)).toBeLessThan(0.04);
    for (const id of ordinary) expect(Math.abs(d.filter((x) => x.hackers[0] === id).length / 4000 - 1 / ordinary.length)).toBeLessThan(0.03);
    // Whoever is not the hacker can get any job.
    for (const p of scenario.players) expect(d.some((x) => x.seats.get('net0') === p.id), p.id).toBe(true);
    // Two people: now and then it is one of them, usually not.
    const two = many(2, {}, 4000).filter((x) => x.human).length / 4000;
    expect(two).toBeGreaterThan(0.1);
    expect(two).toBeLessThan(0.28);
  });

  it('with two people nobody can be sure to be against a person', () => {
    const p = new Party('BCDFG', 11);
    p.join('a', 'A');
    p.join('b', 'B');
    p.setReady('b', true);
    expect(p.notYet()).toBe('');
    p.change({ hacker: 'human' });
    expect(p.notYet()).toContain('at least 3');
    p.change({ hacker: 'bot' });
    expect(p.notYet()).toBe('');
    p.change({ bots: false });
    expect(p.notYet()).toContain('at least 3');
    p.join('c', 'C');
    p.setReady('c', true);
    expect(p.notYet()).toBe('');
  });
});

/** A lobby's match as the room starts it. */
function start(n: number, s: Partial<PartySettings> = {}, seed = 1) {
  const d = deal(scenario.players, people(n), settings(s), new Random(seed));
  const o = partyGameOptions(base, settings(s), seed, d);
  const r = new Recorder({ ...o, botOptions: { ...o.botOptions, hackerPace: undefined } });
  for (const [client, id] of d.seats) r.game.seat(client, id);
  r.game.everybodyIsIn();
  r.flush();
  return { r, d };
}

describe('the match', () => {
  it('each browser gets its own part, and only the hacker a briefing', () => {
    for (const s of [{}, { bots: false }]) {
      const { r, d } = start(5, s, 3);
      for (const [client, id] of d.seats) {
        const welcome = r.messages(client, 'welcome');
        expect(welcome).toHaveLength(1);
        const { playerId, mission, card } = welcome[0].payload as { playerId: string; mission: { handInMinutes?: number } | null; card: { username: string } };
        expect(playerId).toBe(id);
        expect(card.username).toBe(scenario.players.find((p) => p.id === id)!.account);
        if (id === d.hackers[0]) expect(mission).toMatchObject({ handInMinutes: PARTY_HAND_IN_MINUTES });
        else expect(mission).toBeNull();
      }
      expect(r.game.world.mission.hackers[0]).toBe(d.hackers[0]);
    }
  });

  it('a bot can be the hacker, and a person cannot change that', () => {
    const { r, d } = start(3, { hacker: 'bot' }, 5);
    expect(d.human).toBe(false);
    expect(r.game.world.mission.hackers[0]).toBe(d.hackers[0]);
    expect(r.game.bots!.has(d.hackers[0])).toBe(true);
    for (const client of people(3)) expect((r.last(client, 'welcome')!.payload as { mission: unknown }).mission).toBeNull();
    const before = r.messages('net0').length;
    r.send('net0', 'choose', { playerId: d.hackers[0], hacker: true });
    r.connect('stranger');
    r.send('stranger', 'choose', { playerId: 'p4', hacker: true });
    expect(r.messages('net0').length).toBe(before);
    expect(r.messages('stranger', 'welcome')).toEqual([]);
    expect(r.game.world.mission.hackers[0]).toBe(d.hackers[0]);
  });

  it('everybody is at work from the first moment, in the same way: nothing tells people from bots', () => {
    const { r, d } = start(4, {}, 7);
    const state = r.game.publicState();
    expect(Object.keys(state.players).sort()).toEqual(scenario.players.map((p) => p.id).sort());
    // The order, the places and the fields are those of everybody else.
    expect(Object.keys(state.players)).toEqual([...Object.keys(state.players)].sort());
    for (const p of scenario.players) {
      const spawn = r.map.spawns[p.desk] ?? r.map.defaultSpawn;
      expect(state.players[p.id], p.id).toMatchObject({ x: spawn.x, y: spawn.y, seatedAt: '', activity: '', facing: 'up' });
    }
    expect(new Set(Object.values(state.players).map((p) => Object.keys(p).sort().join())).size).toBe(1);
    // The entrance logged each of them once, at the same time.
    const arrivals = r.game.world.events.filter((e) => e.type === 'badge.tap' && e.time === r.game.world.time);
    expect(arrivals.map((e) => e.actor).sort()).toEqual(scenario.players.map((p) => p.id).sort());
    const other = [...d.seats].find(([, id]) => id !== d.hackers[0])![0];
    const told = r.last(other, 'lobby')!.payload as { employees: { taken: boolean }[]; hackerOpen: boolean };
    expect(told.employees.some((e) => e.taken)).toBe(false);
    expect(told.hackerOpen).toBe(false);
  });

  it('the same for a match with a human and with a bot hacker: the first messages have the same shape', () => {
    const shape = (hacker: 'human' | 'bot') => {
      const { r, d } = start(3, { hacker }, 9);
      const [client] = [...d.seats].find(([, id]) => id !== d.hackers[0])!;
      return r.messages(client).map((m) => `${m.type}:${Object.keys(m.payload as object).sort().join()}`);
    };
    expect(shape('human')).toEqual(shape('bot'));
  });

  it('bots live on normally from there, and nothing secret arrives', () => {
    const { r, d } = start(4, {}, 11);
    for (let i = 0; i < 6000 && !r.game.over; i++) {
      r.game.tick(100);
      if (i % 50 === 0) r.flush();
    }
    r.flush();
    expect(r.game.over).toBeNull(); // the hacker is a person who does nothing
    expect(r.game.bots!.list().filter((b) => b.failure)).toEqual([]);
    expect(r.game.bots!.list().filter((b) => b.seatedAt !== '').length).toBeGreaterThan(2);
    for (const [client, id] of d.seats) {
      const text = JSON.stringify(r.sent.get(client)!.map((m) => [m.type, m.payload]));
      const me = scenario.players.find((p) => p.id === id)!;
      for (const [user, password] of Object.entries(PW)) if (user !== me.account) expect(text, user).not.toContain(password);
      if (id !== d.hackers[0]) for (const word of ['"mission":{', 'toolsPath', '"debrief"', '"cast"', 'net0', 'net1']) expect(text).not.toContain(word);
    }
  }, 60_000);

  it('a human hacker has to wait before handing in; a hacker played by the computer has its own waits', () => {
    const o = (human: boolean) => partyGameOptions(base, settings(), 1, { hackers: ['p4'], human });
    expect(o(true).handInMinutes).toBe(3);
    expect(o(false).handInMinutes).toBeUndefined();
    const { r, d } = start(4, {}, 13);
    const [client, id] = [...d.seats].find(([, x]) => x === d.hackers[0])!;
    // (The file is read by force here: this is about the waiting, not about getting in.)
    const flag = r.file('ADMIN-SRV-01', '/root/flag.txt').trim();
    const { flag: where } = r.game.world.mission;
    r.game.world.events.push({ ...r.game.world.events.at(-1)!, time: r.game.world.time, actor: id, host: where!.host, type: 'file.read', details: { path: where!.path } });
    r.game.tick(100);
    r.send(client, 'flag.submit', { text: flag });
    expect(r.game.over).toBeNull();
    expect((r.last(client, 'notice')!.payload as { text: string }).text).toContain('not here yet');
    for (let i = 0; i < 1810; i++) r.game.tick(100);
    r.send(client, 'flag.submit', { text: flag });
    expect(r.game.over?.winner).toBe('hacker');
  });
});
