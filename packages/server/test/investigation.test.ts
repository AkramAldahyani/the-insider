/**
 * Phase 5a, part C: Investigation mode. The difficulty levels, the help from
 * colleagues, the rating, and: every job can really solve the case.
 */
import { describe, expect, it } from 'vitest';
import { queryEvents } from '@insider/engine';
import { SOLO_DIFFICULTIES, type DebriefView, type MeetingView, type SoloChoice, type SoloRole } from '@insider/shared';
import { SOC_CHECK, inspect } from '../src/bots/brain';
import { rate, type RatingInput } from '../src/rating';
import { soloGameOptions } from '../src/solo';
import { PW, Recorder, clone, scenario, tiledMap } from './helpers';

const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small' };
const CHOICE: SoloChoice = { mode: 'investigation', role: 'soc', difficulty: 'normal' };
const START = Date.parse(scenario.startTime);

/** A solo match exactly as the room starts it (only the meetings are shorter). */
function solo(choice: Partial<SoloChoice>, seed: number): { r: Recorder; me: (typeof scenario.players)[number] } {
  const options = soloGameOptions(base, { ...CHOICE, ...choice }, seed);
  const r = new Recorder({ ...options, botOptions: { ...options.botOptions, hackerPace: undefined }, meetingTimes: { ...options.meetingTimes, discussionMs: 30_000, votingMs: 15_000, resultMs: 1000 } });
  r.connect('me');
  return { r, me: scenario.players.find((p) => p.id === options.soloPlayer)! };
}
const weaknessesOf = (choice: Partial<SoloChoice>, seed: number) => soloGameOptions(base, { ...CHOICE, ...choice }, seed).weaknesses as string[];
function play(r: Recorder, done: () => boolean, minutes: number): boolean {
  for (let i = 0; i < minutes * 600 && !done(); i++) {
    r.game.tick(100);
    if (i % 10 === 0) r.flush();
  }
  r.flush();
  return done();
}
const chat = (r: Recorder) => r.messages('me', 'chat').map((m) => m.payload as { from: string; text: string });
const debrief = (r: Recorder) => (r.last('me', 'debrief')!.payload as { debrief: DebriefView }).debrief;

describe('difficulty levels', () => {
  it('decide how many weaknesses there are; one always gives a direct way in', () => {
    for (const [difficulty, count] of [['easy', 2], ['normal', 3], ['hard', 4]] as const) {
      const sets = new Set<string>();
      for (let seed = 1; seed <= 60; seed++) {
        const w = weaknessesOf({ difficulty }, seed);
        expect(new Set(w).size, `${difficulty} ${seed}`).toBe(count);
        expect(w.includes('plaintext-password') || w.includes('weak-admin-password')).toBe(true);
        sets.add([...w].sort().join());
      }
      expect(sets.size, difficulty).toBeGreaterThan(difficulty === 'hard' ? 2 : 4); // not always the same day
    }
  });

  it('a player who is the administrator never gets "the administrator is careless"', () => {
    for (let seed = 1; seed <= 60; seed++) {
      expect(weaknessesOf({ role: 'sysadmin', difficulty: 'hard' }, seed)).not.toContain('careless-admin');
      const any = soloGameOptions(base, { ...CHOICE, role: 'any', difficulty: 'hard' }, seed); // also when the server picked that job
      if (any.soloPlayer === 'p5') expect(any.weaknesses).not.toContain('careless-admin');
    }
  });

  it('weaknesses forced by the operator win', () => {
    expect(soloGameOptions({ ...base, weaknesses: ['tailgate'] }, CHOICE, 1).weaknesses).toEqual(['tailgate']);
    expect(soloGameOptions({ ...base, weaknesses: [] }, CHOICE, 1).weaknesses).toEqual([]);
    expect(soloGameOptions({ ...base, weaknesses: 'random' }, CHOICE, 1).weaknesses).toHaveLength(3);
  });

  it('a match lasts long enough to play and never drags on for hours', () => {
    for (const difficulty of SOLO_DIFFICULTIES) {
      for (const seed of [11, 12, 13, 16]) {
        const { r } = solo({ difficulty }, seed);
        expect(play(r, () => r.game.over !== null, 60), `${difficulty} ${seed}`).toBe(true);
        expect((r.game.over!.at - START) / 60_000).toBeGreaterThan(7);
        expect(debrief(r).rating!.title).toBe('The hacker got away');
      }
    }
  }, 60_000);
});

