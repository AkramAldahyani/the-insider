/**
 * Phase 5, part I: the debrief after a match. What the hacker did, which
 * evidence each step left, what was found or missed, with ATT&CK ids.
 */
import { describe, expect, it } from 'vitest';
import { deserializeWorld, plugUsb, serializeWorld } from '@insider/engine';
import { TICK_RATE, type DebriefStepView, type DebriefView } from '@insider/shared';
import { getNode } from '../../engine/src/fs/vfs';
import { PW, ROOT_PW, Recorder } from './helpers';

const SERVER = 'ADMIN-SRV-01';
const seconds = (n: number) => Math.round(n * TICK_RATE);
const debrief = (r: Recorder, client: string) => (r.last(client, 'debrief')!.payload as { debrief: DebriefView }).debrief;
const step = (d: DebriefView, title: string): DebriefStepView => {
  const found = d.steps.find((s) => s.title.includes(title));
  expect(found, `${title} in\n${d.steps.map((s) => s.title).join('\n')}`).toBeDefined();
  return found!;
};

/** Omar (p4) is the hacker; Huda (SOC), Khalid (sysadmin) and Sara are playing. */
function match(options: ConstructorParameters<typeof Recorder>[0] = {}): Recorder {
  const r = new Recorder({ weaknesses: ['plaintext-password'], ...options });
  r.connect('h');
  r.send('h', 'choose', { playerId: 'p4', hacker: true });
  r.connect('soc', 'p11');
  r.connect('k', 'p5');
  r.connect('s', 'p1');
  return r;
}

/** From his desk to a root shell on the server. Returns the flag's text (the match goes on until it is handed in). */
function attack(r: Recorder): string {
  r.sitAt('h', 'p4', 'MKT-LT-11');
  r.type('h', PW['o.farouk']);
  r.type('h', `ssh k.nasser@${SERVER}`);
  for (const guess of ['admin', 'password', 'letmein']) r.type('h', guess);
  r.tick(seconds(3));
  r.type('h', `ssh ${SERVER}`);
  r.type('h', PW['o.farouk']);
  r.tick(seconds(3));
  const script = r.type('h', 'cat /srv/shared/old/backup-2025.sh');
  r.tick(seconds(3));
  r.type('h', 'su');
  r.type('h', /ROOT_PW='([^']+)'/.exec(script)![1]);
  r.tick(seconds(3));
  return r.type('h', 'cat /root/flag.txt').trim();
}
/** The same, for a hacker who has to get out of the server room first. */
function attackFrom(r: Recorder): string {
  r.send('h', 'tap', { door: 'SRV-ROOM' });
  return attack(r);
}
const win = (r: Recorder, flag: string) => r.send('h', 'flag.submit', { text: flag });

describe('the timeline', () => {
  it('lists the steps in order, each explained, with a real ATT&CK id and the line that started it', () => {
    const r = match();
    win(r, attack(r));
    const d = debrief(r, 's');
    expect(d).toMatchObject({ winner: 'hacker', hacker: 'Omar Farouk', reason: 'The hacker got the flag out.' });
    expect(d.steps.map((s) => s.title)).toEqual([
      `Wrong password over ssh for k.nasser on ${SERVER}`,
      `Logged in to ${SERVER} over ssh with their own account`,
      `Read a password out of /srv/shared/old/backup-2025.sh on ${SERVER}`,
      `Became root on ${SERVER} with su`,
      `Read the flag /root/flag.txt on ${SERVER}`,
      'Handed in the flag',
    ]);
    expect(d.steps.map((s) => s.technique?.id ?? '')).toEqual(['T1110.001', 'T1021.004', 'T1552.001', 'T1078.003', 'T1005', '']);
    expect(step(d, 'Wrong password')).toMatchObject({ count: 3, by: 'Omar Farouk', typed: `ssh k.nasser@${SERVER}`, alerts: ['auth-failures'], suspicious: true });
    expect(step(d, 'Read the flag')).toMatchObject({ typed: 'cat /root/flag.txt', alerts: ['flag-read'] });
    for (const s of d.steps) expect(s.lesson.length, s.title).toBeGreaterThan(20);
    for (let i = 1; i < d.steps.length; i++) expect(d.steps[i].time).toBeGreaterThanOrEqual(d.steps[i - 1].time);
    expect(d.weaknesses).toEqual(['An old script on the shared folder still contained the root password.']);
  });

  it('what an honest employee does too is shown, but not counted', () => {
    const r = match();
    win(r, attack(r));
    const d = debrief(r, 's');
    expect(step(d, 'with their own account').suspicious).toBe(false);
    expect(d.totals.steps).toBe(d.steps.filter((s) => s.suspicious && s.status !== 'none').length);
    expect(d.totals.pinned + d.totals.seen + d.totals.missed).toBe(d.totals.steps);
    // Other people's work is not on the list at all.
    expect(d.steps.every((s) => s.by === 'Omar Farouk')).toBe(true);
  });

  it('the evidence is the lines that were really written', () => {
    const r = match();
    win(r, attack(r));
    const su = step(debrief(r, 's'), 'Became root');
    const line = su.evidence.find((e) => e.text.includes('(to root) o.farouk'))!;
    expect(line).toMatchObject({ host: SERVER, where: '/var/log/auth.log', gone: false, found: 'missed', foundBy: [] });
    expect(r.file(SERVER, '/var/log/auth.log')).toContain(line.text);
  });

  it('a line the hacker removed is still shown, and marked', () => {
    const r = match();
    const flag = attack(r);
    const log = getNode(r.game.world.hosts[SERVER], '/var/log/auth.log')!;
    log.content = log.content!.split('\n').filter((l) => !l.includes('(to root) o.farouk')).join('\n');
    win(r, flag);
    expect(step(debrief(r, 's'), 'Became root').evidence.find((e) => e.text.includes('(to root)'))).toMatchObject({ gone: true });
  });
});

