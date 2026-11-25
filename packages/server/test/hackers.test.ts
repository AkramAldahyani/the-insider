/**
 * Phase 6, part C: matches with two or three hackers. They know each other, one
 * caught hacker does not end the match, and either side wins as the design says.
 */
import { describe, expect, it } from 'vitest';
import { activeHackers, escalate, submitFlag, type GameEvent } from '@insider/engine';
import { DEFAULT_PARTY_SETTINGS, hackerCount, type DebriefView, type MissionBriefing, type PartySettings } from '@insider/shared';
import { Random } from '../src/bots/random';
import { deal } from '../src/deal';
import { Party, partyGameOptions } from '../src/party';
import { PW, Recorder, clone, scenario, tiledMap } from './helpers';

const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small', dev: false };
const settings = (s: Partial<PartySettings> = {}): PartySettings => ({ ...DEFAULT_PARTY_SETTINGS, ...s });
const people = (n: number) => Array.from({ length: n }, (_, i) => `net${i}`);
const many = (n: number, s: Partial<PartySettings>, times = 200) => Array.from({ length: times }, (_, seed) => deal(scenario.players, people(n), settings(s), new Random(seed)));

/** Omar (p4) and Lina (p3) are the hackers; Sara (p1), Maha (p9) and the guard Tariq (p10) are not. No bots unless asked for. */
const CAST: Record<string, string> = { o: 'p4', l: 'p3', s: 'p1', m: 'p9', t: 'p10' };
function match(options: ConstructorParameters<typeof Recorder>[0] = {}, hackers = ['p4', 'p3']): Recorder {
  const r = new Recorder({ ...base, assigned: true, hackers, weaknesses: ['plaintext-password'], ...options });
  for (const [client, id] of Object.entries(CAST)) r.game.seat(client, id);
  r.flush();
  return r;
}
const nextTo = (r: Recorder, client: string, me: string, target: string): void => {
  const t = r.position(target);
  expect(r.walkTo(client, me, t.x + 30, t.y) || r.walkTo(client, me, t.x - 30, t.y) || r.walkTo(client, me, t.x, t.y + 30)).toBe(true);
};
const detain = (r: Recorder, target: string): void => {
  nextTo(r, 't', 'p10', target);
  r.send('t', 'detain', { target });
};
/** Lets the meeting decide against somebody (the votes themselves are tested in meetings.test.ts). */
const FAST = { discussionMs: 2000, votingMs: 2000, resultMs: 500, cooldownMs: 0, usesPerPlayer: 3 };
function voteOut(r: Recorder, target: string): void {
  if (r.game.board.items.length < 3) {
    expect(r.sitAt('s', 'p1', 'FIN-LT-07')).toBe(true);
    r.type('s', PW['s.alharbi']);
    for (const cmd of ['hostname', 'whoami', 'pwd']) r.send('s', 'evidence.pin', { kind: 'screen', text: r.type('s', cmd).trim() });
    r.send('s', 'stand');
  }
  const b = r.map.furniture.find((f) => f.kind === 'button')!;
  expect(r.walkTo('m', 'p9', b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
  r.send('m', 'meeting.call');
  r.send('s', 'meeting.accuse', { suspect: target, evidence: r.game.board.items.map((i) => i.id) });
  for (let i = 0; i < 100 && r.game.meetings.current?.phase !== 'voting'; i++) r.tick();
  for (const c of Object.keys(CAST)) r.send(c, 'meeting.vote', { target });
  for (let i = 0; i < 100 && r.game.meetings.current && !r.game.over; i++) r.tick();
}
const over = (r: Recorder, client: string) => r.last(client, 'match.over')?.payload as { winner: string; hacker: string; hackers: string[]; reason: string } | undefined;
const briefing = (r: Recorder, client: string) => (r.last(client, 'welcome')!.payload as { mission: MissionBriefing | null }).mission;
/** One hacker gets the flag with the forgotten script. */
function steal(r: Recorder, client: string, id: string): string {
  const me = scenario.players.find((p) => p.id === id)!;
  expect(r.sitAt(client, id, me.desk)).toBe(true);
  if (r.screen(client).screen === 'login') r.type(client, me.account);
  if (r.screen(client).screen !== 'shell') r.type(client, PW[me.account]);
  r.type(client, 'ssh ADMIN-SRV-01');
  r.type(client, PW[me.account]);
  const script = r.type(client, 'cat /srv/shared/old/backup-2025.sh');
  r.type(client, 'su');
  r.type(client, /ROOT_PW='([^']+)'/.exec(script)![1]);
  const flag = /NEXORA\{[^}]+\}/.exec(r.type(client, 'cat /root/flag.txt'))![0];
  r.send(client, 'stand');
  return flag;
}

