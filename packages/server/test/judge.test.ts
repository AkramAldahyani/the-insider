/**
 * Phase 5a, part B: evidence that convinces. How colleagues judge pinned
 * evidence, and how that decides the votes of a solo match.
 */
import { describe, expect, it } from 'vitest';
import { queryEvents } from '@insider/engine';
import type { DebriefView, MeetingView, SoloChoice } from '@insider/shared';
import type { EvidenceItem } from '../src/evidence';
import { comment, judgeAccusation, judgePiece, type Judge, type StaffMember } from '../src/judge';
import { soloGameOptions } from '../src/solo';
import { PW, Recorder, clone, scenario, tiledMap } from './helpers';

const person = (id: string, name: string, account: string, desk: string, ip: string, uid: number, badge: string, it = false): StaffMember => ({ id, name, account, desk, ip, uid, badge, it });
const judge: Judge = {
  staff: [
    person('p3', 'Lina Haddad', 'l.haddad', 'HR-LT-03', '10.0.2.18', 1003, '0303'),
    person('p4', 'Omar Farouk', 'o.farouk', 'MKT-LT-11', '10.0.2.185', 1004, '0404'),
    person('p5', 'Khalid Nasser', 'k.nasser', 'IT-WS-02', '10.0.2.119', 1005, '0505', true),
    person('p11', 'Huda Rahman', 'h.rahman', 'SOC-WS-01', '10.0.2.59', 1011, '0141'),
  ],
  today: '2026-03-02',
  roomAt: (x) => (x > 1000 ? 'Server room' : 'Corridor'),
};
const [lina, omar, khalid] = judge.staff;
let n = 0;
const text = (t: string, shown?: string): EvidenceItem => ({ id: `E${++n}`, kind: 'screen', title: 'SOC-WS-01 screen', text: t, shown, time: 0, pinnedBy: 'Huda Rahman', pinnedById: 'p11' });
const picture = (people: { name: string; x?: number; seatedAt?: string; activity?: string }[]): EvidenceItem => ({
  ...text('a picture'), kind: 'snapshot', title: 'CAM-01',
  frame: { camera: 'CAM-01', time: 0, people: people.map((p) => ({ x: 10, y: 10, facing: 'up', seatedAt: '', activity: '', ...p })) },
});
const points = (item: EvidenceItem, who = omar) => judgePiece(item, who, judge).points;
const unusual = (item: EvidenceItem, who = omar) => judgePiece(item, who, judge).unusual;

