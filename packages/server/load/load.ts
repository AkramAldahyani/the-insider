/**
 * Load test (Phase 6, part H): many people play at the same time, and this
 * measures whether the game still feels quick.
 *
 *   pnpm load                      30 people in lobbies of 10, for one minute
 *   pnpm load 55 120               55 people, for two minutes
 *   pnpm load 30 60 large          30 people in ONE lobby, in the large office
 *
 * It starts its own game server (port 2594) as a separate program, like a real
 * one, and plays with pretend players: they walk about, sit down, type
 * commands, chat and look around, a little busier than people are. It never
 * touches a game that is running.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type Room } from 'colyseus.js';

/** At most 55: one network address may have 60 connections. */
const people = Math.min(55, Math.max(2, Number(process.argv[2] ?? 30)));
const seconds = Math.max(5, Number(process.argv[3] ?? 60));
const large = process.argv[4] === 'large';
const PER_LOBBY = large ? 30 : 10;
const PORT = 2594;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tsx = join(dirname(createRequire(join(root, 'package.json')).resolve('tsx/package.json')), 'dist', 'cli.mjs');

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
const at = (list: number[], part: number) => (list.length ? [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * part))] : NaN);
const ms = (n: number) => `${n.toFixed(0)} ms`;

const COMMANDS = ['ls -la', 'whoami', 'cat /etc/passwd', 'ps aux', 'last', 'journalctl -n 20', 'grep -r sshd /var/log', 'mail', 'history', 'find /home -name "*.txt"', 'ss -tlnp', 'date'];

/** The server lets one network address in only so fast (a real group comes from many): then try again a little later. */
async function comeIn(enter: () => Promise<Room>): Promise<Room> {
  for (;;) {
    try {
      return await enter();
    } catch (error) {
      if ((error as { code?: unknown }).code !== 429) throw error;
      await wait(1000);
    }
  }
}

/** One pretend player. */
class Player {
  /** Message -> answer, in milliseconds: walking, and lines typed at a PC. */
  readonly walk: number[] = [];
  readonly line: number[] = [];
  /** Time between two updates of the office. */
  readonly gaps: number[] = [];
  closed = 0;
  ready = false;
  private asked = new Map<number, number>();
  private sequence = 0;
  private typed = 0;
  private lastPatch = 0;
  private seated = false;
  private password = '';
  private login = false;
  /** Their own PC (a person tries to sit at the desk in front of them, not at thirty at once). */
  private desk = '';

  constructor(readonly room: Room) {
    room.onMessage('*', () => undefined);
    room.onMessage('welcome', (m: { card: { password: string; hostname: string } }) => { this.password = m.card.password; this.desk = m.card.hostname; this.ready = true; });
    room.onMessage('move.ack', (m: { sequence: number }) => {
      const sent = this.asked.get(m.sequence);
      if (sent !== undefined) this.walk.push(performance.now() - sent);
      this.asked.delete(m.sequence);
    });
    room.onMessage('term.open', (m: { screen: string }) => { this.seated = true; this.login = m.screen !== 'shell'; });
    room.onMessage('term.close', () => { this.seated = false; });
    room.onMessage('term.output', (m: { screen: string }) => {
      if (this.typed) this.line.push(performance.now() - this.typed);
      this.typed = 0;
      this.login = m.screen !== 'shell';
    });
    room.onStateChange(() => {
      const now = performance.now();
      if (this.lastPatch) this.gaps.push(now - this.lastPatch);
      this.lastPatch = now;
    });
    room.onLeave((code) => { this.closed = code; });
  }

  /** The measuring begins (what came before was waiting in the lobby). */
  begin(): void {
    this.gaps.length = 0;
    this.lastPatch = 0;
  }

