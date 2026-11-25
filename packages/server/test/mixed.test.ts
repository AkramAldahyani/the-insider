/**
 * Phase 6, part G: people and bots in one match. When bots help to judge, how
 * many votes it takes, and what the difficulty of a lobby means.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARTY_SETTINGS, PARTY_VOTES_NEEDED, SOLO_DIFFICULTIES, type MeetingView, type PartySettings } from '@insider/shared';
import { Random } from '../src/bots/random';
import { deal } from '../src/deal';
import { countVotes } from '../src/meeting';
import { partyGameOptions } from '../src/party';
import { LEVELS } from '../src/solo';
import { Recorder, clone, scenario, tiledMap } from './helpers';

const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small', dev: false };
const FAST = { discussionMs: 3000, votingMs: 3000, resultMs: 500, cooldownMs: 0, usesPerPlayer: 9, votesNeeded: PARTY_VOTES_NEEDED };
const ALL = scenario.players.map((p) => p.id);

/** A lobby's match in which these employees are people (the browser of p1 is called "p1"). Omar (p4) is the hacker. */
function match(people: string[], options: ConstructorParameters<typeof Recorder>[0] = {}): Recorder {
  const r = new Recorder({ ...base, assigned: true, bots: true, hackers: ['p4'], meetingTimes: FAST, seed: 5, ...options, botOptions: { hacker: true, ...options.botOptions } });
  for (const id of people) r.game.seat(id, id);
  r.game.everybodyIsIn();
  r.flush();
  return r;
}
const view = (r: Recorder, c: string) => r.last(c, 'meeting')!.payload as MeetingView;
const seconds = (s: number) => Math.round(s * 20);

/** Puts lines on the board as if somebody had pinned them. Returns their ids. */
function pins(r: Recorder, ...texts: string[]): string[] {
  return texts.map((text) => r.game.board.add({ time: r.game.world.time, pinnedBy: 'Sara Alharbi', pinnedById: 'p1', kind: 'screen', title: 'FIN-LT-07 screen', text, shown: text })!.id);
}
const JUNK = ['FIN-LT-07', 's.alharbi', '/home/s.alharbi'];
/** Three lines that point at Omar, two of them out of the ordinary. */
const PROOF = [
  'Mar  2 09:10:01 ADMIN-SRV-01 sudo: o.farouk : user NOT in sudoers ; COMMAND=/bin/cat /root/flag.txt',
  'Mar  2 09:12:31 ADMIN-SRV-01 su: (to root) o.farouk on pts/0',
  'Mar  2 09:12:00 ADMIN-SRV-01 sshd[90]: Accepted password for o.farouk from 10.0.1.11 port 50000 ssh2',
];

