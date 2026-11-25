/**
 * Phase 5a, part F: Infiltration. The player is the hacker; the bots notice,
 * investigate, call meetings, accuse and vote.
 */
import { describe, expect, it } from 'vitest';
import { queryEvents } from '@insider/engine';
import { SOLO_DIFFICULTIES, parseSoloChoice, type DebriefView, type MeetingView, type MissionBriefing, type SoloDifficulty } from '@insider/shared';
import { FAST_INVESTIGATION, INVESTIGATION_PACE } from '../src/bots/investigation-pace';
import { paceFor } from '../src/bots/hacker-pace';
import type { OfficeGameOptions } from '../src/game';
import { rateInfiltration, type InfiltrationInput } from '../src/rating';
import { soloGameOptions } from '../src/solo';
import { PW, Recorder, clone, scenario, tiledMap } from './helpers';

const base: OfficeGameOptions = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small' };
const options = (difficulty: SoloDifficulty, seed: number, over: Partial<OfficeGameOptions> = {}) => soloGameOptions({ ...base, ...over }, { mode: 'infiltration', role: 'any', difficulty }, seed);

/** An Infiltration as the room starts it (shorter meetings); the old script with the root password is there. */
function infiltrate(difficulty: SoloDifficulty, seed: number, over: Partial<OfficeGameOptions> = {}): { r: Recorder; me: (typeof scenario.players)[number] } {
  const o = options(difficulty, seed, { weaknesses: ['plaintext-password'], ...over });
  const r = new Recorder({ ...o, botOptions: { ...o.botOptions, hackerPace: undefined }, meetingTimes: { ...o.meetingTimes, discussionMs: 20_000, votingMs: 15_000, resultMs: 1000 } });
  r.connect('me');
  return { r, me: scenario.players.find((p) => p.id === o.soloPlayer)! };
}
function play(r: Recorder, minutes: number, done: () => boolean = () => false): boolean {
  for (let i = 0; i < minutes * 600 && !r.game.over && !done(); i++) {
    r.game.tick(100);
    if (i % 10 === 0) r.flush();
  }
  r.flush();
  return done();
}
const chat = (r: Recorder) => r.messages('me', 'chat').map((m) => m.payload as { from: string; text: string });
const debrief = (r: Recorder) => (r.last('me', 'debrief')!.payload as { debrief: DebriefView }).debrief;
const briefing = (r: Recorder) => (r.last('me', 'welcome')!.payload as { mission: MissionBriefing | null }).mission;

/** From a PC with an open shell of `account`: root on the server, and the flag's text. */
function steal(r: Recorder, account: string): string {
  r.type('me', `ssh ${account}@ADMIN-SRV-01`);
  r.type('me', PW[account]);
  const script = r.type('me', 'cat /srv/shared/old/backup-2025.sh');
  r.type('me', 'su');
  r.type('me', /ROOT_PW='([^']+)'/.exec(script)![1]);
  return r.type('me', 'cat /root/flag.txt').trim();
}
/** Sits down at a desk and gets to a shell of its owner (who is the player, or whose password the player knows). */
function open(r: Recorder, id: string, hostname: string, account: string): void {
  expect(r.sitAt('me', id, hostname)).toBe(true);
  const s = r.screen('me');
  if (s.screen === 'login' && !s.masked) r.type('me', account);
  if (r.screen('me').screen !== 'shell') r.type('me', PW[account]);
  expect(r.screen('me').prompt).toContain(`${account}@${hostname}`);
}

