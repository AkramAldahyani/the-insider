/**
 * Phase 6, part H: one player must not be able to freeze, fill up or damage
 * the simulation, whatever they type.
 */
import { describe, expect, it } from 'vitest';
import { commandNames } from '../src/index';
import { MAX_FILE, MAX_HOST_NODES, MAX_SCREEN } from '../src/core/limits';
import { literal, pattern, wildcard } from '../src/core/pattern';
import { bytesIn, getNode, nodesIn } from '../src/fs/vfs';
import { sysWrite } from '../src/fs/vfs';
import { PW, ROOT_PW, SERVER, Term, newWorld } from './helpers';

/** A small random number generator, so that a failure can be repeated. */
function random(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return Math.floor((s / 2 ** 32) * n);
  };
}
const took = (run: () => void): number => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

describe('search patterns', () => {
  it('finds the same as JavaScript, for thousands of random patterns', () => {
    const r = random(7);
    const atoms = ['a', 'b', 'c', '.', '\\.', '[ab]', '[^a]', '[a-c]', '\\w', '\\d', '\\s', '1', ' ', '-', 'A', '\\W', '[\\w.]', '\\b', '^', '$', '[0-9]'];
    const build = (depth: number): string => {
      let out = '';
      for (let i = 0, n = 1 + r(3); i < n; i++) {
        let atom = depth > 0 && r(4) === 0 ? `(${build(depth - 1)}${r(3) === 0 ? `|${build(depth - 1)}` : ''})` : atoms[r(atoms.length)];
        if (r(3) === 0 && !['\\b', '^', '$'].includes(atom)) atom += ['*', '+', '?', '{2}', '{1,2}', '{0,}'][r(6)];
        out += atom;
      }
      return out;
    };
    const letters = ['a', 'b', 'c', 'A', '1', ' ', '.', '-', 'z', '_'];
    let compared = 0;
    for (let i = 0; i < 4000; i++) {
      const source = build(2);
      const ignoreCase = r(4) === 0;
      const mine = pattern(source, ignoreCase);
      expect(mine, source).not.toBeNull();
      const js = new RegExp(source, ignoreCase ? 'i' : '');
      for (let k = 0; k < 5; k++) {
        const text = Array.from({ length: r(9) }, () => letters[r(letters.length)]).join('');
        expect(mine!.test(text), `/${source}/${ignoreCase ? 'i' : ''} on "${text}"`).toBe(js.test(text));
        compared++;
      }
    }
    expect(compared).toBe(20_000);
  });

  it('knows what grep -E is used for', () => {
    const m = (source: string, text: string, i = false) => pattern(source, i)!.test(text);
    expect(m('Failed password for (invalid user )?\\w+', 'sshd: Failed password for invalid user bob')).toBe(true);
    expect(m('^Mar +2 09:(1[0-9]|20):', 'Mar  2 09:17:03 x')).toBe(true);
    expect(m('^Mar +2 09:(1[0-9]|20):', 'Mar  2 09:21:03 x')).toBe(false);
    expect(m('([0-9]{1,3}\\.){3}[0-9]{1,3}', 'from 10.0.2.37 port 1')).toBe(true);
    expect(m('[[:digit:]]+[[:space:]]x', '42 x')).toBe(true);
    expect(m('ERROR|warning', 'a WARNING', true)).toBe(true);
    expect(m('\\bsu\\b', 'sudo su -')).toBe(true);
    expect(m('a{2', 'xa{2y')).toBe(true); // not a repeat: ordinary characters
    expect(m('[]', 'x')).toBe(false);
    expect(m('', 'anything')).toBe(true);
    for (const bad of ['(', 'a)', '[a', '*a', 'a**', '(?=x)', '(?<n>x)', '(a)\\1', '\\', 'a{5,2}', '(((a{100}){100}){100})', '('.repeat(20_000)]) expect(pattern(bad), bad.slice(0, 20)).toBeNull();
    expect(literal('a.b*', false).test('xa.b*x')).toBe(true);
    expect(literal('ABC', true).test('xabcx')).toBe(true);
  });

  it('hostile patterns take no time', () => {
    const line = 'a'.repeat(5000);
    for (const source of ['(a+)+$', '(a|a)*b', '(a*)*b', '(.*)*x', '.*.*.*.*.*.*.*x', '(a?){50}a{50}b', '(\\w+\\s?)+$', '([a-zA-Z]+)*1', '(.*a){20}b']) {
      const m = pattern(source)!;
      expect(took(() => m.test(`${line}!`)), source).toBeLessThan(1500);
    }
    const stars = wildcard('*a'.repeat(50) + '*b');
    expect(took(() => stars.test(line))).toBeLessThan(500);
  });

  it('wildcards: whole names, as in a shell', () => {
    const w = (p: string, t: string, i = false) => wildcard(p, { ignoreCase: i }).test(t);
    expect([w('*.txt', 'a.txt'), w('*.txt', 'a.txt.bak'), w('a?c', 'abc'), w('a?c', 'ac'), w('*', ''), w('a*b*c', 'aXbYbc'), w('**', 'x'), w('A*', 'abc', true), w('', ''), w('', 'x')]).toEqual([true, false, true, false, true, true, true, true, true, false]);
    expect(wildcard('10.0.2.*', { question: false }).test('10.0.2.37')).toBe(true);
    expect(wildcard('a?', { question: false }).test('ab')).toBe(false);
    expect(wildcard('a.c').test('abc')).toBe(false);
  });

  it('at the terminal: grep, find and siem answer at once', () => {
    const t = new Term(newWorld(), 'FIN-LT-07');
    t.type(PW['s.alharbi']);
    t.type(`echo ${'a'.repeat(1900)} > long.txt`);
    expect(took(() => t.type("grep -E '(a+)+$' long.txt"))).toBeLessThan(1500);
    expect(t.type("grep -E '(a|aa)+!' long.txt")).toBe('');
    expect(took(() => t.type(`find / -name '${'*a'.repeat(200)}*z'`))).toBeLessThan(1500);
    expect(took(() => t.type(`ls ${'*a'.repeat(100)}*`))).toBeLessThan(1500);
    expect(took(() => t.type('grep -A 999999999 -B 999999999 a /etc/passwd'))).toBeLessThan(1500);
  });
});

