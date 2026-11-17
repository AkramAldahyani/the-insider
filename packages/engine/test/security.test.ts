/**
 * Phase 4, part F (engine side): the audit log for watched files, the
 * security-alert rules, and handing in the flag.
 */
import { describe, expect, it } from 'vitest';
import { advanceTime, createWorld, plugUsb, queryEvents, setHacker, submitFlag } from '../src/index';
import { FLAG, PW, ROOT_PW, SERVER, Term, atDesk, fileOn, newWorld, scenario, ssh } from './helpers';

const START = Date.parse(scenario.startTime);
const SEC = 'SEC-SRV-01';
const alerts = (world: ReturnType<typeof newWorld>) => fileOn(world, SEC, '/var/log/security/alerts.log').split('\n').filter(Boolean);
const audit = (world: ReturnType<typeof newWorld>, host: string) => fileOn(world, host, '/var/log/audit/audit.log');

describe('the audit log', () => {
  it('records who read /etc/shadow, with the login account and the command', () => {
    const world = newWorld();
    const khalid = atDesk(world, 'k.nasser');
    ssh(khalid, 'k.nasser', SERVER);
    khalid.type('sudo cat /etc/shadow');
    khalid.type(PW['k.nasser']);
    const log = audit(world, SERVER);
    const uid = /^k\.nasser:x:(\d+):/m.exec(fileOn(world, SERVER, '/etc/passwd'))![1];
    expect(log).toMatch(new RegExp(`^type=SYSCALL msg=audit\\(\\d+\\.\\d{3}:\\d+\\): arch=c000003e syscall=257 success=yes exit=3 auid=${uid} uid=0 euid=0 tty=pts0 ses=\\d+ comm="cat" exe="/usr/bin/cat" key="shadow-read"$`, 'm'));
    expect(log).toContain('type=PATH msg=audit(');
    expect(log).toContain('item=0 name="/etc/shadow" nametype=NORMAL');
  });

  it('records refused attempts too, and only root can read it', () => {
    const world = newWorld();
    const sara = atDesk(world, 's.alharbi');
    expect(sara.type('cat /etc/shadow')).toContain('Permission denied');
    expect(audit(world, 'FIN-LT-07')).toContain('success=no exit=-13');
    expect(sara.type('cat /var/log/audit/audit.log')).toContain('Permission denied');
    // Ordinary files are not audited.
    sara.type('cat /etc/passwd');
    expect(audit(world, 'FIN-LT-07').match(/type=SYSCALL/g)).toHaveLength(1);
  });

  it('records reading the flag on the server', () => {
    const world = newWorld();
    const khalid = atDesk(world, 'k.nasser');
    ssh(khalid, 'k.nasser', SERVER);
    khalid.type('sudo cat /root/flag.txt');
    expect(khalid.type(PW['k.nasser'])).toContain(FLAG);
    expect(audit(world, SERVER)).toContain('key="flag-read"');
    expect(audit(world, SERVER)).toContain('name="/root/flag.txt"');
  });
});