describe('found or missed', () => {
  it('pinned, seen on a screen, or missed; with names', () => {
    const r = match();
    const flag = attack(r);
    // Khalid reads the server's auth.log (seen). Huda finds the su in the SIEM and pins that row.
    r.sitAt('k', 'p5', 'IT-WS-02');
    r.type('k', PW['k.nasser']);
    r.type('k', `ssh ${SERVER}`);
    r.type('k', PW['k.nasser']);
    r.type('k', 'sudo grep Failed /var/log/auth.log');
    r.type('k', PW['k.nasser']);
    r.sitAt('soc', 'p11', 'SOC-WS-01');
    r.type('soc', PW['h.rahman']);
    const row = r.type('soc', 'siem source=auth action=su user=o.farouk').split('\n').find((l) => l.includes('action=su'))!;
    r.send('soc', 'evidence.pin', { kind: 'screen', text: row });
    expect(r.game.board.items).toHaveLength(1);
    win(r, flag);
    const d = debrief(r, 's');

    expect(step(d, 'Wrong password').status).toBe('seen');
    expect(step(d, 'Wrong password').evidence[0]).toMatchObject({ found: 'seen', foundBy: ['Khalid Nasser'] });
    expect(step(d, 'Became root').status).toBe('pinned');
    expect(step(d, 'Became root').evidence[0]).toMatchObject({ found: 'pinned', foundBy: ['Huda Rahman'], where: '/var/log/auth.log' });
    expect(step(d, 'Read the flag').status).toBe('missed');
    // A SIEM row about one log says nothing about a line of another log from the same second.
    expect(step(d, 'with their own account').evidence.filter((e) => e.text.includes('UFW ALLOW')).every((e) => e.found === 'missed')).toBe(true);
    expect(d.totals).toMatchObject({ pinned: 1, seen: 1 });
  });

  it('what the hacker looked at or pinned himself does not count', () => {
    const r = match();
    const flag = attack(r);
    const line = r.type('h', 'grep "to root" /var/log/auth.log').split('\n').find((l) => l.includes('o.farouk'))!;
    r.send('h', 'evidence.pin', { kind: 'screen', text: line.trim() });
    expect(r.game.board.items).toHaveLength(1);
    win(r, flag);
    expect(step(debrief(r, 's'), 'Became root')).toMatchObject({ status: 'missed' });
  });

  it('the badge and motion lists on the security monitors count as seen too', () => {
    const r = match();
    r.connect('g', 'p10');
    const door = r.map.doors.find((d) => d.code === 'SRV-ROOM')!;
    expect(r.walkTo('h', 'p4', door.x - 20, door.y + door.height / 2)).toBe(true);
    r.send('h', 'tap', { door: 'SRV-ROOM' });
    const desk = r.map.furniture.find((f) => f.kind === 'monitors')!;
    expect(r.walkTo('g', 'p10', desk.x + desk.width / 2, desk.y - 14)).toBe(true);
    r.send('g', 'monitors.open');
    win(r, attack(r));
    expect(step(debrief(r, 's'), 'Was refused at door SRV-ROOM')).toMatchObject({ status: 'seen' });
  });
});

