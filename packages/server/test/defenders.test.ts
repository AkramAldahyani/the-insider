/**
 * Phase 5, part G: bot defenders. They check their own PCs, remember what
 * they saw, tell the meeting, and vote only on what they know themselves.
 */
import { describe, expect, it } from 'vitest';
import { lastStamp, queryEvents } from '@insider/engine';
import { TICK_RATE, type MeetingView } from '@insider/shared';
import { inspect, today, SELF_CHECKS } from '../src/bots/brain';
import { PW, Recorder, scenario } from './helpers';

const seconds = (s: number) => Math.round(s * TICK_RATE);
const START = Date.parse(scenario.startTime);
const FAST = { discussionMs: 6000, votingMs: 6000, resultMs: 1000, cooldownMs: 0 };
const view = (r: Recorder, c: string) => r.last(c, 'meeting')!.payload as MeetingView;

describe('checking the own PC', () => {
  const me = { account: 'r.mansour', desk: 'FIN-LT-04', ip: '10.0.0.74', today: today(START) };

  it('a login over the network today, from another address, is worth mentioning', () => {
    const output = [
      `o.farouk   pts/0        10.0.0.71        ${lastStamp(START + 52 * 60_000)}   still logged in`,
      `r.mansour  tty1                          ${lastStamp(START)}   still logged in`,
      `r.mansour  pts/1        10.0.0.74        ${lastStamp(START + 60_000)}   still logged in`, // from this very PC
      `r.mansour  pts/0        10.0.0.110       ${lastStamp(START - 3 * 86_400_000)} - 10:00  (00:05)`, // days ago: old news
      '',
      'wtmp begins Mon Feb 23 08:00:00 2026',
    ].join('\n');
    const found = inspect('last -n 10', output, me);
    expect(found).toEqual([{ text: 'Someone logged in to my PC FIN-LT-04 as o.farouk from 10.0.0.71 at 09:52. That was not me.', weight: 0 }]);
  });

  it('an @reboot line in the crontab is worth mentioning; no crontab is not', () => {
    expect(inspect('crontab -l', '@reboot /home/r.mansour/.cache/.sysupd/sysupd -d\n', me)[0].text)
      .toBe('My crontab on FIN-LT-04 has a line I never added: @reboot /home/r.mansour/.cache/.sysupd/sysupd -d');
    expect(inspect('crontab -l', '', me)).toEqual([]);
  });

  it('bots really type those checks at their own PCs during the day', () => {
    const r = new Recorder({ bots: true });
    r.tick(seconds(40 * 60));
    const checks = queryEvents(r.game.world, { type: 'command', since: START })
      .filter((e) => SELF_CHECKS.includes(String(e.details.command)));
    expect(new Set(checks.map((e) => e.user)).size).toBeGreaterThanOrEqual(5);
    // ...at their own desks, not over the network.
    for (const e of checks) expect(r.game.world.players.find((p) => p.account === e.user)?.desk).toBe(e.host);
  });
});

describe('what bots notice', () => {
  it('a bot coming back from a break sees somebody at its PC, and remembers it', () => {
    const r = new Recorder({ bots: true });
    r.tick(seconds(260)); // everybody has arrived
    for (let i = 0; i < 600 && r.game.bots!.list().find((b) => b.playerId === 'p2')?.seatedAt !== 'FIN-LT-04'; i++) r.tick(seconds(1));
    r.game.bots!.mind('p2')!.nextBreakAt = 0; // Rami takes a break now
    for (let i = 0; i < 60 && r.game.bots!.list().find((b) => b.playerId === 'p2')?.seatedAt; i++) r.tick(seconds(1));
    r.connect('s', 'p1');
    expect(r.sitAt('s', 'p1', 'FIN-LT-04')).toBe(true); // Sara sits at Rami's PC
    for (let i = 0; i < 300 && r.game.bots!.findings('p2').length === 0; i++) r.tick(seconds(1));
    expect(r.game.bots!.findings('p2')).toEqual([expect.objectContaining({ suspect: 'p1', weight: 2, text: expect.stringMatching(/^I saw Sara Alharbi sitting at my PC FIN-LT-04 at \d\d:\d\d, while I was away from it\.$/) })]);
  });

  it('being watched while typing a password is remembered as a finding against the watcher', () => {
    const r = new Recorder({ bots: true });
    r.tick(seconds(260));
    for (let i = 0; i < 20 && r.game.bots!.findings('p2').length === 0; i++) {
      r.game.bots!.watchedBy('p2', { playerId: 'p4', name: 'Omar Farouk' }, 'Finance', 'FIN-LT-04'); // remembered 7 times in 10
    }
    expect(r.game.bots!.findings('p2')).toHaveLength(1); // the same story is not counted twice
    expect(r.game.bots!.suspicion('p2', 'p4')).toBe(3);
  });
});

