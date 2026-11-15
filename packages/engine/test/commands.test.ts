import { describe, expect, it } from 'vitest';
import { commandNames } from '../src/index';
import { PW, SERVER, atDesk, newWorld, ssh } from './helpers';

const REQUIRED = [
  'whoami', 'id', 'hostname', 'ip', 'pwd', 'cd', 'ls', 'cat', 'head', 'tail', 'less', 'grep', 'find', 'stat', 'file',
  'echo', 'touch', 'mkdir', 'rm', 'cp', 'mv', 'chmod', 'ssh', 'scp', 'exit', 'logout', 'su', 'sudo', 'last', 'who',
  'w', 'history', 'ps', 'kill', 'ss', 'netstat', 'journalctl', 'dmesg', 'crontab', 'ping', 'nslookup', 'clear',
  'help', 'man',
];

describe('command set', () => {
  it('implements every command required for Phase 1, each with a man page', () => {
    const names = commandNames();
    const t = atDesk(newWorld(), 'l.haddad');
    for (const name of REQUIRED) {
      expect(names, name).toContain(name);
      expect(t.type(`man ${name}`), name).toContain('NAME\n');
    }
    expect(t.type('man nosuch')).toBe('No manual entry for nosuch\n');
    expect(t.type('help')).toContain('journalctl');
  });
});

describe('identity and network commands', () => {
  it('whoami / id / hostname / pwd', () => {
    const world = newWorld();
    const t = atDesk(world, 'k.nasser');
    expect(t.type('whoami')).toBe('k.nasser\n');
    expect(t.type('id')).toBe('uid=1005(k.nasser) gid=1005(k.nasser) groups=1005(k.nasser),4(adm),27(sudo)\n');
    expect(t.type('hostname')).toBe('IT-WS-02\n');
    expect(t.type('hostname -I')).toBe(`${world.hosts['IT-WS-02'].ip} \n`);
    expect(t.type('pwd')).toBe('/home/k.nasser\n');
  });

  it('ping and nslookup use the internal DNS', () => {
    const world = newWorld();
    const t = atDesk(world, 'l.haddad');
    const out = t.type('ping -c 2 FIN-LT-07');
    expect(out).toContain(`PING FIN-LT-07 (${world.hosts['FIN-LT-07'].ip}) 56(84) bytes of data.`);
    expect(out).toContain('2 packets transmitted, 2 received, 0% packet loss');
    expect(t.type('ping -c 1 nowhere')).toBe('ping: nowhere: Name or service not known\n');

    expect(t.type('nslookup IT-WS-02')).toContain(`Name:\tIT-WS-02.nexora.local\nAddress: ${world.hosts['IT-WS-02'].ip}\n`);
    expect(t.type('nslookup 10.0.1.10')).toContain('name = ADMIN-SRV-01.nexora.local.');
    expect(t.type('nslookup nowhere')).toContain("** server can't find nowhere: NXDOMAIN");
  });

  it('ss and netstat list listening services and connections', () => {
    const world = newWorld();
    const t = atDesk(world, 'k.nasser');
    ssh(t, 'k.nasser', SERVER);
    expect(t.type('ss -tnp')).not.toContain('LISTEN');
    t.type('sudo ss -tanp');
    const all = t.type(PW['k.nasser']);
    expect(all).toMatch(/LISTEN\s+0\s+128\s+0\.0\.0\.0:22\s+0\.0\.0\.0:\*\s+users:\(\("sshd",pid=\d+,fd=3\)\)/);
    expect(all).toMatch(new RegExp(`ESTAB\\s+0\\s+0\\s+10\\.0\\.1\\.10:22\\s+${world.hosts['IT-WS-02'].ip}:\\d+\\s+users:\\(\\("sshd"`));
    expect(t.type('sudo netstat -tlnp')).toMatch(/tcp\s+0\s+0 0\.0\.0\.0:53\s+0\.0\.0\.0:\*\s+LISTEN\s+\d+\/named/);
  });
});