describe('how many hackers', () => {
  it('by the size of the match, and never so many that the defenders lose their majority', () => {
    const count = (s: Partial<PartySettings>, n: number, desks: number) => hackerCount(settings(s), n, desks);
    expect([8, 11, 15, 20, 25, 30].map((desks) => count({}, 4, desks))).toEqual([1, 1, 1, 2, 2, 3]);
    expect([1, 2, 3].map((hackers) => count({ hackers }, 4, 11))).toEqual([1, 2, 3]);
    // Without bots only the people count.
    expect([2, 3, 4, 6, 7, 9, 10].map((n) => count({ bots: false, hackers: 3 }, n, 11))).toEqual([1, 1, 1, 1, 2, 2, 3]);
  });

  it('the draw gives that many, at ordinary desks; at least two people are not hackers', () => {
    const ordinary = scenario.players.filter((p) => (p.role ?? 'employee') === 'employee').map((p) => p.id);
    for (let n = 2; n <= 11; n++) {
      for (const hackers of [2, 3]) {
        for (const s of [{ hackers }, { hackers, hacker: 'human' as const }, { hackers, hacker: 'bot' as const }, { hackers, bots: false }]) {
          const wanted = hackerCount(settings(s), n, 11);
          for (const d of many(n, s, 25)) {
            expect(new Set(d.hackers).size).toBe(wanted);
            for (const id of d.hackers) expect(ordinary).toContain(id);
            expect(new Set(d.seats.values()).size).toBe(n);
            expect([...d.seats.keys()]).toEqual(people(n));
            const human = [...d.seats.values()].filter((id) => d.hackers.includes(id)).length;
            expect(d.human).toBe(human > 0);
            if (n >= 3 && (s.hacker ?? 'auto') !== 'bot') expect(n - human).toBeGreaterThanOrEqual(2);
            // "Always the computer" unless there are not enough other desks.
            if (s.hacker === 'bot') expect(human).toBe(n === 11 ? wanted : Math.max(0, n - (11 - wanted)));
            // Enough people: all hackers are people.
            if (s.hacker !== 'bot' && n >= 5) expect(human).toBe(wanted);
          }
        }
      }
    }
  });

  it('the lobby says how many, and the number does not change when somebody leaves the match', () => {
    const p = new Party('BCDFG', 11);
    for (let i = 0; i < 7; i++) p.join(`n${i}`, 'x');
    p.change({ bots: false, hackers: 3 });
    expect(p.view('n0').hackers).toBe(2);
    p.begin(2);
    for (let i = 3; i < 7; i++) p.leave(`n${i}`);
    expect(p.view('n0').hackers).toBe(2);
    p.end([]);
    expect(p.view('n0').hackers).toBe(1);
  });
});

