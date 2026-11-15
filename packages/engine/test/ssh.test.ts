import { describe, expect, it } from 'vitest';
import { queryEvents } from '../src/index';
import { PW, SERVER, Term, atDesk, authLog, newWorld, ssh } from './helpers';

describe('ssh', () => {
  it('asks for a password with masked input and opens a nested session', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    expect(t.prompt).toBe('s.alharbi@FIN-LT-07:~$ ');

    t.type(`ssh s.alharbi@${SERVER}`);
    expect(t.prompt).toBe(`s.alharbi@${SERVER}'s password: `);
    expect(t.last.awaitingInput).toEqual({ masked: true });

    const banner = t.type(PW['s.alharbi']);
    expect(banner).toContain('Welcome to Ubuntu');
    expect(banner).toContain('Last login: Fri Feb 27'); // from the scenario's history
    expect(t.prompt).toBe(`s.alharbi@${SERVER}:~$ `);
    expect(t.last.awaitingInput).toBeUndefined();
    expect(t.type('hostname')).toBe(`${SERVER}\n`);

    expect(t.type('exit')).toBe(`logout\nConnection to ${SERVER} closed.\n`);
    expect(t.prompt).toBe('s.alharbi@FIN-LT-07:~$ ');
    expect(t.type('hostname')).toBe('FIN-LT-07\n');
  });

  it("logs a successful login on the TARGET's auth.log with the correct source IP", () => {
    const world = newWorld();
    const ip = world.hosts['FIN-LT-07'].ip;
    const t = atDesk(world, 's.alharbi');
    const before = authLog(world, SERVER).length;
    ssh(t, 's.alharbi', SERVER);

    const added = authLog(world, SERVER).slice(before);
    expect(added).toMatch(new RegExp(`${SERVER} sshd\\[\\d+\\]: Accepted password for s\\.alharbi from ${ip.replace(/\./g, '\\.')} port \\d+ ssh2`));
    expect(added).toContain('pam_unix(sshd:session): session opened for user s.alharbi(uid=1001) by (uid=0)');
    // nothing is written on the machine the connection came FROM
    expect(authLog(world, 'FIN-LT-07')).not.toContain('Accepted password');

    // last / who / w on the target show the source IP too
    expect(t.type('last -n 1')).toMatch(new RegExp(`^s\\.alharbi\\s+pts/0\\s+${ip.replace(/\./g, '\\.')}\\s+Mon Mar  2 09:00   still logged in`));
    expect(t.type('who')).toContain(`(${ip})`);
    expect(t.type('w')).toContain(ip);

    t.type('exit');
    expect(authLog(world, SERVER).slice(before)).toContain('pam_unix(sshd:session): session closed for user s.alharbi');
    const [event] = queryEvents(world, { type: 'ssh.accept', host: SERVER }).slice(-1);
    expect(event).toMatchObject({ user: 's.alharbi', sourceIp: ip, actor: 'p1' });
  });

  it('logs failed passwords on the target with the source IP, and gives up after three', () => {
    const world = newWorld();
    const ip = world.hosts['FIN-LT-07'].ip;
    const t = atDesk(world, 's.alharbi');
    const before = authLog(world, SERVER).length;

    t.type(`ssh k.nasser@${SERVER}`);
    expect(t.type('guess1')).toBe('Permission denied, please try again.\n');
    expect(t.masked).toBe(true);
    expect(t.type('guess2')).toBe('Permission denied, please try again.\n');
    expect(t.type('guess3')).toBe(`k.nasser@${SERVER}: Permission denied (publickey,password).\n`);
    expect(t.prompt).toBe('s.alharbi@FIN-LT-07:~$ '); // still on our own machine

    const added = authLog(world, SERVER).slice(before);
    expect(added.match(new RegExp(`Failed password for k\\.nasser from ${ip.replace(/\./g, '\\.')} port \\d+ ssh2`, 'g'))).toHaveLength(3);
    expect(added).toContain(`Connection closed by authenticating user k.nasser ${ip}`);
    expect(queryEvents(world, { type: 'ssh.fail', sourceIp: ip, user: 'k.nasser' })).toHaveLength(3);
    // a failed login never appears in `last`
    expect(world.hosts[SERVER].wtmp.filter((w) => w.logout === null && w.user !== 'reboot')).toHaveLength(0);
  });

  it('logs attempts for users that do not exist as "invalid user"', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    t.type(`ssh hacker@${SERVER}`);
    t.type('x');
    expect(authLog(world, SERVER)).toContain(`Failed password for invalid user hacker from ${world.hosts['FIN-LT-07'].ip}`);
  });

  it('when pivoting through another machine, the target only sees the last hop', () => {
    const world = newWorld();
    const fin = world.hosts['FIN-LT-07'].ip;
    const itws = world.hosts['IT-WS-02'].ip;
    const t = atDesk(world, 's.alharbi'); // physically at FIN-LT-07...
    ssh(t, 'k.nasser', 'IT-WS-02'); // ...hops to IT-WS-02 with stolen credentials...
    const before = authLog(world, SERVER).length;
    ssh(t, 'k.nasser', SERVER); // ...and from there to the server
    expect(t.prompt).toBe(`k.nasser@${SERVER}:~$ `);

    const added = authLog(world, SERVER).slice(before);
    expect(added).toContain(`Accepted password for k.nasser from ${itws} port`);
    expect(added).not.toContain(fin);
    // but IT-WS-02's own log does show where the first hop came from
    expect(authLog(world, 'IT-WS-02')).toContain(`Accepted password for k.nasser from ${fin} port`);
    // and the engine knows the truth: it was player p1 all along
    expect(queryEvents(world, { type: 'ssh.accept', host: SERVER }).slice(-1)[0].actor).toBe('p1');

    t.type('exit');
    expect(t.prompt).toBe('k.nasser@IT-WS-02:~$ ');
    t.type('exit');
    expect(t.prompt).toBe('s.alharbi@FIN-LT-07:~$ ');
  });

  it('accepts hostnames, full names and IP addresses; rejects unknown hosts', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    t.type('ssh s.alharbi@admin-srv-01.nexora.local');
    expect(t.masked).toBe(true);
    t.type(PW['s.alharbi']);
    expect(t.type('hostname')).toBe(`${SERVER}\n`);
    t.type('exit');
    t.type('ssh 10.0.1.10');
    expect(t.prompt).toBe("s.alharbi@10.0.1.10's password: ");
    t.type(PW['s.alharbi']);
    t.type('exit');
    expect(t.type('ssh s.alharbi@NOPE-PC')).toBe('ssh: Could not resolve hostname NOPE-PC: Name or service not known\n');
  });

  it('shows the connection and processes on both ends while the session is open', () => {
    const world = newWorld();
    const ip = world.hosts['FIN-LT-07'].ip;
    const t = atDesk(world, 's.alharbi');
    ssh(t, 's.alharbi', SERVER);
    const server = world.hosts[SERVER];
    expect(server.connections).toHaveLength(1);
    expect(server.connections[0]).toMatchObject({ localIp: '10.0.1.10', localPort: 22, peerIp: ip, program: 'sshd' });
    expect(t.type('ss -tn')).toContain(`10.0.1.10:22`);
    expect(t.type('ps aux')).toContain('sshd: s.alharbi@pts/0');
    expect(world.hosts['FIN-LT-07'].processes.some((p) => p.command === `ssh s.alharbi@${SERVER}`)).toBe(true);

    t.type('exit');
    expect(server.connections).toHaveLength(0);
    expect(server.processes.some((p) => p.command.includes('s.alharbi'))).toBe(false);
    expect(world.hosts['FIN-LT-07'].connections).toHaveLength(0);
  });

  it('a session survives the player walking away, for whoever sits down next', () => {
    const world = newWorld();
    const lina = atDesk(world, 'l.haddad');
    ssh(lina, 'l.haddad', SERVER);
    const someoneElse = new Term(world, 'HR-LT-03', 'p4');
    expect(someoneElse.prompt).toBe(`l.haddad@${SERVER}:~$ `);
    expect(someoneElse.type('whoami')).toBe('l.haddad\n');
  });

  it('scp copies a file and leaves a login record on the target', () => {
    const world = newWorld();
    const t = atDesk(world, 's.alharbi');
    const before = authLog(world, SERVER).length;
    t.type(`scp todo.txt s.alharbi@${SERVER}:/tmp/`);
    expect(t.masked).toBe(true);
    expect(t.type(PW['s.alharbi'])).toMatch(/^todo\.txt\s+100%/);
    expect(authLog(world, SERVER).slice(before)).toContain(`Accepted password for s.alharbi from ${world.hosts['FIN-LT-07'].ip}`);

    t.type(`scp s.alharbi@${SERVER}:/srv/shared/README.txt readme-copy.txt`);
    t.type(PW['s.alharbi']);
    expect(t.type('head -n 1 readme-copy.txt')).toBe('Nexora Corp shared folder\n');

    t.type(`scp s.alharbi@${SERVER}:/root/flag.txt .`);
    expect(t.type(PW['s.alharbi'])).toBe('scp: /root/flag.txt: Permission denied\n');
  });
});
