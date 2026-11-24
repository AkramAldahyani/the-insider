/**
 * Phase 5a, part E: bots that investigate. The SOC analyst follows addresses,
 * the guard watches the monitors and detains - the right person on strong
 * evidence, nobody on weak evidence, and sometimes the wrong one (framed).
 */
import { describe, expect, it } from 'vitest';
import { queryEvents } from '@insider/engine';
import { FAST_INVESTIGATION } from '../src/bots/investigation-pace';
import { Analyst, refusedBadge, suspicious, type StaffEntry } from '../src/bots/investigators';
import type { EvidenceItem } from '../src/evidence';
import { strongCase, type Judge } from '../src/judge';
import { PW, Recorder, scenario } from './helpers';

const START = Date.parse(scenario.startTime);
const staff: StaffEntry[] = scenario.players.map((p) => ({ id: p.id, name: p.name, account: p.account, desk: p.desk, it: p.role === 'sysadmin' || p.role === 'helpdesk' }));
const HEAD = 'TIME     HOST          SOURCE   FIELDS\n';

/** Feeds the analyst answers, one per question, and returns the questions it asked. */
function follow(a: Analyst, answers: Record<string, string>): { asked: string[]; clues: ReturnType<Analyst['read']> } {
  const asked: string[] = [];
  const clues: ReturnType<Analyst['read']> = [];
  for (let q = a.next(); q !== null && asked.length < 20; q = a.next()) {
    asked.push(q);
    clues.push(...a.read(Object.entries(answers).find(([k]) => q!.includes(k))?.[1] ?? 'No matching records.\n'));
  }
  return { asked, clues };
}