describe('hackers know each other', () => {
  it('each briefing names the partners and the own tools; nobody else is told anything', () => {
    const r = match();
    expect(briefing(r, 'o')).toMatchObject({ partners: [{ id: 'p3', name: 'Lina Haddad' }], toolsPath: '/home/o.farouk/.tools' });
    expect(briefing(r, 'l')).toMatchObject({ partners: [{ id: 'p4', name: 'Omar Farouk' }], toolsPath: '/home/l.haddad/.tools' });
    for (const c of ['s', 'm', 't']) {
      expect(briefing(r, c)).toBeNull();
      expect(JSON.stringify(r.sent.get(c))).not.toContain('partners');
    }
    for (const [client, desk] of [['o', 'MKT-LT-11'], ['l', 'HR-LT-03']] as const) {
      expect(r.sitAt(client, CAST[client], desk)).toBe(true);
      if (r.screen(client).screen !== 'shell') r.type(client, PW[scenario.players.find((p) => p.id === CAST[client])!.account]);
      expect(r.type(client, 'ls ~/.tools')).toContain('README');
    }
  });

  it('with one hacker there are no partners', () => {
    expect(briefing(match({}, ['p4']), 'o')!.partners).toEqual([]);
  });

  it('a bot partner is named too, and does not tell a meeting about its partner', () => {
    const r = match({ bots: true, botOptions: { hacker: true } }, ['p4', 'p6']);
    r.game.everybodyIsIn();
    expect(briefing(r, 'o')!.partners).toEqual([{ id: 'p6', name: 'Noor Saleh' }]);
    const find = (who: string, suspect: string) => {
      const bots = r.game.bots as unknown as { bots: Map<string, object>; find(b: object, f: object): boolean };
      return bots.find(bots.bots.get(who)!, { suspect, weight: 3, text: `about ${suspect}` });
    };
    expect(find('p6', 'p4')).toBe(false);
    expect(find('p6', 'p1')).toBe(true);
    expect(find('p2', 'p4')).toBe(true);
    expect(r.game.bots!.ballot('p2', ['p4'])).toBe('p4');
    expect(r.game.bots!.ballot('p6', ['p4'])).not.toBe('p4');
  });
});

describe('one hacker is caught', () => {
  it('detained: they are out and it is announced, the others go on; the last one ends the match', () => {
    const r = match();
    detain(r, 'p4');
    expect(r.game.over).toBeNull();
    expect(activeHackers(r.game.world)).toEqual(['p3']);
    expect(r.position('p4')).toBeUndefined();
    expect((r.last('o', 'fired')!.payload as { reason: string }).reason).toContain('You were detained');
    for (const c of ['l', 's', 'm', 't']) expect(r.notice(c)).toBe('Tariq Omar detained Omar Farouk, who was a hacker. One hacker is still out there.');
    expect(r.game.reputation).toBe(100);
    // The guard keeps the power. The detained hacker can do nothing any more.
    r.send('o', 'flag.submit', { text: 'x' });
    r.send('o', 'move', { dx: 1, dy: 0 });
    expect(r.position('p4')).toBeUndefined();
    detain(r, 'p3');
    for (const c of Object.keys(CAST)) expect(over(r, c), c).toMatchObject({ winner: 'defenders', hacker: 'Omar Farouk and Lina Haddad', hackers: ['Omar Farouk', 'Lina Haddad'], reason: 'Tariq Omar caught Lina Haddad in the act.' });
  });

  it('voted out: no reputation is lost, everybody learns it, and the vote for the last one ends the match', () => {
    const r = match({ meetingTimes: FAST });
    voteOut(r, 'p3');
    expect(r.game.over).toBeNull();
    expect(r.game.reputation).toBe(100);
    expect(r.game.meetings.history[0].result).toMatchObject({ firedId: 'p3', wasHacker: true });
    expect(r.messages('s', 'notice').map((m) => (m.payload as { text: string }).text)).toContain('Lina Haddad was a hacker. One hacker is still out there.');
    expect(r.last('l', 'fired')).toBeDefined();
    voteOut(r, 'p4');
    expect(over(r, 's')).toMatchObject({ winner: 'defenders', reason: 'Omar Farouk was voted out. They were the last hacker.' });
    const d = (r.last('s', 'debrief')!.payload as { debrief: DebriefView }).debrief;
    expect(d.hackers).toEqual(['Omar Farouk', 'Lina Haddad']);
    expect(d.meetings.map((m) => [m.fired, m.wasHacker])).toEqual([['Lina Haddad', true], ['Omar Farouk', true]]);
    expect(d.meetings.every((m) => m.accusations[0].right)).toBe(true);
  });

  it('an innocent person voted out costs reputation as before', () => {
    const r = match({ meetingTimes: FAST });
    voteOut(r, 'p10');
    expect(r.game.reputation).toBe(75);
  });

  it('a hacker played by a bot is simply gone', () => {
    const r = match({ bots: true, botOptions: { hacker: true } }, ['p4', 'p6']);
    r.game.everybodyIsIn();
    // (A bot does not wait for the guard.)
    for (let i = 0; i < 20 && r.game.bots!.has('p6'); i++) detain(r, 'p6');
    expect(r.game.over).toBeNull();
    expect(r.game.bots!.has('p6')).toBe(false);
    expect(r.position('p6')).toBeUndefined();
    r.tick(200);
    expect(r.position('p6')).toBeUndefined();
  });

  it('the anti-stall rule no longer points at what a caught hacker did', () => {
    const r = match();
    const scan = (actor: string, host: string): GameEvent => {
      const e = { ...r.game.world.events.at(-1)!, id: 900_000 + r.game.world.events.length, time: r.game.world.time, actor, host, user: 'x', type: 'network.scan', details: { target: 'a' } } as GameEvent;
      r.game.world.events.push(e);
      return e;
    };
    scan('p4', 'MKT-LT-11');
    const mine = scan('p3', 'HR-LT-03');
    r.game.world.mission.caught.push('p4');
    expect(escalate(r.game.world)).toBe(mine);
    expect(escalate(r.game.world)).toBeNull();
  });
});

