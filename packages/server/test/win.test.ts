/**
 * Phase 4, part F (server side): two complete routes from a desk to the flag,
 * the end of the match for everybody, and the security-alert banner.
 *
 * DESIGN.md section 15, Phase 4 is done when: "Win as the hacker by at least
 * 2 routes; every action is traceable."
 */
import { describe, expect, it } from 'vitest';
import { queryEvents } from '@insider/engine';
import { TICK_RATE } from '@insider/shared';
import { PW, ROOT_PW, Recorder, scenario } from './helpers';

const SERVER = 'ADMIN-SRV-01';
const FLAG = 'NEXORA{r00t_0n_adm1n_srv_01}';
const START = Date.parse(scenario.startTime);
const seconds = (s: number) => Math.round(s * TICK_RATE);
const minutes = (m: number) => m * 60 * TICK_RATE;
const over = (r: Recorder, client: string) => r.last(client, 'match.over')?.payload as { winner: string; hacker: string; at: number } | undefined;
const alertsLog = (r: Recorder) => r.file('SEC-SRV-01', '/var/log/security/alerts.log');

/** A match where Omar (p4) joined as the hacker on client "h". */
function withHacker(options: ConstructorParameters<typeof Recorder>[0] = {}): Recorder {
  const r = new Recorder(options);
  r.connect('h');
  r.send('h', 'choose', { playerId: 'p4', hacker: true });
  return r;
}

describe('route 1: a password left in an old script', () => {
  it('Omar reads the script, becomes root on the server, reads the flag and wins; everybody is told', () => {
    const r = withHacker({ weaknesses: ['plaintext-password'] });
    r.connect('e', 'p1'); // Sara, an employee in the office
    r.connect('late'); // someone still on the start screen

    r.sitAt('h', 'p4', 'MKT-LT-11');
    r.type('h', PW['o.farouk']);
    r.type('h', `ssh ${SERVER}`);
    r.type('h', PW['o.farouk']);
    const script = r.type('h', 'cat /srv/shared/old/backup-2025.sh');
    const rootPassword = /ROOT_PW='([^']+)'/.exec(script)![1];
    expect(rootPassword).toBe(ROOT_PW);
    r.type('h', 'su');
    r.type('h', rootPassword);
    const flag = r.type('h', 'cat /root/flag.txt').trim();
    expect(flag).toBe(FLAG);

    r.send('h', 'flag.submit', { text: flag });
    for (const client of ['h', 'e', 'late']) expect(over(r, client), client).toMatchObject({ winner: 'hacker', hacker: 'Omar Farouk' });
    expect(r.game.world.mission.won).not.toBeNull();
    expect(r.game.publicState().players.p4.seatedAt).toBe(''); // the hacker was stood up

    // Every step is traceable by defenders:
    const auth = r.file(SERVER, '/var/log/auth.log');
    const omarIp = r.game.world.hosts['MKT-LT-11'].ip;
    expect(auth).toContain(`Accepted password for o.farouk from ${omarIp}`); // he logged in to the server from his own PC
    expect(auth).toMatch(/su\[\d+\]: \(to root\) o\.farouk on pts\/0/); // then became root
    expect(r.file(SERVER, '/var/log/audit/audit.log')).toContain('key="flag-read"'); // and read the flag
    expect(alertsLog(r)).toMatch(/\[HIGH\] flag-read .*login o\.farouk\) from /);
    expect(r.file(SERVER, '/home/o.farouk/.bash_history') + r.file(SERVER, '/root/.bash_history')).toBe(''); // (shells still open: history is written at logout)
  });
});

