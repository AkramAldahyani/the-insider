import { describe, expect, it } from 'vitest';
import { advanceTime, plugUsb } from '@insider/engine';
import { PW, Recorder } from './helpers';

function match() {
  const r = new Recorder({ weaknesses: [] });
  r.connect('h');
  r.send('h', 'choose', { playerId: 'p4', hacker: true });
  r.connect('e', 'p1');
  r.connect('late');
  r.sitAt('h', 'p4', 'MKT-LT-11');
  r.type('h', PW['o.farouk']);
  return r;
}

describe('Part D visibility and alerts', () => {
  it('a scan shows results only to the operator and sends everybody the same vague banner', () => {
    const r = match();
    expect(r.type('h', '~/.tools/scan')).toContain('22/tcp sshd');
    r.tick();
    const alert = r.last('h', 'alert')?.payload;
    expect(alert).toBeDefined();
    // Every player gets the same vague banner; someone still on the start screen gets none (as in win.test.ts).
    expect(r.last('e', 'alert')?.payload).toEqual(alert);
    expect(r.messages('late', 'alert')).toEqual([]);
    for (const client of ['e', 'late']) {
      expect(JSON.stringify(r.sent.get(client))).not.toMatch(/network-scan|22\/tcp|\.tools\/scan|SRC=/);
    }
    expect(JSON.stringify(r.states)).not.toMatch(/network-scan|22\/tcp|keyloggers|backdoors|toolkit/);
  });

  it('captured passwords and job snapshots never enter bystander or public messages', () => {
    const r = match();
    r.type('h', 'scp ~/.tools/keylogger l.haddad@HR-LT-03:/tmp/recorder');
    r.type('h', PW['l.haddad']);
    // The physical USB hold is covered by physical-tools tests; seed its completed effect here.
    plugUsb(r.game.world, 'HR-LT-03', 'p4');
    r.type('h', '~/.tools/implant HR-LT-03');
    r.type('h', 'chmod 700 /tmp/recorder');
    r.type('h', '/tmp/recorder');
    const k = r.game.world.toolkit.keyloggers[0];
    r.connect('victim', 'p3');
    r.sitAt('victim', 'p3', 'HR-LT-03');
    r.type('victim', 'loginctl lock-session');
    r.type('victim', PW['l.haddad']);
    expect(r.type('h', `cat ${k.path}`)).toContain(PW['l.haddad']);
    r.type('h', 'exit');
    // The operator acquires a readable copy through the normal simulated sudo/scp path.
    r.type('h', 'ssh k.nasser@ADMIN-SRV-01');
    r.type('h', PW['k.nasser']);
    r.type('h', 'sudo cp /etc/shadow /tmp/shadow-copy');
    r.type('h', PW['k.nasser']);
    r.type('h', 'sudo chmod 644 /tmp/shadow-copy');
    r.type('h', 'exit');
    r.type('h', 'scp k.nasser@ADMIN-SRV-01:/tmp/shadow-copy /tmp/shadow-copy');
    r.type('h', PW['k.nasser']);
    r.type('h', '~/.tools/crack /tmp/shadow-copy k.nasser');
    const job = r.game.world.toolkit.jobs[0];
    expect(job.data?.result).toContain(PW['k.nasser']);
    advanceTime(r.game.world, job.finishAt - r.game.world.time);
    expect(r.type('h', `cat ~/.tools/loot/crack-${job.id}.txt`)).toContain(PW['k.nasser']);
    for (const client of ['e', 'late']) {
      const stream = JSON.stringify(r.sent.get(client));
      for (const secret of [PW['l.haddad'], PW['k.nasser'], '.keys-', 'keylogger', 'crack-', 'sysupd', 'toolkit']) expect(stream).not.toContain(secret);
    }
    expect(JSON.stringify(r.states)).not.toMatch(/keyloggers|backdoors|toolkit|\.keys-/);
  });
});