describe('things no log records', () => {
  it('a PC left open, the USB stick, and the camera pictures of both', () => {
    const r = match();
    expect(r.sitAt('h', 'p4', 'HR-LT-03')).toBe(true); // Lina's PC is open in this scenario
    r.type('h', 'ls');
    r.send('h', 'stand');
    plugUsb(r.game.world, 'HR-LT-03', 'p4');
    win(r, attack(r));
    const d = debrief(r, 's');
    expect(step(d, 'which Lina Haddad had left unlocked (typed 1 line)')).toMatchObject({ suspicious: true, technique: { id: 'T1078.003' } });
    const usb = step(d, 'Plugged a USB stick into HR-LT-03');
    expect(usb).toMatchObject({ technique: { id: 'T1200' }, alerts: ['usb-keyboard'] });
    expect(usb.evidence.some((e) => / picture$/.test(e.where) && e.text.includes('Omar Farouk'))).toBe(true);
    expect(step(d, 'Installed a backdoor').evidence.map((e) => e.where)).toEqual(expect.arrayContaining(['ps aux', 'crontab -l', 'ss -tlnp']));
  });

  it('what the bots noticed about the hacker, and only about the hacker', () => {
    const r = match({ bots: true });
    r.tick(seconds(260));
    const add = (suspect: string, text: string) => r.game.bots!.findings('p3').push({ time: r.game.world.time, text, suspect, weight: 2 });
    add('p4', 'I saw Omar Farouk sitting at my PC.');
    add('p1', 'I saw Sara Alharbi sitting at my PC.');
    win(r, attack(r));
    expect(debrief(r, 's').witnesses).toEqual([expect.objectContaining({ name: 'Lina Haddad', text: 'I saw Omar Farouk sitting at my PC.' })]);
  });
});

describe('doors', () => {
  it('slipping into the server room behind the sysadmin is a step', () => {
    const r = match({ weaknesses: ['tailgate', 'plaintext-password'] });
    r.walkToTile('h', 'p4', 47, 5);
    r.walkToTile('k', 'p5', 48, 4);
    r.tick(seconds(4));
    r.send('k', 'tap', { door: 'SRV-ROOM' });
    for (const c of ['k', 'h']) r.send(c, 'move', { dx: 1, dy: 0 });
    r.tick(seconds(2));
    for (const c of ['k', 'h']) r.send(c, 'move', { dx: 0, dy: 0 });
    expect(r.position('p4').x).toBeGreaterThan(50 * r.map.tile);
    r.game.world.mission.hackers = ['p4'];
    win(r, attackFrom(r));
    expect(step(debrief(r, 's'), 'Slipped through door SRV-ROOM behind someone else')).toMatchObject({ suspicious: true, technique: null });
  });

  it('coming to work at the same moment as somebody else is not', () => {
    const r = new Recorder({ bots: true, seed: 5, weaknesses: 'random', botOptions: { hacker: true, hackerDifficulty: 'easy' } });
    r.connect('s', 'p11');
    for (let i = 0; i < 30 && !r.game.over; i++) r.tick(seconds(60));
    expect(r.game.over).not.toBeNull();
    expect(debrief(r, 's').steps.map((x) => x.title).filter((t) => t.includes('MAIN-ENT'))).toEqual([]);
  });
});

describe('phishing', () => {
  it('what the victim did is part of the hacker\'s story', () => {
    const r = match();
    r.connect('l', 'p3');
    r.sitAt('h', 'p4', 'MKT-LT-11');
    r.type('h', PW['o.farouk']);
    r.type('h', '~/.tools/phish l.haddad');
    r.sitAt('l', 'p3', 'HR-LT-03');
    const url = r.game.world.toolkit.phishing[0].url;
    r.type('l', `curl ${url}`);
    r.send('h', 'stand');
    win(r, attack(r));
    const d = debrief(r, 's');
    expect(step(d, 'Sent a fake "IT password reset" mail to l.haddad')).toMatchObject({ technique: { id: 'T1566.002' } });
    expect(step(d, 'l.haddad gave their password')).toMatchObject({ technique: { id: 'T1204.001' }, by: 'Omar Farouk' });
    expect(JSON.stringify(d)).not.toContain(PW['l.haddad']);
  });
});