describe('starting', () => {
  it('a browser may ask for it, but not for a role', () => {
    expect(parseSoloChoice({ mode: 'infiltration', role: 'any', difficulty: 'hard', soloHacker: false, handInMinutes: 0 })).toEqual({ mode: 'infiltration', role: 'any', difficulty: 'hard' });
    for (const role of ['soc', 'guard', 'sysadmin', 'helpdesk']) expect(parseSoloChoice({ mode: 'infiltration', role, difficulty: 'easy' }), role).toBeNull();
  });

  it('the player is the hacker, posing as an ordinary employee; no bot is', () => {
    const who = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const { r, me } = infiltrate('normal', seed);
      expect(me.role ?? 'employee').toBe('employee');
      expect(r.game.world.mission.hackers[0]).toBe(me.id);
      expect(briefing(r)).toMatchObject({ handInMinutes: 4, toolsPath: `/home/${me.account}/.tools` });
      who.add(me.id);
    }
    expect(who.size).toBe(scenario.players.filter((p) => p.role === 'employee').length);
  });

  it('levels: fewer weaknesses, fewer open screens, closer checks and faster investigators when it is harder', () => {
    const o = Object.fromEntries(SOLO_DIFFICULTIES.map((d) => [d, options(d, 3)])) as Record<SoloDifficulty, OfficeGameOptions>;
    expect(SOLO_DIFFICULTIES.map((d) => o[d].weaknesses!.length)).toEqual([4, 3, 2]);
    expect(SOLO_DIFFICULTIES.map((d) => o[d].handInMinutes)).toEqual([2, 4, 5]);
    expect(SOLO_DIFFICULTIES.map((d) => o[d].escalationMinutes)).toEqual([20, 15, 10]);
    for (const d of SOLO_DIFFICULTIES) {
      expect(o[d].botOptions).toMatchObject({ hacker: false, investigate: true, investigationPace: INVESTIGATION_PACE[d] });
      for (let seed = 1; seed <= 30; seed++) {
        const w = options(d, seed).weaknesses as string[];
        expect(w.includes('plaintext-password') || w.includes('weak-admin-password'), `${d} ${seed}`).toBe(true);
      }
    }
    const [easy, normal, hard] = SOLO_DIFFICULTIES.map((d) => o[d].botOptions!);
    expect(easy.forgetLock).toBeGreaterThan(normal.forgetLock!);
    expect(normal.forgetLock).toBeGreaterThan(hard.forgetLock!);
    expect(hard.checkMinutes![1]).toBeLessThan(normal.checkMinutes![1]);
    for (const key of ['alertSeconds', 'alarmSeconds', 'querySeconds', 'guardMinutes', 'meetingMinutes'] as const) {
      expect(INVESTIGATION_PACE.easy[key][0], key).toBeGreaterThan(INVESTIGATION_PACE.normal[key][0]);
      expect(INVESTIGATION_PACE.normal[key][0], key).toBeGreaterThan(INVESTIGATION_PACE.hard[key][0]);
    }
    expect(options('hard', 1, { escalationMinutes: 3 }).escalationMinutes).toBe(3); // the operator's setting wins
  });
});

describe('the office is not empty at the start', () => {
  it('everybody is there within a minute', () => {
    const { r, me } = infiltrate('hard', 1);
    play(r, 1);
    expect(Object.keys(r.game.publicState().players)).toHaveLength(scenario.players.length);
    expect(r.game.bots!.list().map((b) => b.playerId)).not.toContain(me.id);
  });

  it.each([1, 2, 3])('hurrying in the first minute does not help on Hard (seed %i)', (seed) => {
    const { r, me } = infiltrate('hard', seed);
    open(r, me.id, me.desk, me.account);
    const flag = steal(r, me.account);
    r.send('me', 'stand');
    play(r, 4.9);
    r.send('me', 'flag.submit', { text: flag });
    play(r, 5);
    expect(r.game.over).toMatchObject({ winner: 'defenders' });
  }, 30_000);
});

