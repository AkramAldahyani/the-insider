import { describe, expect, it } from 'vitest';
import { parse } from '../src/shell/parser';
import { Term, atDesk, newWorld } from './helpers';

/** Lina's PC is unlocked at the start, which makes it handy for shell tests. */
const lina = (): Term => atDesk(newWorld(), 'l.haddad');

describe('pipes', () => {
  it('connects commands', () => {
    const t = lina();
    expect(t.type('echo hello | grep -c hello')).toBe('1\n');
    expect(t.type('cat todo.txt | grep -i lock | wc -l')).toBe('1\n');
    expect(t.type('cat /etc/passwd | grep -v nologin | grep -n bash | head -n 1')).toBe('1:root:x:0:0:root:/root:/bin/bash\n');
    expect(t.type('ls Documents | sort -r | head -n 1')).toBe('onboarding_checklist.txt\n');
  });

  it('only stdout goes through the pipe; errors still reach the screen', () => {
    const t = lina();
    expect(t.type('cat nope.txt | wc -l')).toBe('cat: nope.txt: No such file or directory\n0\n');
  });
});

describe('redirection', () => {
  it('> overwrites and >> appends', () => {
    const t = lina();
    expect(t.type('echo a > /tmp/f.txt')).toBe('');
    t.type('echo b >> /tmp/f.txt');
    expect(t.type('cat /tmp/f.txt')).toBe('a\nb\n');
    t.type('echo c > /tmp/f.txt');
    expect(t.type('cat /tmp/f.txt')).toBe('c\n');
  });

  it('works at the end of a pipeline and with input redirection', () => {
    const t = lina();
    t.type('grep -c x /etc/passwd > /tmp/count.txt');
    expect(Number(t.type('cat /tmp/count.txt'))).toBeGreaterThan(5);
    expect(t.type('wc -l < /tmp/count.txt')).toBe('1\n');
    t.type('cat Documents/employees.csv | grep Finance | wc -l > /tmp/fin.txt');
    expect(t.type('cat /tmp/fin.txt')).toBe('2\n');
  });

  it('2> and 2>&1 handle error output', () => {
    const t = lina();
    expect(t.type('ls /root 2>/dev/null')).toBe('');
    expect(t.type('find /home -name "*.csv" 2>/dev/null')).toBe('/home/l.haddad/Documents/employees.csv\n');
    t.type('cat nope.txt > /tmp/both.txt 2>&1');
    expect(t.type('cat /tmp/both.txt')).toBe('cat: nope.txt: No such file or directory\n');
    expect(t.type('cat nope.txt 2>&1 | grep -c "No such"')).toBe('1\n');
  });

  it('reports a file that cannot be written and does not run the command', () => {
    const t = lina();
    expect(t.type('echo x > /etc/motd')).toBe('bash: /etc/motd: Permission denied\n');
    expect(t.type('echo x > /nope/file')).toBe('bash: /nope/file: No such file or directory\n');
  });
});

describe('; && ||', () => {
  it('runs in sequence and respects exit codes', () => {
    const t = lina();
    expect(t.type('echo a; echo b')).toBe('a\nb\n');
    expect(t.type('true && echo yes')).toBe('yes\n');
    expect(t.type('false && echo yes')).toBe('');
    expect(t.type('false || echo fallback')).toBe('fallback\n');
    expect(t.type('cat nope.txt 2>/dev/null && echo found || echo missing; echo end')).toBe('missing\nend\n');
    expect(t.type('cd Documents && pwd')).toBe('/home/l.haddad/Documents\n');
    expect(t.type('false; echo $?')).toBe('1\n');
    expect(t.type('nosuchcmd; echo $?')).toBe('bash: nosuchcmd: command not found\n127\n');
  });
});

describe('quotes, ~ and variables', () => {
  it('handles quoting like bash', () => {
    const t = lina();
    expect(t.type('echo "a   b" c')).toBe('a   b c\n');
    expect(t.type("echo 'single $HOME *'")).toBe('single $HOME *\n');
    expect(t.type('echo "home is $HOME"')).toBe('home is /home/l.haddad\n');
    expect(t.type('echo a\\ b "say \\"hi\\""')).toBe('a b say "hi"\n');
    expect(t.type('echo "a;b|c>d"')).toBe('a;b|c>d\n');
    expect(t.type('echo one # a comment')).toBe('one\n');
    expect(t.type('grep -c "HR Specialist" Documents/employees.csv')).toBe('1\n');
  });

  it('expands ~ and $VARS', () => {
    const t = lina();
    expect(t.type('echo ~ ~/Documents $USER')).toBe('/home/l.haddad /home/l.haddad/Documents l.haddad\n');
    expect(t.type('echo ~k.nasser "~"')).toBe('/home/k.nasser ~\n');
    t.type('cd /tmp');
    expect(t.prompt).toBe('l.haddad@HR-LT-03:/tmp$ ');
    expect(t.type('ls ~/todo.txt')).toBe('/home/l.haddad/todo.txt\n');
    t.type('cd ~/Documents');
    expect(t.prompt).toBe('l.haddad@HR-LT-03:~/Documents$ ');
    expect(t.type('cd -')).toBe('/tmp\n');
    t.type('cd');
    expect(t.prompt).toBe('l.haddad@HR-LT-03:~$ ');
  });
});

describe('globs', () => {
  it('expands * and ? to matching file names', () => {
    const t = lina();
    expect(t.type('echo Documents/*.txt')).toBe('Documents/leave_requests.txt Documents/onboarding_checklist.txt\n');
    expect(t.type('echo Doc*/emp?oyees.csv')).toBe('Documents/employees.csv\n');
    expect(t.type('echo /home/*/todo.txt')).toBe('/home/l.haddad/todo.txt\n');
    expect(t.type('wc -l Documents/*.txt | tail -n 1')).toBe('7 total\n');
  });

  it('does not match hidden files, leaves non-matching patterns alone, and ignores quoted stars', () => {
    const t = lina();
    expect(t.type('echo *')).toBe('Documents todo.txt\n');
    expect(t.type('echo .bash*')).toBe('.bash_history .bash_logout .bashrc\n');
    expect(t.type('echo *.nomatch')).toBe('*.nomatch\n');
    expect(t.type('echo "*"')).toBe('*\n');
    expect(t.type('ls *.nomatch')).toBe("ls: cannot access '*.nomatch': No such file or directory\n");
  });
});

describe('errors', () => {
  it('unknown command', () => {
    expect(lina().type('foo --bar')).toBe('bash: foo: command not found\n');
  });

  it('syntax errors do not crash anything', () => {
    const t = lina();
    expect(t.type('ls |')).toBe('bash: syntax error: unexpected end of file\n');
    expect(t.type('| ls')).toBe("bash: syntax error near unexpected token `|'\n");
    expect(t.type('echo "unterminated')).toContain('unexpected EOF while looking for matching');
    expect(t.type('echo ok')).toBe('ok\n');
    expect(t.type('')).toBe('');
    expect(t.type('   ')).toBe('');
  });

  it('the parser produces a plain-JSON tree', () => {
    const tree = parse('a | b > f ; c && d');
    expect(tree.map((i) => [i.pipeline.length, i.next])).toEqual([[2, ';'], [1, '&&'], [1, null]]);
    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
  });
});

describe('prompt', () => {
  it('uses # for root and $ for everyone else, with ~ for the home directory', () => {
    const t = lina();
    expect(t.prompt).toBe('l.haddad@HR-LT-03:~$ ');
    t.type('cd /var/log');
    expect(t.prompt).toBe('l.haddad@HR-LT-03:/var/log$ ');
  });
});