describe('meetings in the debrief', () => {
  it('who was accused, who voted what, and whether it was right', () => {
    const r = match({ meetingTimes: { discussionMs: 3000, votingMs: 3000, resultMs: 1000, cooldownMs: 0 } });
    attack(r);
    r.sitAt('s', 'p1', 'FIN-LT-07');
    r.type('s', PW['s.alharbi']);
    for (const cmd of ['hostname', 'whoami', 'pwd']) r.send('s', 'evidence.pin', { kind: 'screen', text: r.type('s', cmd).trim() });
    r.send('s', 'stand');
    const b = r.map.furniture.find((f) => f.kind === 'button')!;
    expect(r.walkTo('s', 'p1', b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
    r.send('s', 'meeting.call');
    r.send('s', 'meeting.accuse', { suspect: 'p4', evidence: r.game.board.items.map((i) => i.id) });
    r.tick(seconds(3.2));
    for (const c of ['s', 'k']) r.send(c, 'meeting.vote', { target: 'p4' });
    r.send('h', 'meeting.vote', { target: 'skip' });
    r.tick(seconds(4));
    const d = debrief(r, 'h');
    expect(d).toMatchObject({ winner: 'defenders', hacker: 'Omar Farouk' });
    expect(d.meetings).toEqual([expect.objectContaining({
      number: 1, calledBy: 'Sara Alharbi', fired: 'Omar Farouk', wasHacker: true,
      accusations: [{ accuser: 'Sara Alharbi', suspect: 'Omar Farouk', right: true, evidence: ['E1', 'E2', 'E3'] }],
      votes: expect.arrayContaining([{ voter: 'Sara Alharbi', target: 'Omar Farouk' }, { voter: 'Omar Farouk', target: 'skip' }]),
    })]);
    // Pins that have nothing to do with the hacker's actions find nothing.
    expect(d.totals.pinned).toBe(0);
  });

  it('the guard\'s detentions', () => {
    const r = match();
    r.connect('g', 'p10');
    const o = r.position('p4');
    expect(r.walkTo('g', 'p10', o.x + 30, o.y)).toBe(true);
    r.send('g', 'detain', { target: 'p4' });
    expect(debrief(r, 's').detentions).toEqual([expect.objectContaining({ guard: 'Tariq Omar', target: 'Omar Farouk', right: true })]);
  });
});

describe('secrets', () => {
  it('nothing of it is sent before the match is over; then everybody gets the same', () => {
    const r = match();
    r.connect('late'); // still on the start screen
    const flag = attack(r);
    r.tick(seconds(5));
    for (const [client, messages] of r.sent) {
      expect(messages.filter((m) => m.type === 'debrief'), client).toEqual([]);
      if (client !== 'h') expect(JSON.stringify(messages)).not.toMatch(/T1078|"trail"|Became root on/);
    }
    expect(JSON.stringify(r.states)).not.toMatch(/trail|debrief/);
    win(r, flag);
    for (const c of ['h', 'soc', 'k', 's', 'late']) expect(debrief(r, c)).toEqual(debrief(r, 's'));
  });

  it('it contains nobody\'s password and not the flag', () => {
    const r = match();
    // A password typed as a user name ends up in the logs (a classic mistake), so it would be in the evidence too.
    r.sitAt('h', 'p4', 'MKT-LT-11');
    r.type('h', PW['o.farouk']);
    r.type('h', `ssh ${PW['r.mansour']}@${SERVER}`);
    r.type('h', 'x');
    r.send('h', 'term.cancel');
    r.send('h', 'stand');
    const flag = attack(r);
    win(r, flag);
    expect(r.file(SERVER, '/var/log/auth.log')).toContain(`Invalid user ${PW['r.mansour']}`);
    const text = JSON.stringify(debrief(r, 's'));
    for (const secret of [...Object.values(PW), ROOT_PW, flag]) expect(text).not.toContain(secret);
    expect(text).toContain('********');
  });

  it('the trail survives saving and loading the world', () => {
    const r = match();
    attack(r);
    const copy = deserializeWorld(serializeWorld(r.game.world));
    expect(copy.mission.trail).toEqual(r.game.world.mission.trail);
    expect(copy.mission.trail.length).toBeGreaterThan(5);
  });
});