describe('the SOC analyst (a bot) and its alerts', () => {
  it('reads them off its own screen', () => {
    const me = { account: 'h.rahman', desk: 'SOC-WS-01', ip: '10.0.2.59', today: 'Mon Mar  2' };
    const output = 'TIME     HOST          SOURCE   FIELDS\n09:09:12 SEC-SRV-01    alert    severity=high rule=flag-read src_ip=10.0.2.185\n\n(1 of 1 shown)';
    expect(inspect(SOC_CHECK, output, me)).toEqual([{
      text: 'The SIEM shows a security alert at 09:09:12: severity=high rule=flag-read src_ip=10.0.2.185.', weight: 0,
      line: '09:09:12 SEC-SRV-01    alert    severity=high rule=flag-read src_ip=10.0.2.185',
    }]);
    expect(inspect(SOC_CHECK, 'No matching records.\n', me)).toEqual([]);
    expect(inspect('last -n 10', output, me)).toEqual([]);
  });

  it('on Easy colleagues pin clues, a few and never the whole case; on Normal and Hard nothing', () => {
    let pinned = 0;
    for (const seed of [1, 2, 3, 4]) {
      const { r } = solo({ role: 'guard', difficulty: 'easy' }, seed);
      play(r, () => r.game.over !== null, 60);
      const items = r.game.board.items;
      expect(items.length).toBeLessThanOrEqual(3);
      pinned += items.length;
      for (const i of items) {
        expect(i.pinnedById).not.toBe('p10');
        expect(r.messages('me', 'notice').some((m) => (m.payload as { text: string }).text === `${i.pinnedBy} pinned something to the evidence board (${i.id}).`)).toBe(true);
        // It is a real line from a real screen, and it does not say who did it.
        expect(i.text).toMatch(/alert|pts\/|@reboot|ESTAB|LISTEN|usb|\/\./);
        const hacker = scenario.players.find((p) => p.id === r.game.world.mission.hacker)!;
        expect(i.text).not.toContain(hacker.name);
      }
    }
    expect(pinned).toBeGreaterThanOrEqual(4);
    for (const difficulty of ['normal', 'hard'] as const) {
      const { r } = solo({ role: 'guard', difficulty }, 2);
      play(r, () => r.game.over !== null, 60);
      expect(r.game.board.items).toEqual([]);
    }
  }, 60_000);
});

// ───────────────────────────── Every job can solve the case ─────────────────────────────