describe('the SOC analyst', () => {
  const alert = `${HEAD}09:10:03 SEC-SRV-01    alert    severity=high rule=flag-read src_ip=10.0.2.71`;
  const lease = `${HEAD}07:40:00 ADMIN-SRV-01  dhcp     action=lease ip=10.0.2.71 mac=52:54:00:f1:04:04 client=MKT-LT-11`;

  it('follows an alert: address, lease, PC, owner; the login from there; and what the account did', () => {
    const a = new Analyst('p11', staff, () => []);
    expect(a.next()).toBeNull();
    expect(a.saw(alert)).toEqual([]);
    const { asked, clues } = follow(a, {
      'source=dhcp': lease,
      'action=login': `${HEAD}09:07:47 ADMIN-SRV-01  auth     src_ip=10.0.2.71 action=login result=success user=o.farouk`,
      'target_user=root': `${HEAD}09:09:23 ADMIN-SRV-01  auth     action=su result=success user=o.farouk target_user=root`,
    });
    expect(asked).toEqual([
      'siem source=dhcp ip=10.0.2.71 | tail 1',
      'siem source=auth action=login result=success src_ip=10.0.2.71 | tail 1',
      'siem source=auth user=o.farouk target_user=root | tail 1',
    ]);
    expect(clues.map((c) => [c.suspect, c.weight, c.line])).toEqual([
      ['p4', 2, lease.split('\n')[1]],
      ['', 0, '09:07:47 ADMIN-SRV-01  auth     src_ip=10.0.2.71 action=login result=success user=o.farouk'],
      ['p4', 2, '09:09:23 ADMIN-SRV-01  auth     action=su result=success user=o.farouk target_user=root'],
    ]);
    expect(clues[0].text).toBe('The address 10.0.2.71 is MKT-LT-11, the PC of Omar Farouk: the security alert at 09:10:03 (severity=high rule=flag-read src_ip=10.0.2.71) came from there.');
    // The same alert again: nothing new. Another alert from the same address: it already knows whose PC it is.
    expect(a.saw(alert)).toEqual([]);
    expect(a.saw(`${HEAD}09:12:00 SEC-SRV-01    alert    severity=low rule=sudo-denied src_ip=10.0.2.71`)).toEqual([expect.objectContaining({ suspect: 'p4', weight: 1 })]);
    expect(a.next()).toBeNull();
  });

  it('somebody else\'s account from that address is odd; an old action flagged again is only a lead', () => {
    const a = new Analyst('p11', staff, () => []);
    a.saw(`${HEAD}09:20:00 SEC-SRV-01    alert    severity=high rule=threat-escalation src_ip=10.0.2.71`);
    const { asked, clues } = follow(a, { 'source=dhcp': lease, 'action=login': `${HEAD}09:07:47 ADMIN-SRV-01  auth     src_ip=10.0.2.71 action=login result=success user=k.nasser` });
    expect(asked).toHaveLength(2); // Khalid's account: what it did afterwards says nothing about Omar
    expect(clues[0]).toMatchObject({ suspect: 'p4', weight: 1 });
    expect(clues[1]).toMatchObject({ suspect: 'p4', weight: 2, text: expect.stringContaining("another person's account") });
  });

  it('an address that is nobody\'s PC (a server), or its own, ends there', () => {
    const a = new Analyst('p11', staff, () => []);
    a.saw(alert.replace('10.0.2.71', '10.0.1.10'));
    expect(follow(a, {}).clues).toEqual([]);
    a.saw(alert.replace('10.0.2.71', '10.0.2.59'));
    expect(follow(a, { 'source=dhcp': lease.replace('10.0.2.71', '10.0.2.59').replace('MKT-LT-11', 'SOC-WS-01') }).clues).toEqual([]);
  });

  it('follows addresses that colleagues pinned, each once, and not its own pins', () => {
    const items = [
      { id: 'E1', pinnedById: 'p2', text: 'ESTAB    0        0          10.0.2.74:4440        10.0.2.71:51525  users:(("sysupd",pid=768,fd=4))' },
      { id: 'E2', pinnedById: 'p3', text: 'o.farouk   pts/0        10.0.2.90        Mon Mar  2 09:09   still logged in' },
      { id: 'E3', pinnedById: 'p11', text: 'ESTAB    0        0          10.0.2.74:4440        10.0.2.99:51525' },
      { id: 'E4', pinnedById: 'p2', text: 'the address 10.0.2.98 looks odd to me' },
    ];
    const a = new Analyst('p11', staff, () => items);
    expect(follow(a, {}).asked).toEqual(['siem source=dhcp ip=10.0.2.71 | tail 1', 'siem source=dhcp ip=10.0.2.90 | tail 1']);
    expect(a.next()).toBeNull();
  });
});

describe('the guard at the monitors', () => {
  const person = (over: object) => ({ name: 'Omar Farouk', playerId: 'p4', seatedAt: '', activity: '', room: 'Corridor', ...over });
  it('sees somebody crouched at a PC, at another desk, or in the server room', () => {
    const see = (over: object) => suspicious(person(over), 'CAM-01', '09:31', staff);
    expect(see({})).toBeNull();
    expect(see({ seatedAt: 'MKT-LT-11' })).toBeNull();
    expect(see({ activity: 'at-pc' })).toMatchObject({ weight: 3, caught: true, suspect: 'p4', text: 'CAM-01 shows Omar Farouk crouched at a PC, plugging something in at 09:31.' });
    expect(see({ seatedAt: 'HR-LT-03' })).toMatchObject({ weight: 2, caught: false });
    expect(see({ room: 'Server room' })).toMatchObject({ weight: 1 });
    expect(suspicious(person({ playerId: 'p5', name: 'Khalid Nasser', room: 'Server room' }), 'CAM-05', '09:31', staff)).toBeNull();
    expect(suspicious(person({ playerId: 'p8', name: 'Dana Aziz', seatedAt: 'HR-LT-03' }), 'CAM-05', '09:31', staff)).toBeNull();
  });
  it('reads refused badges', () => {
    expect(refusedBadge('2026-03-02 09:31:05 DOOR=SRV-ROOM BADGE=0417 USER=o.farouk RESULT=DENIED DIR=IN', staff)).toMatchObject({ suspect: 'p4', weight: 1, text: 'The badge log shows Omar Farouk was refused at the door SRV-ROOM at 09:31.' });
    expect(refusedBadge('2026-03-02 09:31:05 DOOR=MAIN-ENT BADGE=0417 USER=o.farouk RESULT=GRANTED DIR=IN', staff)).toBeNull();
  });
});

