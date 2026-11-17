/**
 * Phase 5, part H: how a match ends, and the anti-stall rule.
 *
 * Earlier parts already end a match when the flag is handed in (win.test.ts),
 * when the hacker is voted out (meetings.test.ts) and when the guard detains
 * the hacker (guard.test.ts). This file adds parity (DESIGN.md section 1:
 * the hackers win when the defenders left are no more than the hackers left)
 * and the anti-stall escalation in the SIEM.
 */
import { describe, expect, it } from 'vitest';
import { siemQuery } from '@insider/engine';
import { TICK_RATE } from '@insider/shared';
import { PW, Recorder } from './helpers';

const minutes = (m: number) => m * 60 * TICK_RATE;
const alertsLog = (r: Recorder) => r.file('SEC-SRV-01', '/var/log/security/alerts.log');
const escalations = (r: Recorder) => alertsLog(r).split('\n').filter((l) => l.includes('threat-escalation'));
/** Fires a player as a lost vote would (the meeting itself is tested in meetings.test.ts). */
const fire = (r: Recorder, playerId: string) => (r.game as unknown as { fire(id: string): void }).fire(playerId);

/** Omar (p4) is the hacker; Sara (p1) is playing too. */
function withHacker(options: ConstructorParameters<typeof Recorder>[0] = {}): Recorder {
  const r = new Recorder({ weaknesses: ['plaintext-password'], ...options });
  r.connect('h');
  r.send('h', 'choose', { playerId: 'p4', hacker: true });
  r.connect('e', 'p1');
  return r;
}

describe('parity', () => {
  it('the hacker wins once the defenders left are no more than the hackers', () => {
    const r = withHacker();
    const innocents = ['p2', 'p3', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11'];
    for (const id of innocents.slice(0, 8)) fire(r, id);
    r.tick();
    expect(r.last('e', 'match.over')).toBeUndefined(); // Sara and Huda are left: 2 defenders against 1 hacker
    fire(r, 'p11');
    r.tick();
    for (const c of ['h', 'e']) {
      expect(r.last(c, 'match.over')!.payload, c).toMatchObject({
        winner: 'hacker', hacker: 'Omar Farouk',
        reason: 'Only 1 defender is left, as many as hackers: the hacker took over the company.',
      });
    }
  });

  it('a match without a hacker never ends that way', () => {
    const r = new Recorder({ weaknesses: [] });
    r.connect('e', 'p1');
    for (const id of ['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11']) fire(r, id);
    r.tick();
    expect(r.last('e', 'match.over')).toBeUndefined();
  });
});

describe('anti-stall', () => {
  /** The hacker logs in to the server, reads the old script and becomes root. */
  function attack(r: Recorder): void {
    r.sitAt('h', 'p4', 'MKT-LT-11');
    r.type('h', PW['o.farouk']);
    r.type('h', 'whoami'); // ordinary: never flagged
    r.type('h', 'ssh ADMIN-SRV-01');
    r.type('h', PW['o.farouk']);
    const script = r.type('h', 'cat /srv/shared/old/backup-2025.sh');
    r.type('h', 'su');
    r.type('h', /ROOT_PW='([^']+)'/.exec(script)![1]);
  }

  it('every 10 game minutes, the oldest unflagged hacker action is re-scored HIGH, without naming anyone', () => {
    const r = withHacker();
    attack(r);
    const omarIp = r.game.world.hosts['MKT-LT-11'].ip;
    r.tick(minutes(9));
    expect(escalations(r)).toEqual([]);
    r.tick(minutes(1.1));
    expect(escalations(r)).toHaveLength(1);
    expect(escalations(r)[0]).toContain('[HIGH]');
    expect(escalations(r)[0]).toContain(`ssh.accept on ADMIN-SRV-01 (account o.farouk from ${omarIp})`);
    r.tick(minutes(10));
    expect(escalations(r)).toHaveLength(2);
    expect(escalations(r)[1]).toContain(`su.success on ADMIN-SRV-01 (account o.farouk from ${omarIp})`);
    // Reading an ordinary file (the old script) and typing commands are never on the list; no names either.
    expect(alertsLog(r)).not.toMatch(/Omar|Farouk|whoami|file\.read/);
    // The SOC analyst finds them in the SIEM.
    expect(siemQuery(r.game.world, 'rule=threat-escalation severity=high').matched).toBe(2);
    // Once the trail is used up, nothing more is flagged.
    r.tick(minutes(30));
    expect(escalations(r)).toHaveLength(2);
    expect(r.game.world.mission.escalated).toHaveLength(2);
  });

  it('every player gets the vague banner; the details stay in the log', () => {
    const r = withHacker();
    attack(r);
    r.tick(minutes(2)); // the attack's own alerts (if any) have had their banner
    const before = r.messages('e', 'alert').length;
    r.tick(minutes(8.5));
    expect(r.messages('e', 'alert').length).toBe(before + 1);
    expect(JSON.stringify(r.messages('e'))).not.toContain('threat-escalation');
  });

  it('nothing to flag without a hacker, or when switched off', () => {
    const none = new Recorder({ weaknesses: [] });
    none.tick(minutes(25));
    expect(escalations(none)).toEqual([]);

    const off = withHacker({ escalationMinutes: 0 });
    attack(off);
    off.tick(minutes(25));
    expect(escalations(off)).toEqual([]);
  });
});
