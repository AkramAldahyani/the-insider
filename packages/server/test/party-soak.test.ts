/**
 * Phase 6, part J: whole lobby matches, again and again, with people who do
 * all kinds of things (walk, work, chat, pin, accuse, vote, lose the line,
 * come back, leave), and the balance when a person is the hacker.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, isFree, type MeetingView, type PartySettings } from '@insider/shared';
import { Random } from '../src/bots/random';
import { deal } from '../src/deal';
import { partyGameOptions } from '../src/party';
import { PW, Recorder, clone, scenario, tiledMap } from './helpers';

const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small', dev: false };
const COMMANDS = ['ls -la', 'whoami', 'last -n 5', 'ps aux', 'mail', 'history', 'cat /etc/hostname', 'ssh ADMIN-SRV-01', 'exit', 'uptime', 'grep -r ssh /var/log', 'loginctl lock-session', 'find ~ -name "*.txt"'];
const CHAT = ['who was at the server room?', 'I was in Finance', 'not me', 'look at the board'];

interface Person {
  client: string;
  id: string;
  account: string;
  /** What this person is doing now, and for how many more steps. */
  doing: 'idle' | 'walk' | 'away' | 'gone';
  steps: number;
}

/**
 * One lobby match, played by `people.length` people who behave at random (and
 * a little like players), until it ends or `minutes` of game time have passed.
 */
function soak(seed: number, settings: Partial<PartySettings>, size: number, minutes: number) {
  const s: PartySettings = { bots: true, hacker: 'auto', hackers: 0, difficulty: 'normal', meetings: 'short', office: 'auto', ...settings };
  const clients = Array.from({ length: size }, (_, i) => `c${i}`);
  const random = new Random(seed * 7919);
  const d = deal(scenario.players, clients, s, random);
  const o = partyGameOptions(base, s, seed, d);
  const r = new Recorder({ ...o, meetingTimes: { ...o.meetingTimes, discussionMs: 15_000, votingMs: 8000, resultMs: 1000, cooldownMs: 10_000, usesPerPlayer: 2 } });
  for (const [client, id] of d.seats) r.game.seat(client, id);
  r.game.everybodyIsIn();
  r.flush();
  const people: Person[] = [...d.seats].map(([client, id]) => ({ client, id, account: scenario.players.find((p) => p.id === id)!.account, doing: 'idle', steps: 0 }));
  const hackers = new Set(d.hackers);

  for (let step = 0; step < minutes * 600 && !r.game.over; step++) {
    for (const p of people) {
      if (p.doing === 'gone') continue;
      if (p.doing === 'away') {
        if (--p.steps === 0) {
          r.game.connectionBack(p.client);
          p.doing = 'idle';
        } else if (p.steps === 650) r.game.standIn(p.client); // the minute is over
        continue;
      }
      if (random.next() > 0.04) continue; // people do something now and then, not ten times a second
      const roll = random.next();
      const seated = r.game.publicState().players[p.id]?.seatedAt ?? '';
      const meeting = r.last(p.client, 'meeting')?.payload as MeetingView | undefined;
      if (meeting?.active) {
        if (meeting.phase === 'discussion' && roll < 0.3 && r.game.board.items.length >= 3) {
          const suspect = random.pick(scenario.players).id;
          r.send(p.client, 'meeting.accuse', { suspect, evidence: r.game.board.items.slice(-3).map((i) => i.id) });
        } else if (meeting.phase === 'voting' && meeting.canVote && !meeting.myVote) {
          r.send(p.client, 'meeting.vote', { target: roll < 0.5 && meeting.accusations[0] ? meeting.accusations[0].suspectId : 'skip' });
        } else r.send(p.client, 'chat.send', { text: random.pick(CHAT) });
      } else if (roll < 0.0004) {
        r.game.disconnect(p.client); // goes home for good
        p.doing = 'gone';
      } else if (roll < 0.004) {
        r.game.connectionLost(p.client); // the Wi-Fi
        p.doing = 'away';
        p.steps = random.next() < 0.5 ? 300 : 900;
      } else if (roll < 0.03 && r.game.board.items.length >= 3 && !r.game.over && r.game.publicState().players[p.id]) {
        // Goes to the red button (the others stand still meanwhile) and calls a meeting.
        if (seated) r.send(p.client, 'stand');
        const button = r.map.furniture.find((f) => f.kind === 'button')!;
        if (r.walkTo(p.client, p.id, button.x + button.width / 2, button.y + button.height + 14)) r.send(p.client, 'meeting.call');
      } else if (seated) {
        const screen = r.screen(p.client);
        if (roll < 0.1) r.send(p.client, 'stand');
        else if (screen.masked || screen.screen !== 'shell') r.send(p.client, 'term.line', { text: screen.prompt.endsWith('login: ') ? p.account : PW[p.account] });
        else if (roll < 0.2 && screen.output.trim()) r.send(p.client, 'evidence.pin', { kind: 'screen', text: screen.output.trim().split('\n')[0] });
        else r.send(p.client, 'term.line', { text: random.pick(COMMANDS) });
      } else if (roll < 0.25) {
        r.send(p.client, 'move', { dx: random.pick([-1, 0, 1]), dy: random.pick([-1, 0, 1]) });
      } else if (roll < 0.5) {
        r.send(p.client, 'move', { dx: 0, dy: 0 });
        const at = r.game.publicState().players[p.id];
        const near = at && r.map.desks.find((desk) => Math.hypot(desk.seatX - at.x, desk.seatY - at.y) < 40);
        if (near) r.send(p.client, 'sit', { hostname: near.hostname });
        else {
          const button = r.map.furniture.find((f) => f.kind === 'button')!;
          if (at && Math.hypot(button.x - at.x, button.y - at.y) < 60 && r.game.board.items.length >= 3) r.send(p.client, 'meeting.call');
        }
      } else if (roll < 0.6) r.send(p.client, 'chat.send', { text: random.pick(CHAT), ...(hackers.has(p.id) && roll < 0.55 ? { channel: 'hackers' } : {}) });
      else if (roll < 0.62) r.send(p.client, 'detain', { target: random.pick(scenario.players).id });
    }
    r.game.tick(100);
    if (step % 10 === 0) r.flush();
    if (step % 600 === 0) check(r);
  }
  r.flush();
  check(r);
  return { r, d, people };
}

