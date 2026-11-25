/**
 * Phase 6, part D: chat. Who hears a line, what a line may contain, and that
 * nobody can flood it or read what is not meant for them.
 */
import { describe, expect, it } from 'vitest';
import { CHAT_BURST, CHAT_LENGTH, CHAT_REFILL_MS, cleanChat, roomAt } from '@insider/shared';
import { soloGameOptions } from '../src/solo';
import { Recorder, clone, scenario, tiledMap } from './helpers';

const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small', dev: false };
/** Sara and Rami sit in Finance, Lina in HR, Omar in Marketing, Maha at the reception. Omar and Lina are hackers. */
const CAST: Record<string, string> = { s: 'p1', r: 'p2', l: 'p3', o: 'p4', m: 'p9' };
const FAST = { discussionMs: 2000, votingMs: 2000, resultMs: 500, cooldownMs: 0, usesPerPlayer: 3 };

function match(hackers = ['p4', 'p3'], options: ConstructorParameters<typeof Recorder>[0] = {}): Recorder {
  const r = new Recorder({ ...base, assigned: true, hackers, meetingTimes: FAST, ...options });
  for (const [client, id] of Object.entries(CAST)) r.game.seat(client, id);
  r.flush();
  return r;
}
type Line = { channel: string; from: string; fromId: string; text: string };
const heard = (r: Recorder, client: string) => r.messages(client, 'chat').map((m) => m.payload as Line);
const say = (r: Recorder, client: string, text: string, channel?: string) => r.send(client, 'chat.send', { text, channel });
/** Who heard this text? */
const ears = (r: Recorder, text: string) => Object.keys(CAST).filter((c) => heard(r, c).some((l) => l.text === text)).sort();
const room = (r: Recorder, id: string) => { const p = r.position(id); return roomAt(r.map, p.x, p.y); };

describe('what a line may contain', () => {
  it('one line of any language, not too long, nothing invisible', () => {
    const char = (code: number) => String.fromCodePoint(code);
    expect(cleanChat('  hello \n\t there  ')).toBe('hello there');
    expect(cleanChat(`a${char(0x202e)}b${char(0x200b)}c${char(0)}d${char(0x2028)}e`)).toBe('abc d e');
    expect(cleanChat('مرحبا 👋🏽 naïve <b>')).toBe('مرحبا 👋🏽 naïve <b>');
    expect(cleanChat('x'.repeat(100_000))).toBe('x'.repeat(CHAT_LENGTH));
    expect(cleanChat(`e${char(0x301).repeat(50)}`).length).toBeLessThanOrEqual(5);
    for (const bad of [null, undefined, 5, {}, ['hi'], '   ', '\n', char(0x200b)]) expect(cleanChat(bad)).toBe('');
  });
});

describe('open chat', () => {
  it('is heard by everybody in the same room, and by nobody else', () => {
    const r = match();
    expect([room(r, 'p1'), room(r, 'p2')]).toEqual(['Finance', 'Finance']);
    expect(room(r, 'p3')).not.toBe('Finance');
    say(r, 's', 'hello Finance');
    expect(ears(r, 'hello Finance')).toEqual(['r', 's']);
    expect(heard(r, 'r')[0]).toEqual({ channel: 'room', from: 'Sara Alharbi', fromId: 'p1', text: 'hello Finance', time: r.game.world.time });
    for (const c of ['l', 'o', 'm']) expect(JSON.stringify(r.sent.get(c))).not.toContain('hello Finance');
  });

  it('follows the body: after walking over, the other room hears it', () => {
    const r = match();
    const desk = r.map.desks.find((d) => d.hostname === 'HR-LT-03')!;
    expect(r.walkTo('s', 'p1', desk.seatX + 60, desk.seatY + 60)).toBe(true);
    expect(room(r, 'p1')).toBe(room(r, 'p3'));
    say(r, 's', 'hello HR');
    expect(ears(r, 'hello HR')).toEqual(['l', 's']);
  });

  it('works while sitting at a PC, and is not typed into it', () => {
    const r = match();
    expect(r.sitAt('s', 'p1', 'FIN-LT-07')).toBe(true);
    const before = r.messages('s', 'term.output').length;
    say(r, 's', 'whoami');
    expect(r.messages('s', 'term.output').length).toBe(before);
    expect(ears(r, 'whoami')).toEqual(['r', 's']);
  });

  it('in a doorway, outside all rooms, distance decides', () => {
    const r = match();
    const avatars = (r.game as unknown as { avatars: Map<string, { x: number; y: number }> }).avatars;
    // Somewhere on the map that belongs to no room.
    const spot = (() => {
      for (let y = 8; y < r.map.height; y += 8) for (let x = 8; x < r.map.width; x += 8) if (roomAt(r.map, x, y) === '') return { x, y };
      return null;
    })();
    if (!spot) throw new Error("this map has no such place");
    Object.assign(avatars.get('s')!, spot);
    Object.assign(avatars.get('r')!, { x: spot.x + 100, y: spot.y });
    Object.assign(avatars.get('l')!, { x: spot.x + 400, y: spot.y });
    say(r, 's', 'psst');
    expect(ears(r, 'psst')).toEqual(['r', 's']);
  });

  it('a strange channel is just the room; a solo match has none', () => {
    const r = match();
    for (const channel of ['meeting', 'fired', 'all', '__proto__']) {
      r.tick(Math.ceil(CHAT_REFILL_MS / 50) + 1);
      say(r, 's', `via ${channel}`, channel);
      expect(ears(r, `via ${channel}`), channel).toEqual(['r', 's']);
      expect(heard(r, 'r').at(-1)!.channel).toBe('room');
    }
    const solo = new Recorder(soloGameOptions(base, { mode: 'investigation', role: 'soc', difficulty: 'easy' }, 3));
    solo.connect('me');
    solo.send('me', 'chat.send', { text: 'anybody?' });
    expect(solo.messages('me', 'chat')).toEqual([]);
    expect(solo.notice('me')).toBe('You can talk to everybody during a meeting.');
  });
});

