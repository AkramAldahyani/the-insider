import { describe, expect, it } from 'vitest';
import { advanceTime, advanceTo, deserializeWorld, queryEvents, serializeWorld, validateScenario, type World } from '../src/index';
import { PW, SERVER, Term, atDesk, newWorld, scenario, ssh } from './helpers';

/** A fixed sequence of actions touching several machines. Returns the terminals used. */
function playFirstHalf(world: World): { hr: Term; it: Term } {
  const hr = atDesk(world, 'l.haddad');
  hr.type('echo hello > /tmp/note.txt');
  hr.type('ping -c 3 IT-WS-02');
  ssh(hr, 'l.haddad', SERVER);
  hr.type('ls -la /srv/shared');
  const it = atDesk(world, 'k.nasser');
  it.type(`ssh k.nasser@${SERVER}`); // stops at the password prompt on purpose
  return { hr, it };
}

function playSecondHalf(world: World, hr: Term, it: Term): void {
  it.type(PW['k.nasser']);
  it.type('sudo cat /root/flag.txt');
  it.type(PW['k.nasser']);
  advanceTime(world, 3 * 60 * 60 * 1000); // long enough for cron and DHCP renewals
  hr.type('exit');
  hr.type('loginctl lock-session');
}

function playAll(seed: number): string {
  const world = newWorld(seed);
  const { hr, it } = playFirstHalf(world);
  playSecondHalf(world, hr, it);
  return serializeWorld(world);
}

describe('deterministic replay', () => {
  it('same seed + same inputs = exactly the same world', () => {
    expect(playAll(7)).toBe(playAll(7));
  });

  it('a different seed gives a different world', () => {
    expect(playAll(7)).not.toBe(playAll(8));
  });

  it('building the same scenario twice gives identical worlds', () => {
    expect(serializeWorld(newWorld(3))).toBe(serializeWorld(newWorld(3)));
  });
});

describe('serialization', () => {
  it('the world is plain JSON and survives a round trip', () => {
    const world = newWorld();
    const copy = deserializeWorld(serializeWorld(world));
    expect(copy).toEqual(world);
  });

  it('a saved world can be continued, even in the middle of a password prompt', () => {
    const original = newWorld(5);
    const a = playFirstHalf(original);
    expect(a.it.masked).toBe(true); // waiting for the ssh password

    const restored = deserializeWorld(serializeWorld(original));
    const b = { hr: new Term(restored, 'HR-LT-03', 'p3'), it: new Term(restored, 'IT-WS-02', 'p5') };
    // Sitting down again is itself an event, so do the same in the original.
    const a2 = { hr: new Term(original, 'HR-LT-03', 'p3'), it: new Term(original, 'IT-WS-02', 'p5') };
    expect(b.it.prompt).toBe(`k.nasser@${SERVER}'s password: `);

    playSecondHalf(original, a2.hr, a2.it);
    playSecondHalf(restored, b.hr, b.it);
    expect(serializeWorld(restored)).toBe(serializeWorld(original));
  });
});

describe('clock', () => {
  it('only moves when told to', () => {
    const world = newWorld();
    const start = world.time;
    expect(start).toBe(Date.parse(scenario.startTime));
    const hr = new Term(world, 'HR-LT-03', 'p3');
    expect(hr.type('date')).toBe('Mon Mar  2 09:00:01 UTC 2026\n'); // Term.type adds one second
    advanceTime(world, 5 * 60 * 1000);
    expect(world.time).toBe(start + 1000 + 5 * 60 * 1000);
  });

  it('refuses to go backwards', () => {
    const world = newWorld();
    expect(() => advanceTo(world, world.time - 1)).toThrow(/backwards/);
  });
});

describe('master event log', () => {
  it('records who was physically at the keyboard, separately from the account used', () => {
    const world = newWorld();
    // p4 (Omar) walks up to Lina's UNLOCKED pc and types a command as her.
    const term = new Term(world, 'HR-LT-03', 'p4');
    term.type('touch /tmp/not-me');
    const [event] = queryEvents(world, { type: 'command', host: 'HR-LT-03' }).slice(-1);
    expect(event.user).toBe('l.haddad');
    expect(event.actor).toBe('p4');
    expect(event.details.command).toBe('touch /tmp/not-me');
  });

  it('starts with pre-existing history so logs are not empty', () => {
    const world = newWorld();
    expect(queryEvents(world, { type: 'ssh.accept', host: SERVER }).length).toBeGreaterThanOrEqual(4);
    expect(queryEvents(world, { type: 'ssh.fail', host: SERVER }).length).toBeGreaterThanOrEqual(5);
  });
});

describe('scenario validation', () => {
  it('rejects a scenario with an unknown user on a host', () => {
    const broken = JSON.parse(JSON.stringify(scenario));
    broken.hosts[1].users.push('ghost');
    expect(() => validateScenario(broken)).toThrow(/unknown user "ghost"/);
  });
});