/** Walks to the red button and calls a meeting. */
function callMeeting(r: Recorder, id: string): void {
  if (r.game.publicState().players[id].seatedAt) r.send('me', 'stand');
  const b = r.map.furniture.find((f) => f.kind === 'button')!;
  expect(r.walkTo('me', id, b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
  r.send('me', 'meeting.call');
  expect(r.game.meetings.current, r.notice('me')).not.toBeNull();
}

/** Sits down at the own PC and gets to a shell there. */
function atOwnPc(r: Recorder, me: (typeof scenario.players)[number]): void {
  r.sitAt('me', me.id, me.desk);
  const s = r.screen('me');
  if (s.screen === 'login' && !s.masked) r.type('me', me.account);
  if (r.screen('me').screen !== 'shell') r.type('me', PW[me.account]);
  if (r.screen('me').screen !== 'shell') r.type('me', r.game.world.credentials[me.account].password); // the administrator's easy password of the day
  while (!r.screen('me').prompt.startsWith(`${me.account}@${me.desk}:`)) r.type('me', 'exit');
}

const pin = (r: Recorder, text: string) => r.send('me', 'evidence.pin', { kind: 'screen', text });

/**
 * Plays one Investigation the way a person with this job would: waits for the
 * alert banner that everybody sees, finds out the address behind it, and traces
 * the address with what everybody may read on the admin server.
 */
function investigate(role: SoloRole, difficulty: SoloChoice['difficulty'], seed: number): Recorder {
  const { r, me } = solo({ role, difficulty }, seed);
  const server = (host: string) => {
    r.type('me', `ssh ${host}`);
    r.type('me', r.game.world.credentials[me.account].password);
    expect(r.screen('me').prompt).toContain(`@${host}`);
  };
  if (!play(r, () => r.messages('me', 'alert').length > 0 || r.game.over !== null, 60) || r.game.over) return r;

  let ip = '';
  const fromLog = () => {
    atOwnPc(r, me);
    server('SEC-SRV-01');
    const lines = r.type('me', 'cat /var/log/security/alerts.log').split('\n').filter((l) => / from \d+\.\d+/.test(l));
    ip = / from (\d+\.\d+\.\d+\.\d+)/.exec(lines.at(-1) ?? '')?.[1] ?? '';
    if (ip) pin(r, lines.at(-1)!.trim());
    r.type('me', 'exit');
  };
  if (role === 'soc') {
    atOwnPc(r, me);
    const row = r.type('me', 'siem source=alert | tail 1').split('\n').find((l) => l.includes('src_ip='));
    ip = /src_ip=(\S+)/.exec(row ?? '')?.[1] ?? '';
    if (row) pin(r, row.trim());
  } else if (role === 'guard' || role === 'sysadmin') fromLog();
  else {
    // An employee or the helpdesk cannot read alerts: give the SOC analyst a moment to look, then ask everybody.
    play(r, () => r.game.over !== null, 2);
    if (r.game.over) return r;
    callMeeting(r, me.id);
    play(r, () => r.game.meetings.current === null, 3);
    ip = /src_ip=(\d+\.\d+\.\d+\.\d+)/.exec(chat(r).map((l) => l.text).join('\n'))?.[1] ?? '';
  }
  expect(ip, 'the address behind the alert').not.toBe('');

  if (!r.game.publicState().players[me.id].seatedAt) atOwnPc(r, me);
  server('ADMIN-SRV-01');
  const login = r.type('me', `last | grep "${ip} "`).split('\n').find((l) => l.includes(ip));
  if (login) pin(r, login.trim());
  const lease = r.type('me', `grep -A 8 "lease ${ip} " /var/lib/dhcp/dhcpd.leases | tail -9`);
  const pc = /client-hostname "([^"]+)"/.exec(lease)![1];
  const shown = lease.split('\n').filter((l) => l.includes(`lease ${ip} `) || l.includes('client-hostname'));
  for (const l of shown.slice(-2)) pin(r, l.trim());
  const suspect = scenario.players.find((p) => p.desk === pc)!;
  while (!r.screen('me').prompt.startsWith(`${me.account}@${me.desk}:`)) r.type('me', 'exit');
  if (r.game.over) return r;

  play(r, () => r.game.meetings.whyNot(me.id) === '' || r.game.over !== null, 2); // the button rests for a minute after a meeting
  if (r.game.over) return r;
  callMeeting(r, me.id);
  r.send('me', 'meeting.accuse', { suspect: suspect.id, evidence: r.game.board.items.map((i) => i.id) });
  expect((r.last('me', 'meeting')!.payload as MeetingView).accusations, r.notice('me')).toHaveLength(1);
  play(r, () => r.game.meetings.current?.phase === 'voting', 2);
  r.send('me', 'meeting.vote', { target: suspect.id });
  play(r, () => r.game.meetings.current === null || r.game.over !== null, 3);
  return r;
}

describe('every job can solve the case', () => {
  const roles = ['employee', 'soc', 'guard', 'sysadmin', 'helpdesk'] as const;
  it.each(roles.flatMap((role) => SOLO_DIFFICULTIES.map((difficulty) => ({ role, difficulty }))))('$role, $difficulty', ({ role, difficulty }) => {
    for (const seed of [1, 2, 3]) {
      const r = investigate(role, difficulty, seed);
      expect(r.game.over?.winner, `seed ${seed}: ${JSON.stringify({ chat: chat(r).slice(-6), board: r.game.board.items.map((i) => i.text) })}`).toBe('defenders');
      expect(debrief(r).rating).toMatchObject({ title: 'Case proven' });
    }
  }, 60_000);

  it('for an employee, what the SOC analyst told the meeting stands in for the alert nobody showed', () => {
    const r = investigate('employee', 'normal', 1);
    expect(r.game.over?.winner).toBe('defenders');
    expect(r.game.board.items.every((i) => !i.text.includes('severity='))).toBe(true);
    expect(chat(r).some((l) => l.from === 'Huda Rahman' && l.text.startsWith('The SIEM shows a security alert'))).toBe(true);
    expect(chat(r).some((l) => l.text.includes('Huda Rahman told us something odd about them'))).toBe(true);
    expect(debrief(r).rating!.lines[0]).toContain('what Huda Rahman told the meeting');
  });
});