describe('winning', () => {
  it('only some minutes after the flag was first read', () => {
    const { r, me } = infiltrate('easy', 2);
    open(r, me.id, me.desk, me.account);
    const flag = steal(r, me.account);
    r.tick();
    expect(r.notice('me')).toBe('You have the file. Your contact takes it in 2 minutes: do not get caught until then.');
    r.send('me', 'stand');
    r.send('me', 'flag.submit', { text: flag });
    expect(r.notice('me')).toMatch(/^Your contact is not here yet\. Hand it in in (2 minutes|\d+ seconds)\.$/);
    expect(r.game.over).toBeNull();
    play(r, 1.5);
    r.send('me', 'flag.submit', { text: flag });
    expect(r.notice('me')).toMatch(/Hand it in in \d+ seconds/);
    play(r, 0.6);
    // A wrong text is still wrong, and the right one wins.
    r.send('me', 'flag.submit', { text: 'NEXORA{guess}' });
    expect(r.notice('me')).toBe('That is not the flag.');
    r.send('me', 'flag.submit', { text: flag });
    r.flush();
    expect(r.game.over).toMatchObject({ winner: 'hacker' });
    expect(debrief(r).rating).toBeDefined();
    expect(['Like a ghost', 'Clean getaway', 'By a hair']).toContain(debrief(r).rating!.title);
  });

  it('reading it again does not start the wait again', () => {
    const { r, me } = infiltrate('easy', 2);
    open(r, me.id, me.desk, me.account);
    const flag = steal(r, me.account);
    play(r, 1.9);
    if (!r.game.over) r.type('me', 'cat /root/flag.txt');
    play(r, 0.3);
    r.send('me', 'stand');
    r.send('me', 'flag.submit', { text: flag });
    expect(r.game.over).toMatchObject({ winner: 'hacker' });
  });

  it('not by getting colleagues fired', () => {
    const { r, me } = infiltrate('normal', 1);
    const others = scenario.players.filter((p) => p.id !== me.id);
    for (const p of others.slice(0, 9)) (r.game as unknown as { fire(id: string): void }).fire(p.id);
    r.tick();
    expect(r.game.reputation).toBe(0);
    expect(r.game.over).toBeNull();
  });

  it('the shared office and Investigation have no wait', () => {
    const r = new Recorder({ bots: false, weaknesses: ['plaintext-password'] });
    r.connect('me');
    r.send('me', 'choose', { playerId: 'p4', hacker: true });
    expect(briefing(r)).not.toHaveProperty('handInMinutes');
    open(r, 'p4', 'MKT-LT-11', 'o.farouk');
    const flag = steal(r, 'o.farouk');
    r.send('me', 'flag.submit', { text: flag });
    expect(r.game.over).toMatchObject({ winner: 'hacker' });
  });
});