describe('does a piece point at the accused?', () => {
  it('by account, name, PC, address, user number or badge', () => {
    for (const line of [
      '09:08:14 ADMIN-SRV-01  auth     src_ip=10.0.2.185 action=login result=success user=k.nasser',
      'Mar  2 09:03:12 ADMIN-SRV-01 su[1288]: (to root) o.farouk on pts/0',
      '07:40:00 ADMIN-SRV-01  dhcp     action=lease ip=10.0.2.77 client=MKT-LT-11',
      'type=SYSCALL msg=audit(1772442195.350:561): success=yes auid=1004 uid=0 comm="cat" key="flag-read"',
      '2026-03-02 09:01:00 DOOR=MAIN-ENT BADGE=0404 RESULT=GRANTED',
      'From: Omar Farouk <o.farouk@nexora.local>',
    ]) expect(points(text(line)), line).toBe(true);
  });

  it('a longer word, address or number that only contains it does not count', () => {
    for (const line of ['user=o.farouk2', 'user=joe.o.farouk.old', 'src_ip=10.0.2.18', 'src_ip=110.0.2.185', 'src_ip=10.0.2.185.4', 'auid=10041', 'client=MKT-LT-110', 'BADGE=04045']) {
      expect(points(text(line)), line).toBe(false);
    }
    expect(points(text('src_ip=10.0.2.185'), lina)).toBe(false); // hers is 10.0.2.18
    expect(points(text('Accepted password from 10.0.2.185.'))).toBe(true); // the end of a sentence
  });

  it('old news and lists of everybody say nothing about one person', () => {
    expect(points(text('Feb 27 15:10:00 ADMIN-SRV-01 sshd[1096]: Failed password for invalid user admin from 10.0.2.185 port 36437 ssh2'))).toBe(false);
    expect(points(text('2026-02-27 15:10:00 [HIGH] flag-read by o.farouk'))).toBe(false);
    expect(points(text('Mar  2 15:10:00 ADMIN-SRV-01 sshd[1]: Accepted password for o.farouk from 10.0.2.185 port 1 ssh2'))).toBe(true);
    expect(points(text(judge.staff.map((p) => `user=${p.account}`).join('\n')))).toBe(false);
  });

  it('what the pinning player typed is not evidence', () => {
    expect(points(text('o.farouk is the hacker', ''))).toBe(false);
    expect(points(text('anything', 'user=o.farouk'))).toBe(true);
  });

  it('a camera picture only if it shows them in the act', () => {
    expect(points(picture([{ name: 'Omar Farouk' }]))).toBe(false); // walking about
    expect(points(picture([{ name: 'Omar Farouk', seatedAt: 'MKT-LT-11' }]))).toBe(false); // at his own desk
    expect(points(picture([{ name: 'Omar Farouk', seatedAt: 'HR-LT-03' }]))).toBe(true);
    expect(points(picture([{ name: 'Omar Farouk', activity: 'at-pc' }]))).toBe(true);
    expect(points(picture([{ name: 'Omar Farouk', x: 2000 }]))).toBe(true);
    expect(points(picture([{ name: 'Khalid Nasser', x: 2000 }]), khalid)).toBe(false); // his job
    expect(points(picture([{ name: 'Lina Haddad', seatedAt: 'MKT-LT-11' }]))).toBe(false); // somebody else
  });
});

describe('does it show something unusual?', () => {
  it('alerts, refusals, root rights outside IT, another account from their address', () => {
    for (const line of [
      '09:10:03 SEC-SRV-01    alert    severity=high rule=flag-read src_ip=10.0.2.185',
      '2026-03-02 09:03:15 [HIGH] flag-read /root/flag.txt on ADMIN-SRV-01 was read as root (login o.farouk) from 10.0.2.185',
      'Mar  2 09:03:12 ADMIN-SRV-01 sudo: o.farouk : user NOT in sudoers ; TTY=pts/0 ; COMMAND=/usr/bin/cat',
      '09:09:23 ADMIN-SRV-01  auth     action=su result=success user=o.farouk target_user=root',
      '09:17:50 ADMIN-SRV-01  auth     src_ip=10.0.2.185 action=login result=success user=k.nasser',
      '2026-03-02 09:03:15 RULE=network-scan SRC=10.0.2.185 USER=o.farouk TARGET=all',
      '2026-03-02 09:01:00 DOOR=SRV-ROOM BADGE=0404 USER=o.farouk RESULT=DENIED',
    ]) expect(unusual(text(line)), line).toBe(true);
  });

  it('ordinary work is not: logins, a mistyped password, a lease, the sysadmin using sudo', () => {
    for (const line of [
      '09:08:14 ADMIN-SRV-01  auth     src_ip=10.0.2.185 action=login result=success user=o.farouk',
      'Mar  2 09:02:55 ADMIN-SRV-01 sshd[1272]: Failed password for o.farouk from 10.0.2.185 port 36147 ssh2',
      '07:40:00 ADMIN-SRV-01  dhcp     action=lease ip=10.0.2.185 mac=52:54:00:17:02:02 client=MKT-LT-11',
      '2026-03-02 09:01:00 DOOR=MAIN-ENT BADGE=0404 USER=o.farouk RESULT=GRANTED',
    ]) expect(unusual(text(line)), line).toBe(false);
    expect(unusual(text('Mar  2 08:33:00 ADMIN-SRV-01 sudo: k.nasser : TTY=pts/0 ; USER=root ; COMMAND=/usr/bin/tail'), khalid)).toBe(false);
  });

  it('only the line about the accused counts, not its neighbours', () => {
    const two = text('09:10:03 alert severity=high rule=flag-read src_ip=10.0.2.18\n09:10:04 auth action=login user=o.farouk');
    expect(points(two)).toBe(true);
    expect(unusual(two)).toBe(false);
    expect(unusual(two, lina)).toBe(true);
  });
});

