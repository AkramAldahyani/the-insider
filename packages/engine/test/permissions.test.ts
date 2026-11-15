import { describe, expect, it } from 'vitest';
import { FLAG, PW, ROOT_PW, SERVER, atDesk, fileOn, newWorld, ssh } from './helpers';

describe('filesystem permissions', () => {
  it('a normal user cannot read /root/flag.txt on the admin server', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    ssh(t, 's.alharbi', SERVER);
    expect(t.prompt).toBe(`s.alharbi@${SERVER}:~$ `);
    expect(t.type('cat /root/flag.txt')).toBe('cat: /root/flag.txt: Permission denied\n');
    expect(t.type('ls /root')).toBe("ls: cannot open directory '/root': Permission denied\n");
    expect(t.type('cd /root')).toBe('bash: cd: /root: Permission denied\n');
    expect(t.type('cp /root/flag.txt /tmp/f')).toContain('Permission denied');
    expect(t.type('find /root -name flag.txt')).toContain('Permission denied');
    expect(t.type('grep NEXORA /root/flag.txt')).toBe('grep: /root/flag.txt: Permission denied\n');
    expect(fileOn(world, SERVER, '/tmp/f')).toBe('');
  });

  it('root can read the flag', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    ssh(t, 's.alharbi', SERVER);
    t.type('su -');
    t.type(ROOT_PW);
    expect(t.prompt).toBe(`root@${SERVER}:~# `);
    expect(t.type('cat /root/flag.txt')).toBe(`${FLAG}\n`);
    expect(t.type('ls -l /root/flag.txt')).toMatch(/^-r-------- 1 root root 29 /);
  });

  it('protects /etc/shadow and the logs but not /etc/passwd', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    ssh(t, 's.alharbi', SERVER);
    expect(t.type('cat /etc/shadow')).toBe('cat: /etc/shadow: Permission denied\n');
    expect(t.type('tail -n 1 /var/log/auth.log')).toBe('tail: /var/log/auth.log: Permission denied\n');
    expect(t.type('grep -c s.alharbi /etc/passwd')).toBe('1\n');
    expect(fileOn(world, SERVER, '/etc/shadow')).toMatch(/^s\.alharbi:\$6\$[./0-9A-Za-z]{16}\$[./0-9A-Za-z]{86}:\d+:0:99999:7:::$/m);
  });

  it('the owner of a workstation (group adm) can read its logs', () => {
    const t = atDesk(newWorld(), 'l.haddad');
    expect(t.type('id')).toBe('uid=1003(l.haddad) gid=1003(l.haddad) groups=1003(l.haddad),4(adm)\n');
    expect(t.type('tail -n 1 /var/log/auth.log')).toContain('HR-LT-03');
  });

  it("users cannot look into each other's home directories", () => {
    const t = atDesk(newWorld(), 's.alharbi');
    ssh(t, 's.alharbi', SERVER);
    expect(t.type('ls /home/k.nasser')).toBe("ls: cannot open directory '/home/k.nasser': Permission denied\n");
    expect(t.type('cat /home/k.nasser/.bash_history')).toBe('cat: /home/k.nasser/.bash_history: Permission denied\n');
  });

  it('cannot write where it should not', () => {
    const t = atDesk(newWorld(), 'l.haddad');
    expect(t.type('echo x > /etc/passwd')).toBe('bash: /etc/passwd: Permission denied\n');
    expect(t.type('touch /etc/newfile')).toBe("touch: cannot touch '/etc/newfile': Permission denied\n");
    expect(t.type('rm /etc/hostname')).toBe("rm: cannot remove '/etc/hostname': Permission denied\n");
    expect(t.type('mkdir /opt/x')).toBe("mkdir: cannot create directory '/opt/x': Permission denied\n");
    expect(t.type('chmod 777 /etc/shadow')).toBe("chmod: changing permissions of '/etc/shadow': Operation not permitted\n");
  });

  it('prints the real Linux error messages', () => {
    const t = atDesk(newWorld(), 'l.haddad');
    expect(t.type('cat nope.txt')).toBe('cat: nope.txt: No such file or directory\n');
    expect(t.type('cat Documents')).toBe('cat: Documents: Is a directory\n');
    expect(t.type('ls nope')).toBe("ls: cannot access 'nope': No such file or directory\n");
    expect(t.type('cd todo.txt')).toBe('bash: cd: todo.txt: Not a directory\n');
    expect(t.type('rm Documents')).toBe("rm: cannot remove 'Documents': Is a directory\n");
    expect(t.type('cat todo.txt/x')).toBe('cat: todo.txt/x: Not a directory\n');
  });

  it('chmod changes who can read a file', () => {
    const world = newWorld();
    const lina = atDesk(world, 'l.haddad');
    lina.type('echo secret > /tmp/s.txt');
    lina.type('chmod 600 /tmp/s.txt');
    expect(lina.type('ls -l /tmp/s.txt')).toMatch(/^-rw------- 1 l\.haddad l\.haddad 7 /);

    // k.nasser also has an account on this laptop
    lina.type('su k.nasser');
    lina.type(PW['k.nasser']);
    expect(lina.type('cat /tmp/s.txt')).toBe('cat: /tmp/s.txt: Permission denied\n');
    // /tmp is sticky: you cannot delete other people's files there
    expect(lina.type('rm /tmp/s.txt')).toBe("rm: cannot remove '/tmp/s.txt': Permission denied\n");
    lina.type('exit');
    lina.type('chmod o+r /tmp/s.txt');
    lina.type('su k.nasser');
    lina.type(PW['k.nasser']);
    expect(lina.type('cat /tmp/s.txt')).toBe('secret\n');
  });

  it('tracks modification times', () => {
    const world = newWorld();
    const t = atDesk(world, 'l.haddad');
    t.type('echo one > /tmp/t.txt');
    const first = world.time;
    expect(t.type('stat /tmp/t.txt')).toContain('Modify: 2026-03-02 09:00:0');
    world.time += 60_000;
    t.type('echo two >> /tmp/t.txt');
    const node = world.hosts['HR-LT-03'].fs.children!.tmp.children!['t.txt'];
    expect(node.mtime).toBeGreaterThan(first);
    expect(node.content).toBe('one\ntwo\n');
  });
});