describe('how a bot votes', () => {
  const r = new Recorder({ bots: true });
  r.tick(seconds(260));
  const add = (bot: string, suspect: string, weight: number) => r.game.bots!.findings(bot).push({ time: 0, text: `${bot} on ${suspect} ${weight}`, suspect, weight });

  it('for the accused person it has enough against', () => {
    add('p2', 'p4', 2);
    add('p2', 'p7', 3);
    expect(r.game.bots!.ballot('p2', ['p4', 'p7'])).toBe('p7'); // the one with the most
    expect(r.game.bots!.ballot('p2', ['p4'])).toBe('p4');
  });

  it('skip when it strongly suspects someone who was not accused; nothing when it knows nothing', () => {
    expect(r.game.bots!.ballot('p2', ['p9'])).toBe('skip');
    expect(r.game.bots!.ballot('p3', ['p9'])).toBeNull();
    add('p3', 'p9', 1); // one sighting in the server room is not enough to fire anyone
    expect(r.game.bots!.ballot('p3', ['p9'])).toBeNull();
  });

  it('never for itself', () => {
    add('p6', 'p6', 3);
    expect(r.game.bots!.ballot('p6', ['p6'])).toBeNull();
  });
});

describe('bots in a meeting', () => {
  it('they tell the meeting what they saw, and their votes decide', () => {
    const r = new Recorder({ bots: true, meetingTimes: FAST });
    r.tick(seconds(260));
    r.connect('s', 'p1');
    r.connect('o', 'p4');
    const witnesses = ['p2', 'p3', 'p6'];
    for (const id of witnesses) r.game.bots!.findings(id).push({ time: START, text: `I saw Omar Farouk sitting at my PC at 09:3${id.slice(1)}, while I was away from it.`, suspect: 'p4', weight: 2 });

    // Sara pins three things and accuses Omar.
    r.sitAt('s', 'p1', 'FIN-LT-07');
    r.type('s', PW['s.alharbi']);
    for (const cmd of ['hostname', 'whoami', 'pwd']) r.send('s', 'evidence.pin', { kind: 'screen', text: r.type('s', cmd).trim() });
    r.send('s', 'stand');
    const b = r.map.furniture.find((f) => f.kind === 'button')!;
    expect(r.walkTo('s', 'p1', b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
    r.send('s', 'meeting.call');
    r.send('s', 'meeting.accuse', { suspect: 'p4', evidence: r.game.board.items.map((i) => i.id) });

    r.tick(seconds(6.2)); // the discussion
    const said = r.messages('s', 'chat').map((m) => m.payload as { from: string; text: string });
    for (const name of ['Rami Mansour', 'Lina Haddad', 'Noor Saleh']) expect(said.some((l) => l.from === name && l.text.includes('Omar Farouk sitting at my PC')), name).toBe(true);
    expect(r.game.chatLog.every((l) => l.channel === 'meeting')).toBe(true);

    r.send('o', 'meeting.vote', { target: 'skip' });
    r.tick(seconds(6.5)); // the vote: Sara does not even vote
    const result = view(r, 's').result!;
    expect(result).toMatchObject({ fired: 'Omar Farouk' });
    expect(r.game.meetings.history[0].votes).toMatchObject({ p2: 'p4', p3: 'p4', p6: 'p4', p4: 'skip' });
    // Bots that know nothing did not vote at all.
    expect(Object.keys(r.game.meetings.history[0].votes)).toHaveLength(4);
  });
});