describe('the hackers’ private chat', () => {
  it('reaches the hackers wherever they are, and nobody else ever', () => {
    const r = match();
    say(r, 'o', 'I have the password', 'hackers');
    expect(ears(r, 'I have the password')).toEqual(['l', 'o']);
    expect(heard(r, 'l')[0]).toMatchObject({ channel: 'hackers', from: 'Omar Farouk' });
    // Also during a meeting.
    const b = r.map.furniture.find((f) => f.kind === 'button')!;
    expect(r.walkTo('m', 'p9', b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
    r.send('m', 'meeting.call');
    say(r, 'l', 'stay calm', 'hackers');
    expect(ears(r, 'stay calm')).toEqual(['l', 'o']);
    for (const c of ['s', 'r', 'm']) expect(JSON.stringify(r.sent.get(c))).not.toMatch(/I have the password|stay calm|"channel":"hackers"/);
  });

  it('a defender cannot write to it, and neither can the only hacker of a match', () => {
    const r = match();
    say(r, 's', 'who are you?', 'hackers');
    expect(r.game.chatLog).toEqual([]); // not even as open chat: that would give the attempt away, or nothing
    const alone = match(['p4']);
    say(alone, 'o', 'hello me', 'hackers');
    expect(alone.game.chatLog).toEqual([]);
  });

  it('a caught hacker neither reads nor writes it any more', () => {
    const r = match();
    const game = r.game as unknown as { takeOut(id: string, reason: string): void };
    r.game.world.mission.caught.push('p4');
    game.takeOut('p4', 'Out.');
    r.flush();
    say(r, 'o', 'it is Lina!', 'hackers');
    say(r, 'l', 'alone now', 'hackers');
    expect(ears(r, 'it is Lina!')).toEqual([]);
    expect(ears(r, 'alone now')).toEqual(['l']);
    // They can talk to others who are out, whatever channel they ask for.
    say(r, 'o', 'anybody here?', 'room');
    expect(heard(r, 'o').at(-1)).toMatchObject({ channel: 'fired', text: 'anybody here?' });
    expect(ears(r, 'anybody here?')).toEqual(['o']);
  });
});

describe('meetings and people who are out', () => {
  it('at a meeting everybody hears everything; people who are out listen and are not heard', () => {
    const r = match();
    (r.game as unknown as { takeOut(id: string, reason: string): void }).takeOut('p2', 'Out.');
    r.flush();
    const b = r.map.furniture.find((f) => f.kind === 'button')!;
    expect(r.walkTo('m', 'p9', b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
    r.send('m', 'meeting.call');
    say(r, 's', 'it was Omar');
    say(r, 'r', 'no, Lina');
    expect(ears(r, 'it was Omar')).toEqual(['l', 'm', 'o', 'r', 's']);
    expect(ears(r, 'no, Lina')).toEqual(['r']);
  });

  it('open chat is not heard by people who are out', () => {
    const r = match();
    (r.game as unknown as { takeOut(id: string, reason: string): void }).takeOut('p2', 'Out.');
    r.flush();
    say(r, 's', 'alone in Finance');
    expect(ears(r, 'alone in Finance')).toEqual(['s']);
  });
});

describe('limits', () => {
  it('a few lines at once, then one every moment; each person on their own', () => {
    const r = match();
    for (let i = 0; i < CHAT_BURST + 3; i++) say(r, 's', `line ${i}`);
    expect(heard(r, 'r')).toHaveLength(CHAT_BURST);
    expect(r.notice('s')).toBe('You are writing too fast. Wait a moment.');
    say(r, 'r', 'I may still write');
    expect(ears(r, 'I may still write')).toEqual(['r', 's']);
    r.tick(Math.ceil(CHAT_REFILL_MS / 50) + 1);
    say(r, 's', 'again');
    say(r, 's', 'too fast again');
    expect(ears(r, 'again')).toEqual(['r', 's']);
    expect(ears(r, 'too fast again')).toEqual([]);
    // Waiting for long does not save up more than the few.
    r.tick(2000);
    const before = heard(r, 'r').length;
    for (let i = 0; i < 20; i++) say(r, 's', `burst ${i}`);
    expect(heard(r, 'r').length - before).toBe(CHAT_BURST);
  });

  it('all channels count together, and nonsense costs nothing and does nothing', () => {
    const r = match();
    for (let i = 0; i < 10; i++) r.send('o', 'chat.send', { text: i % 2 ? '' : 7 });
    for (let i = 0; i < CHAT_BURST; i++) say(r, 'o', `x${i}`, i % 2 ? 'hackers' : 'room');
    say(r, 'o', 'one more', 'hackers');
    expect(r.game.chatLog).toHaveLength(CHAT_BURST);
    for (const bad of [null, undefined, 'text', 5, [], { text: { toString: 1 } }]) expect(() => r.send('s', 'chat.send', bad)).not.toThrow();
    r.connect('lobbyless');
    r.send('lobbyless', 'chat.send', { text: 'hi' });
    expect(r.game.chatLog).toHaveLength(CHAT_BURST);
  });
});