describe('the hackers win', () => {
  it('together: a partner may hand in what another one read, also after that one was caught', () => {
    const r = match();
    const flag = steal(r, 'o', 'p4');
    expect(submitFlag(r.game.world, 'p1', flag).won).toBe(false);
    detain(r, 'p4');
    expect(submitFlag(r.game.world, 'p4', flag).won).toBe(false);
    r.send('l', 'flag.submit', { text: flag });
    expect(over(r, 's')).toMatchObject({ winner: 'hacker', hackers: ['Omar Farouk', 'Lina Haddad'], reason: 'Lina Haddad got the flag out.' });
    const d = (r.last('s', 'debrief')!.payload as { debrief: DebriefView }).debrief;
    expect(new Set(d.steps.map((s) => s.by))).toEqual(new Set(['Omar Farouk', 'Lina Haddad']));
    expect(d.steps.find((s) => s.title.includes('Became root'))!.by).toBe('Omar Farouk');
  });

  it('but nobody can hand in what no hacker read', () => {
    const r = match();
    r.send('l', 'flag.submit', { text: r.file('ADMIN-SRV-01', '/root/flag.txt').trim() });
    expect(r.game.over).toBeNull();
    expect(r.notice('l')).toContain('You have to get the flag yourself');
  });

  it('the wait before handing in counts from the first time one of them read it, and both are told', () => {
    const r = match({ handInMinutes: 3 });
    const flag = steal(r, 'o', 'p4');
    // Handing in at once, before the server's next tick, does not slip past the wait.
    r.send('o', 'flag.submit', { text: flag });
    expect(r.game.over).toBeNull();
    for (const c of ['o', 'l']) expect(r.messages(c, 'notice').some((m) => (m.payload as { text: string }).text.includes('You have the file')), c).toBe(true);
    expect(r.messages('s', 'notice').some((m) => (m.payload as { text: string }).text.includes('You have the file'))).toBe(false);
    r.send('l', 'flag.submit', { text: flag });
    expect(r.notice('l')).toContain('not here yet');
    for (let i = 0; i < 1800; i++) r.game.tick(100);
    r.send('l', 'flag.submit', { text: flag });
    expect(r.game.over?.winner).toBe('hacker');
  });

  it('by parity, counting the people who play: without bots 3 against 2, then 2 against 2', () => {
    const r = match({ meetingTimes: FAST });
    voteOut(r, 'p10');
    expect(over(r, 's')).toMatchObject({ winner: 'hacker', reason: 'Only 2 defenders are left, as many as hackers: the hackers took over the company.' });
  });

  it('with one hacker and no bots the match goes on as long as two defenders are left', () => {
    const r = match({ meetingTimes: FAST }, ['p4']);
    voteOut(r, 'p10');
    voteOut(r, 'p3');
    expect(r.game.over).toBeNull();
    (r.game as unknown as { fire(id: string): void }).fire('p9');
    r.flush();
    expect(over(r, 's')!.reason).toContain('Only 1 defender is left');
  });

  it('with bots the whole staff counts, so reputation decides first', () => {
    const r = match({ bots: true, botOptions: { hacker: true } });
    const fire = (id: string) => (r.game as unknown as { fire(id: string): void }).fire(id);
    for (const id of ['p2', 'p5', 'p6']) fire(id);
    expect(r.game.over).toBeNull();
    fire('p7');
    r.flush();
    expect(over(r, 's')!.reason).toContain('The hackers win.');
  });
});

