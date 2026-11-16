/**
 * Phase 4, part B: the toolkit mechanism (tool files in ~/.tools, cooldowns,
 * background jobs, the master-log record) with its one harmless tool,
 * `selftest`.
 */
import { describe, expect, it } from 'vitest';
import { TOOLS, advanceTime, createWorld, deserializeWorld, queryEvents, serializeWorld, setHacker, toolAt } from '../src/index';
import { PW, SERVER, Term, atDesk, fileOn, scenario, ssh } from './helpers';

const SECOND = 1000;
const START = Date.parse(scenario.startTime);
const LOOT = '/home/o.farouk/.tools/loot/selftest.txt';

/** A plain office where Omar (p4) is the hacker, sitting at his own unlocked PC. */
function hackerAtDesk() {
  const world = createWorld(scenario, 1);
  setHacker(world, 'p4');
  return { world, omar: atDesk(world, 'o.farouk') };
}

describe('every tool', () => {
  it('declares the traces it leaves, a usage line and a noise level', () => {
    expect(TOOLS.length).toBeGreaterThan(0);
    for (const tool of TOOLS) {
      expect(tool.traces.length, tool.name).toBeGreaterThan(0); // "there is no perfect crime"
      expect(tool.usage.startsWith(tool.name), tool.name).toBe(true);
      expect(['quiet', 'low', 'loud']).toContain(tool.noise);
    }
  });
});

describe('tool files', () => {
  it('the hacker has one executable file per tool, private to them, and a README that lists them', () => {
    const { world, omar } = hackerAtDesk();
    const listing = omar.type('ls -l .tools');
    for (const tool of TOOLS) {
      expect(listing).toMatch(new RegExp(`-rwx------ .* o\\.farouk o\\.farouk .* ${tool.name}\\n`));
      expect(toolAt(world.hosts['MKT-LT-11'], `/home/o.farouk/.tools/${tool.name}`)).toBe(tool.name);
    }
    expect(omar.type('cat .tools/README')).toContain('~/.tools/selftest [--long]');
    expect(omar.type('cat .tools/selftest')).toContain('# toolkit: selftest');
  });

  it('can be run by path, from anywhere, but not by bare name', () => {
    const { world, omar } = hackerAtDesk();
    expect(omar.type('~/.tools/selftest')).toContain('selftest: toolkit OK on MKT-LT-11 (running as o.farouk)');
    advanceTime(world, 10 * SECOND); // (the cooldown)
    expect(omar.type('.tools/selftest')).toContain('toolkit OK');
    advanceTime(world, 10 * SECOND);
    omar.type('cd /tmp');
    expect(omar.type('/home/o.farouk/.tools/selftest')).toContain('toolkit OK');
    expect(omar.type('selftest')).toContain('bash: selftest: command not found');
  });

  it('other employees cannot run them, and ordinary scripts still do not run', () => {
    const { world } = hackerAtDesk();
    const khalid = atDesk(world, 'k.nasser');
    ssh(khalid, 'k.nasser', 'MKT-LT-11');
    expect(khalid.type('/home/o.farouk/.tools/selftest')).toContain('Permission denied');
    // A copy without the execute bit does not run either.
    const omar = new Term(world, 'MKT-LT-11', 'p4');
    omar.type('cp .tools/selftest /tmp/st');
    omar.type('chmod 644 /tmp/st');
    expect(omar.type('/tmp/st')).toContain('Permission denied');
    // A normal script is not a tool.
    omar.type('echo "echo hi" > /tmp/hi.sh');
    omar.type('chmod 755 /tmp/hi.sh');
    expect(omar.type('/tmp/hi.sh')).toContain('programs and scripts cannot be executed in this simulation');
  });

  it('a plain employee has no tools folder at all', () => {
    const { world } = hackerAtDesk();
    expect(atDesk(world, 's.alharbi').type('ls -a')).not.toContain('.tools');
    expect(fileOn(world, 'FIN-LT-07', '/home/s.alharbi/.tools/selftest')).toBe('');
  });

  it('the tools are on the hacker\'s own PC only: after ssh to the server they are not there', () => {
    const { omar } = hackerAtDesk();
    ssh(omar, 'o.farouk', SERVER);
    expect(omar.type('~/.tools/selftest')).toContain('No such file or directory');
  });
});