describe('nobody can fill up the memory', () => {
  const sara = () => {
    const t = new Term(newWorld(), 'FIN-LT-07');
    t.type(PW['s.alharbi']);
    return t;
  };
  it('a file cannot be doubled for ever', () => {
    const t = sara();
    t.type(`echo ${'x'.repeat(1500)} > a`);
    let said = '';
    for (let i = 0; i < 30; i++) said += t.type('cat a a a a a a a a > b; cat b > a');
    expect(said).toContain('File too large');
    const home = getNode(t.world.hosts['FIN-LT-07'], '/home/s.alharbi')!;
    expect(bytesIn(home)).toBeLessThan(4 * MAX_FILE);
    expect(took(() => t.type('cat a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a > c'))).toBeLessThan(1500);
    for (let i = 0; i < 5; i++) t.type('cp a f$i; cat a >> a; cat a a >> a');
    expect(bytesIn(home)).toBeLessThan(6 * MAX_FILE);
  });

  it('nor thousands of files and directories made', () => {
    const t = sara();
    const host = t.world.hosts['FIN-LT-07'];
    const start = nodesIn(host.fs);
    expect(t.type(`touch ${Array.from({ length: 400 }, (_, i) => `f${i}`).join(' ')}`)).toContain('Argument list too long');
    let said = '';
    for (let n = 0; n < 60; n++) said += t.type(`mkdir d${n} && cd d${n} && touch ${Array.from({ length: 90 }, (_, i) => `f${i}`).join(' ')}; cd ~`);
    expect(said).toContain('No space left on device');
    expect(nodesIn(host.fs)).toBeLessThanOrEqual(MAX_HOST_NODES);
    expect(t.type('cp -r d0 copy')).toContain('No space left on device');
    // The system itself still works, and cleaning up makes room.
    sysWrite(host, '/var/log/test.log', 'line\n', { time: t.world.time });
    expect(getNode(host, '/var/log/test.log')?.content).toBe('line\n');
    for (let n = 0; n < 60; n++) t.type(`rm -r d${n}`);
    expect(nodesIn(host.fs)).toBeLessThan(start + 300);
    expect(t.type('mkdir again && ls -d again')).toContain('again');
  });

  it('a huge output shows its end, and a line can only read so much', () => {
    const t = sara();
    t.type(`echo ${'y'.repeat(1000)} > a`);
    for (let i = 0; i < 7; i++) t.type('cat a a > b; cat b > a');
    const out = t.type('cat a a a a a a; echo the end');
    expect(out.length).toBeLessThan(MAX_SCREEN + 100);
    expect(out.startsWith('[...]\n')).toBe(true);
    expect(out).toContain('the end');
    expect(t.type(`cat ${Array(150).fill('a').join(' ')} | wc -c; cat a | wc -l`)).toContain('Cannot allocate memory');
    // The next line can read again.
    expect(t.type('head -n 1 a | wc -c').trim()).toBe('1001');
  });

  it('ordinary work is far below all limits', () => {
    const world = newWorld();
    for (const host of Object.values(world.hosts)) {
      expect(nodesIn(host.fs)).toBeLessThan(MAX_HOST_NODES / 10);
      expect(bytesIn(host.fs)).toBeLessThan(1024 * 1024);
    }
  });
});

