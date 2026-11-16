/**
 * Test helpers: load the sample scenario and "play" it with a few lines of code.
 * (Tests may use Node APIs to read the scenario file; the engine itself never does.)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  advanceTime, createWorld, openTerminal, sendInput, type Scenario, type TerminalResult, type World,
} from '../src/index';
import { getNode } from '../src/fs/vfs';

export const scenario: Scenario = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../scenarios/nexora-small.json', import.meta.url)), 'utf8'),
);

/** username -> password, straight from the scenario file. */
export const PW: Record<string, string> = Object.fromEntries(scenario.accounts.map((a) => [a.username, a.password]));
export const ROOT_PW = scenario.hosts.find((h) => h.hostname === 'ADMIN-SRV-01')!.rootPassword!.password;
export const FLAG = 'NEXORA{r00t_0n_adm1n_srv_01}';
export const SERVER = 'ADMIN-SRV-01';

/** A fresh world of the sample scenario. */
export function newWorld(seed = 1): World {
  return createWorld(scenario, seed);
}

/** A player sitting at a PC. `type()` sends one line (one second of game time passes first). */
export class Term {
  id: string;
  last: TerminalResult;

  constructor(
    public world: World,
    public host: string,
    player = 'p1',
  ) {
    const opened = openTerminal(world, host, player);
    this.id = opened.terminalId;
    this.last = opened;
  }

  type(line: string): string {
    advanceTime(this.world, 1000);
    this.last = sendInput(this.world, this.id, line);
    return this.last.output;
  }

  get prompt(): string {
    return this.last.prompt;
  }

  get masked(): boolean {
    return this.last.awaitingInput?.masked ?? false;
  }
}

/** Sits the account's own player at their own desk and gets to a shell (logging in or unlocking as needed). */
export function atDesk(world: World, account: string): Term {
  const player = world.players.find((p) => p.account === account)!;
  const term = new Term(world, player.desk, player.id);
  if (term.prompt.endsWith('login: ')) term.type(account);
  if (term.last.awaitingInput) term.type(PW[account]);
  return term;
}

/** Opens an ssh session from an existing shell. */
export function ssh(term: Term, user: string, host: string): void {
  term.type(`ssh ${user}@${host}`);
  term.type(PW[user]);
}

/** Raw content of a file on a host, bypassing permissions (what the engine itself sees). */
export function fileOn(world: World, host: string, path: string): string {
  return getNode(world.hosts[host], path)?.content ?? '';
}

export const authLog = (world: World, host: string) => fileOn(world, host, '/var/log/auth.log');