describe('a whole accusation', () => {
  const alert = text('09:10:03 SEC-SRV-01 alert severity=high rule=flag-read src_ip=10.0.2.185');
  const lease = text('07:40:00 ADMIN-SRV-01 dhcp action=lease ip=10.0.2.185 client=MKT-LT-11');
  const login = text('09:08:14 ADMIN-SRV-01 auth src_ip=10.0.2.185 action=login user=o.farouk');
  const nothing = text('SOC-WS-01 is my PC');

  it('needs two pieces about the accused, one of them unusual', () => {
    expect(judgeAccusation([alert, lease, login], 'p4', judge)).toEqual({ convincing: true, pointing: [alert.id, lease.id, login.id], unusual: [alert.id], testimony: '' });
    expect(judgeAccusation([alert, lease, nothing], 'p4', judge).convincing).toBe(true);
    expect(judgeAccusation([alert, nothing, nothing], 'p4', judge).convincing).toBe(false);
    expect(judgeAccusation([lease, login, nothing], 'p4', judge).convincing).toBe(false);
    expect(judgeAccusation([alert, lease, login], 'p3', judge)).toEqual({ convincing: false, pointing: [], unusual: [], testimony: '' });
    expect(judgeAccusation([alert, lease, login], 'nobody', judge).convincing).toBe(false);
  });

  it('what a colleague told a meeting can stand in for the unusual piece, but not for the two about the accused', () => {
    const siem = { from: 'Huda Rahman', text: 'The SIEM shows a security alert at 09:09:12: severity=high rule=flag-read src_ip=10.0.2.185.' };
    expect(judgeAccusation([lease, login, nothing], 'p4', judge, [siem])).toMatchObject({ convincing: true, unusual: [], testimony: 'Huda Rahman' });
    expect(judgeAccusation([lease, nothing], 'p4', judge, [siem]).convincing).toBe(false);
    expect(judgeAccusation([lease, login], 'p3', judge, [siem]).testimony).toBe(''); // another address
    const ordinary = { from: 'Lina Haddad', text: 'I saw Omar Farouk in the cafeteria.' };
    expect(judgeAccusation([lease, login], 'p4', judge, [ordinary]).convincing).toBe(false);
    const witness = { from: 'Lina Haddad', text: 'I saw Omar Farouk sitting at my PC HR-LT-03 at 09:30, while I was away from it.' };
    expect(judgeAccusation([lease, login], 'p4', judge, [witness]).testimony).toBe('Lina Haddad');
    // A witness names their own PC: that is not testimony against themselves.
    expect(judgeAccusation([], 'p3', judge, [witness]).testimony).toBe('');
    expect(comment(judgeAccusation([lease, login], 'p4', judge, [witness]), 'Omar Farouk')).toContain('Lina Haddad told us something odd about them');
  });

  it('yesterday in the output of last is old news too', () => {
    expect(points(text('o.farouk   pts/0        10.0.2.185       Fri Feb 27 16:00 - 16:08  (00:08)'))).toBe(false);
    expect(points(text('o.farouk   pts/0        10.0.2.185       Mon Mar  2 09:07   still logged in'))).toBe(true);
  });

  it('the same text pinned twice counts once', () => {
    expect(judgeAccusation([alert, { ...alert, id: 'E99' }, nothing], 'p4', judge).pointing).toEqual([alert.id]);
  });

  it('it can be fooled, like people can: an accusation of the owner of a stolen account', () => {
    // Somebody used Khalid's account from Omar's PC. The audit line names Khalid.
    const audit = text('type=SYSCALL msg=audit(1772442195.350:561): success=yes auid=1005 uid=0 comm="cat" key="flag-read"');
    const sudo = text('09:09:12 ADMIN-SRV-01 auth action=sudo result=success user=k.nasser target_user=root command=/usr/bin/cat /root/flag.txt');
    expect(judgeAccusation([audit, sudo, nothing], 'p5', judge).convincing).toBe(true);
  });

  it('colleagues say what they make of it', () => {
    const say = (items: EvidenceItem[]) => comment(judgeAccusation(items, 'p4', judge), 'Omar Farouk');
    expect(say([alert, lease, nothing])).toBe(`${alert.id} and ${lease.id} point at Omar Farouk, and ${alert.id} is not ordinary work. That convinces me.`);
    expect(say([alert, nothing])).toContain(`Only ${alert.id} says anything about Omar Farouk`);
    expect(say([nothing])).toContain('None of that evidence says anything about Omar Farouk');
    expect(say([lease, login])).toContain('they only show ordinary work');
  });
});

