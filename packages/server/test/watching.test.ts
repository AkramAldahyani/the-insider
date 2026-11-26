/**
 * Phase 6, part E: people who are out. They watch, hear what anybody standing
 * in the office could hear, and nothing they do reaches the match.
 */
import { describe, expect, it } from 'vitest';
import type { ClientMessageType, EvidenceView, MeetingView } from '@insider/shared';
import { PW, Recorder, clone, scenario, tiledMap } from './helpers';

const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small', dev: false };
/** Sara and Rami sit in Finance, Lina in HR, Omar in Marketing, Maha at the reception. Omar and Lina are hackers. */
const CAST: Record<string, string> = { s: 'p1', r: 'p2', l: 'p3', o: 'p4', m: 'p9' };
const FAST = { discussionMs: 2000, votingMs: 2000, resultMs: 500, cooldownMs: 0, usesPerPlayer: 3 };
/** Every message a browser can send, with contents that would do something. (A new message type must be added here: the type says so.) */
const ALL_MESSAGES: Record<ClientMessageType, unknown[]> = {
  'party.ready': [{ ready: true }], 'party.settings': [{ bots: false }], 'party.open': [{ open: true }], 'party.remove': [{ id: 'm1' }], 'party.start': [{}], 'party.back': [{}], 'party.look': [{ style: 1 }],
  choose: [{ playerId: 'p5' }, { playerId: 'p2' }, { playerId: 'p5', hacker: true }],
  move: [{ dx: 1, dy: 1, sequence: 1 }], sit: [{ hostname: 'FIN-LT-04' }, { hostname: 'HR-LT-03' }], stand: [{}], tap: [{ door: 'D-SRV' }],
  'item.start': [{ item: 'usb', hostname: 'FIN-LT-04' }], 'item.stop': [{}], 'monitors.open': [{}], 'monitors.frame': [{ camera: 'CAM-01' }],
  'evidence.pin': [{ kind: 'screen', text: 'x' }], 'evidence.unpin': [{ id: 'E1' }], detain: [{ target: 'p4' }],
  'meeting.call': [{}], 'talk.call': [{}], 'meeting.accuse': [{ suspect: 'p1', evidence: ['E1', 'E2', 'E3'] }], 'meeting.vote': [{ target: 'skip' }, { target: 'p4' }],
  'flag.submit': [{ text: scenario.mission ? 'NEXORA{x}' : '' }], 'term.line': [{ text: 'whoami' }], 'term.complete': [{ text: 'cat /etc/pa' }], 'term.cancel': [{}], 'term.switchUser': [{}],
  'dev.speed': [{ multiplier: 60 }], 'dev.jump': [{ duration: '10m' }], 'dev.events': [{ count: 5 }], 'dev.teleport': [{ hostname: 'HR-LT-03' }], 'dev.dump': [{}], 'dev.show': [{ what: 'mission' }],
  'chat.send': [{ text: 'hello' }, { text: 'hello', channel: 'hackers' }, { text: 'hello', channel: 'room' }],
};
type Line = { channel: string; from: string; text: string; room?: string };