describe('what each of them did', () => {
  it('the debrief says who, and what a partner saw or pinned does not count as found', () => {
    const r = match();
    steal(r, 'o', 'p4');
    expect(r.sitAt('l', 'p3', 'HR-LT-03')).toBe(true);
    if (r.screen('l').screen !== 'shell') r.type('l', PW['l.haddad']);
    r.type('l', 'ssh ADMIN-SRV-01');
    r.type('l', PW['l.haddad']);
    const seen = r.type('l', 'last');
    const line = seen.split('\n').find((x) => x.includes('o.farouk'))!;
    r.send('l', 'evidence.pin', { kind: 'screen', text: line.trim() });
    expect(r.game.board.items).toHaveLength(1);
    (r.game as unknown as { endMatch(w: string, reason: string): void }).endMatch('defenders', 'Test.');
    r.flush();
    const d = (r.last('s', 'debrief')!.payload as { debrief: DebriefView }).debrief;
    expect(d.totals.pinned).toBe(0);
    expect(d.totals.seen).toBe(0);
    expect(d.steps.some((s) => s.by === 'Lina Haddad')).toBe(true);
  });

  it('a reset mail and its victim belong to the hacker who sent it', () => {
    const r = match();
    expect(r.sitAt('l', 'p3', 'HR-LT-03')).toBe(true);
    if (r.screen('l').screen !== 'shell') r.type('l', PW['l.haddad']);
    expect(r.type('l', '~/.tools/phish s.alharbi')).toContain('Reset message sent');
    const { url } = r.game.world.toolkit.phishing[0];
    expect(r.sitAt('s', 'p1', 'FIN-LT-07')).toBe(true);
    r.type('s', PW['s.alharbi']);
    r.type('s', `curl ${url}`);
    const submit = r.game.world.events.find((e) => e.type === 'phish.submit')!;
    expect(r.game.world.mission.trail.find((t) => t.event === submit.id)!.by).toBe('p3');
  });
});

describe('several hackers played by the computer', () => {
  it('each does its own work with the existing behaviour, and the match ends', () => {
    for (const hackers of [2, 3]) {
      for (const seed of [1, 2, 3, 4]) {
        const d = deal(scenario.players, people(2), settings({ hacker: 'bot', hackers }), new Random(seed));
        const o = partyGameOptions({ ...base, weaknesses: ['plaintext-password', 'extra-sudo'] }, settings({ hacker: 'bot', hackers }), seed, d);
        const r = new Recorder({ ...o, botOptions: { ...o.botOptions, hackerPace: undefined } });
        for (const [client, id] of d.seats) r.game.seat(client, id);
        r.game.everybodyIsIn();
        for (let i = 0; i < 90 * 600 && !r.game.over; i++) {
          r.game.tick(100);
          if (i % 20 === 0) r.flush();
        }
        r.flush();
        expect(r.game.over?.winner, `${hackers} hackers, seed ${seed}`).toBe('hacker');
        expect(over(r, 'net0')!.hackers).toHaveLength(hackers);
        expect(r.game.bots!.list().filter((b) => b.failure && !d.hackers.includes(b.playerId))).toEqual([]);
        const before = JSON.stringify(r.sent.get('net0')!.filter((m) => !['match.over', 'debrief'].includes(m.type)));
        expect(before).not.toContain('partners');
        for (const password of Object.values(PW)) if (password !== (r.last('net0', 'welcome')!.payload as { card: { password: string } }).card.password) expect(before).not.toContain(password);
      }
    }
  }, 120_000);
});