// ───────────────────────────── In a match ─────────────────────────────

const base = { scenario: clone(scenario), map: clone(tiledMap), mapName: 'office-small' };
const CHOICE: SoloChoice = { mode: 'investigation', role: 'soc', difficulty: 'normal' };

function solo(difficulty: SoloChoice['difficulty'], seed: number): Recorder {
  const options = soloGameOptions(base, { ...CHOICE, difficulty }, seed);
  const r = new Recorder({ ...options, weaknesses: 'random', botOptions: { ...options.botOptions, hackerPace: undefined }, meetingTimes: { ...options.meetingTimes, discussionMs: 20_000, votingMs: 15_000, resultMs: 1000, cooldownMs: 0 } });
  r.connect('soc');
  expect(r.sitAt('soc', 'p11', 'SOC-WS-01')).toBe(true);
  r.type('soc', PW['h.rahman']);
  return r;
}
function play(r: Recorder, done: () => boolean, minutes: number): void {
  for (let i = 0; i < minutes * 600 && !done(); i++) {
    r.game.tick(100);
    if (i % 10 === 0) r.flush();
  }
  r.flush();
  expect(done()).toBe(true);
}
const pin = (r: Recorder, line: string) => r.send('soc', 'evidence.pin', { kind: 'screen', text: line });
const row = (output: string, has: string) => output.split('\n').find((l) => l.includes(has))!;
const chat = (r: Recorder) => r.messages('soc', 'chat').map((m) => m.payload as { from: string; text: string });