describe('names that mean something to JavaScript', () => {
  const NAMES = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype'];
  it('are ordinary names: nothing gets hold of the objects behind them', () => {
    const t = new Term(newWorld(), 'IT-WS-02', 'p5');
    t.type(PW['k.nasser']);
    const before = [Object.keys(Object.prototype), Object.getOwnPropertyNames(Object.prototype).length, Object.getOwnPropertyNames(Object).length];
    for (const name of NAMES) {
      for (const line of [`ls -l ${name}`, `cat ${name}`, `cat /${name}/x`, `mkdir ${name}`, `touch ${name}`, `echo x > ${name}`, `cp /etc/hostname ${name}`, `mv ${name} other`, `rm -r ${name}`, name, `${name} x`, `man ${name}`, `ssh ${name}`, `ping -c 1 ${name}`, `echo $${name}`, `mail ${name}`, `su ${name}`, `siem ${name}=x`, `siem * | count by ${name}`, `file x.${name}`, `id ${name}`, `kill ${name}`, `curl http://${name}/`, `nslookup ${name}`, `grep -E '[[:${name}:]]' /etc/passwd`, `chmod 777 ${name}`, `chown root ${name}`]) {
        expect(t.type(line), line).not.toMatch(/internal simulation error|native code|\[object/);
        t.type('');
      }
    }
    // As root too.
    const s = new Term(t.world, 'FIN-LT-07', 'p1');
    s.type(PW['s.alharbi']);
    s.type(`ssh s.alharbi@${SERVER}`);
    s.type(PW['s.alharbi']);
    s.type('su');
    s.type(ROOT_PW);
    expect(s.type('whoami')).toContain('root');
    for (const name of NAMES) for (const line of [`chmod 777 /${name}`, `chown root:root /${name}`, `touch /${name}`, `rm -r /${name}`, `mv /etc/hostname /${name}; mv /${name} /etc/hostname`]) expect(s.type(line)).not.toContain('internal simulation error');
    expect([Object.keys(Object.prototype), Object.getOwnPropertyNames(Object.prototype).length, Object.getOwnPropertyNames(Object).length]).toEqual(before);
    expect(({} as { mode?: number }).mode).toBeUndefined();
    expect(() => JSON.parse(JSON.stringify(t.world))).not.toThrow();
  });

  it('a file called "constructor" can be written and read', () => {
    const t = new Term(newWorld(), 'FIN-LT-07');
    t.type(PW['s.alharbi']);
    expect(t.type('echo hello > constructor; cat constructor; ls')).toMatch(/hello[\s\S]*constructor/);
    expect(t.type('mkdir __proto__')).toContain('Operation not permitted');
  });
});

it('random nonsense never breaks a command', () => {
  const r = random(11);
  const t = new Term(newWorld(), 'SOC-WS-01', 'p11');
  t.type(PW[t.world.players.find((p) => p.id === 'p11')!.account]);
  const words = ['-l', '-la', '-n', '-r', '-E', '--', '-', '*', '?', '/', '..', '/etc/passwd', '/var/log', '~', '$HOME', '"', "'", '\\', '|', '>', '>>', '<', '2>&1', '&&', '||', ';', '0', '-1', '1e309', 'NaN', '999999999999', 'k.nasser', 'ADMIN-SRV-01', '10.0.2.10', 'a'.repeat(300), '{}', '[]', '()', '%s', 'é漢🙂', '\u0000', '$(ls)', '`ls`', 'count', 'by', 'where', '=', 'source=auth', 'since=99:99', '@', 'root@', ':', 'http://', 'file://x', '+x', '777', '99999'];
  const names = commandNames().filter((n) => !['exit', 'logout'].includes(n));
  for (let i = 0; i < 6000; i++) {
    const line = [names[r(names.length)], ...Array.from({ length: r(6) }, () => words[r(words.length)])].join(' ');
    const out = t.type(line);
    expect(out, line).not.toContain('internal simulation error');
    if (t.last.awaitingInput) t.type(''); // a question: answer with nothing
    if (t.last.screen !== 'shell') {
      t.type(PW[t.world.players.find((p) => p.id === 'p11')!.account]);
      if (t.last.screen !== 'shell') break;
    }
  }
  expect(Object.keys(Object.prototype)).toEqual([]);
}, 60_000);