describe('running a tool', () => {
  it('is recorded in the master log with the account, the host and the player at the keyboard', () => {
    const { world, omar } = hackerAtDesk();
    omar.type('~/.tools/selftest');
    expect(queryEvents(world, { type: 'tool.run', since: START })).toMatchObject([{
      host: 'MKT-LT-11', user: 'o.farouk', actor: 'p4', origin: 'physical',
      details: { tool: 'selftest', args: [], noise: 'quiet', background: false, path: '/home/o.farouk/.tools/selftest' },
    }]);
  });

  it('is in the shell history, like any command (a trace defenders can find)', () => {
    const { world, omar } = hackerAtDesk();
    omar.type('~/.tools/selftest');
    expect(omar.type('history | tail -n 2')).toContain('~/.tools/selftest');
    omar.type('exit');
    expect(fileOn(world, 'MKT-LT-11', '/home/o.farouk/.bash_history')).toContain('~/.tools/selftest');
  });

  it('has a cooldown per player', () => {
    const { world, omar } = hackerAtDesk();
    omar.type('~/.tools/selftest');
    const again = omar.type('~/.tools/selftest');
    expect(again).toMatch(/selftest: still cooling down \(\d+ s left\)/);
    expect(omar.last.output).not.toContain('toolkit OK');
    expect(queryEvents(world, { type: 'tool.run', since: START })).toHaveLength(1);
    advanceTime(world, 10 * SECOND);
    expect(omar.type('~/.tools/selftest')).toContain('toolkit OK');
  });
});

describe('background jobs', () => {
  it('a long run is a visible process, then writes its result to loot and disappears', () => {
    const { world, omar } = hackerAtDesk();
    const started = omar.type('~/.tools/selftest --long');
    expect(started).toContain('running the long self-test in the background');
    const pid = Number(/^\[1\] (\d+)$/m.exec(started)![1]);
    expect(omar.type('ps aux')).toMatch(new RegExp(`o\\.farouk +${pid} .* /home/o\\.farouk/\\.tools/selftest --long`));
    expect(fileOn(world, 'MKT-LT-11', LOOT)).toBe('');

    advanceTime(world, 31 * SECOND);
    expect(omar.type('cat ~/.tools/loot/selftest.txt')).toContain('self-test passed on MKT-LT-11');
    expect(omar.type('ps aux')).not.toContain('selftest --long');
    expect(queryEvents(world, { type: 'tool.done', since: START })).toMatchObject([{ actor: 'p4', user: 'o.farouk', details: { tool: 'selftest', result: 'done' } }]);
  });

  it('killing the process stops the job: no result', () => {
    const { world, omar } = hackerAtDesk();
    const pid = /^\[1\] (\d+)$/m.exec(omar.type('~/.tools/selftest --long'))![1];
    omar.type(`kill ${pid}`);
    advanceTime(world, 31 * SECOND);
    expect(fileOn(world, 'MKT-LT-11', LOOT)).toBe('');
    expect(queryEvents(world, { type: 'tool.done', since: START })).toMatchObject([{ details: { result: 'killed' } }]);
  });

  it('a defender who sees the process can kill it too (as root)', () => {
    const { world, omar } = hackerAtDesk();
    const pid = /^\[1\] (\d+)$/m.exec(omar.type('~/.tools/selftest --long'))![1];
    const khalid = atDesk(world, 'k.nasser');
    ssh(khalid, 'k.nasser', 'MKT-LT-11');
    expect(khalid.type('ps aux')).toContain('.tools/selftest --long');
    khalid.type(`sudo kill ${pid}`);
    khalid.type(PW['k.nasser']);
    advanceTime(world, 31 * SECOND);
    expect(fileOn(world, 'MKT-LT-11', LOOT)).toBe('');
  });

  it('keeps running after its owner logs out', () => {
    const { world, omar } = hackerAtDesk();
    omar.type('~/.tools/selftest --long');
    omar.type('exit');
    advanceTime(world, 31 * SECOND);
    expect(fileOn(world, 'MKT-LT-11', LOOT)).toContain('self-test passed');
  });

  it('finishes at the right moment however time is advanced, and survives saving the world', () => {
    const run = (step: number) => {
      const { world, omar } = hackerAtDesk();
      omar.type('~/.tools/selftest --long');
      const saved = deserializeWorld(serializeWorld(world)); // a save in the middle of the job
      for (let t = 0; t < 40 * SECOND; t += step) advanceTime(saved, step);
      return { loot: fileOn(saved, 'MKT-LT-11', LOOT), done: queryEvents(saved, { type: 'tool.done' })[0]?.time };
    };
    const a = run(50);
    expect(a.loot).toContain('self-test passed');
    expect(run(40 * SECOND)).toEqual(a);
  });
});