/** What must always be true. */
function check(r: Recorder): void {
  const state = r.game.publicState();
  const bodies = Object.values(state.players);
  for (const p of bodies) {
    expect(isFree(r.map, p.x, p.y, PLAYER_RADIUS), `${p.name} at ${p.x},${p.y}`).toBe(true);
    expect(r.game.fired.has(p.id), `${p.name} is out but has a body`).toBe(false);
  }
  // Nobody twice, nobody at two PCs, nobody at a PC twice.
  expect(new Set(bodies.map((p) => p.id)).size).toBe(bodies.length);
  const seated = bodies.filter((p) => p.seatedAt).map((p) => p.seatedAt);
  expect(new Set(seated).size).toBe(seated.length);
  expect(state.reputation).toBeGreaterThanOrEqual(0);
  expect(state.reputation).toBeLessThanOrEqual(100);
  expect(r.game.bots?.list().filter((b) => b.failure) ?? []).toEqual([]);
}

describe('soak: lobby matches with people who do everything', () => {
  const cases = [
    { seed: 1, size: 3, settings: {} },
    { seed: 2, size: 5, settings: { hacker: 'human' as const } },
    { seed: 3, size: 4, settings: { bots: false } },
    { seed: 4, size: 8, settings: { hackers: 2, hacker: 'human' as const } },
    { seed: 5, size: 11, settings: { difficulty: 'hard' as const } },
    { seed: 6, size: 2, settings: { hacker: 'bot' as const, difficulty: 'easy' as const } },
    { seed: 7, size: 6, settings: { bots: false, hackers: 1 } },
    { seed: 8, size: 9, settings: { hackers: 3, hacker: 'human' as const } },
  ];
  it.each(cases)('$size people, seed $seed, $settings', ({ seed, size, settings }) => {
    const { r, d, people } = soak(seed, settings, size, 45);
    expect(r.game.meetings.history.length, 'meetings').toBeGreaterThan(0);
    const world = r.game.world;
    const flag = r.file(world.mission.flag!.host, world.mission.flag!.path).trim();
    for (const p of people) {
      const all = r.sent.get(p.client) ?? [];
      const end = all.findIndex((m) => m.type === 'match.over');
      const before = JSON.stringify(end < 0 ? all : all.slice(0, end));
      // Nothing secret before the end: nobody else's password, nobody's role, no private chat for a defender.
      for (const [user, password] of Object.entries(PW)) if (user !== p.account && !d.hackers.includes(p.id)) expect(before, `${p.client} got ${user}`).not.toContain(password);
      if (!d.hackers.includes(p.id)) {
        expect(before).not.toContain('"channel":"hackers"');
        expect(before).not.toContain('toolsPath');
        expect(before).not.toContain(flag);
      }
      for (const word of ['"debrief":{', '"cast":[{', 'mission.trail', 'convening', 'net0']) expect(before, word).not.toContain(word);
      // Somebody who is still here at the end is told once.
      if (r.game.over && p.doing !== 'gone' && p.doing !== 'away') {
        expect(all.filter((m) => m.type === 'match.over'), p.client).toHaveLength(1);
        expect(all.filter((m) => m.type === 'debrief'), p.client).toHaveLength(1);
      }
    }
    // A match ends or keeps a modest size.
    expect(world.events.length).toBeLessThan(100_000);
    expect(r.game.chatLog.length).toBeLessThan(5000);
    // When it is over, it is over.
    if (r.game.over) {
      const end = JSON.stringify(world);
      for (let i = 0; i < 600; i++) r.game.tick(100);
      expect(JSON.stringify(r.game.world)).toBe(end);
    }
  }, 120_000);

  it('the same people doing the same things give the same match', () => {
    const run = () => {
      const { r } = soak(9, { hacker: 'human' }, 5, 10);
      return JSON.stringify([r.game.world.events.length, r.game.publicState(), r.game.over, r.game.chatLog.length]);
    };
    expect(run()).toBe(run());
  }, 60_000);
});

