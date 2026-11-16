/**
 * Screen locking without auto-lock (and the record of unattended PCs),
 * switch user, remote lock/unlock logging, physical vs remote input, Ctrl+C,
 * and forgetting ended sessions.
 */
import { describe, expect, it } from 'vitest';
import {
  advanceTime, cancelInput, leaveTerminal, queryEvents, refreshTerminal, screenState, switchUser, unattendedMs,
} from '../src/index';
import { PW, SERVER, Term, atDesk, authLog, newWorld, scenario, ssh } from './helpers';

const SECOND = 1000;
const START = Date.parse(scenario.startTime);

describe('no auto-lock: screens stay open until someone locks them', () => {
  it('an unlocked PC is still unlocked hours later, with nobody touching it', () => {
    const world = newWorld();
    atDesk(world, 's.alharbi').type('pwd');
    advanceTime(world, 5 * 3600 * SECOND);
    expect(screenState(world, 'FIN-LT-07')).toEqual({ state: 'unlocked', user: 's.alharbi' });
    expect(queryEvents(world, { type: 'session.lock', host: 'FIN-LT-07', since: START })).toEqual([]);
    // The scenario's PCs that start unlocked stay that way too.
    expect(screenState(world, 'HR-LT-03').state).toBe('unlocked');
    expect(screenState(world, 'MKT-LT-09').state).toBe('unlocked');
  });

  it('a lock is always somebody\'s doing, and logged as such', () => {
    const world = newWorld();
    const sara = atDesk(world, 's.alharbi');
    sara.type('loginctl lock-session');
    const lock = queryEvents(world, { type: 'session.lock', host: 'FIN-LT-07', since: START }).pop()!;
    expect(lock).toMatchObject({ actor: 'p1', origin: 'physical', details: { via: 'loginctl', by: 's.alharbi' } });
    expect(authLog(world, 'FIN-LT-07')).toContain('Session 2 of user s.alharbi locked.');
  });
});

describe('unattended PCs (ground truth for the debrief)', () => {
  it('records how long a PC stood unlocked after its owner walked away, and who used it', () => {
    const world = newWorld();
    const sara = atDesk(world, 's.alharbi');
    sara.type('pwd');
    leaveTerminal(world, sara.id); // she walks away without locking
    const left = world.time;
    expect(world.unattended.filter((w) => w.host === 'FIN-LT-07')).toMatchObject([{ account: 's.alharbi', ownerPlayer: 'p1', from: left, to: null, visitors: [] }]);

    advanceTime(world, 90 * SECOND);
    const omar = new Term(world, 'FIN-LT-07', 'p4'); // Omar sits at her open PC
    omar.type('whoami');
    omar.type('cat Documents/invoices_feb.csv');
    leaveTerminal(world, omar.id);
    advanceTime(world, 60 * SECOND);
    expect(unattendedMs(world, 'FIN-LT-07')).toBe(world.time - left);

    // Sara comes back: the window closes.
    new Term(world, 'FIN-LT-07', 'p1');
    const window = world.unattended.find((w) => w.host === 'FIN-LT-07')!;
    expect(window).toMatchObject({ to: world.time, endedBy: 'owner returned' });
    expect(window.visitors).toMatchObject([{ playerId: 'p4', lines: 2 }]);
    expect(window.visitors[0].firstAt).toBe(left + 90 * SECOND);
  });

  it('a window ends when someone locks the screen, and says who did', () => {
    const world = newWorld();
    const sara = atDesk(world, 's.alharbi');
    leaveTerminal(world, sara.id);
    const helper = new Term(world, 'FIN-LT-07', 'p8'); // Dana passes by and locks it for her
    helper.type('loginctl lock-session');
    expect(world.unattended.find((w) => w.host === 'FIN-LT-07')).toMatchObject({ endedBy: 'locked', lockedBy: { account: 's.alharbi', playerId: 'p8' } });
  });

  it('the PCs that start unlocked are open windows from the first second', () => {
    const world = newWorld();
    const open = world.unattended.filter((w) => w.to === null).map((w) => `${w.host}:${w.account}`).sort();
    expect(open).toEqual(['HR-LT-03:l.haddad', 'MKT-LT-09:y.khalil']);
    expect(world.unattended.every((w) => w.from === START)).toBe(true);
  });

  it('locking before leaving leaves no window; a remote lock closes one', () => {
    const world = newWorld();
    const sara = atDesk(world, 's.alharbi');
    sara.type('loginctl lock-session');
    leaveTerminal(world, sara.id);
    expect(world.unattended.some((w) => w.host === 'FIN-LT-07')).toBe(false);

    const khalid = atDesk(world, 'k.nasser');
    ssh(khalid, 'l.haddad', 'HR-LT-03');
    khalid.type('loginctl lock-session');
    expect(world.unattended.find((w) => w.host === 'HR-LT-03')).toMatchObject({ endedBy: 'locked', lockedBy: { account: 'l.haddad', playerId: 'p5' } });
  });

  it('logging out closes a window', () => {
    const world = newWorld();
    const omar = new Term(world, 'HR-LT-03', 'p4');
    omar.type('exit');
    expect(world.unattended.find((w) => w.host === 'HR-LT-03')).toMatchObject({ endedBy: 'logged out', visitors: [{ playerId: 'p4', lines: 1 }] });
  });
});

