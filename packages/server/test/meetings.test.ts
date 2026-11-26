/**
 * Phase 5, part D: emergency meetings, accusations, voting, firing, fired
 * players, and the company's reputation.
 */
import { describe, expect, it } from 'vitest';
import { TICK_RATE, type MeetingView } from '@insider/shared';
import { countVotes } from '../src/meeting';
import { PW, Recorder } from './helpers';

const seconds = (s: number) => Math.round(s * TICK_RATE);
/** Short meetings for tests: 5 s discussion, 5 s voting, 1 s result, no cooldown. */
const FAST = { discussionMs: 5000, votingMs: 5000, resultMs: 1000, cooldownMs: 0 };
const view = (r: Recorder, c: string) => r.last(c, 'meeting')!.payload as MeetingView;

/** Walks a player to the emergency button. */
function toButton(r: Recorder, client: string, playerId: string): void {
  const b = r.map.furniture.find((f) => f.kind === 'button')!;
  expect(r.walkTo(client, playerId, b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
}

/** Pins three lines from a PC screen, so an accusation can be made. Returns their ids. */
function threePins(r: Recorder, client: string, playerId: string, desk: string, password: string): string[] {
  r.sitAt(client, playerId, desk);
  r.type(client, password);
  for (const cmd of ['hostname', 'whoami', 'pwd']) r.send(client, 'evidence.pin', { kind: 'screen', text: r.type(client, cmd).trim() });
  r.send(client, 'stand');
  return r.game.board.items.filter((i) => i.pinnedBy === r.game.publicState().players[playerId]?.name).map((i) => i.id);
}

describe('counting votes', () => {
  it('the single highest wins if it beats skip; ties and skip fire nobody', () => {
    const voters = ['a', 'b', 'c', 'd', 'e'];
    expect(countVotes({ a: 'x', b: 'x', c: 'skip' }, voters)).toMatchObject({ firedId: 'x', skips: 1, abstained: 2 });
    expect(countVotes({ a: 'x', b: 'y' }, voters).firedId).toBeNull(); // tie
    expect(countVotes({ a: 'x', b: 'skip' }, voters).firedId).toBeNull(); // as many skips
    expect(countVotes({ a: 'x', b: 'x', c: 'y', d: 'skip' }, voters).firedId).toBe('x');
    expect(countVotes({ z: 'x' }, voters).firedId).toBeNull(); // not a voter
  });
});

describe('calling a meeting', () => {
  it('the button gathers everybody at the meeting table, stands them up, and freezes walking', () => {
    const r = new Recorder({ meetingTimes: FAST });
    r.connect('s', 'p1');
    r.connect('m', 'p9');
    r.sitAt('s', 'p1', 'FIN-LT-07');
    r.type('s', PW['s.alharbi']);
    toButton(r, 'm', 'p9');
    r.send('m', 'meeting.call');
    const v = view(r, 's');
    expect(v).toMatchObject({ active: true, number: 1, phase: 'discussion', calledBy: 'Maha Yousef' });
    expect(r.last('s', 'term.close')).toBeDefined(); // Sara was stood up...
    expect(r.game.publicState().desks['FIN-LT-07'].screen).toBe('unlocked'); // ...her PC stays open behind her
    const table = r.map.furniture.find((f) => f.name === 'Meeting table')!;
    for (const id of ['p1', 'p9']) {
      const p = r.position(id);
      expect(Math.hypot(p.x - (table.x + table.width / 2), p.y - (table.y + table.height / 2))).toBeLessThan(5 * 32);
    }
    const before = r.position('p1');
    r.send('s', 'move', { dx: 1, dy: 0 });
    r.tick(seconds(1));
    expect(r.position('p1')).toEqual(before);
    r.send('s', 'sit', { hostname: 'FIN-LT-07' }); // nothing but talking, accusing and voting
    expect(r.position('p1')).toMatchObject({ seatedAt: '' });
  });

  it('works only at the button, once per player, and not during another meeting', () => {
    const r = new Recorder({ meetingTimes: FAST });
    r.connect('m', 'p9');
    r.send('m', 'meeting.call');
    expect(r.notice('m')).toContain('The emergency button is in the meeting room');
    toButton(r, 'm', 'p9');
    expect(view(r, 'm').usesLeft).toBe(1);
    r.send('m', 'meeting.call');
    r.tick(seconds(12)); // discussion with no accusation -> straight to the result, then over
    expect(view(r, 'm')).toMatchObject({ active: false, usesLeft: 0 });
    toButton(r, 'm', 'p9');
    r.send('m', 'meeting.call');
    expect(r.notice('m')).toBe('You have already used your emergency meeting.');
  });

  it('without an accusation there is no vote; nobody is fired', () => {
    const r = new Recorder({ meetingTimes: FAST });
    r.connect('m', 'p9');
    toButton(r, 'm', 'p9');
    r.send('m', 'meeting.call');
    r.tick(seconds(5.2));
    expect(view(r, 'm')).toMatchObject({ phase: 'result', result: { fired: '', tally: [] } });
    r.tick(seconds(1.2));
    expect(view(r, 'm').active).toBe(false);
    expect(r.game.fired.size).toBe(0);
  });
});

describe('accusing and voting', () => {
  /** Sara pins 3 items, Maha calls a meeting, Sara accuses Omar. */
  function accused(hacker: string | null, times: Partial<typeof FAST & { defenceMs: number }> = FAST): Recorder {
    const r = new Recorder({ meetingTimes: { ...FAST, ...times } });
    if (hacker) {
      r.connect('o');
      r.send('o', 'choose', { playerId: 'p4', hacker: hacker === 'p4' });
      if (hacker !== 'p4') r.game.world.mission.hackers = [hacker];
    } else r.connect('o', 'p4');
    r.connect('s', 'p1');
    r.connect('m', 'p9');
    const pins = threePins(r, 's', 'p1', 'FIN-LT-07', PW['s.alharbi']);
    expect(pins).toHaveLength(3);
    toButton(r, 'm', 'p9');
    r.send('m', 'meeting.call');
    r.send('s', 'meeting.accuse', { suspect: 'p4', evidence: pins });
    return r;
  }

  it('an accusation needs 3 items of the board, a living suspect other than yourself, and one per person', () => {
    const r = accused(null);
    expect(view(r, 'm').accusations).toEqual([{ id: 'A1', accuser: 'Sara Alharbi', suspectId: 'p4', suspect: 'Omar Farouk', evidence: ['E1', 'E2', 'E3'] }]);
    r.send('m', 'meeting.accuse', { suspect: 'p1', evidence: ['E1', 'E2'] });
    expect(r.notice('m')).toBe('An accusation needs at least 3 items from the evidence board.');
    r.send('m', 'meeting.accuse', { suspect: 'p1', evidence: ['E1', 'E2', 'E99'] });
    expect(r.notice('m')).toBe('An accusation needs at least 3 items from the evidence board.');
    r.send('m', 'meeting.accuse', { suspect: 'p9', evidence: ['E1', 'E2', 'E3'] });
    expect(r.notice('m')).toBe('Choose someone else who is still at the company.');
    r.send('s', 'meeting.accuse', { suspect: 'p9', evidence: ['E1', 'E2', 'E3'] });
    expect(r.notice('s')).toBe('You have already made an accusation in this meeting.');
  });

  it('the defence: after the discussion each accused has the floor, then the vote; nobody votes or accuses meanwhile', () => {
    const r = accused(null, { defenceMs: 3000 });
    r.send('m', 'meeting.accuse', { suspect: 'p1', evidence: ['E1', 'E2', 'E3'] });
    r.tick(seconds(5.2));
    // Omar first (the first accused), then Sara.
    expect(view(r, 's')).toMatchObject({ phase: 'defence', floor: { id: 'p4', name: 'Omar Farouk', turn: 1, of: 2 } });
    expect(view(r, 's').floor!.endsIn).toBeGreaterThan(2000);
    r.send('s', 'meeting.vote', { target: 'p4' });
    expect(r.notice('s')).toBe('There is no vote right now.');
    r.send('o', 'meeting.accuse', { suspect: 'p9', evidence: ['E1', 'E2', 'E3'] });
    expect(r.notice('o')).toBe('Accusations can only be made during the discussion.');
    // The accused can answer: the meeting chat works.
    r.send('o', 'chat.send', { text: 'I was at my desk all morning.' });
    r.tick(seconds(3));
    expect(view(r, 'm')).toMatchObject({ phase: 'defence', floor: { id: 'p1', name: 'Sara Alharbi', turn: 2, of: 2 } });
    r.tick(seconds(3.2));
    expect(view(r, 'm')).toMatchObject({ phase: 'voting', floor: null });
    r.send('s', 'meeting.vote', { target: 'p4' });
    expect(view(r, 's').myVote).toBe('p4');
  });

  it('voting: one vote each, only for an accused person or skip; who voted is public, not what', () => {
    const r = accused(null);
    r.send('s', 'meeting.vote', { target: 'p4' });
    expect(r.notice('s')).toBe('There is no vote right now.');
    r.tick(seconds(5.2));
    expect(view(r, 's').phase).toBe('voting');
    r.send('s', 'meeting.vote', { target: 'p9' });
    expect(r.notice('s')).toBe('You can only vote for someone who was accused, or skip.');
    r.send('s', 'meeting.vote', { target: 'p4' });
    r.send('s', 'meeting.vote', { target: 'skip' });
    expect(r.notice('s')).toBe('You have already voted.');
    expect(view(r, 's')).toMatchObject({ myVote: 'p4', voted: ['Sara Alharbi'] });
    expect(view(r, 'm')).toMatchObject({ myVote: '', voted: ['Sara Alharbi'] });
  });

  it('voting out an innocent person fires them; they become a ghost; reputation drops; the game goes on', () => {
    const r = accused(null);
    r.tick(seconds(5.2));
    r.send('s', 'meeting.vote', { target: 'p4' });
    r.send('m', 'meeting.vote', { target: 'p4' });
    r.send('o', 'meeting.vote', { target: 'skip' });
    r.tick(2); // everybody voted: no waiting
    expect(view(r, 's')).toMatchObject({ phase: 'result', result: { fired: 'Omar Farouk', wasHacker: false, skips: 1, tally: [{ id: 'p4', name: 'Omar Farouk', votes: 2 }] } });
    expect(r.last('o', 'fired')).toBeDefined();
    expect(r.game.publicState().players.p4).toBeUndefined(); // gone from the office
    expect(r.game.publicState().reputation).toBe(75);
    expect(r.messages('s', 'match.over')).toEqual([]);
    // A fired employee cannot be picked again.
    r.connect('late');
    const lobby = r.last('late', 'lobby')!.payload as { employees: { id: string; taken: boolean }[] };
    expect(lobby.employees.find((e) => e.id === 'p4')!.taken).toBe(true);
  });

  it('voting out the hacker ends the match: the defenders win', () => {
    const r = accused('p4');
    r.tick(seconds(5.2));
    for (const c of ['s', 'm']) r.send(c, 'meeting.vote', { target: 'p4' });
    r.send('o', 'meeting.vote', { target: 'skip' });
    r.tick(2);
    for (const c of ['s', 'm', 'o']) {
      expect(r.last(c, 'match.over')!.payload, c).toMatchObject({ winner: 'defenders', hacker: 'Omar Farouk', reason: 'Omar Farouk was voted out. They were the hacker.' });
    }
    // After the end nothing moves and nobody can hand in a flag.
    r.send('o', 'flag.submit', { text: 'anything' });
    expect(r.game.world.mission.won).toBeNull();
  });
});

describe('chat and fired players', () => {
  it('meeting chat reaches everybody, in whatever room they were', () => {
    const r = new Recorder({ meetingTimes: FAST });
    r.connect('s', 'p1');
    r.connect('m', 'p9');
    toButton(r, 'm', 'p9');
    r.send('m', 'meeting.call');
    r.send('m', 'chat.send', { text: 'Who was at the server room door at 09:12?' });
    for (const c of ['s', 'm']) expect(r.last(c, 'chat')!.payload).toMatchObject({ channel: 'meeting', from: 'Maha Yousef', text: 'Who was at the server room door at 09:12?' });
    expect(r.game.chatLog).toHaveLength(1);
  });

  it('fired players can read the meeting, talk only to each other, and do nothing else', () => {
    const r = new Recorder({ meetingTimes: FAST });
    r.connect('o', 'p4');
    r.connect('s', 'p1');
    r.connect('m', 'p9');
    const pins = threePins(r, 's', 'p1', 'FIN-LT-07', PW['s.alharbi']);
    toButton(r, 'm', 'p9');
    r.send('m', 'meeting.call');
    r.send('s', 'meeting.accuse', { suspect: 'p4', evidence: pins });
    r.tick(seconds(5.2));
    for (const c of ['s', 'm']) r.send(c, 'meeting.vote', { target: 'p4' });
    r.tick(seconds(5.5)); // Omar never voted: the vote ends on time
    expect(r.game.fired.has('p4')).toBe(true);
    r.tick(seconds(1.5)); // the meeting is over

    r.send('o', 'chat.send', { text: 'It was not me!' });
    expect(r.last('o', 'chat')!.payload).toMatchObject({ channel: 'fired', from: 'Omar Farouk' });
    for (const c of ['s', 'm']) expect(JSON.stringify(r.sent.get(c))).not.toContain('It was not me!');
    // No body, no PCs, no button, no pins, no votes.
    for (const [type, payload] of [['move', { dx: 1, dy: 0 }], ['sit', { hostname: 'MKT-LT-11' }], ['meeting.call', {}], ['evidence.pin', { kind: 'screen', text: 'x' }]] as const) r.send('o', type, payload);
    expect(r.game.publicState().players.p4).toBeUndefined();
    // In the next meeting Omar can read the chat but not vote.
    const pins2 = threePins(r, 'm', 'p9', 'REC-PC-01', PW['m.yousef']);
    toButton(r, 's', 'p1');
    r.send('s', 'meeting.call');
    r.send('m', 'meeting.accuse', { suspect: 'p1', evidence: pins2 });
    r.send('s', 'chat.send', { text: 'Second meeting' });
    expect(r.last('o', 'chat')!.payload).toMatchObject({ channel: 'meeting', text: 'Second meeting' });
    expect(view(r, 'o')).toMatchObject({ active: true, canVote: false });
  });

  it('a fired bot leaves the office for good', () => {
    const r = new Recorder({ meetingTimes: FAST, bots: true });
    r.tick(seconds(250)); // everybody has arrived
    r.connect('s', 'p1');
    r.connect('m', 'p9');
    const pins = threePins(r, 's', 'p1', 'FIN-LT-07', PW['s.alharbi']);
    toButton(r, 'm', 'p9');
    r.send('m', 'meeting.call');
    r.send('s', 'meeting.accuse', { suspect: 'p7', evidence: pins }); // Yousef, a bot
    r.tick(seconds(5.2));
    for (const c of ['s', 'm']) r.send(c, 'meeting.vote', { target: 'p7' });
    r.tick(seconds(7));
    expect(r.game.fired.has('p7')).toBe(true);
    expect(r.game.publicState().players.p7).toBeUndefined();
    expect(r.game.bots!.has('p7')).toBe(false);
    r.tick(seconds(300));
    expect(r.game.publicState().players.p7).toBeUndefined(); // no bot comes back as Yousef
  });
});
