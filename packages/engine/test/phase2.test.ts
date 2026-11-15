/**
 * Phase 2 engine features: auto-lock, switch user, remote lock/unlock logging,
 * physical vs remote input, Ctrl+C.
 */
import { describe, expect, it } from 'vitest';
import {
  advanceTime, cancelInput, queryEvents, refreshTerminal, screenState, switchUser, touchTerminal,
} from '../src/index';
import { PW, SERVER, Term, atDesk, authLog, newWorld, ssh } from './helpers';

const SECOND = 1000;

describe('auto-lock', () => {
  it('locks a screen after 60 s without physical input, and logs why', () => {
    const world = newWorld(1, true);
    const sara = atDesk(world, 's.alharbi');
    expect(screenState(world, 'FIN-LT-07')).toEqual({ state: 'unlocked', user: 's.alharbi' });

    advanceTime(world, 59 * SECOND);
    expect(screenState(world, 'FIN-LT-07').state).toBe('unlocked');
    expect(refreshTerminal(world, sara.id)).toBeNull(); // nothing changed on screen

    advanceTime(world, 1 * SECOND);
    expect(screenState(world, 'FIN-LT-07')).toEqual({ state: 'locked', user: 's.alharbi' });
    expect(authLog(world, 'FIN-LT-07')).toContain('of user s.alharbi locked (idle timeout, 60s without keyboard input).');

    // The seated player's screen is redrawn as a lock screen.
    const redraw = refreshTerminal(world, sara.id)!;
    expect(redraw.output).toContain('screen locked by s.alharbi');
    expect(redraw.screen).toBe('locked');
    expect(redraw.awaitingInput).toEqual({ masked: true });
    expect(refreshTerminal(world, sara.id)).toBeNull();

    const lock = queryEvents(world, { type: 'session.lock', host: 'FIN-LT-07' }).pop()!;
    expect(lock.details.via).toBe('idle');
    expect(lock.origin).toBe('system');
    expect(lock.actor).toBeNull();
  });

  it('every physical input restarts the timer, including keys pressed before Enter', () => {
    const world = newWorld(1, true);
    const sara = atDesk(world, 's.alharbi');
    for (let i = 0; i < 5; i++) {
      advanceTime(world, 40 * SECOND);
      sara.type('pwd');
    }
    expect(screenState(world, 'FIN-LT-07').state).toBe('unlocked');
    advanceTime(world, 50 * SECOND);
    touchTerminal(world, sara.id); // still typing a long command
    advanceTime(world, 50 * SECOND);
    expect(screenState(world, 'FIN-LT-07').state).toBe('unlocked');
    advanceTime(world, 10 * SECOND);
    expect(screenState(world, 'FIN-LT-07').state).toBe('locked');
  });

  it('input that arrives over ssh does NOT keep the target screen awake', () => {
    const world = newWorld(1, true);
    // Sara unlocks her PC and walks away; Khalid works on it remotely the whole time.
    atDesk(world, 's.alharbi');
    const khalid = atDesk(world, 'k.nasser');
    ssh(khalid, 'k.nasser', 'FIN-LT-07');
    for (let i = 0; i < 7; i++) {
      advanceTime(world, 9 * SECOND);
      expect(khalid.type('hostname')).toBe('FIN-LT-07\n');
    }
    expect(screenState(world, 'FIN-LT-07').state).toBe('locked');
    // ...while Khalid's own PC, where his fingers are, stays unlocked.
    expect(screenState(world, 'IT-WS-02').state).toBe('unlocked');
  });

  it('respects per-machine settings: off on HR-LT-03, 10 minutes on MKT-LT-09', () => {
    const world = newWorld(1, true);
    expect(screenState(world, 'HR-LT-03').state).toBe('unlocked');
    expect(screenState(world, 'MKT-LT-09').state).toBe('unlocked');
    advanceTime(world, 9 * 60 * SECOND);
    expect(screenState(world, 'MKT-LT-09').state).toBe('unlocked');
    advanceTime(world, 61 * SECOND);
    expect(screenState(world, 'MKT-LT-09').state).toBe('locked');
    advanceTime(world, 3 * 3600 * SECOND);
    expect(screenState(world, 'HR-LT-03').state).toBe('unlocked');
  });

  it('standing up does not lock, and sitting down does not count as input', () => {
    const world = newWorld(1, true);
    atDesk(world, 's.alharbi');
    advanceTime(world, 30 * SECOND);
    const stranger = new Term(world, 'FIN-LT-07', 'p4');
    expect(stranger.prompt).toBe('s.alharbi@FIN-LT-07:~$ ');
    advanceTime(world, 31 * SECOND);
    expect(screenState(world, 'FIN-LT-07').state).toBe('locked');
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
