import { describe, expect, it } from 'vitest';
import { PW, SERVER, Term, atDesk, fileOn, newWorld, ssh } from './helpers';

describe('shell history', () => {
  it('the history command lists what was typed (old history first)', () => {
    const t = atDesk(newWorld(), 'l.haddad');
    t.type('echo one');
    t.type('pwd');
    const out = t.type('history');
    // the scenario seeded three old commands in ~/.bash_history
    expect(out).toContain('    1  ls\n');
    expect(out).toContain('    4  echo one\n    5  pwd\n    6  history\n');
  });

  it('skips lines starting with a space and immediate repeats, like bash', () => {
    const t = atDesk(newWorld(), 'l.haddad');
    t.type('echo twice');
    t.type('echo twice');
    t.type(' echo hidden');
    const out = t.type('history');
    expect(out.match(/echo twice/g)).toHaveLength(1);
    expect(out).not.toContain('hidden');
  });

  it('writes ~/.bash_history when the session ends - not before', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    ssh(t, 's.alharbi', SERVER);
    t.type('echo marker-123');
    t.type('cat /root/flag.txt');
    const path = '/home/s.alharbi/.bash_history';
    expect(fileOn(world, SERVER, path)).not.toContain('marker-123');

    t.type('exit');
    const saved = fileOn(world, SERVER, path);
    expect(saved).toContain('echo marker-123\ncat /root/flag.txt\nexit\n');
    // earlier sessions' history is kept (appended to, not overwritten)
    expect(saved).toContain('cat /srv/shared/policies/password-policy.txt');
    // passwords typed at prompts are never recorded
    expect(saved).not.toContain(PW['s.alharbi']);
    expect(fileOn(world, 'FIN-LT-07', path)).not.toContain(PW['s.alharbi']);
  });

  it('the next session loads the saved history', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    ssh(t, 's.alharbi', SERVER);
    t.type('echo first-visit');
    t.type('exit');
    ssh(t, 's.alharbi', SERVER);
    expect(t.type('history')).toContain('echo first-visit');
  });

  it('history -c wipes the in-memory list so nothing new is saved', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    ssh(t, 's.alharbi', SERVER);
    t.type('echo cover-my-tracks');
    t.type('history -c');
    t.type(' exit');
    expect(fileOn(world, SERVER, '/home/s.alharbi/.bash_history')).not.toContain('cover-my-tracks');
  });

  it('su shells record into the target user\'s history', () => {
    const world = newWorld();
    const t = atDesk(world, 'l.haddad');
    t.type('su k.nasser');
    t.type(PW['k.nasser']);
    t.type('echo as-khalid');
    t.type('exit');
    expect(fileOn(world, 'HR-LT-03', '/home/k.nasser/.bash_history')).toContain('echo as-khalid');
    expect(t.type('history')).not.toContain('as-khalid');
  });

  it('kill -9 on an intruder\'s shell disconnects them and their history is lost', () => {
    const world = newWorld();
    const intruder = atDesk(world, 's.alharbi');
    ssh(intruder, 's.alharbi', SERVER);
    intruder.type('echo doing-bad-things');

    const admin = atDesk(world, 'k.nasser');
    ssh(admin, 'k.nasser', SERVER);
    const shell = world.hosts[SERVER].processes.find((p) => p.user === 's.alharbi' && p.command === '-bash')!;
    expect(admin.type(`kill -9 ${shell.pid}`)).toBe(`bash: kill: (${shell.pid}) - Operation not permitted\n`);
    admin.type(`sudo kill -9 ${shell.pid}`);
    admin.type(PW['k.nasser']);

    expect(admin.type('who')).not.toContain('s.alharbi');
    expect(fileOn(world, SERVER, '/home/s.alharbi/.bash_history')).not.toContain('doing-bad-things');
    // the intruder's next keypress shows the dead connection and drops them back home
    const out = intruder.type('whoami');
    expect(out).toBe(`Connection to ${SERVER} closed by remote host.\nConnection to ${SERVER} closed.\n`);
    expect(intruder.prompt).toBe('s.alharbi@FIN-LT-07:~$ ');
    // ...and `last` on the server shows when the session ended
    expect(admin.type('last -n 2 s.alharbi')).toMatch(/s\.alharbi\s+pts\/0\s+\S+\s+Mon Mar  2 09:00 - 09:00/);
  });

  it('a plain kill (SIGTERM) lets the shell save its history', () => {
    const world = newWorld();
    const victim = new Term(world, 'HR-LT-03', 'p3');
    ssh(victim, 'l.haddad', SERVER);
    victim.type('echo saved-on-term');
    const shell = world.hosts[SERVER].processes.find((p) => p.user === 'l.haddad' && p.command === '-bash')!;
    victim.type(`kill ${shell.pid}`); // killing your own shell is allowed
    expect(victim.prompt).toBe('l.haddad@HR-LT-03:~$ ');
    expect(fileOn(world, SERVER, '/home/l.haddad/.bash_history')).toContain('saved-on-term');
  });
});
