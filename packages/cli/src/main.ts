/**
 * The Insider - text CLI.
 *
 *   pnpm cli                          start with the only/first scenario
 *   pnpm cli --scenario nexora-small  pick a scenario by id (or give a .json path)
 *   pnpm cli --seed 42                use another random seed
 *
 * This file only deals with the keyboard and the screen. The game logic is in
 * game.ts (CLI meta commands) and in @insider/engine (everything else).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Scenario } from '@insider/engine';
import { Game, type Screen } from './game';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCENARIO_DIR = join(ROOT, 'scenarios');

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function listScenarios(): { file: string; scenario: Scenario }[] {
  if (!existsSync(SCENARIO_DIR)) return [];
  return readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: join(SCENARIO_DIR, f), scenario: JSON.parse(readFileSync(join(SCENARIO_DIR, f), 'utf8')) as Scenario }));
}

// ── Keyboard and screen ──
// Passwords must not be shown while typing. readline echoes every key to its
// output stream, so we give it a stream we can "mute": while muted, only the
// final newline is let through.
let muted = false;
const screenOut = new Writable({
  write(chunk, _encoding, done) {
    const textChunk = chunk.toString();
    if (!muted) process.stdout.write(textChunk);
    else if (textChunk.includes('\n')) process.stdout.write('\n');
    done();
  },
});
Object.defineProperty(screenOut, 'columns', { get: () => process.stdout.columns });

const rl = createInterface({ input: process.stdin, output: screenOut, terminal: process.stdin.isTTY === true });

function ask(prompt: string, masked: boolean): void {
  muted = false;
  rl.setPrompt(prompt);
  rl.prompt();
  muted = masked; // from here on, typed characters are hidden
}

function show(screen: Screen): void {
  muted = false;
  process.stdout.write(screen.output);
  if (screen.quit) {
    rl.close();
    return;
  }
  ask(screen.prompt, screen.masked);
}

// ── Start-up: choose a scenario, then hand every line to the Game ──
const seed = Number(argValue('--seed') ?? 1) || 1;
const available = listScenarios();
let game: Game | null = null;

function start(scenario: Scenario): void {
  try {
    game = new Game(scenario, seed, join(ROOT, 'dumps'));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  process.stdout.write(game.intro());
  ask(game.prompt(), false);
}

function chooseScenario(): void {
  const wanted = argValue('--scenario');
  if (wanted) {
    const match = available.find((s) => s.scenario.id === wanted || s.file === resolve(wanted));
    if (match) return start(match.scenario);
    if (existsSync(wanted)) return start(JSON.parse(readFileSync(wanted, 'utf8')) as Scenario);
    console.error(`Scenario not found: ${wanted}`);
    process.exit(1);
  }
  if (available.length === 0) {
    console.error(`No scenarios found in ${SCENARIO_DIR}`);
    process.exit(1);
  }
  if (available.length === 1) return start(available[0].scenario);
  process.stdout.write('Scenarios:\n');
  available.forEach((s, i) => process.stdout.write(`  ${i + 1}. ${s.scenario.id} - ${s.scenario.name}\n`));
  ask(`Choose a scenario [1-${available.length}]: `, false);
}

rl.on('line', (line) => {
  // When input is piped from a file there is no keyboard echo, so print the
  // line ourselves (hiding passwords). This makes scripted runs readable.
  if (!process.stdin.isTTY) process.stdout.write(`${muted ? '********' : line}\n`);
  if (!game) {
    const pick = available[(parseInt(line, 10) || 1) - 1];
    if (pick) start(pick.scenario);
    else ask(`Choose a scenario [1-${available.length}]: `, false);
    return;
  }
  show(game.handle(line));
});
rl.on('close', () => {
  process.stdout.write('\n');
  process.exit(0);
});

process.stdout.write('THE INSIDER - simulation core (Phase 1)\n');
chooseScenario();