describe('process commands', () => {
  it('ps aux shows system and session processes', () => {
    const t = atDesk(newWorld(), 'l.haddad');
    const out = t.type('ps aux');
    expect(out.split('\n')[0]).toBe('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND');
    expect(out).toMatch(/root\s+1\s+0\.0\s+0\.1\s+167744\s+11532 \?\s+Ss\s+Feb27\s+0:00 \/sbin\/init splash/);
    expect(out).toContain('sshd: /usr/sbin/sshd -D [listener]');
    expect(out).toMatch(/l\.haddad\s+\d+ .* tty1 .* -bash/);
    expect(out).toContain('ps aux');
    expect(t.type('ps')).toMatch(/^\s+PID TTY\s+TIME CMD\n\s*\d+ tty1\s+00:00:00 login\n\s*\d+ tty1\s+00:00:00 bash\n\s*\d+ tty1\s+00:00:00 ps\n$/);
  });

  it('kill enforces ownership; root killing sshd stops new ssh logins', () => {
    const world = newWorld();
    const t = atDesk(world, 'k.nasser');
    const sshd = world.hosts['IT-WS-02'].services.find((s) => s.port === 22)!.pid;
    expect(t.type(`kill ${sshd}`)).toBe(`bash: kill: (${sshd}) - Operation not permitted\n`);
    expect(t.type('kill 99999')).toBe('bash: kill: (99999) - No such process\n');
    t.type(`sudo kill ${sshd}`);
    t.type(PW['k.nasser']);
    const other = atDesk(world, 'l.haddad');
    expect(other.type('ssh k.nasser@IT-WS-02')).toBe('ssh: connect to host IT-WS-02 port 22: Connection refused\n');
  });
});

describe('log commands', () => {
  it('journalctl needs group adm; supports -n, -u and -k', () => {
    const world = newWorld();
    const t = atDesk(world, 'l.haddad');
    expect(t.type('journalctl -n 2').trimEnd().split('\n')).toHaveLength(2);
    expect(t.type('journalctl -u ssh -n 50')).toContain('sshd[');
    expect(t.type('journalctl -k')).toContain('kernel: Linux version 5.15.0-105-generic');
    expect(t.type('dmesg')).toMatch(/^\[\s+0\.000000\] Linux version/);

    ssh(t, 'l.haddad', SERVER); // not in adm on the server
    expect(t.type('journalctl -n 5')).toContain('-- No entries --');
  });

  it('auth.log already contains history when the game starts', () => {
    const t = atDesk(newWorld(), 'k.nasser');
    ssh(t, 'k.nasser', SERVER);
    const fails = t.type('grep "Failed password" /var/log/auth.log');
    expect(fails).toContain('Failed password for invalid user admin from 10.0.2.71');
    expect(fails).toContain('Failed password for r.mansour from');
    expect(t.type('grep -c "Accepted password" /var/log/auth.log')).toBe('5\n');
    expect(t.type('last | grep -c pts')).toBe('5\n');
  });

  it('crontab -l', () => {
    const t = atDesk(newWorld(), 'k.nasser');
    expect(t.type('crontab -l')).toContain('0 8 * * 1-5 /home/k.nasser/scripts/check-disk.sh');
    ssh(t, 'k.nasser', SERVER);
    expect(t.type('crontab -l')).toBe('no crontab for k.nasser\n');
    t.type('sudo crontab -l');
    expect(t.type(PW['k.nasser'])).toContain('/opt/backup/backup.sh');
  });
});