describe('balance: a person as the hacker who steals at once', () => {
  /**
   * The hacker uses the easiest way in at the very start and hands the file in
   * as soon as allowed. A defender at their own PC works at a person's pace
   * (`pace` seconds for each command, reading and typing included) and follows
   * the evidence. Measured in part J: 52 to 143 seconds from the read to the
   * emergency button; the owner then chose 5, 3 and 2 minutes by difficulty.
   */
  it.each([
    { job: 'soc', id: 'p11', pace: 30, difficulty: 'hard' as const },
    { job: 'sysadmin', id: 'p5', pace: 30, difficulty: 'normal' as const },
    { job: 'employee', id: 'p1', pace: 30, difficulty: 'normal' as const },
    { job: 'employee', id: 'p1', pace: 50, difficulty: 'easy' as const },
  ])('a $job at $pace s per command, on $difficulty, is in time', ({ job, id, pace, difficulty }) => {
    const seats = new Map([['h', 'p4'], ['d', id], ['x', 'p2'], ['y', 'p9']]);
    const o = partyGameOptions({ ...base, weaknesses: ['plaintext-password'] }, { bots: true, hacker: 'human', hackers: 1, difficulty, meetings: 'normal', office: 'small' }, 1, { hackers: ['p4'], human: true, seats });
    const r = new Recorder(o);
    for (const [c, p] of seats) r.game.seat(c, p);
    r.game.everybodyIsIn();
    const wait = (s: number) => { for (let i = 0; i < s * 20; i++) { r.game.tick(50); if (i % 20 === 0) r.flush(); } r.flush(); };
    const login = (c: string, pid: string, host: string, account: string) => {
      r.sitAt(c, pid, host);
      if (r.screen(c).screen === 'login' && !r.screen(c).masked) r.type(c, account);
      if (r.screen(c).screen !== 'shell') r.type(c, PW[account]);
    };
    const me = scenario.players.find((p) => p.id === id)!;
    login('d', id, me.desk, me.account);
    login('h', 'p4', 'MKT-LT-11', 'o.farouk');
    // The hacker: a line every 8 seconds, the way the story offers.
    const h = (line: string) => { wait(8); return r.type('h', line); };
    h('ssh o.farouk@ADMIN-SRV-01');
    r.type('h', PW['o.farouk']);
    const script = h('cat /srv/shared/old/backup-2025.sh');
    h('su');
    r.type('h', /ROOT_PW='([^']+)'/.exec(script)![1]);
    const flag = h('cat /root/flag.txt').trim();
    const read = r.game.world.time;
    wait(1);
    expect(r.messages('d', 'alert').length).toBeGreaterThan(0); // the banner everybody sees
    // The hacker tries to hand it in every 10 seconds from now on.
    let tries = 0;
    const d = (line: string) => {
      for (let s = 0; s < pace; s += 10) {
        wait(10);
        if (++tries && !r.game.meetings.current) r.send('h', 'flag.submit', { text: flag });
      }
      return r.type('d', line);
    };
    const pin = (text: string | undefined) => { if (text) r.send('d', 'evidence.pin', { kind: 'screen', text: text.trim() }); };
    const line = (text: string, what: string) => text.split('\n').find((l) => l.includes(what));
    if (job === 'soc') {
      const row = line(d('siem source=alert severity=high'), 'rule=') ?? '';
      pin(row);
      const ip = /src_ip=(\S+)/.exec(row)![1];
      pin(line(d(`siem source=dhcp ip=${ip} | tail 1`), 'client='));
      pin(line(d(`siem source=auth host=ADMIN-SRV-01 action=login src_ip=${ip} | tail 1`), 'action=login'));
    } else {
      d('ssh ADMIN-SRV-01');
      r.type('d', PW[me.account]);
      const last = d('last -n 6');
      pin(line(last, 'o.farouk'));
      const ip = /(\d+\.\d+\.\d+\.\d+)/.exec(line(last, 'o.farouk')!)![1];
      pin(line(d(`grep -A 6 ${ip} /var/lib/dhcp/dhcpd.leases | tail -n 8`), 'MKT-LT-11'));
      pin(line(job === 'sysadmin' ? d('grep Accepted /var/log/auth.log | tail -n 3') : d('last -n 3'), 'o.farouk'));
    }
    expect(r.game.over, 'handed in before the defender was done').toBeNull();
    r.send('d', 'stand');
    const b = r.map.furniture.find((f) => f.kind === 'button')!;
    expect(r.walkTo('d', id, b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
    r.send('d', 'meeting.call');
    expect(r.game.meetings.current, r.notice('d')).not.toBeNull();
    expect((r.game.world.time - read) / 60_000).toBeLessThan(o.handInMinutes!);
    r.send('d', 'meeting.accuse', { suspect: 'p4', evidence: r.game.board.items.map((i) => i.id) });
    while (r.game.meetings.current?.phase === 'discussion') r.game.tick(100);
    r.send('d', 'meeting.vote', { target: 'p4' });
    while (r.game.meetings.current && !r.game.over) r.game.tick(100);
    r.flush();
    expect(r.game.over?.winner).toBe('defenders');
    expect(tries).toBeGreaterThan(3);
  }, 60_000);
});
