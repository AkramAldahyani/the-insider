/**
 * Starts the game for development: the game server and the web page together.
 *
 *   pnpm dev                 both (server on :2567, page on http://localhost:5173)
 *   pnpm client              only the web page
 *   pnpm build               production build of the web page into packages/client/dist
 *
 * It is a plain Node script (no extra tools) that starts the two programs,
 * prefixes their output so you can tell them apart, and stops both when you
 * press Ctrl+C or when one of them dies.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = join(root, 'packages', 'client');
// Find the programs inside node_modules, so this works even when `pnpm` itself is not on the PATH.
const tsx = join(dirname(createRequire(join(root, 'package.json')).resolve('tsx/package.json')), 'dist', 'cli.mjs');
const vite = join(dirname(createRequire(join(client, 'package.json')).resolve('vite/package.json')), 'bin', 'vite.js');

const children = [];
function start(name, color, args, cwd) {
  const child = spawn(process.execPath, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const print = (stream, target) => {
    let rest = '';
    stream.on('data', (chunk) => {
      const lines = (rest + chunk.toString()).split(/\r?\n/);
      rest = lines.pop() ?? '';
      for (const line of lines) target.write(`\x1b[${color}m[${name}]\x1b[0m ${line}\n`);
    });
  };
  print(child.stdout, process.stdout);
  print(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (stopping) return;
    console.log(`[${name}] stopped (exit code ${code}). Stopping everything.`);
    stop(code ?? 1);
  });
  children.push(child);
}

let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

const flag = process.argv[2];
if (flag === '--build') {
  start('build', 36, [vite, 'build'], client);
  children[0].on('exit', (code) => process.exit(code ?? 0));
  stopping = true; // a finished build is not a crash
} else {
  if (flag !== '--client-only') start('server', 32, [tsx, 'watch', join('packages', 'server', 'src', 'index.ts')], root);
  start('client', 36, [vite], client);
}