function match(options: ConstructorParameters<typeof Recorder>[0] = {}): Recorder {
  const r = new Recorder({ ...base, assigned: true, hackers: ['p4', 'p3'], meetingTimes: FAST, ...options });
  for (const [client, id] of Object.entries(CAST)) r.game.seat(client, id);
  r.game.everybodyIsIn();
  r.flush();
  return r;
}
function out(r: Recorder, id: string): void {
  (r.game as unknown as { takeOut(id: string, reason: string): void }).takeOut(id, 'Out.');
  r.flush();
}
const heard = (r: Recorder, client: string) => r.messages(client, 'chat').map((m) => m.payload as Line);
function callMeeting(r: Recorder): void {
  const b = r.map.furniture.find((f) => f.kind === 'button')!;
  expect(r.walkTo('m', 'p9', b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
  r.send('m', 'meeting.call');
}
/** Somebody is accused (what that needs is tested elsewhere). */
const accuse = (r: Recorder, suspectId: string) => void r.game.meetings.current!.accusations.push({ id: 'A1', accuserId: 'p1', suspectId, evidence: [] } as never);
/** Everything the match consists of. */
const everything = (r: Recorder) => JSON.stringify([r.game.world, r.game.publicState(), r.game.board.items, r.game.meetings.current, r.game.meetings.history, r.game.reputation, [...r.game.fired], r.game.detentions]);

describe('nothing a watcher does reaches the match', () => {
  it('whatever they send, in the office and at a meeting, also in a developer match', () => {
    for (const dev of [false, true]) {
      const r = match({ dev });
      out(r, 'p2');
      const tryAll = () => {
        const before = everything(r);
        for (const [type, payloads] of Object.entries(ALL_MESSAGES)) for (const payload of payloads) r.send('r', type, payload);
        expect(everything(r)).toBe(before);
      };
      tryAll();
      callMeeting(r);
      accuse(r, 'p4');
      tryAll();
      r.tick(45);
      expect(r.game.meetings.current!.phase).toBe('voting');
      tryAll();
      expect(r.game.publicState().players.p2).toBeUndefined();
    }
  });

  it('a whole office with bots goes exactly the same way whether they are busy or silent', () => {
    const play = (busy: boolean) => {
      const r = match({ bots: true, seed: 7 });
      out(r, 'p2');
      for (let i = 0; i < 1200; i++) {
        if (busy && i % 5 === 0) {
          r.game.handle('r', 'chat.send', { text: `line ${i}`, channel: i % 2 ? 'hackers' : 'room' });
          r.game.handle('r', 'move', { dx: 1, dy: 0 });
          r.game.handle('r', 'choose', { playerId: 'p5' });
        }
        r.game.tick(50);
        r.flush();
        if (i % 100 === 0) r.send('s', 'chat.send', { text: `at ${i}` });
      }
      const others = Object.keys(CAST).filter((c) => c !== 'r').map((c) => r.messages(c));
      return { world: everything(r), others: JSON.stringify(others), states: JSON.stringify(r.states.slice(-5)) };
    };
    const silent = play(false);
    const busy = play(true);
    expect(busy.world).toBe(silent.world);
    expect(busy.others).toBe(silent.others);
    expect(busy.states).toBe(silent.states);
  });

  it('when they close the page nobody notices, and no bot comes in their place', () => {
    const r = match({ bots: true, seed: 7 });
    out(r, 'p2');
    const before = everything(r);
    const sent = Object.keys(CAST).filter((c) => c !== 'r').map((c) => r.messages(c).length);
    r.game.disconnect('r');
    r.flush();
    expect(everything(r)).toBe(before);
    expect(Object.keys(CAST).filter((c) => c !== 'r').map((c) => r.messages(c).length)).toEqual(sent);
    r.tick(2000);
    expect(r.game.publicState().players.p2).toBeUndefined();
  });
});

describe('what a watcher hears and sees', () => {
  it('open chat of every room, with the room; the living do not get that', () => {
    const r = match();
    out(r, 'p2');
    r.send('s', 'chat.send', { text: 'in Finance' });
    r.send('l', 'chat.send', { text: 'in HR' });
    expect(heard(r, 'r').map((l) => [l.text, l.room])).toEqual([['in Finance', 'Finance'], ['in HR', r.map.rooms.find((x) => /HR/.test(x.name))?.name]]);
    for (const c of ['s', 'l', 'o', 'm']) expect(JSON.stringify(heard(r, c))).not.toContain('"room":"');
    expect(heard(r, 'o')).toEqual([]);
  });

  it('meetings, the evidence board, security alerts and what is announced', () => {
    const r = match();
    r.sitAt('s', 'p1', 'FIN-LT-07');
    r.type('s', PW['s.alharbi']);
    r.sitAt('r', 'p2', 'FIN-LT-04');
    r.type('r', PW['r.mansour']);
    r.send('r', 'evidence.pin', { kind: 'screen', text: r.type('r', 'hostname').trim() });
    out(r, 'p2');
    const items = () => (r.last('r', 'board')!.payload as { items: EvidenceView[] }).items;
    // Their own pin stays on the board, but is no longer theirs to take down.
    expect(items().map((i) => [i.pinnedBy, i.mine])).toEqual([['Rami Mansour', false]]);
    r.send('s', 'evidence.pin', { kind: 'screen', text: r.type('s', 'hostname').trim() });
    expect(items()).toHaveLength(2);
    // An alert.
    const log = r.game.world.events;
    log.push({ ...clone(log[0]), type: 'security.alert', details: { severity: 'high' } });
    r.tick();
    expect(r.last('r', 'alert')).toBeDefined();
    expect(r.messages('r', 'alert')).toHaveLength(r.messages('s', 'alert').length);
    // A caught hacker is announced.
    r.send('s', 'stand');
    callMeeting(r);
    expect(r.last('r', 'meeting')!.payload as MeetingView).toMatchObject({ active: true, canVote: false });
    r.send('s', 'chat.send', { text: 'who was it?' });
    expect(heard(r, 'r').at(-1)).toMatchObject({ channel: 'meeting', text: 'who was it?' });
    accuse(r, 'p4');
    r.tick(45);
    for (const c of ['s', 'l', 'm', 'o']) r.send(c, 'meeting.vote', { target: c === 'o' ? 'skip' : 'p4' });
    r.tick(2);
    expect(r.game.fired.has('p4')).toBe(true);
    expect(r.notice('r')).toBe('Omar Farouk was a hacker. One hacker is still out there.');
    expect(r.notice('s')).toBe('Omar Farouk was a hacker. One hacker is still out there.');
  });

  it('no secrets: no screens, tasks or cards, no private chat, nobody’s role', () => {
    const r = match();
    r.sitAt('r', 'p2', 'FIN-LT-04');
    r.type('r', PW['r.mansour']);
    out(r, 'p2');
    const from = r.messages('r').length;
    r.sitAt('s', 'p1', 'FIN-LT-07');
    r.type('s', PW['s.alharbi']);
    r.type('s', 'echo only Sara sees this');
    r.send('o', 'chat.send', { text: 'partners only', channel: 'hackers' });
    r.tick(100);
    const after = r.messages('r').slice(from);
    expect([...new Set(after.map((m) => m.type))].filter((t) => !['chat', 'notice', 'alert', 'board', 'meeting'].includes(t))).toEqual([]);
    expect(JSON.stringify(after)).not.toMatch(/only Sara sees this|partners only|"hackers"/);
  });

  it('a caught hacker does not hear the private chat either', () => {
    const r = match();
    r.game.world.mission.caught.push('p4');
    out(r, 'p4');
    r.send('l', 'chat.send', { text: 'they got Omar', channel: 'hackers' });
    expect(heard(r, 'o')).toEqual([]);
  });

  it('the end of the match and the debrief; after it they are as silent as everybody', () => {
    const r = match();
    out(r, 'p2');
    (r.game as unknown as { endMatch(w: string, why: string): void }).endMatch('defenders', 'Test.');
    r.flush();
    expect(r.last('r', 'match.over')!.payload).toMatchObject({ winner: 'defenders' });
    expect(r.last('r', 'debrief')).toBeDefined();
    r.send('r', 'chat.send', { text: 'after the end' });
    expect(r.game.chatLog).toEqual([]);
  });

  it('several people who are out talk to each other, also during a meeting, within the same limits', () => {
    const r = match();
    out(r, 'p2');
    out(r, 'p1');
    r.send('r', 'chat.send', { text: 'so it is you too' });
    for (const c of ['r', 's']) expect(heard(r, c).at(-1)).toMatchObject({ channel: 'fired', text: 'so it is you too' });
    callMeeting(r);
    r.send('s', 'chat.send', { text: 'watch Lina' });
    expect(heard(r, 'r').at(-1)).toMatchObject({ channel: 'fired', text: 'watch Lina' });
    for (const c of ['l', 'o', 'm']) expect(JSON.stringify(heard(r, c))).not.toMatch(/so it is you too|watch Lina/);
    for (let i = 0; i < 20; i++) r.send('s', 'chat.send', { text: `x${i}` });
    expect(r.notice('s')).toBe('You are writing too fast. Wait a moment.');
  });
});

describe('the shared office', () => {
  it('who is out cannot come back as somebody else, and nobody can become the one who is out', () => {
    const r = new Recorder({ meetingTimes: FAST });
    r.connect('s', 'p1');
    r.connect('r', 'p2');
    out(r, 'p2');
    const lobbies = r.messages('r', 'lobby').length;
    r.send('r', 'choose', { playerId: 'p5' });
    r.send('r', 'choose', { playerId: 'p5', hacker: true });
    expect(Object.keys(r.game.publicState().players)).toEqual(['p1']);
    r.connect('new');
    r.send('new', 'choose', { playerId: 'p2' });
    expect(r.notice('new')).toBe('Rami Mansour is out of this match.');
    expect(Object.keys(r.game.publicState().players)).toEqual(['p1']);
    r.send('new', 'choose', { playerId: 'p5' });
    expect(Object.keys(r.game.publicState().players)).toEqual(['p1', 'p5']);
    // A watcher is not on the start screen: they are not sent its news.
    expect(r.messages('r', 'lobby')).toHaveLength(lobbies);
  });
});