describe('security alerts', () => {
  it('a quiet office has none; history before the match raises none', () => {
    const world = newWorld();
    advanceTime(world, 30 * 60_000);
    expect(alerts(world)).toEqual([]);
  });

  it('reading the password file is MEDIUM, reading the flag is HIGH', () => {
    const world = newWorld();
    const khalid = atDesk(world, 'k.nasser');
    ssh(khalid, 'k.nasser', SERVER);
    khalid.type('sudo cat /etc/shadow');
    khalid.type(PW['k.nasser']);
    khalid.type('sudo cat /root/flag.txt');
    const ip = world.hosts['IT-WS-02'].ip;
    expect(alerts(world)).toEqual([
      expect.stringMatching(new RegExp(`^2026-03-02 09:00:\\d\\d \\[MEDIUM\\] shadow-read /etc/shadow on ADMIN-SRV-01 was read as root \\(login k\\.nasser\\) from ${ip.replace(/\./g, '\\.')}$`)),
      expect.stringMatching(/\[HIGH\] flag-read \/root\/flag\.txt on ADMIN-SRV-01 was read as root \(login k\.nasser\)/),
    ]);
  });

  it('three failed logins for one account in two minutes is MEDIUM; one or two is normal life', () => {
    const world = newWorld();
    const omar = atDesk(world, 'o.farouk');
    omar.type('ssh k.nasser@ADMIN-SRV-01');
    omar.type('guess-1');
    omar.type('guess-2');
    expect(alerts(world)).toEqual([]);
    omar.type('guess-3');
    expect(alerts(world)).toEqual([expect.stringMatching(new RegExp(`\\[MEDIUM\\] auth-failures 3 failed logins for k\\.nasser on ADMIN-SRV-01 within 2 minutes from ${world.hosts['MKT-LT-11'].ip.replace(/\./g, '\\.')}$`))]);
    // Keeping at it does not repeat the same alert for five minutes.
    omar.type('ssh k.nasser@ADMIN-SRV-01');
    omar.type('guess-4');
    omar.type('guess-5');
    omar.type('guess-6');
    expect(alerts(world)).toHaveLength(1);
  });

  it('the USB stick is LOW; a backdoor listening on a port is MEDIUM', () => {
    const world = newWorld();
    plugUsb(world, 'HR-LT-03', 'p4');
    expect(alerts(world)).toEqual([
      expect.stringMatching(/\[LOW\] usb-keyboard a new USB keyboard was plugged into HR-LT-03$/),
      expect.stringMatching(/\[MEDIUM\] new-listener a new program started listening on port 4440 on HR-LT-03 \(as l\.haddad\)$/),
    ]);
  });

  it('a refused sudo is LOW; the guard and the sysadmin can read the alert log, others cannot', () => {
    const world = newWorld();
    const sara = atDesk(world, 's.alharbi');
    ssh(sara, 's.alharbi', SERVER);
    sara.type('sudo cat /root/flag.txt');
    sara.type(PW['s.alharbi']);
    expect(alerts(world).some((l) => l.includes('[LOW] sudo-denied s.alharbi tried to use sudo on ADMIN-SRV-01 without permission'))).toBe(true);
    expect(alerts(world).some((l) => l.includes('[LOW] flag-read-denied'))).toBe(false); // sudo refused her before any read
    const tariq = atDesk(world, 't.omar');
    ssh(tariq, 't.omar', SEC);
    expect(tariq.type('cat /var/log/security/alerts.log')).toContain('sudo-denied');
    const rami = atDesk(world, 'r.mansour');
    ssh(rami, 'r.mansour', SERVER);
    expect(rami.type(`ssh r.mansour@${SEC}`) + rami.type(PW['r.mansour'])).toMatch(/Permission denied/); // no account there
  });
});

describe('handing in the flag', () => {
  /** Omar is the hacker; the root password is in the old backup script. */
  function match() {
    const world = createWorld(scenario, 1, { weaknesses: ['plaintext-password'] });
    setHacker(world, 'p4');
    return world;
  }
  const getFlag = (world: ReturnType<typeof match>) => {
    const omar = atDesk(world, 'o.farouk');
    ssh(omar, 'o.farouk', SERVER);
    expect(omar.type('cat /srv/shared/old/backup-2025.sh')).toContain(ROOT_PW);
    omar.type('su');
    omar.type(ROOT_PW);
    return omar.type('cat /root/flag.txt').trim();
  };

  it('counts only for the hacker, with the exact text, after reading the file in this match', () => {
    const world = match();
    expect(submitFlag(world, 'p4', FLAG)).toEqual({ won: false, text: 'You have to get the flag yourself in this match: read it on the server first.' });
    const flag = getFlag(world);
    expect(flag).toBe(FLAG);
    expect(submitFlag(world, 'p1', flag)).toMatchObject({ won: false, text: 'Only the hacker can hand in the flag.' });
    expect(submitFlag(world, 'p4', 'NEXORA{guess}')).toMatchObject({ won: false, text: 'That is not the flag.' });
    expect(submitFlag(world, 'p4', `  ${flag}\n`)).toEqual({ won: true, text: 'The flag is out. You win.' });
    expect(world.mission.won).toBe(world.time);
    expect(queryEvents(world, { type: 'mission.won' })).toMatchObject([{ actor: 'p4' }]);
    expect(submitFlag(world, 'p4', flag)).toMatchObject({ won: false, text: 'The match is already over.' });
  });

  it('getting there leaves a trail: the su, the audit line and a HIGH alert', () => {
    const world = match();
    getFlag(world);
    expect(fileOn(world, SERVER, '/var/log/auth.log')).toMatch(/su\[\d+\]: \(to root\) o\.farouk on pts\/0/);
    expect(audit(world, SERVER)).toContain('key="flag-read"');
    expect(alerts(world).some((l) => l.includes('[HIGH] flag-read') && l.includes('login o.farouk'))).toBe(true);
    // A watcher with the master log knows exactly who it was.
    expect(queryEvents(world, { type: 'file.read', host: SERVER, since: START }).filter((e) => e.details.path === '/root/flag.txt').map((e) => e.actor)).toEqual(['p4']);
  });

  it('an office without a flag has nothing to hand in', () => {
    const bare = JSON.parse(JSON.stringify(scenario));
    delete bare.mission;
    const world = createWorld(bare, 1);
    expect(submitFlag(world, 'p4', FLAG).won).toBe(false);
    expect(new Term(world, 'FIN-LT-07', 'p1').last.screen).toBe('locked');
  });
});