// ───────────────────────────── The rating ─────────────────────────────

describe('the rating', () => {
  const input: RatingInput = {
    winner: 'defenders', hacker: 'Omar Farouk', verdict: { convincing: true, pointing: ['E1', 'E2'], unusual: ['E1'], testimony: '' },
    firedWrongly: [], detainedWrongly: [], meetingsCalled: 1, meetingsAllowed: 2, ms: 14.6 * 60_000, ownPins: 3, otherPins: 0,
  };
  const weak = { convincing: false, pointing: ['E1'], unusual: [], testimony: '' };
  const none = { convincing: false, pointing: [], unusual: [], testimony: '' };

  it('tells a proven case from a guess, and counts the mistakes', () => {
    expect(rate(input)).toEqual({ title: 'Case proven', lines: ['You had evidence against Omar Farouk: E1 and E2.', '15 game minutes, 1 of 2 meetings called, 3 pieces of evidence pinned by you.'] });
    expect(rate({ ...input, firedWrongly: ['Sara Alharbi'] })).toMatchObject({ title: 'Case proven, at a price', lines: expect.arrayContaining(['Innocent people fired: Sara Alharbi.']) as string[] });
    expect(rate({ ...input, detainedWrongly: ['Sara Alharbi', 'Lina Haddad'] }).lines).toContain('Innocent people detained: Sara Alharbi and Lina Haddad.');
    expect(rate({ ...input, verdict: none, ownPins: 0 })).toMatchObject({ title: 'Lucky guess', lines: expect.arrayContaining(['You were right about Omar Farouk, but the evidence did not show it.']) as string[] });
    expect(rate({ ...input, verdict: weak }).lines[0]).toContain('only E1 said anything about them, and it was ordinary work');
    expect(rate({ ...input, verdict: { ...input.verdict, unusual: [], testimony: 'Huda Rahman' } }).lines[0]).toContain('what Huda Rahman told the meeting');
  });

  it('after a defeat it says how close you were', () => {
    expect(rate({ ...input, winner: 'hacker' })).toMatchObject({ title: 'So close' });
    expect(rate({ ...input, winner: 'hacker', verdict: weak })).toMatchObject({ title: 'The hacker got away', lines: expect.arrayContaining(['Only E1 on the board said anything about Omar Farouk.']) as string[] });
    expect(rate({ ...input, winner: 'hacker', verdict: none, otherPins: 2, ms: 60_000 }).lines).toEqual(['Nothing on the board said anything about Omar Farouk.', '1 game minute, 1 of 2 meetings called, 3 pieces of evidence pinned by you and 2 by colleagues.']);
  });

  it('a guard who detains the right person without any evidence only guessed', () => {
    const { r } = solo({ role: 'guard' }, 2);
    const hacker = r.game.world.mission.hacker!;
    play(r, () => r.game.bots!.isPresent(hacker), 10);
    for (let tries = 0; tries < 30 && !r.game.over; tries++) {
      const p = r.game.publicState().players[hacker];
      const desk = r.map.desks.find((d) => d.hostname === p.seatedAt);
      r.walkTo('me', 'p10', desk ? desk.seatX : p.x, desk ? desk.seatY + 32 : p.y);
      r.send('me', 'detain', { target: hacker });
    }
    expect(r.game.over?.winner).toBe('defenders');
    expect(debrief(r).rating!.title).toBe('Lucky guess');
  });

  it('the shared office has no rating', () => {
    const r = new Recorder({ bots: true, botOptions: { hacker: true } });
    r.connect('me', 'p11');
    play(r, () => r.game.over !== null, 60);
    expect(debrief(r).rating).toBeUndefined();
    expect(queryEvents(r.game.world, { type: 'mission.won' })).toHaveLength(1);
  });
});