describe('when is the evidence strong?', () => {
  const judge: Judge = {
    staff: scenario.players.map((p) => ({ id: p.id, name: p.name, account: p.account, desk: p.desk, ip: p.id === 'p4' ? '10.0.2.71' : '', uid: 0, badge: '', it: p.role === 'sysadmin' })),
    today: '2026-03-02', roomAt: () => '',
  };
  const item = (id: string, text: string): EvidenceItem => ({ id, kind: 'screen', title: '', text, time: 0, pinnedBy: '', pinnedById: '' });
  const alert = item('E1', '09:10:03 SEC-SRV-01 alert severity=high rule=flag-read src_ip=10.0.2.71');
  const lease = item('E2', '07:40:00 ADMIN-SRV-01 dhcp action=lease ip=10.0.2.71 client=MKT-LT-11');
  const login = item('E3', '09:07:47 ADMIN-SRV-01 auth src_ip=10.0.2.71 action=login user=o.farouk');
  const root = item('E4', '09:09:23 ADMIN-SRV-01 auth action=su user=o.farouk target_user=root');
  const again = item('E5', '09:20:00 SEC-SRV-01 alert severity=high rule=threat-escalation src_ip=10.0.2.71');
  const strong = (items: EvidenceItem[], saw: { suspect: string; weight: number; caught: boolean }[] = []) => strongCase(items, 'p4', judge, saw);

  it('three pieces, two of them unusual; more than a vote needs', () => {
    expect(strong([alert, lease, login, root])).toBe(true);
    expect(strong([alert, lease, login])).toBe(false);
    expect(strong([alert, root])).toBe(false);
    expect(strong([again, alert, lease, login])).toBe(false); // an old login flagged again is not a second unusual thing
    expect(strong([again, lease, login])).toBe(false);
    // Attempts that were refused are not enough either, however many.
    const refused = item('E6', '09:11:00 SEC-SRV-01 alert severity=low rule=sudo-denied src_ip=10.0.2.71');
    const badge = item('E7', '2026-03-02 09:31:05 DOOR=SRV-ROOM BADGE=0417 USER=o.farouk RESULT=DENIED DIR=IN');
    expect(strong([refused, badge, lease, login, again])).toBe(false);
    expect(strong([refused, badge, lease, login, alert])).toBe(false);
  });
  it('or what the guard saw', () => {
    expect(strong([], [{ suspect: 'p4', weight: 3, caught: true }])).toBe(true);
    expect(strong([], [{ suspect: 'p4', weight: 3, caught: false }])).toBe(false); // standing behind somebody: people do
    expect(strong([alert], [{ suspect: 'p4', weight: 2, caught: false }])).toBe(true);
    expect(strong([], [{ suspect: 'p4', weight: 2, caught: false }])).toBe(false);
    expect(strong([lease], [{ suspect: 'p3', weight: 3, caught: true }])).toBe(false);
  });
});

// ───────────────────────────── In the office ─────────────────────────────

/** As fast as they can, but nobody calls a meeting (that is tested in infiltration.test.ts): here the guard is alone. */
const GUARD_ONLY = { ...FAST_INVESTIGATION, meetingMinutes: [600, 600] as const };