describe('ended sessions are forgotten', () => {
  it('a long day of ssh logins does not keep growing the session list; the logs keep the record', () => {
    const world = newWorld();
    const sara = atDesk(world, 's.alharbi');
    const before = Object.keys(world.sessions).length;
    for (let i = 0; i < 40; i++) {
      ssh(sara, 's.alharbi', SERVER);
      sara.type('exit');
    }
    advanceTime(world, SECOND);
    expect(Object.keys(world.sessions).length).toBeLessThanOrEqual(before);
    const server = new Term(world, SERVER, 'p5');
    expect(server.prompt).toBe('ADMIN-SRV-01 login: ');
    expect((authLog(world, SERVER).match(/Accepted password for s\.alharbi/g) ?? []).length).toBeGreaterThanOrEqual(40);
  });

  it('a session that is still on a screen, or under a live su, is kept', () => {
    const world = newWorld();
    const t = atDesk(world, 'k.nasser');
    ssh(t, 'k.nasser', SERVER);
    advanceTime(world, SECOND);
    const live = Object.values(world.sessions).filter((x) => x.logoutTime === null);
    for (const session of live) expect(world.sessions[session.id]).toBeDefined();
    expect(t.type('whoami')).toBe('k.nasser\n');
  });
});

describe('switch user', () => {
  it('lets another account log in next to a locked session, which stays locked underneath', () => {
    const world = newWorld();
    const t = new Term(world, 'FIN-LT-07', 'p5'); // Khalid at Sara's locked PC
    expect(t.last.canSwitchUser).toBe(true);
    const saraSession = world.hosts['FIN-LT-07'].consoleSessionId!;

    t.last = switchUser(world, t.id);
    expect(t.last.output).toContain('still logged in and locked: s.alharbi');
    expect(t.prompt).toBe('FIN-LT-07 login: ');
    expect(screenState(world, 'FIN-LT-07').state).toBe('login');

    t.type('k.nasser');
    t.type(PW['k.nasser']);
    expect(t.prompt).toBe('k.nasser@FIN-LT-07:~$ ');
    expect(t.type('whoami')).toBe('k.nasser\n');
    // Both sessions exist; Sara's is untouched and still locked.
    expect(world.sessions[saraSession].locked).toBe(true);
    expect(world.sessions[saraSession].logoutTime).toBeNull();
    const who = t.type('who');
    expect(who).toMatch(/s\.alharbi\s+tty1/);
    expect(who).toMatch(/k\.nasser\s+tty2/);
    // Both logins are in the logs.
    const log = authLog(world, 'FIN-LT-07');
    expect(log).toContain('session opened for user s.alharbi');
    expect(log).toContain('session opened for user k.nasser');
    expect(log).toContain('of user s.alharbi moved to the background (switch user).');

    // Logging out brings Sara's lock screen back.
    expect(t.type('exit')).toContain('screen locked by s.alharbi');
    expect(world.hosts['FIN-LT-07'].consoleSessionId).toBe(saraSession);
    t.type(PW['s.alharbi']);
    expect(t.prompt).toBe('s.alharbi@FIN-LT-07:~$ ');
  });

  it('rejects accounts that do not exist on that machine', () => {
    const world = newWorld();
    const t = new Term(world, 'FIN-LT-07', 'p4');
    switchUser(world, t.id);
    t.type('o.farouk');
    expect(t.type(PW['o.farouk'])).toBe('\nLogin incorrect\n');
    expect(authLog(world, 'FIN-LT-07')).toContain("FOR 'o.farouk', Authentication failure");
  });

  it('logging in as the user who is already logged in resumes their session', () => {
    const world = newWorld();
    const sara = atDesk(world, 's.alharbi');
    sara.type('cd Documents');
    sara.type('loginctl lock-session');
    switchUser(world, sara.id);
    sara.type('s.alharbi');
    sara.type(PW['s.alharbi']);
    expect(sara.prompt).toBe('s.alharbi@FIN-LT-07:~/Documents$ ');
    expect(Object.values(world.sessions).filter((s) => s.host === 'FIN-LT-07' && s.logoutTime === null)).toHaveLength(1);
  });

  it('is only offered on a lock screen, and Ctrl+C or walking away returns to it', () => {
    const world = newWorld();
    const open = new Term(world, 'HR-LT-03', 'p4');
    expect(open.last.canSwitchUser).toBe(false);
    expect(switchUser(world, open.id).prompt).toBe('l.haddad@HR-LT-03:~$ ');

    const t = new Term(world, 'FIN-LT-07', 'p4');
    switchUser(world, t.id);
    expect(cancelInput(world, t.id).output).toContain('screen locked by s.alharbi');
    switchUser(world, t.id);
    t.type('k.nasser'); // half-typed login, then walks away
    expect(new Term(world, 'FIN-LT-07', 'p1').prompt).toBe('Password: ');
    expect(screenState(world, 'FIN-LT-07')).toEqual({ state: 'locked', user: 's.alharbi' });
  });
});