describe('route 2: watch the sysadmin type his password', () => {
  it('Omar stands behind Khalid while he unlocks his PC, pieces the password together, and uses it on the server', () => {
    const r = withHacker({ weaknesses: [] });
    r.connect('k', 'p5'); // Khalid, the sysadmin (a human here, so the test controls when he types)
    r.sitAt('k', 'p5', 'IT-WS-02');
    const desk = r.map.desks.find((d) => d.hostname === 'IT-WS-02')!;
    expect(r.walkTo('h', 'p4', desk.seatX, desk.seatY + 32)).toBe(true);

    // Khalid unlocks, works, locks... several times while Omar watches.
    const real = PW['k.nasser'];
    const seen: string[] = [];
    for (let i = 0; i < 20 && (seen.length === 0 || [...real].some((_, k) => seen.every((p) => p[k] === '?'))); i++) {
      r.type('k', real);
      const text = r.notice('h');
      seen.push(/: (\S+)  \(saved in/.exec(text)![1]);
      r.type('k', 'loginctl lock-session');
    }
    const pieced = [...real].map((_, k) => seen.find((p) => p[k] !== '?')![k]).join('');
    expect(pieced).toBe(real);
    expect(r.file('MKT-LT-11', '/home/o.farouk/.tools/loot/shoulder.txt').split('\n').filter(Boolean)).toHaveLength(seen.length);

    // Omar walks back to his own PC and uses Khalid's account on the server.
    r.send('h', 'move', { dx: 0, dy: 0 });
    r.sitAt('h', 'p4', 'MKT-LT-11');
    r.type('h', PW['o.farouk']);
    r.type('h', `ssh k.nasser@${SERVER}`);
    r.type('h', pieced);
    r.type('h', 'sudo cat /root/flag.txt');
    const flag = r.type('h', pieced).trim();
    expect(flag).toBe(FLAG);
    r.send('h', 'flag.submit', { text: flag });
    expect(over(r, 'k')).toMatchObject({ winner: 'hacker', hacker: 'Omar Farouk' });

    // The giveaway for an investigator: the sysadmin's account logged in to the server from MARKETING's PC.
    const omarIp = r.game.world.hosts['MKT-LT-11'].ip;
    expect(r.file(SERVER, '/var/log/auth.log')).toContain(`Accepted password for k.nasser from ${omarIp}`);
    // ...and the master log knows who was really at the keyboard.
    expect(queryEvents(r.game.world, { type: 'ssh.accept', host: SERVER, user: 'k.nasser', since: START }).map((e) => e.actor)).toEqual(['p4']);
    expect(queryEvents(r.game.world, { type: 'shoulder.surf', since: START }).length).toBe(seen.length);
  });
});

describe('handing in the flag through the server', () => {
  it('is refused for a non-hacker, a wrong text, or a flag never read in this match', () => {
    const r = withHacker({ weaknesses: ['plaintext-password'] });
    r.connect('e', 'p1');
    r.send('e', 'flag.submit', { text: FLAG });
    expect(r.notice('e')).toBe('Only the hacker can hand in the flag.');
    r.send('h', 'flag.submit', { text: FLAG }); // he knows it from somewhere, but never read it here
    expect(r.notice('h')).toContain('read it on the server first');
    r.send('h', 'flag.submit', { text: 'NEXORA{nope}' });
    expect(r.notice('h')).toBe('That is not the flag.');
    r.send('h', 'flag.submit', { text: 42 });
    expect(r.messages('e', 'match.over')).toEqual([]);
    expect(r.game.world.mission.won).toBeNull();
  });
});

describe('the security-alert banner', () => {
  it('goes to every player, says nothing specific, and comes at most once a minute', () => {
    const r = withHacker({ weaknesses: [] });
    r.connect('e', 'p1');
    r.connect('late'); // on the start screen: not playing yet, no banner
    r.sitAt('h', 'p4', 'MKT-LT-11');
    r.type('h', PW['o.farouk']);
    r.type('h', `ssh k.nasser@${SERVER}`);
    for (const guess of ['admin', 'password', 'nexora']) r.type('h', guess);
    r.tick();
    expect(alertsLog(r)).toContain('[MEDIUM] auth-failures');
    for (const client of ['h', 'e']) {
      const banners = r.messages(client, 'alert');
      expect(banners, client).toHaveLength(1);
      expect((banners[0].payload as { text: string }).text).toBe('SECURITY ALERT: unusual activity was detected on the company network.');
    }
    expect(r.messages('late', 'alert')).toEqual([]);

    // More failures at once: the log gets them, the banner waits.
    r.type('h', `ssh d.aziz@${SERVER}`);
    for (const guess of ['a', 'b', 'c']) r.type('h', guess);
    r.tick();
    expect(alertsLog(r).match(/auth-failures/g)).toHaveLength(2);
    expect(r.messages('e', 'alert')).toHaveLength(1);
    r.tick(seconds(61));
    r.type('h', `ssh t.omar@${SERVER}`);
    for (const guess of ['x', 'y', 'z']) r.type('h', guess);
    r.tick();
    expect(r.messages('e', 'alert')).toHaveLength(2);
  });

  it('a LOW alert (a USB keyboard) is only in the log, not on screens', () => {
    const r = withHacker({ weaknesses: [] });
    r.connect('e', 'p1');
    const desk = r.map.desks.find((d) => d.hostname === 'HR-LT-05')!; // Noor's PC: locked, so no backdoor (which would be MEDIUM)
    r.walkTo('h', 'p4', desk.seatX, desk.seatY);
    r.send('h', 'item.start', { item: 'usb', hostname: 'HR-LT-05' });
    r.tick(seconds(5.5));
    expect(alertsLog(r)).toContain('[LOW] usb-keyboard');
    expect(r.messages('e', 'alert')).toEqual([]);
  });

  it('an ordinary morning of bots raises no MEDIUM or HIGH alert at all', () => {
    const r = new Recorder({ bots: true });
    r.tick(minutes(30));
    const serious = alertsLog(r).split('\n').filter((l) => /\[(MEDIUM|HIGH)\]/.test(l));
    expect(serious).toEqual([]);
  });
});