/** Omar is a human hacker; everybody else is a bot, and they investigate. */
function office(options: { investigate?: boolean; seed?: number } = {}): Recorder {
  const r = new Recorder({ bots: true, seed: options.seed ?? 3, weaknesses: ['plaintext-password'], botOptions: { hacker: false, investigate: options.investigate ?? true, pinClues: 30, investigationPace: GUARD_ONLY } });
  r.connect('h');
  r.send('h', 'choose', { playerId: 'p4', hacker: true });
  for (let i = 0; i < 2600; i++) r.game.tick(100); // everybody has arrived
  return r;
}
function play(r: Recorder, minutes: number, done: () => boolean = () => false): boolean {
  for (let i = 0; i < minutes * 600 && !r.game.over && !done(); i++) {
    r.game.tick(100);
    if (i % 10 === 0) r.flush();
  }
  r.flush();
  return done();
}
/** Root on the server with the password from the old script, then the flag. */
function steal(r: Recorder, account: string, password: string): void {
  r.type('h', `ssh ${account}@ADMIN-SRV-01`);
  r.type('h', password);
  const script = r.type('h', 'cat /srv/shared/old/backup-2025.sh');
  r.type('h', 'su');
  r.type('h', /ROOT_PW='([^']+)'/.exec(script)![1]);
  expect(r.type('h', 'cat /root/flag.txt')).toContain('NEXORA{');
}