describe('being caught', () => {
  it.each([1, 2, 3, 4, 5])('a reckless hacker on Hard is caught before the contact comes (seed %i)', (seed) => {
    const { r, me } = infiltrate('hard', seed);
    play(r, 5);
    open(r, me.id, me.desk, me.account);
    const flag = steal(r, me.account);
    r.send('me', 'stand');
    play(r, 4.9);
    r.send('me', 'flag.submit', { text: flag });
    play(r, 5);
    expect(r.game.over).toMatchObject({ winner: 'defenders' });
    const d = debrief(r);
    expect(['Detained', 'Voted out']).toContain(d.rating!.title);
    expect(d.rating!.lines[0]).toContain('What gave you away: E');
    expect(d.totals.pinned).toBeGreaterThan(0);
  }, 30_000);

  it('a bot walks to the button, calls a meeting, accuses with evidence, and they vote', () => {
    // Without the guard there is only the meeting.
    const { r, me } = infiltrate('hard', 2);
    play(r, 5);
    r.game.bots!.remove('p10');
    open(r, me.id, me.desk, me.account);
    steal(r, me.account);
    expect(play(r, 6, () => r.game.meetings.current !== null)).toBe(true);
    const m = r.game.meetings.current!;
    expect(m.calledById).toBe('p11'); // the SOC analyst
    const button = r.map.furniture.find((f) => f.kind === 'button')!;
    expect(button).toBeDefined();
    play(r, 1, () => r.game.meetings.current!.accusations.length > 0);
    expect(m.accusations).toEqual([expect.objectContaining({ accuserId: 'p11', suspectId: me.id })]);
    expect(m.accusations[0].evidence.length).toBeGreaterThanOrEqual(3);
    expect(chat(r).some((l) => l.from === 'Huda Rahman' && l.text.includes(`because of ${me.name}`))).toBe(true);
    // The player may vote like everybody; it does not help.
    play(r, 1, () => r.game.meetings.current?.phase === 'voting');
    r.send('me', 'meeting.vote', { target: 'skip' });
    play(r, 1);
    expect(r.game.over).toMatchObject({ winner: 'defenders' });
    expect(debrief(r).rating!.title).toBe('Voted out');
    expect(debrief(r).meetings[0]).toMatchObject({ calledBy: 'Huda Rahman', fired: me.name, wasHacker: true });
  }, 30_000);

  it('the same case is raised once; they do not call one meeting after another', () => {
    const { r, me } = infiltrate('hard', 3);
    play(r, 5);
    r.game.bots!.remove('p10');
    open(r, me.id, me.desk, me.account);
    steal(r, me.account);
    expect(play(r, 6, () => r.game.meetings.current !== null)).toBe(true);
    // Suppose the vote fails: take the accusation away before it is made.
    (r.game as unknown as { botMeeting: { accuse?: unknown } }).botMeeting.accuse = undefined;
    play(r, 2, () => r.game.meetings.current === null);
    expect(r.game.over).toBeNull();
    const pins = r.game.board.items.length;
    play(r, 4, () => r.game.meetings.current !== null);
    if (r.game.meetings.current) expect(r.game.board.items.length).toBeGreaterThan(pins); // only because there was more
  }, 30_000);

  it('working from somebody else\'s PC puts the blame on its owner, and the player can still win on Hard', () => {
    const { r, me } = infiltrate('hard', 4);
    // A colleague in another room whose PC is free for a while, and whose password the player has.
    const victim = scenario.players.find((p) => p.role === 'employee' && p.id !== me.id && p.desk !== 'REC-PC-01')!;
    play(r, 5);
    const mind = r.game.bots!.mind(victim.id)!;
    play(r, 20, () => r.game.publicState().players[victim.id].seatedAt === '');
    Object.assign(mind, { nextBreakAt: 0, leaving: 'undecided', atBreakSpot: true, breakSpot: { x: 0, y: 0 }, breakUntil: r.game.world.time + 3_600_000 });
    // Nobody looks on (witnesses would remember who sat there).
    const room = r.map.desks.find((d) => d.hostname === victim.desk)!;
    for (const p of scenario.players) {
      const desk = r.map.desks.find((d) => d.hostname === p.desk)!;
      if (p.id !== victim.id && p.id !== me.id && Math.hypot(desk.seatX - room.seatX, desk.seatY - room.seatY) < 260) r.game.bots!.remove(p.id);
    }
    open(r, me.id, victim.desk, victim.account);
    const flag = steal(r, victim.account);
    r.send('me', 'stand');
    r.walkToTile('me', me.id, 20, 16); // away from there, into the corridor
    play(r, 5.2);
    r.send('me', 'flag.submit', { text: flag });
    r.flush();
    expect(r.game.over, JSON.stringify(r.game.board.items.map((i) => i.text))).toMatchObject({ winner: 'hacker' });
    const pointsAtVictim = r.game.board.items.filter((i) => i.text.includes(victim.desk) || i.text.includes(victim.account)).length;
    expect(pointsAtVictim).toBeGreaterThan(0);
    const blamed = [...r.game.fired, ...r.game.detentions.map((d) => d.targetId)];
    if (blamed.length > 0) {
      expect(blamed.every((id) => id === victim.id)).toBe(true);
      expect(debrief(r).rating!.lines.join()).toContain(`Blamed in your place: ${victim.name}.`);
    }
  }, 30_000);

  it('somebody who only does their job is left alone, even on Hard and for an hour', () => {
    for (const seed of [1, 2, 3]) {
      const { r, me } = infiltrate('hard', seed);
      open(r, me.id, me.desk, me.account);
      for (let round = 0; round < 6; round++) {
        r.type('me', 'ssh ADMIN-SRV-01'); // everybody does that
        r.type('me', PW[me.account]);
        r.type('me', 'ls');
        r.type('me', 'exit');
        play(r, 10, () => r.game.meetings.current !== null);
        expect(r.game.meetings.current).toBeNull();
      }
      expect(r.game.over).toBeNull();
      expect(r.game.detentions).toEqual([]);
      expect(r.game.meetings.history).toEqual([]);
    }
  }, 60_000);
});