/** `by` calls a meeting and accuses `suspect` with this evidence; then the people vote. Plays on until the result. */
function trial(r: Recorder, by: string, suspect: string, evidence: string[], votes: Record<string, string>): NonNullable<MeetingView['result']> {
  const b = r.map.furniture.find((f) => f.kind === 'button')!;
  expect(r.walkTo(by, by, b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
  r.send(by, 'meeting.call');
  r.send(by, 'meeting.accuse', { suspect, evidence });
  expect(view(r, by).accusations).toHaveLength(1);
  while (view(r, by).phase === 'discussion') r.tick();
  for (const [voter, target] of Object.entries(votes)) r.send(voter, 'meeting.vote', { target });
  for (let i = 0; i < seconds(4) && !view(r, by).result; i++) r.tick();
  return view(r, by).result!;
}

describe('how many votes it takes', () => {
  it('the count: never with fewer than needed, and a tie or as many skips still fire nobody', () => {
    const voters = ['a', 'b', 'c', 'd'];
    expect(countVotes({ a: 'x' }, voters, 2).firedId).toBeNull();
    expect(countVotes({ a: 'x', b: 'x' }, voters, 2).firedId).toBe('x');
    expect(countVotes({ a: 'x', b: 'x', c: 'skip', d: 'skip' }, voters, 2).firedId).toBeNull();
    expect(countVotes({ a: 'x', b: 'x', c: 'y', d: 'y' }, voters, 2).firedId).toBeNull();
    expect(countVotes({ a: 'x' }, voters).firedId).toBe('x');
  });

  it('a lobby: one person alone fires nobody, two do', () => {
    const r = match(['p1', 'p2', 'p4', 'p9'], { bots: false });
    expect(trial(r, 'p1', 'p9', pins(r, ...JUNK), { p1: 'p9' })).toMatchObject({ fired: '', tally: [{ id: 'p9', votes: 1 }] });
    expect(view(r, 'p1').votesNeeded).toBe(2);
    r.tick(seconds(2));
    expect(trial(r, 'p1', 'p9', ['E1', 'E2', 'E3'], { p1: 'p9', p2: 'p9' })).toMatchObject({ fired: 'Maha Yousef' });
  });

  it('elsewhere one is enough, as before', () => {
    expect(new Recorder().game.meetings.times.votesNeeded).toBe(1);
  });
});

describe('bots judge while people are few', () => {
  it('fewer than half of those at the meeting: 5 of 11 people yes, 6 of 11 no; without bots never', () => {
    for (const [n, judged] of [[2, true], [5, true], [6, false], [10, false]] as const) {
      const people = ['p1', 'p4', ...ALL.filter((id) => id !== 'p1' && id !== 'p4')].slice(0, n);
      const r = match(people);
      const result = trial(r, 'p1', 'p4', pins(r, ...JUNK), {});
      expect(view(r, 'p1').judged, `${n} people`).toBe(judged);
      // Weak evidence: judging bots skip, the others have no opinion.
      expect(result.skips > 0, `${n} people`).toBe(judged);
    }
    const none = match(['p1', 'p2', 'p4'], { bots: false });
    trial(none, 'p1', 'p4', pins(none, ...JUNK), {});
    expect(view(none, 'p1').judged).toBe(false);
  });

  it('weak evidence fires nobody, even if all the people agree', () => {
    const r = match(['p1', 'p2', 'p9']);
    const result = trial(r, 'p1', 'p3', pins(r, ...JUNK), { p1: 'p3', p2: 'p3', p9: 'p3' });
    expect(result).toMatchObject({ fired: '' });
    expect(result.skips).toBeGreaterThan(3);
    expect(r.game.reputation).toBe(100);
    // One of them says why.
    const said = r.messages('p1', 'chat').map((m) => (m.payload as { text: string }).text);
    expect(said.some((t) => t.includes('None of that evidence says anything about Lina Haddad'))).toBe(true);
  });

  it('good evidence convinces them: one defender can have the hacker voted out', () => {
    for (const people of [['p1', 'p2'], ['p1', 'p4', 'p9']]) {
      const r = match(people);
      const result = trial(r, 'p1', 'p4', pins(r, ...PROOF), { p1: 'p4' });
      expect(result, people.join()).toMatchObject({ fired: 'Omar Farouk', wasHacker: true });
      expect(r.game.over?.winner).toBe('defenders');
    }
  });

  it('it can be used against an innocent person too: they judge the evidence, they do not know the truth', () => {
    const r = match(['p1', 'p2', 'p4']);
    const about = (text: string) => text.replaceAll('o.farouk', 'l.haddad');
    expect(trial(r, 'p4', 'p3', pins(r, ...PROOF.map(about)), { p4: 'p3' })).toMatchObject({ fired: 'Lina Haddad', wasHacker: false });
    expect(r.game.reputation).toBe(75);
  });

  it('many people: they decide alone, and bots have only what they saw themselves', () => {
    const people = ['p1', 'p2', 'p3', 'p4', 'p5', 'p9'];
    const r = match(people);
    expect(trial(r, 'p1', 'p4', pins(r, ...PROOF), { p1: 'p4' })).toMatchObject({ fired: '', skips: 0 });
    r.tick(seconds(2));
    expect(trial(r, 'p1', 'p9', ['E1', 'E2', 'E3'], { p1: 'p9', p2: 'p9' })).toMatchObject({ fired: 'Maha Yousef' });
    expect(r.messages('p1', 'chat').map((m) => (m.payload as { text: string }).text).some((t) => /convinces me|I will not fire/.test(t))).toBe(false);
  });

  it('people who are out no longer count: the rule can begin in the middle of a match', () => {
    const people = ['p1', 'p2', 'p3', 'p4', 'p5', 'p9'];
    const r = match(people);
    for (const id of ['p2', 'p5']) (r.game as unknown as { takeOut(id: string, why: string): void }).takeOut(id, 'Out.');
    r.flush();
    trial(r, 'p1', 'p4', pins(r, ...JUNK), {});
    expect(view(r, 'p1').judged).toBe(true); // 4 people of 9
  });

  it('who lost the connection still counts as a person, so the rule does not tell that somebody is away', () => {
    const people = ['p1', 'p2', 'p3', 'p4', 'p5', 'p9'];
    const r = match(people);
    r.game.connectionLost('p9');
    r.game.standIn('p9');
    r.flush();
    trial(r, 'p1', 'p4', pins(r, ...JUNK), {});
    expect(view(r, 'p1').judged).toBe(false);
    // Who left for good does not (the lobby's list shows that anyway).
    const q = match(people);
    q.game.disconnect('p9');
    q.flush();
    trial(q, 'p1', 'p4', pins(q, ...JUNK), {});
    expect(view(q, 'p1').judged).toBe(true);
  });

  it('a computer hacker does not vote for its partner, whatever the evidence', () => {
    const r = match(['p1', 'p2'], { hackers: ['p4', 'p3'] });
    trial(r, 'p1', 'p4', pins(r, ...PROOF), { p1: 'p4' });
    const m = r.game.meetings.history[0];
    expect(m.votes.p3).not.toBe('p4');
    expect(m.result!.firedId).toBe('p4');
  });

  it('the vote does not wait for bots without an opinion, and nobody is told who they are', () => {
    const people = ['p1', 'p2', 'p3', 'p4', 'p5', 'p9'];
    const r = match(people, { meetingTimes: { ...FAST, votingMs: 60_000 } });
    const b = r.map.furniture.find((f) => f.kind === 'button')!;
    expect(r.walkTo('p1', 'p1', b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
    r.send('p1', 'meeting.call');
    r.send('p1', 'meeting.accuse', { suspect: 'p4', evidence: pins(r, ...JUNK) });
    while (view(r, 'p1').phase === 'discussion') r.tick();
    for (const id of people) r.send(id, 'meeting.vote', { target: 'skip' });
    r.tick(seconds(1));
    expect(view(r, 'p1').phase).toBe('voting'); // the bots take their time...
    r.tick(seconds(45));
    expect(view(r, 'p1').phase).not.toBe('voting'); // ...but not the whole minute
    expect(JSON.stringify([...r.sent.values()])).not.toContain('passed');
    expect(r.game.meetings.history[0].result!.abstained).toBe(5);
  });

  it('a solo match judges as before; the shared office never does', () => {
    const r = new Recorder({ bots: true, meetingTimes: { ...FAST, votesNeeded: 1 } });
    r.tick(seconds(250));
    r.connect('p1', 'p1');
    trial(r, 'p1', 'p4', pins(r, ...JUNK), {});
    expect(view(r, 'p1').judged).toBe(false);
  });
});

describe('the difficulty of a lobby', () => {
  const settings = (s: Partial<PartySettings>): PartySettings => ({ ...DEFAULT_PARTY_SETTINGS, ...s });
  const options = (s: Partial<PartySettings>, seed: number, people = 3) => {
    const d = deal(scenario.players, Array.from({ length: people }, (_, i) => `net${i}`), settings(s), new Random(seed));
    return { d, o: partyGameOptions(base, settings(s), seed, d) };
  };

  it('is how many ways in the office has, and there is always one that needs nobody’s mistake', () => {
    for (const difficulty of SOLO_DIFFICULTIES) {
      for (let seed = 1; seed <= 60; seed++) {
        const { o } = options({ difficulty }, seed);
        const list = o.weaknesses as string[];
        expect(list).toHaveLength(LEVELS[difficulty].weaknesses);
        expect(new Set(list).size).toBe(list.length);
        expect(list.some((w) => w === 'plaintext-password' || w === 'weak-admin-password')).toBe(true);
        expect(o.botOptions).toMatchObject({ forgetLock: LEVELS[difficulty].forgetLock, hackerDifficulty: difficulty, pinClues: 0 });
      }
    }
  });

  it('a careless administrator only where a bot is the administrator', () => {
    const seen = new Set<boolean>();
    for (let seed = 1; seed <= 200; seed++) {
      const { d, o } = options({ difficulty: 'hard' }, seed, 5);
      const person = [...d.seats.values()].includes('p5');
      const careless = (o.weaknesses as string[]).includes('careless-admin');
      if (person) expect(careless).toBe(false);
      else if (careless) seen.add(true);
      expect(options({ difficulty: 'hard', bots: false }, seed, 5).o.weaknesses).not.toContain('careless-admin');
    }
    expect(seen.has(true)).toBe(true);
  });

  it('the office is the same whether the hacker is a person or not', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const o = (human: boolean) => partyGameOptions(base, settings({}), seed, { hackers: ['p4'], human, seats: new Map([['a', 'p1'], ['b', human ? 'p4' : 'p2']]) });
      expect(o(true).weaknesses).toEqual(o(false).weaknesses);
      expect(o(true).botOptions).toEqual(o(false).botOptions);
    }
  });

  it('the operator’s own weaknesses come first', () => {
    const d = { hackers: ['p4'], human: false };
    expect(partyGameOptions({ ...base, weaknesses: ['tailgate'] }, settings({}), 1, d).weaknesses).toEqual(['tailgate']);
    expect(partyGameOptions({ ...base, weaknesses: [] }, settings({}), 1, d).weaknesses).toEqual([]);
    expect(partyGameOptions({ ...base, weaknesses: 'random' }, settings({}), 1, d).weaknesses).toHaveLength(3);
  });

  it('a whole match of two idle people ends on every level, and no bot pins anything (its name would be announced)', () => {
    const lengths: Record<string, number> = {};
    for (const difficulty of SOLO_DIFFICULTIES) {
      const { d, o } = options({ difficulty, hacker: 'bot' }, 11, 2);
      const r = new Recorder({ ...o, botOptions: { ...o.botOptions, hackerPace: undefined } });
      for (const [c, id] of d.seats) r.game.seat(c, id);
      r.game.everybodyIsIn();
      const start = r.game.world.time;
      for (let i = 0; i < 90 * 600 && !r.game.over; i++) {
        r.game.tick(100);
        if (i % 20 === 0) r.flush();
      }
      r.flush();
      expect(r.game.over?.winner, difficulty).toBe('hacker');
      expect(r.game.board.items).toEqual([]);
      expect(JSON.stringify(r.messages('net0', 'notice'))).not.toContain('pinned something');
      lengths[difficulty] = (r.game.over!.at - start) / 60_000;
    }
    expect(lengths.easy).toBeGreaterThan(lengths.hard);
  }, 60_000);
});
