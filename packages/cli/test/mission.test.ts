import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { queryEvents, type Scenario } from '@insider/engine';
import { Game } from '../src/game';
import { missionOptions } from '../src/options';

const scenario: Scenario = JSON.parse(readFileSync(new URL('../../../scenarios/nexora-small.json', import.meta.url), 'utf8'));
const password = scenario.accounts.find((a) => a.username === 'o.farouk')!.password;
const server = scenario.mission!.flagHost;
const flagPath = scenario.mission!.flagPath;
const flagContent = scenario.hosts.find((h) => h.hostname === server)!.files!.find((f) => f.path === flagPath)!.content;
const flag = (Array.isArray(flagContent) ? flagContent.join('\n') : flagContent).trim();
const hackerGame = () => new Game(scenario, 1, 'dumps', { hacker: 'p4', weaknesses: ['plaintext-password'] });

describe('CLI mission settings', () => {
  it('keeps the ordinary CLI without a hacker or weaknesses', () => {
    const game = new Game(scenario, 1, 'dumps', missionOptions([]));
    expect(game.playerId).toBe('p1');
    expect(game.world.mission).toMatchObject({ hacker: null, weaknesses: [] });
    expect(game.intro()).not.toContain('You are the hacker.');
  });

  it('selects a hacker by ID, installs tools, and uses deterministic random weaknesses by default', () => {
    const first = new Game(scenario, 42, 'dumps', missionOptions(['--hacker', 'p4']));
    const second = new Game(scenario, 42, 'dumps', { hacker: 'p4' });
    expect(first.world.mission.hacker).toBe('p4');
    expect(first.world.mission.weaknesses.length).toBeGreaterThanOrEqual(2);
    expect(first.world.mission.weaknesses).toEqual(second.world.mission.weaknesses);
    expect(first.intro()).toContain(':sit MKT-LT-11');
    expect(first.intro()).toContain('You are the hacker.');
    first.handle(':sit MKT-LT-11');
    first.handle(password);
    expect(first.handle('ls -a ~/.tools').output).toContain('phish');
  });

  it('accepts an account name and an explicit weakness-free practice setup', () => {
    const game = new Game(scenario, 1, 'dumps', missionOptions(['--hacker', 'o.farouk', '--vulns', 'none']));
    expect(game.playerId).toBe('p4');
    expect(game.world.mission.weaknesses).toEqual([]);
  });

  it('validates and deduplicates fixed weaknesses, and accepts random explicitly', () => {
    expect(missionOptions(['--vulns', 'plaintext-password,tailgate,tailgate']).weaknesses).toEqual(['plaintext-password', 'tailgate']);
    expect(missionOptions(['--vulns', 'random']).weaknesses).toBe('random');
  });

  it.each([['--hacker'], ['--hacker', '--seed', '42'], ['--vulns'], ['--vulns', 'unknown'], ['--vulns', 'tailgate,']])('rejects malformed settings: %j', (...args) => {
    expect(() => missionOptions(args)).toThrow();
  });

  it('rejects unknown players and scenarios without a mission', () => {
    expect(() => new Game(scenario, 1, 'dumps', { hacker: 'nobody' })).toThrow('Unknown hacker player');
    const plain = structuredClone(scenario);
    delete plain.mission;
    expect(() => new Game(plain, 1, 'dumps', { hacker: 'p4' })).toThrow('no hacker mission');
  });
});

describe('CLI hacker gameplay', () => {
  it('does not move the hacker role with :as or reveal its briefing to the other player', () => {
    const game = hackerGame();
    game.handle(':as p1');
    expect(game.world.mission.hacker).toBe('p4');
    expect(game.handle(':briefing').output).toBe('Only the hacker can view the mission briefing.\n');
    expect(game.handle(`:flag ${flag}`).output).toContain('Only the hacker');
    game.handle(':as o.farouk');
    expect(game.handle(':briefing').output).toContain(flagPath);
  });

  it('rejects an empty, incorrect or known-but-unread flag', () => {
    const game = hackerGame();
    expect(game.handle(':flag').output).toContain('Usage:');
    expect(game.handle(':flag wrong').output).toContain('That is not the flag.');
    expect(game.handle(`:flag ${flag}`).output).toContain('read it on the server first');
    expect(game.world.mission.won).toBeNull();
  });

  it('finishes a traceable route through CLI input and freezes play while keeping evidence inspectable', () => {
    const game = hackerGame();
    expect(game.handle(':sit MKT-LT-11').masked).toBe(true);
    game.handle(password);
    game.handle(`ssh ${server}`);
    game.handle(password);
    const script = game.handle(`cat ${scenario.mission!.plaintextPassword!.path}`).output;
    const rootPassword = /ROOT_PW='([^']+)'/.exec(script)![1];
    game.handle('su');
    game.handle(rootPassword);
    const read = game.handle(`cat ${flagPath}`).output.trim();
    expect(read).toBe(flag.trim());
    const result = game.handle(`:flag ${read}`);
    expect(result.output).toContain('You win.');
    expect(result.masked).toBe(false);
    expect(game.terminalId).toBeNull();
    expect(queryEvents(game.world, { type: 'file.read', actor: 'p4' }).some((e) => e.details.path === flagPath)).toBe(true);
    expect(queryEvents(game.world, { type: 'mission.won' })).toHaveLength(1);
    const finished = JSON.stringify(game.world);
    for (const command of [':sit MKT-LT-11', ':as p1', ':time +5m', 'whoami', `:flag ${read}`]) {
      expect(game.handle(command).output).toContain('The match is over.');
    }
    expect(game.handle(':events').output).toContain('mission.won');
    expect(game.handle(':time').output).toContain('Game time:');
    expect(JSON.stringify(game.world)).toBe(finished);
    expect(game.handle(':quit').quit).toBe(true);
  });
});

describe('CLI executable', () => {
  const run = (args: string[], input: string) => spawnSync(process.execPath, [
    '--import', 'tsx', fileURLToPath(new URL('../src/main.ts', import.meta.url)), ...args,
  ], { cwd: fileURLToPath(new URL('../../../', import.meta.url)), input, encoding: 'utf8', timeout: 20_000 });

  it('passes startup settings to the game and can finish a scripted match', () => {
    const rootPassword = scenario.hosts.find((h) => h.hostname === server)!.rootPassword!.password;
    const result = run(['--scenario', 'nexora-small', '--hacker', 'o.farouk', '--vulns', 'plaintext-password'], [
      ':sit MKT-LT-11', password, `ssh ${server}`, password, 'su', rootPassword,
      `cat ${flagPath}`, `:flag ${flag.trim()}`, ':quit', '',
    ].join('\n'));
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('You are the hacker.');
    expect(result.stdout).toContain('You win.');
    expect(result.stdout).toContain('********');
  });

  it('exits with a useful error for a missing hacker argument', () => {
    const result = run(['--hacker'], '');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--hacker needs a value.');
  });
});