describe('in the office', () => {
  it.each([1, 2, 3, 4])('a hacker who works from the own desk is traced and detained (seed %i)', (seed) => {
    const r = office({ seed });
    r.sitAt('h', 'p4', 'MKT-LT-11');
    r.type('h', PW['o.farouk']);
    const before = r.game.world.time;
    steal(r, 'o.farouk', PW['o.farouk']);
    play(r, 25);
    expect(r.game.over, r.game.board.items.map((i) => i.text).join('\n')).toMatchObject({ winner: 'defenders' });
    expect(r.game.detentions).toEqual([expect.objectContaining({ guardId: 'p10', targetId: 'p4', wasHacker: true })]);
    // Not at once: somebody has to look, type and walk.
    expect(r.game.over!.at - before).toBeGreaterThan(45_000);
    const typed = queryEvents(r.game.world, { type: 'command', actor: 'p11', since: before }).map((e) => String(e.details.command));
    expect(typed).toContain('siem source=auth user=o.farouk target_user=root | tail 1');
    expect(r.game.board.items.filter((i) => i.pinnedById === 'p11').length).toBeGreaterThanOrEqual(4);
  }, 30_000);

  it('a hacker at somebody else\'s PC frames its owner; the guard is wrong once and loses the power', () => {
    const r = office({ seed: 1 });
    // Lina's PC is open in this scenario, and she (a bot) is sent on a long break.
    const lina = r.game.bots!.mind('p3')!;
    play(r, 20, () => r.game.publicState().players['p3'].seatedAt === '' && r.game.publicState().desks['HR-LT-03'].screen === 'unlocked');
    expect(r.game.publicState().desks['HR-LT-03'].screen).toBe('unlocked');
    Object.assign(lina, { nextBreakAt: 0, leaving: 'undecided', atBreakSpot: true, breakSpot: { x: 0, y: 0 }, breakUntil: r.game.world.time + 3_600_000 });
    // Nobody is in HR to see it.
    for (const id of ['p6']) r.game.bots!.remove(id);
    expect(r.sitAt('h', 'p4', 'HR-LT-03')).toBe(true);
    if (r.screen('h').screen === 'locked') r.type('h', PW['l.haddad']); // she did lock it: somebody who knows her password
    steal(r, 'l.haddad', PW['l.haddad']);
    r.send('h', 'stand');
    r.walkToTile('h', 'p4', 34, 10);
    play(r, 20, () => r.game.detentions.length > 0);
    expect(r.game.detentions).toEqual([expect.objectContaining({ guardId: 'p10', targetId: 'p3', wasHacker: false })]);
    expect(r.notice('h')).toContain('can no longer detain anyone');
    expect(r.game.over).toBeNull();
    // He never tries again, whatever the board says.
    play(r, 10);
    expect(r.game.detentions).toHaveLength(1);
  }, 30_000);

  it('plugging in a USB stick in front of a camera: the guard sees the picture, pins it and comes', () => {
    const r = office({ seed: 2 });
    const desk = r.map.desks.find((d) => d.hostname === 'REC-PC-01')!;
    r.game.bots!.remove('p9');
    expect(r.walkTo('h', 'p4', desk.seatX, desk.seatY + 4)).toBe(true);
    r.send('h', 'item.start', { item: 'usb', hostname: 'REC-PC-01' });
    for (let i = 0; i < 40; i++) r.tick();
    expect(r.game.publicState().players['p4'].activity).toBe('at-pc');
    r.send('h', 'item.stop');
    play(r, 25);
    expect(r.game.over).toMatchObject({ winner: 'defenders' });
    expect(r.game.bots!.findings('p10').some((f) => f.suspect === 'p4' && f.caught)).toBe(true);
  }, 30_000);

  it('weak evidence detains nobody: a refused sudo, a refused badge, and the old login flagged again', () => {
    const r = office({ seed: 4 });
    const door = r.map.doors.find((d) => d.code === 'SRV-ROOM')!;
    expect(r.walkTo('h', 'p4', door.x - 20, door.y + door.height / 2)).toBe(true);
    // The monitors show the last 40 badge lines: the guard sees it if he looks soon enough.
    const monitors = r.map.furniture.find((f) => f.kind === 'monitors')!;
    expect(play(r, 60, () => Math.hypot(r.position('p10').x - (monitors.x + monitors.width / 2), r.position('p10').y - (monitors.y - 16)) < 4)).toBe(true);
    r.send('h', 'tap', { door: 'SRV-ROOM' });
    play(r, 0.1);
    r.sitAt('h', 'p4', 'MKT-LT-11');
    r.type('h', PW['o.farouk']);
    r.type('h', 'ssh ADMIN-SRV-01');
    r.type('h', PW['o.farouk']);
    r.type('h', 'sudo ls');
    r.type('h', PW['o.farouk']);
    play(r, 30);
    expect(r.game.over).toBeNull();
    expect(r.game.detentions).toEqual([]);
    // They did look into it.
    expect(r.game.board.items.some((i) => i.text.includes('client=MKT-LT-11'))).toBe(true);
    expect(r.game.bots!.findings('p10').some((f) => f.text.includes('refused at the door SRV-ROOM'))).toBe(true);
  }, 30_000);

  it('an ordinary day gives them nothing: no pins, nobody detained', () => {
    for (const seed of [1, 2, 3]) {
      const r = new Recorder({ bots: true, seed, botOptions: { hacker: false, investigate: true, pinClues: 30 } });
      for (let i = 0; i < 2 * 36_000; i++) r.game.tick(100);
      expect(r.game.board.items).toEqual([]);
      expect(r.game.detentions).toEqual([]);
      const watched = r.game.bots!.list().find((b) => b.playerId === 'p10')!;
      expect(watched.failure, 'the guard is not stuck').toBe('');
      // The guard really goes to the monitors, and everybody still does their job.
      expect(queryEvents(r.game.world, { type: 'command', actor: 'p10', since: START }).length).toBeGreaterThan(20);
    }
  }, 60_000);

  it('without the setting nobody investigates', () => {
    const r = office({ investigate: false, seed: 1 });
    r.sitAt('h', 'p4', 'MKT-LT-11');
    r.type('h', PW['o.farouk']);
    steal(r, 'o.farouk', PW['o.farouk']);
    play(r, 20);
    expect(r.game.over).toBeNull();
    expect(r.game.detentions).toEqual([]);
    expect(queryEvents(r.game.world, { type: 'command', actor: 'p11' }).some((e) => String(e.details.command).includes('source=dhcp'))).toBe(false);
  }, 30_000);
});