describe('file commands', () => {
  it('ls formats', () => {
    const t = atDesk(newWorld(), 'l.haddad');
    expect(t.type('ls')).toBe('Documents  todo.txt\n');
    expect(t.type('ls -a')).toBe('.  ..  .bash_history  .bash_logout  .bashrc  Documents  .profile  todo.txt\n');
    const long = t.type('ls -la').split('\n');
    expect(long[0]).toMatch(/^total \d+$/);
    expect(long[1]).toMatch(/^drwxr-x--- 3 l\.haddad l\.haddad 4096 .* \.$/);
    expect(long.find((l) => l.endsWith('employees.csv'))).toBeUndefined();
    expect(t.type('ls -l Documents/employees.csv')).toMatch(/^-rw------- 1 l\.haddad l\.haddad \d+ Feb 27 09:20 Documents\/employees\.csv\n$/);
    expect(t.type('ls -ld /tmp')).toMatch(/^drwxrwxrwt \d+ root root 4096 /);
  });

  it('head, tail, grep flags, find, stat, file', () => {
    const t = atDesk(newWorld(), 'l.haddad');
    expect(t.type('head -n 1 Documents/employees.csv')).toBe('username,full_name,department,title,desk\n');
    expect(t.type('tail -n 1 Documents/employees.csv')).toContain('k.nasser,Khalid Nasser');
    expect(t.type('head -2 todo.txt | tail -1')).toContain('LOCK YOUR SCREENS');
    expect(t.type('grep -i FINANCE Documents/employees.csv | wc -l')).toBe('2\n');
    expect(t.type('grep -v Finance Documents/employees.csv | wc -l')).toBe('4\n');
    expect(t.type('grep -n Marketing Documents/employees.csv')).toMatch(/^5:o\.farouk/);
    // .bash_history matches too: it contains "cat Documents/onboarding_checklist.txt"
    expect(t.type('grep -rl onboarding .')).toBe('./.bash_history\n./Documents/onboarding_checklist.txt\n./todo.txt\n');
    expect(t.type('grep zzz todo.txt; echo $?')).toBe('1\n');
    expect(t.type('find . -name "*.csv"')).toBe('./Documents/employees.csv\n');
    expect(t.type('find Documents -type f | wc -l')).toBe('3\n');
    expect(t.type('find / -name flag.txt')).toContain('find: ‘/root’: Permission denied');
    const stat = t.type('stat todo.txt');
    expect(stat).toContain('  File: todo.txt\n');
    expect(stat).toMatch(/Access: \(0644\/-rw-r--r--\)\s+Uid: \( 1003\/l\.haddad\)/);
    expect(t.type('file todo.txt Documents /usr/bin/ls Documents/employees.csv')).toBe(
      'todo.txt: ASCII text\nDocuments: directory\n/usr/bin/ls: ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, stripped\nDocuments/employees.csv: CSV text\n',
    );
  });

  it('touch, mkdir, cp, mv, rm', () => {
    const t = atDesk(newWorld(), 'l.haddad');
    t.type('mkdir -p work/a/b');
    t.type('touch work/a/new.txt');
    t.type('cp todo.txt work/copy.txt');
    t.type('cp -r Documents work/docs');
    t.type('mv work/copy.txt work/renamed.txt');
    expect(t.type('ls work work/docs')).toBe('work:\na  docs  renamed.txt\n\nwork/docs:\nemployees.csv  leave_requests.txt  onboarding_checklist.txt\n');
    expect(t.type('cp Documents work/x')).toBe("cp: -r not specified; omitting directory 'Documents'\n");
    expect(t.type('mkdir work')).toBe("mkdir: cannot create directory 'work': File exists\n");
    expect(t.type('rm work')).toBe("rm: cannot remove 'work': Is a directory\n");
    expect(t.type('rm -rf work; ls')).toBe('Documents  todo.txt\n');
    expect(t.type('rm -f nothing-here')).toBe('');
    expect(t.type('mv nothing-here x')).toBe("mv: cannot stat 'nothing-here': No such file or directory\n");
  });

  it('clear sends the terminal clear sequence', () => {
    expect(atDesk(newWorld(), 'l.haddad').type('clear')).toBe('\x1b[H\x1b[2J\x1b[3J');
  });
});
