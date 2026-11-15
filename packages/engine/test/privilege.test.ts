import { describe, expect, it } from 'vitest';
import { advanceTime, queryEvents } from '../src/index';
import { FLAG, PW, ROOT_PW, SERVER, atDesk, authLog, newWorld, ssh } from './helpers';

describe('sudo', () => {
  it('lets the sysadmin read the flag on the admin server and logs it', () => {
    const world = newWorld();
    const t = atDesk(world, 'k.nasser');
    ssh(t, 'k.nasser', SERVER);
    const before = authLog(world, SERVER).length;

    t.type('sudo cat /root/flag.txt');
    expect(t.prompt).toBe('[sudo] password for k.nasser: ');
    expect(t.masked).toBe(true);
    expect(t.type(PW['k.nasser'])).toBe(`${FLAG}\n`);

    const added = authLog(world, SERVER).slice(before);
    expect(added).toContain('sudo: k.nasser : TTY=pts/0 ; PWD=/home/k.nasser ; USER=root ; COMMAND=/usr/bin/cat /root/flag.txt');
    expect(added).toContain('pam_unix(sudo:session): session opened for user root(uid=0) by k.nasser(uid=1005)');
    expect(queryEvents(world, { type: 'sudo.exec', host: SERVER }).slice(-1)[0].sourceIp).toBe(world.hosts['IT-WS-02'].ip);
  });

  it('remembers the password for 15 minutes, then asks again', () => {
    const world = newWorld();
    const t = atDesk(world, 'k.nasser');
    t.type('sudo whoami');
    expect(t.type(PW['k.nasser'])).toBe('root\n');
    expect(t.type('sudo whoami')).toBe('root\n'); // no prompt this time
    advanceTime(world, 16 * 60 * 1000);
    t.type('sudo whoami');
    expect(t.masked).toBe(true);
  });

  it('refuses users who are not in sudoers and reports the incident', () => {
    const world = newWorld();
    const t = atDesk(world, 'l.haddad');
    t.type('sudo cat /etc/shadow');
    expect(t.prompt).toBe('[sudo] password for l.haddad: ');
    expect(t.type(PW['l.haddad'])).toBe('l.haddad is not in the sudoers file.  This incident will be reported.\n');
    expect(authLog(world, 'HR-LT-03')).toContain(
      'sudo: l.haddad : user NOT in sudoers ; TTY=tty1 ; PWD=/home/l.haddad ; USER=root ; COMMAND=/usr/bin/cat /etc/shadow',
    );
    expect(queryEvents(world, { type: 'sudo.denied', user: 'l.haddad' })).toHaveLength(1);
  });

  it('gives up after three wrong passwords', () => {
    const world = newWorld();
    const t = atDesk(world, 'k.nasser');
    t.type('sudo ls /root');
    expect(t.type('a')).toBe('Sorry, try again.\n');
    expect(t.type('b')).toBe('Sorry, try again.\n');
    expect(t.type('c')).toBe('sudo: 3 incorrect password attempts\n');
    expect(t.prompt).toBe('k.nasser@IT-WS-02:~$ ');
    expect(authLog(world, 'IT-WS-02')).toContain('k.nasser : 3 incorrect password attempts ; TTY=tty1');
  });

  it('keeps pipes and redirection working across the password prompt', () => {
    const world = newWorld();
    const t = atDesk(world, 'k.nasser');
    t.type('sudo cat /etc/shadow | grep -c k.nasser > /tmp/count.txt && echo done');
    expect(t.type(PW['k.nasser'])).toBe('done\n');
    expect(t.type('cat /tmp/count.txt')).toBe('1\n');
  });

  it('sudo -i opens a root shell with a # prompt; sudo -l lists rights', () => {
    const world = newWorld();
    const t = atDesk(world, 'k.nasser');
    t.type('sudo -l');
    expect(t.type(PW['k.nasser'])).toContain('(ALL : ALL) ALL');
    t.type('sudo -i');
    expect(t.prompt).toBe('root@IT-WS-02:~# ');
    expect(t.type('whoami')).toBe('root\n');
    expect(t.type('id')).toBe('uid=0(root) gid=0(root) groups=0(root)\n');
    expect(t.type('exit')).toBe('logout\n');
    expect(t.prompt).toBe('k.nasser@IT-WS-02:~$ ');
  });

  it('files created with sudo belong to root', () => {
    const t = atDesk(newWorld(), 'k.nasser');
    t.type('sudo touch /opt/made-by-root');
    t.type(PW['k.nasser']);
    expect(t.type('ls -l /opt')).toMatch(/-rw-r--r-- 1 root root 0 .* made-by-root/);
  });
});

describe('su', () => {
  it("switches user with the TARGET user's password and changes the prompt", () => {
    const world = newWorld();
    const t = atDesk(world, 'l.haddad');
    t.type('su k.nasser');
    expect(t.prompt).toBe('Password: ');
    expect(t.masked).toBe(true);
    t.type(PW['k.nasser']);
    expect(t.prompt).toBe('k.nasser@HR-LT-03:/home/l.haddad$ ');
    expect(t.type('whoami')).toBe('k.nasser\n');
    expect(authLog(world, 'HR-LT-03')).toContain('(to k.nasser) l.haddad on tty1');
    expect(authLog(world, 'HR-LT-03')).toContain('pam_unix(su:session): session opened for user k.nasser(uid=1005) by l.haddad(uid=1003)');

    expect(t.type('exit')).toBe('exit\n');
    expect(t.prompt).toBe('l.haddad@HR-LT-03:~$ ');
    expect(t.type('whoami')).toBe('l.haddad\n');
  });

  it('su - becomes root on the server (login shell in /root)', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    ssh(t, 's.alharbi', SERVER);
    t.type('su -');
    t.type(ROOT_PW);
    expect(t.prompt).toBe(`root@${SERVER}:~# `);
    expect(t.type('pwd')).toBe('/root\n');
    expect(t.type('exit')).toBe('logout\n');
  });

  it('logs a failed attempt', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    ssh(t, 's.alharbi', SERVER);
    t.type('su -');
    expect(t.type('wrong')).toBe('su: Authentication failure\n');
    expect(t.prompt).toBe(`s.alharbi@${SERVER}:~$ `);
    expect(authLog(world, SERVER)).toContain('FAILED SU (to root) s.alharbi on pts/0');
    expect(queryEvents(world, { type: 'su.fail', host: SERVER })).toHaveLength(1);
  });

  it('cannot become root where the root account is locked, or a user that does not exist', () => {
    const t = atDesk(newWorld(), 'l.haddad');
    t.type('su -');
    expect(t.type(ROOT_PW)).toBe('su: Authentication failure\n');
    expect(t.type('su nobody-here')).toContain('does not exist');
  });

  it('root can su to anyone without a password', () => {
    const t = atDesk(newWorld(), 'k.nasser');
    t.type('sudo su s.alharbi');
    t.type(PW['k.nasser']);
    // s.alharbi has no account on IT-WS-02, k.nasser does:
    expect(t.prompt).toBe('k.nasser@IT-WS-02:~$ ');
    t.type('sudo su -');
    expect(t.prompt).toBe('root@IT-WS-02:~# ');
  });
});
