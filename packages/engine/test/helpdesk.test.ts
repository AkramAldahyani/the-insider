/**
 * Phase 5, part E: the helpdesk console on Dana's PC (IT-WS-01).
 * `helpdesk status`, `helpdesk lock HOST` and `helpdesk reset USER`.
 */
import { describe, expect, it } from 'vitest';
import { PW, Term, atDesk, authLog, fileOn, newWorld } from './helpers';

describe('the helpdesk console', () => {
  it('status shows every PC screen; lock locks one remotely and the PC logs who did it', () => {
    const world = newWorld();
    atDesk(world, 'l.haddad'); // Lina logs in at HR-LT-03 and leaves it open
    const dana = atDesk(world, 'd.aziz');
    const status = dana.type('helpdesk status');
    expect(status).toMatch(/HR-LT-03\s+UNLOCKED\s+l\.haddad/);
    expect(status).toMatch(/FIN-LT-04\s+login\s+-/);
    expect(status).not.toContain('ADMIN-SRV-01'); // workstations only

    expect(dana.type('helpdesk lock HR-LT-03')).toBe('HR-LT-03: screen of l.haddad locked\n');
    const host = world.hosts['HR-LT-03'];
    expect(world.sessions[host.consoleSessionId!].locked).toBe(true);
    expect(authLog(world, 'HR-LT-03')).toContain(`helpdesk: REMOTE lock-session: session`);
    expect(authLog(world, 'HR-LT-03')).toContain(`of user l.haddad locked by d.aziz from ${world.hosts['IT-WS-01'].ip} (helpdesk)`);
    expect(dana.type('helpdesk lock HR-LT-03')).toBe('HR-LT-03: already locked (l.haddad)\n');
    expect(dana.type('helpdesk lock FIN-LT-04')).toContain('nobody is logged in at FIN-LT-04');
    expect(dana.type('helpdesk lock NOPE')).toContain('Usage: helpdesk lock HOST');
  });

  it('reset gives an account a new password on every machine; the old one stops working', () => {
    const world = newWorld();
    const dana = atDesk(world, 'd.aziz');
    const oldShadow = fileOn(world, 'FIN-LT-04', '/etc/shadow').split('\n').find((l) => l.startsWith('r.mansour:'));
    const out = dana.type('helpdesk reset r.mansour');
    const password = /New password: (\S+)/.exec(out)?.[1] ?? '';
    expect(password).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-\d\d$/);
    expect(world.credentials['r.mansour'].password).toBe(password);
    expect(fileOn(world, 'FIN-LT-04', '/etc/shadow').split('\n').find((l) => l.startsWith('r.mansour:'))).not.toBe(oldShadow);
    // The change is recorded on the directory (admin) server, naming who asked and from where.
    const log = authLog(world, world.dhcp.serverHost);
    expect(log).toContain('pam_unix(passwd:chauthtok): password changed for r.mansour');
    expect(log).toContain(`password of r.mansour reset by d.aziz from ${world.hosts['IT-WS-01'].ip}`);

    const rami = new Term(world, 'FIN-LT-04', 'p2');
    rami.type('r.mansour');
    expect(rami.type(PW['r.mansour'])).toBe('\nLogin incorrect\n');
    rami.type('r.mansour');
    expect(rami.type(password)).toContain('Last login');
    expect(rami.prompt).toBe('r.mansour@FIN-LT-04:~$ ');
  });

  it('refuses root and unknown accounts', () => {
    const dana = atDesk(newWorld(), 'd.aziz');
    expect(dana.type('helpdesk reset root')).toContain('Usage: helpdesk reset USER');
    expect(dana.type('helpdesk reset nobody')).toContain('Usage: helpdesk reset USER');
    expect(dana.type('helpdesk')).toContain('Usage: helpdesk status');
  });

  it('exists only on the helpdesk PC', () => {
    const world = newWorld();
    const sara = atDesk(world, 's.alharbi');
    expect(sara.type('helpdesk status')).toBe('bash: helpdesk: command not found\n');
  });

  it('on the helpdesk PC, only the helpdesk account may use it', () => {
    const world = newWorld();
    const dana = atDesk(world, 'd.aziz');
    // Anyone else who gets a shell on Dana's PC (here: as another user via su) is turned away.
    // Khalid (sysadmin) also has an account on that PC.
    dana.type('su k.nasser');
    dana.type(PW['k.nasser']);
    expect(dana.type('whoami')).toBe('k.nasser\n');
    expect(dana.type('helpdesk status')).toBe('helpdesk: k.nasser is not a helpdesk account\n');
  });
});