  act(): void {
    if (this.closed) return;
    if (this.seated) {
      if (this.typed) return; // still waiting for an answer
      if (Math.random() < 0.03) return this.room.send('stand', {});
      this.typed = performance.now();
      return this.room.send('term.line', { text: this.login ? this.password : pick(COMMANDS) });
    }
    const dice = Math.random();
    if (dice < 0.08) this.room.send('chat.send', { text: 'Has anybody seen anything?' });
    else if (dice < 0.3) {
      // Stop, and sit down at the own desk if it is near (everybody starts next to theirs).
      this.room.send('move', { dx: 0, dy: 0 });
      this.room.send('sit', { hostname: this.desk });
    } else {
      this.asked.set(++this.sequence, performance.now());
      this.room.send('move', { dx: pick([-1, 0, 1]), dy: pick([-1, 0, 1]), sequence: this.sequence });
    }
  }
}

async function main(): Promise<void> {
  const server = spawn(process.execPath, [tsx, join(root, 'packages', 'server', 'src', 'index.ts')], { cwd: root, env: { ...process.env, GAME_PORT: String(PORT), GAME_HOST: 'localhost', NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((resolve, reject) => {
    server.stdout.on('data', (d: Buffer) => { if (d.toString().includes('game server on')) resolve(); });
    server.on('exit', (code) => reject(new Error(`the server stopped (${code})`)));
  });
  let failed = false;
  try {
    const players: Player[] = [];
    const lobbies: Player[][] = [];
    for (let n = 0; n < people; n++) {
      const client = new Client(`ws://localhost:${PORT}`);
      const mine = lobbies.at(-1);
      if (!mine || mine.length >= PER_LOBBY) {
        const player = new Player(await comeIn(() => client.create('party', { name: `Host ${n}` })));
        if (large) player.room.send('party.settings', { office: 'large' });
        lobbies.push([player]);
        players.push(player);
      } else {
        const player = new Player(await comeIn(() => client.joinById(mine[0].room.roomId, { name: `Player ${n}` })));
        mine.push(player);
        players.push(player);
      }
    }
    await wait(300);
    for (const lobby of lobbies) {
      for (const p of lobby.slice(1)) p.room.send('party.ready', { ready: true });
      await wait(200);
      lobby[0].room.send('party.start', {});
    }
    await wait(1500);
    const playing = players.filter((p) => p.ready).length;
    console.log(`${people} people in ${lobbies.length} ${lobbies.length === 1 ? 'lobby' : 'lobbies'} (with the computer's colleagues up to ${large ? 30 : 11} each), ${playing} are playing, ${seconds} s...`);
    if (playing < people) failed = lobbies.some((l) => l.length >= 2 && l.some((p) => !p.ready));
    for (const p of players) p.begin();
    const timers = players.map((p) => setInterval(() => p.act(), 150 + Math.random() * 200));
    await wait(seconds * 1000);
    timers.forEach(clearInterval);
    await wait(1000);
    const walk = players.flatMap((p) => p.walk), line = players.flatMap((p) => p.line), gaps = players.flatMap((p) => p.gaps);
    const report = (name: string, list: number[], limit: number) => {
      const slow = at(list, 0.95);
      const ok = slow <= limit;
      failed ||= !ok;
      console.log(`${name.padEnd(34)} ${String(list.length).padStart(7)} times   half within ${ms(at(list, 0.5)).padStart(7)}   95 % within ${ms(slow).padStart(7)}   longest ${ms(Math.max(...list)).padStart(7)}   ${ok ? 'good' : `TOO SLOW (limit ${ms(limit)})`}`);
    };
    report('answer to walking', walk, 100);
    report('answer to a line at a PC', line, 200);
    report('between two pictures of the office', gaps, 150);
    const closed = players.filter((p) => p.closed !== 0).length;
    console.log(`connections lost: ${closed}`);
    failed ||= closed > 0;
    await Promise.all(players.map((p) => p.room.leave().catch(() => undefined)));
  } finally {
    server.removeAllListeners('exit');
    server.kill();
  }
  console.log(failed ? 'NOT good enough.' : 'Good.');
  process.exit(failed ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