describe('remote lock / unlock', () => {
  it('leaves a clear auth.log line with the source IP', () => {
    const world = newWorld();
    const khalid = atDesk(world, 'k.nasser');
    ssh(khalid, 'k.nasser', 'FIN-LT-07');
    khalid.type('sudo loginctl unlock-session');
    khalid.type(PW['k.nasser']);
    expect(screenState(world, 'FIN-LT-07').state).toBe('unlocked');

    const ip = world.hosts['IT-WS-02'].ip;
    const log = authLog(world, 'FIN-LT-07');
    expect(log).toContain(`of user s.alharbi unlocked by k.nasser from ${ip} (pts/0)`);
    expect(log).toContain('REMOTE unlock-session: session');
    expect(log).toContain('unlocked by request of k.nasser (no password entered).');

    const event = queryEvents(world, { type: 'session.unlock', host: 'FIN-LT-07' }).pop()!;
    expect(event.sourceIp).toBe(ip);
    expect(event.origin).toBe('remote');
    expect(event.actor).toBe('p5');

    khalid.type('sudo loginctl lock-session');
    expect(authLog(world, 'FIN-LT-07')).toContain(`locked by k.nasser from ${ip} (pts/0)`);
    expect(screenState(world, 'FIN-LT-07').state).toBe('locked');
  });

  it('a local lock has no REMOTE line, and someone at the lock screen sees a remote unlock', () => {
    const world = newWorld();
    const lina = atDesk(world, 'l.haddad');
    lina.type('loginctl lock-session');
    expect(authLog(world, 'HR-LT-03')).not.toContain('REMOTE');

    const khalid = atDesk(world, 'k.nasser');
    ssh(khalid, 'k.nasser', 'HR-LT-03');
    khalid.type('sudo loginctl unlock-session');
    khalid.type(PW['k.nasser']);
    const redraw = refreshTerminal(world, lina.id)!;
    expect(redraw.screen).toBe('shell');
    expect(redraw.prompt).toBe('l.haddad@HR-LT-03:~$ ');
  });
});

describe('physical vs remote input', () => {
  it('tags each event with where the keyboard was', () => {
    const world = newWorld();
    const sara = atDesk(world, 's.alharbi');
    sara.type('touch /tmp/local');
    ssh(sara, 's.alharbi', SERVER);
    sara.type('touch /tmp/remote');

    const local = queryEvents(world, { type: 'command', host: 'FIN-LT-07' }).pop()!;
    expect(local.origin).toBe('physical');
    const remote = queryEvents(world, { type: 'command', host: SERVER }).pop()!;
    expect(remote.origin).toBe('remote');
    expect(remote.actor).toBe('p1');
    expect(queryEvents(world, { type: 'ssh.accept', host: SERVER }).pop()!.origin).toBe('remote');
    // Things nobody typed.
    expect(queryEvents(world, { type: 'host.boot' })[0].origin).toBe('system');
    expect(queryEvents(world, { origin: 'physical', host: SERVER })).toHaveLength(0);
  });
});

describe('Ctrl+C', () => {
  it('gives up a password question and returns to the shell', () => {
    const world = newWorld();
    const sara = atDesk(world, 's.alharbi');
    sara.type(`ssh s.alharbi@${SERVER}`);
    expect(sara.masked).toBe(true);
    const r = cancelInput(world, sara.id);
    expect(r.prompt).toBe('s.alharbi@FIN-LT-07:~$ ');
    expect(r.awaitingInput).toBeUndefined();
    expect(authLog(world, SERVER)).toContain('Connection closed by authenticating user s.alharbi');
    expect(sara.type('whoami')).toBe('s.alharbi\n');

    sara.type('sudo ls /root');
    expect(cancelInput(world, sara.id).prompt).toBe('s.alharbi@FIN-LT-07:~$ ');
  });

  it('cannot get past a lock screen', () => {
    const world = newWorld();
    const t = new Term(world, 'FIN-LT-07', 'p4');
    const r = cancelInput(world, t.id);
    expect(r.screen).toBe('locked');
    expect(r.awaitingInput).toEqual({ masked: true });
  });
});