describe('balance', () => {
  /** The existing bot hacker in the player's place: own desk, own account, no tricks. It waits for the contact and then hands in. */
  function reckless(difficulty: SoloDifficulty, seed: number): string {
    const o = options(difficulty, seed);
    const wait = o.handInMinutes! + 0.1;
    const r = new Recorder({ ...o, soloPlayer: 'nobody', botOptions: { ...o.botOptions, hacker: true, hackerDifficulty: 'normal', hackerPace: { ...paceFor('hard'), coverMinutes: [2, 4], lineSeconds: [8, 20], handInMinutes: [wait, wait] } } });
    for (let i = 0; i < 60 * 600 && !r.game.over; i++) {
      r.game.tick(100);
      if (i % 50 === 0) r.game.drain();
    }
    return r.game.over?.winner ?? 'none';
  }
  it('working carelessly is fine on Easy, risky on Normal and hopeless on Hard', () => {
    const wins = (d: SoloDifficulty) => Array.from({ length: 12 }, (_, i) => reckless(d, i + 1)).filter((w) => w === 'hacker').length;
    expect(wins('easy')).toBeGreaterThanOrEqual(10);
    const normal = wins('normal');
    expect(normal).toBeGreaterThanOrEqual(1);
    expect(normal).toBeLessThanOrEqual(8);
    expect(wins('hard')).toBeLessThanOrEqual(2);
  }, 60_000);

  it('the pace elsewhere did not change', () => {
    expect(FAST_INVESTIGATION.alertSeconds).toEqual([60, 150]);
    const r = new Recorder({ bots: true, seed: 2 });
    for (let i = 0; i < 18_000; i++) r.game.tick(100);
    const looks = queryEvents(r.game.world, { type: 'siem.query' }).length;
    expect(looks).toBeGreaterThan(8); // half an hour
    expect(r.game.meetings.history).toEqual([]);
  }, 30_000);
});

describe('the rating', () => {
  const input: InfiltrationInput = { winner: 'hacker', verdict: { convincing: false, pointing: [], unusual: [], testimony: '' }, detained: false, blamed: [], meetings: 0, ms: 12 * 60_000, steps: 4, pinned: 0, missed: 4 };
  it('tells how quietly the player worked', () => {
    expect(rateInfiltration(input)).toEqual({ title: 'Like a ghost', lines: ['Nothing on the evidence board says anything about you.', '12 game minutes, 0 meetings. Of 4 suspicious actions that left evidence, 0 ended up on the board and nobody looked at 4.'] });
    expect(rateInfiltration({ ...input, verdict: { ...input.verdict, pointing: ['E1'] } })).toMatchObject({ title: 'Clean getaway', lines: expect.arrayContaining(['E1 says something about you, but nobody would be convinced.']) as string[] });
    expect(rateInfiltration({ ...input, verdict: { convincing: true, pointing: ['E1', 'E2'], unusual: ['E1'], testimony: '' } }).title).toBe('By a hair');
    expect(rateInfiltration({ ...input, blamed: ['Lina Haddad'] }).lines).toContain('Blamed in your place: Lina Haddad.');
  });
  it('and how they got the player', () => {
    const lost = { ...input, winner: 'defenders' as const, verdict: { convincing: true, pointing: ['E1', 'E2'], unusual: ['E1'], testimony: '' } };
    expect(rateInfiltration(lost)).toMatchObject({ title: 'Voted out', lines: expect.arrayContaining(['What gave you away: E1 and E2 on the evidence board.']) as string[] });
    expect(rateInfiltration({ ...lost, detained: true }).title).toBe('Detained');
    expect(rateInfiltration({ ...lost, verdict: input.verdict }).lines[0]).toContain('with their own eyes');
  });
  it('the meeting the player sees is the same as anybody\'s', () => {
    const { r } = infiltrate('normal', 1);
    expect((r.last('me', 'meeting')!.payload as MeetingView).usesLeft).toBe(2);
  });
});
