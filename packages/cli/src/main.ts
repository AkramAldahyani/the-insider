/**
 * The Insider - text CLI.
 *
 *   pnpm cli                          start (it asks which scenario, if there are several)
 *   pnpm cli --scenario nexora-small  pick a scenario by id (or give a .json path)
 *   pnpm cli --seed 42                use another random seed
 *   pnpm cli --hacker p4              play the hacker with seeded random weaknesses
 *   pnpm cli --hacker o.farouk --vulns plaintext-password  choose a practice setup
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
import { missionOptions } from './options';

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
// Passwords must not be readable while typing: each character shows as "*".
// readline echoes every key to its output stream, so we give it a stream we
// can "mute". While muted, what readline wants to print is one of:
//   - an escape sequence (moving the cursor, clearing the line): let it through;
//   - the Enter key: print the newline;
//   - the whole line again (after Backspace it redraws "prompt + text"):
//     print the prompt and stars for the text;
//   - the character just typed: print a star.
let muted = false;
let shownPrompt = '';
const stars = (textPart: string) => '*'.repeat([...textPart].length);
const screenOut = new Writable({
  write(chunk, _encoding, done) {
    const textChunk = chunk.toString();
    if (!muted || textChunk.startsWith('\x1b')) process.stdout.write(textChunk);
    else if (textChunk.includes('\n') || textChunk.includes('\r')) process.stdout.write('\n');
    else if (shownPrompt && textChunk.startsWith(shownPrompt)) process.stdout.write(shownPrompt + stars(textChunk.slice(shownPrompt.length)));
    else process.stdout.write(stars(textChunk));
    done();
  },
});
Object.defineProperty(screenOut, 'columns', { get: () => process.stdout.columns });

const rl = createInterface({ input: process.stdin, output: screenOut, terminal: process.stdin.isTTY === true });

function ask(prompt: string, masked: boolean): void {
  muted = false;
  shownPrompt = prompt;
  rl.setPrompt(prompt);
  rl.prompt();
  muted = masked; // from here on, typed characters show as stars
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
    game = new Game(scenario, seed, join(ROOT, 'dumps'), missionOptions(process.argv.slice(2)));
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
  if (!process.stdin.isTTY) process.stdout.write(`${muted && !line.startsWith(':') ? '********' : line}\n`);
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

process.stdout.write('THE INSIDER - text CLI for the simulation core\n');
// Wrong options are reported at once, before anybody is asked which scenario to play.
try {
  missionOptions(process.argv.slice(2));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
chooseScenario();