/** Walks to the button, accuses, and votes like the player would. */
function meeting(r: Recorder, suspect: string): MeetingView['result'] {
  r.send('soc', 'stand');
  const b = r.map.furniture.find((f) => f.kind === 'button')!;
  expect(r.walkTo('soc', 'p11', b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
  r.send('soc', 'meeting.call');
  r.send('soc', 'meeting.accuse', { suspect, evidence: r.game.board.items.map((i) => i.id) });
  play(r, () => r.game.meetings.current?.phase === 'voting', 2);
  r.send('soc', 'meeting.vote', { target: suspect });
  play(r, () => r.game.meetings.current === null || r.game.over !== null || r.game.meetings.current.phase === 'result', 2);
  return (r.last('soc', 'meeting')!.payload as MeetingView).result;
}

describe('in a solo match', () => {
  it('three pieces about nothing fire nobody, and a colleague says why', () => {
    const r = solo('normal', 1);
    play(r, () => r.game.bots!.list().every((b) => b.present), 5);
    for (const cmd of ['hostname', 'whoami', 'pwd']) pin(r, r.type('soc', cmd).trim());
    expect(r.game.board.items).toHaveLength(3);
    const hacker = r.game.world.mission.hacker!;
    const result = meeting(r, hacker)!; // even though it is the hacker!
    expect(result.fired).toBe('');
    expect(result.skips).toBeGreaterThanOrEqual(9);
    expect(result.tally).toEqual([expect.objectContaining({ id: hacker, votes: 1 })]); // only Huda
    const name = scenario.players.find((p) => p.id === hacker)!.name;
    const said = chat(r).filter((l) => l.text.includes('None of that evidence says anything about'));
    expect(said).toHaveLength(1);
    expect(said[0].text).toContain(name);
    expect(said[0].from).not.toBe(name);
    expect(r.game.over).toBeNull();
  });

  it('ordinary lines about an innocent colleague, or words the player typed, do not fire them either', () => {
    const r = solo('easy', 2);
    const hacker = r.game.world.mission.hacker!;
    // The first innocent colleague who logs in to the server for their work.
    const innocent = scenario.players.filter((p) => p.id !== hacker && p.role === 'employee');
    const worked = () => innocent.find((p) => queryEvents(r.game.world, { type: 'ssh.accept', actor: p.id }).some((e) => e.host === 'ADMIN-SRV-01' && e.time > r.game.world.noise.from!));
    play(r, () => worked() !== undefined, 15);
    const victim = worked()!;
    pin(r, row(r.type('soc', `siem source=auth action=login user=${victim.account} | tail 1`), 'action=login'));
    pin(r, row(r.type('soc', `siem source=dhcp client=${victim.desk} | tail 1`), 'client='));
    pin(r, r.type('soc', `echo "severity=high rule=flag-read user=${victim.account}"`).trim());
    expect(r.game.board.items).toHaveLength(3);
    const result = meeting(r, victim.id)!;
    expect(result.fired).toBe('');
    expect(chat(r).some((l) => l.text.includes('they only show ordinary work'))).toBe(true);
    expect(r.game.reputation).toBe(100);
  });

  it.each((['easy', 'normal', 'hard'] as const).flatMap((level) => [1, 2, 3].map((seed) => ({ level, seed }))))('a real trail convinces them and the hacker is voted out ($level, seed $seed)', ({ level, seed }) => {
    const r = solo(level, seed);
    let alert = '';
    let i = 0;
    play(r, () => {
      if (i++ % 200 === 0) alert = row(r.type('soc', 'siem source=alert rule=flag-read'), 'rule=flag-read') ?? '';
      return alert !== '' || r.game.over !== null;
    }, 180);
    expect(r.game.over).toBeNull();
    pin(r, alert);
    const ip = /src_ip=(\S+)/.exec(alert)![1];
    const lease = row(r.type('soc', `siem source=dhcp ip=${ip} | tail 1`), 'client=');
    pin(r, lease);
    pin(r, row(r.type('soc', `siem source=auth host=ADMIN-SRV-01 action=login src_ip=${ip} | tail 1`), 'action=login'));
    const suspect = scenario.players.find((p) => p.desk === /client=(\S+)/.exec(lease)![1])!;
    meeting(r, suspect.id);
    expect(r.game.over, JSON.stringify(chat(r))).toMatchObject({ winner: 'defenders' });
    const votes = (r.last('soc', 'debrief')!.payload as { debrief: DebriefView }).debrief.meetings[0].votes;
    expect(votes.filter((v) => v.target === suspect.name).length, 'the bots voted too').toBeGreaterThanOrEqual(6);
    expect(chat(r).some((l) => l.text.includes(`point at ${suspect.name}`) && l.text.includes('convinces me'))).toBe(true);
  }, 60_000);

  it('what the judges use is never sent to a browser', () => {
    const r = solo('normal', 1);
    pin(r, r.type('soc', 'hostname').trim());
    expect(r.game.board.items[0].shown).toBeDefined();
    expect(JSON.stringify(r.last('soc', 'board')!.payload)).not.toContain('shown');
  });
});

describe('in the shared office', () => {
  it('nothing changed: bots who know nothing still leave the decision to the people', () => {
    const r = new Recorder({ bots: true, meetingTimes: { discussionMs: 6000, votingMs: 6000, resultMs: 1000, cooldownMs: 0 } });
    r.connect('soc', 'p11');
    play(r, () => r.game.bots!.list().every((b) => b.present), 5);
    expect(r.sitAt('soc', 'p11', 'SOC-WS-01')).toBe(true);
    r.type('soc', PW['h.rahman']);
    for (const cmd of ['hostname', 'whoami', 'pwd']) pin(r, r.type('soc', cmd).trim());
    const result = meeting(r, 'p4')!;
    expect(result).toMatchObject({ fired: 'Omar Farouk', skips: 0 });
    expect(chat(r).some((l) => l.text.includes('evidence'))).toBe(false);
  });
});
