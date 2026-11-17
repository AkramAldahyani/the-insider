/**
 * Phase 5, part H: how a match ends, and the anti-stall rule.
 *
 * Earlier parts already end a match when the flag is handed in (win.test.ts),
 * when the hacker is voted out (meetings.test.ts) and when the guard detains
 * the hacker (guard.test.ts). This file adds parity (DESIGN.md section 1:
 * the hackers win when the defenders left are no more than the hackers left)
 * the company's reputation reaching 0 % (the owner's rule: the hacker wins),
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

describe('reputation', () => {
  it('the fourth wrong firing ruins the company: the hacker wins', () => {
    const r = withHacker();
    for (const id of ['p2', 'p3', 'p5']) fire(r, id);
    r.tick();
    expect(r.game.reputation).toBe(25);
    expect(r.last('e', 'match.over')).toBeUndefined();
    fire(r, 'p6');
    r.tick();
    expect(r.game.publicState().reputation).toBe(0);
    for (const c of ['h', 'e']) {
      expect(r.last(c, 'match.over')!.payload, c).toMatchObject({
        winner: 'hacker', hacker: 'Omar Farouk',
        reason: "The company's reputation hit 0 %: too many innocent people were fired. The hacker wins.",
      });
    }
  });

  it('through a real meeting: an innocent person voted out at 25 % ends the match', () => {
    const r = withHacker({ meetingTimes: { discussionMs: 3000, votingMs: 3000, resultMs: 1000, cooldownMs: 0 } });
    for (const id of ['p2', 'p3', 'p5']) fire(r, id);
    r.connect('m', 'p9');
    r.sitAt('e', 'p1', 'FIN-LT-07');
    r.type('e', PW['s.alharbi']);
    for (const cmd of ['hostname', 'whoami', 'pwd']) r.send('e', 'evidence.pin', { kind: 'screen', text: r.type('e', cmd).trim() });
    r.send('e', 'stand');
    const b = r.map.furniture.find((f) => f.kind === 'button')!;
    expect(r.walkTo('m', 'p9', b.x + b.width / 2, b.y + b.height + 14)).toBe(true);
    r.send('m', 'meeting.call');
    r.send('e', 'meeting.accuse', { suspect: 'p9', evidence: r.game.board.items.map((i) => i.id) });
    r.tick(Math.round(3.2 * TICK_RATE));
    for (const c of ['e', 'h']) r.send(c, 'meeting.vote', { target: 'p9' });
    r.tick(Math.round(3.5 * TICK_RATE));
    expect(r.game.fired.has('p9')).toBe(true);
    expect(r.last('e', 'match.over')!.payload).toMatchObject({ winner: 'hacker', hacker: 'Omar Farouk' });
  });

  it('without a hacker, a ruined reputation ends nothing', () => {
    const r = new Recorder({ weaknesses: [] });
    r.connect('e', 'p1');
    for (const id of ['p2', 'p3', 'p5', 'p6', 'p7']) fire(r, id);
    r.tick();
    expect(r.game.reputation).toBe(0);
    expect(r.last('e', 'match.over')).toBeUndefined();
  });
});

describe('parity', () => {
  it('the hacker wins once the defenders left are no more than the hackers', () => {
    const r = withHacker();
    const innocents = ['p2', 'p3', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11'];
    // In this office reputation would end the match at the 4th firing; keep it up to reach parity.
    const fireKeepingReputation = (id: string) => {
      r.game.reputation = 100;
      fire(r, id);
    };
    for (const id of innocents.slice(0, 8)) fireKeepingReputation(id);
    r.tick();
    expect(r.last('e', 'match.over')).toBeUndefined(); // Sara and Huda are left: 2 defenders against 1 hacker
    fireKeepingReputation('p11');
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
