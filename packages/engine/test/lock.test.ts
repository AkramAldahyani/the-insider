import { describe, expect, it } from 'vitest';
import { queryEvents } from '../src/index';
import { PW, SERVER, Term, atDesk, authLog, newWorld, ssh } from './helpers';

describe('console login', () => {
  it('shows a login prompt on a PC nobody is logged in to', () => {
    const world = newWorld();
    const t = new Term(world, 'FIN-LT-04', 'p2');
    expect(t.last.output).toContain('Ubuntu 22.04.4 LTS FIN-LT-04 tty1');
    expect(t.prompt).toBe('FIN-LT-04 login: ');
    expect(t.last.awaitingInput).toEqual({ masked: false });

    t.type('r.mansour');
    expect(t.prompt).toBe('Password: ');
    expect(t.masked).toBe(true);
    expect(t.type('wrong')).toBe('\nLogin incorrect\n');
    expect(t.prompt).toBe('FIN-LT-04 login: ');
    expect(authLog(world, 'FIN-LT-04')).toContain("FAILED LOGIN (1) on '/dev/tty1' FOR 'r.mansour', Authentication failure");

    t.type('r.mansour');
    expect(t.type(PW['r.mansour'])).toContain('Last login: Fri Feb 27');
    expect(t.prompt).toBe('r.mansour@FIN-LT-04:~$ ');
    expect(t.type('who')).toMatch(/^r\.mansour\s+tty1\s+2026-03-02 09:00\n$/);
    expect(authLog(world, 'FIN-LT-04')).toContain('pam_unix(login:session): session opened for user r.mansour(uid=1002) by LOGIN(uid=0)');
  });

  it('rejects accounts that do not exist on that PC', () => {
    const t = new Term(newWorld(), 'FIN-LT-04', 'p1');
    t.type('s.alharbi');
    expect(t.type(PW['s.alharbi'])).toBe('\nLogin incorrect\n');
  });

  it('logging out returns to the login prompt', () => {
    const t = atDesk(newWorld(), 'r.mansour');
    expect(t.type('exit')).toContain('Ubuntu 22.04.4 LTS FIN-LT-04 tty1');
    expect(t.prompt).toBe('FIN-LT-04 login: ');
    expect(t.type('last -n 1')).toBe(''); // typed into the login prompt, not a shell
  });
});

describe('screen lock', () => {
  it('a locked PC only accepts the password of the logged-in user', () => {
    const world = newWorld();
    const t = new Term(world, 'FIN-LT-07', 'p4'); // someone else walks up to Sara's locked PC
    expect(t.last.output).toContain('screen locked by s.alharbi');
    expect(t.prompt).toBe('Password: ');
    expect(t.masked).toBe(true);

    expect(t.type('whoami')).toBe('Sorry, that password is incorrect.\n'); // commands do nothing
    expect(t.type(PW['o.farouk'])).toBe('Sorry, that password is incorrect.\n');
    expect(t.masked).toBe(true);
    expect(authLog(world, 'FIN-LT-07')).toContain('pam_unix(gdm-password:auth): authentication failure');
    expect(queryEvents(world, { type: 'unlock.fail', host: 'FIN-LT-07', actor: 'p4' })).toHaveLength(2);

    expect(t.type(PW['s.alharbi'])).toBe('');
    expect(t.prompt).toBe('s.alharbi@FIN-LT-07:~$ ');
    expect(t.last.awaitingInput).toBeUndefined();
    expect(queryEvents(world, { type: 'session.unlock', host: 'FIN-LT-07' })).toHaveLength(1);
  });

  it('loginctl lock-session locks; unlocking needs the password again', () => {
    const world = newWorld();
    const t = atDesk(world, 'l.haddad'); // starts unlocked
    expect(t.type('loginctl lock-session')).toContain('screen locked by l.haddad');
    expect(t.prompt).toBe('Password: ');
    expect(world.sessions[world.hosts['HR-LT-03'].consoleSessionId!].locked).toBe(true);
    expect(authLog(world, 'HR-LT-03')).toContain('of user l.haddad locked.');

    t.type('nope');
    expect(t.masked).toBe(true);
    t.type(PW['l.haddad']);
    expect(t.prompt).toBe('l.haddad@HR-LT-03:~$ ');
    expect(t.type('pwd')).toBe('/home/l.haddad\n'); // the session is exactly as it was
  });

  it('an unlocked PC stays unlocked when its owner walks away', () => {
    const world = newWorld();
    const stranger = new Term(world, 'HR-LT-03', 'p4');
    expect(stranger.last.awaitingInput).toBeUndefined();
    expect(stranger.prompt).toBe('l.haddad@HR-LT-03:~$ ');
    expect(stranger.type('whoami')).toBe('l.haddad\n');
  });

  it('a locked PC stays locked, and keeps its sessions, while the owner is away', () => {
    const world = newWorld();
    const lina = atDesk(world, 'l.haddad');
    lina.type('cd Documents');
    ssh(lina, 'l.haddad', SERVER);
    lina.type('exit');
    lina.type('loginctl lock-session');

    const stranger = new Term(world, 'HR-LT-03', 'p4');
    expect(stranger.prompt).toBe('Password: ');
    stranger.type('guess');
    expect(stranger.masked).toBe(true);

    const back = new Term(world, 'HR-LT-03', 'p3');
    back.type(PW['l.haddad']);
    expect(back.prompt).toBe('l.haddad@HR-LT-03:~/Documents$ ');
  });

  it('the lock can be triggered remotely over ssh by the same user', () => {
    const world = newWorld();
    // Khalid has an account on HR-LT-03 but it is Lina's session: not allowed.
    const admin = atDesk(world, 'k.nasser');
    ssh(admin, 'k.nasser', 'HR-LT-03');
    expect(admin.type('loginctl lock-session')).toBe('Failed to lock session: Access denied\n');
    // With sudo he can force-lock it (this is what the helpdesk role will do later).
    admin.type('sudo loginctl lock-session');
    admin.type(PW['k.nasser']);
    expect(new Term(world, 'HR-LT-03', 'p3').prompt).toBe('Password: ');
  });

  it('records the last activity time (shown as IDLE by `w`)', () => {
    const world = newWorld();
    const t = atDesk(world, 'l.haddad');
    t.type('ls');
    const session = world.sessions[world.hosts['HR-LT-03'].consoleSessionId!];
    expect(session.lastActivity).toBe(world.time);
  });
});
