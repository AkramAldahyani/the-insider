/**
 * The hacker's toolkit: the MECHANISM every tool shares (DESIGN.md section 5).
 *
 * A tool is a game item, not real software. On the hacker's PC each tool is a
 * small file in the hidden folder ~/.tools whose text says which tool it is
 * ("# toolkit: NAME"). Running that file (`~/.tools/NAME ...`) makes the shell
 * hand over to the tool's definition below. Nothing real is executed: a tool
 * only changes the simulated world and writes simulated evidence.
 *
 * What every tool has:
 *  - a COOLDOWN: how long before the same player can use it again;
 *  - an ACTION TIME: 0 = done at once; more = it runs as a background job
 *    for that long (a process anyone with `ps aux` can see, which `kill`
 *    stops), then finishes and usually writes its result to ~/.tools/loot/;
 *  - a NOISE level: how much attention it draws (used for alerts later);
 *  - a list of TRACES: the evidence it leaves. DESIGN.md: "Every tool must
 *    leave at least one discoverable trace". A test enforces that the list is
 *    never empty, and per-tool tests check each trace really appears.
 *
 * Every run and every finished job is recorded in the master event log with
 * the player at the keyboard, for the debrief.
 *
 * Part B of Phase 4 builds only this mechanism and one harmless tool,
 * `selftest`, which checks that the toolkit works.
 */
import { fail, type CmdCtx, type CmdResult } from '../commands/types';
import { emit, withActor } from '../events/log';
import { getNode, sysMkdir, sysWrite } from '../fs/vfs';
import { removeProcess, spawn } from '../proc/processes';
import type { Host, ToolJob, World } from '../types';

export type Noise = 'quiet' | 'low' | 'loud';

export interface ToolDefinition {
  name: string;
  /** One line for the README and `selftest`. */
  summary: string;
  /** How to call it, e.g. "selftest [--long]". */
  usage: string;
  cooldownMs: number;
  /** 0 = runs at once. More = runs as a background job for this long (game time). */
  actionMs(args: string[]): number;
  noise: Noise;
  /** The evidence this tool leaves, in words. Must not be empty. */
  traces: string[];
  /** Runs at once. Returns what to print. For a tool with an action time, this is the "started" message. */
  start(c: CmdCtx, args: string[]): CmdResult;
  /** Called when a background job ends normally (not killed). Writes results; returns a one-line summary for the log. */
  finish?(world: World, host: Host, job: ToolJob): string;
}

const SECOND = 1000;

/** Writes a file into the job owner's ~/.tools/loot on the machine the job ran on. */
export function writeLoot(world: World, host: Host, job: ToolJob, name: string, content: string): string {
  const dir = `/home/${job.account}/.tools/loot`;
  const opts = { owner: job.account, group: job.account, mode: 0o700, time: world.time };
  sysMkdir(host, dir, opts);
  sysWrite(host, `${dir}/${name}`, content, { ...opts, mode: 0o600 });
  return `${dir}/${name}`;
}

// ───────────────────────────── The tools ─────────────────────────────

const selftest: ToolDefinition = {
  name: 'selftest',
  summary: 'checks that the toolkit works (harmless)',
  usage: 'selftest [--long]',
  cooldownMs: 10 * SECOND,
  actionMs: (args) => (args.includes('--long') ? 30 * SECOND : 0),
  noise: 'quiet',
  traces: [
    'the command line in ~/.bash_history',
    'with --long: a process in `ps aux` while it runs, and a result file in ~/.tools/loot/',
  ],
  start(c, args) {
    if (args.includes('--long')) return { stdout: 'selftest: running the long self-test in the background (about 30 s). The result will be in ~/.tools/loot/selftest.txt\n' };
    const lines = TOOLS.map((t) => `  ${t.usage.padEnd(24)} ${t.summary}`);
    return { stdout: `selftest: toolkit OK on ${c.host.hostname} (running as ${c.cred.user})\nTools:\n${lines.join('\n')}\n` };
  },
  finish(world, host, job) {
    const where = writeLoot(world, host, job, 'selftest.txt', `self-test passed on ${host.hostname} at ${new Date(world.time).toISOString()}\n`);
    return `wrote ${where}`;
  },
};

/** Every tool, in the order the README lists them. Later parts add theirs here. */
export const TOOLS: ToolDefinition[] = [selftest];

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}

// ───────────────────────────── Installing ─────────────────────────────

/** The text of a tool file. The marker line is what makes the shell treat it as a tool. */
function toolFile(tool: ToolDefinition): string {
  return `#!/bin/sh\n# toolkit: ${tool.name}\n# ${tool.summary}\n# usage: ~/.tools/${tool.usage}\n# (A game item. Running it is simulated; nothing real is executed.)\n`;
}

/** Puts every tool file and the README into a player's ~/.tools on their own PC. */
export function installTools(world: World, host: Host, account: string): void {
  const home = `/home/${account}`;
  const opts = { owner: account, group: account, time: world.time };
  sysMkdir(host, `${home}/.tools`, { ...opts, mode: 0o700 });
  sysMkdir(host, `${home}/.tools/loot`, { ...opts, mode: 0o700 });
  for (const tool of TOOLS) sysWrite(host, `${home}/.tools/${tool.name}`, toolFile(tool), { ...opts, mode: 0o700 });
  sysWrite(host, `${home}/.tools/README`, [
    'Your toolkit. Nobody else can read this folder (but root can).',
    'Every tool leaves a trace somewhere. There is no perfect crime, only well-hidden ones.',
    '',
    ...TOOLS.map((t) => `  ~/.tools/${t.usage.padEnd(22)} ${t.summary}`),
    '',
    'Physical items (used in the office, not typed):',
    '  USB stick       stand at an UNLOCKED PC (not sitting) and hold U for 5 seconds:',
    '                  sets up a backdoor for whoever is logged in there. Seen by anyone nearby and by cameras.',
    '  your eyes       stand right behind someone sitting at a PC while they type a password:',
    '                  you catch a few of its characters (written to loot/shoulder.txt).',
    '',
    'loot/ is where your tools put what they find.',
    '',
  ].join('\n'), { ...opts, mode: 0o600 });
}

/** If a file is a tool file, the tool's name. */
export function toolMarker(content: string | undefined): string | null {
  return /^# toolkit: ([a-z0-9-]+)$/m.exec(content ?? '')?.[1] ?? null;
}

// ───────────────────────────── Running ─────────────────────────────

/**
 * Runs a tool file. Called by the shell's dispatcher once it has found that
 * the file exists, is executable for this user, and carries a tool marker.
 */
export function runTool(c: CmdCtx, path: string, name: string, args: string[]): CmdResult {
  const tool = toolByName(name);
  if (!tool) return fail(`${path}: this tool does not work in this version of the game`, 126);
  const world = c.world;
  // Cooldowns belong to the PERSON at the keyboard (or to the account, for input with nobody at a keyboard).
  const who = c.terminal.playerId ?? c.cred.user;
  const key = `${who}/${tool.name}`;
  const readyAt = world.toolkit.cooldowns[key] ?? 0;
  if (world.time < readyAt) return fail(`${tool.name}: still cooling down (${Math.ceil((readyAt - world.time) / SECOND)} s left)`);

  const result = tool.start(c, args);
  if (result.exit && result.exit !== 0) return result;
  world.toolkit.cooldowns[key] = world.time + tool.cooldownMs;
  const actionMs = tool.actionMs(args);
  emit(world, {
    host: c.host.hostname, user: c.cred.user, sourceIp: c.session.sourceIp, type: 'tool.run',
    details: { tool: tool.name, args, noise: tool.noise, background: actionMs > 0, path },
  });
  if (actionMs > 0) {
    // A background job: a process like any other. It is NOT tied to the login session (think `nohup`), so it
    // keeps running after its owner logs out, until it is done or someone kills it.
    const command = [path, ...args].join(' ');
    const proc = spawn(world, c.host, { user: c.cred.user, command, tty: '?', stat: 'SN' });
    const job: ToolJob = {
      id: ++world.toolkit.nextJob, tool: tool.name, args, host: c.host.hostname, pid: proc.pid,
      account: c.cred.user, player: c.terminal.playerId, startedAt: world.time, finishAt: world.time + actionMs,
    };
    world.toolkit.jobs.push(job);
    return { stdout: `${result.stdout ?? ''}[${job.id}] ${proc.pid}\n` };
  }
  return result;
}

/** Ends one background job: normally, or as "killed" if its process is gone. */
function finishJob(world: World, job: ToolJob): void {
  world.toolkit.jobs = world.toolkit.jobs.filter((j) => j !== job);
  const host = world.hosts[job.host];
  const alive = host?.processes.some((p) => p.pid === job.pid);
  withActor(job.player, () => {
    if (!host || !alive) {
      emit(world, { host: job.host, user: job.account, type: 'tool.done', details: { tool: job.tool, job: job.id, result: 'killed' } });
      return;
    }
    removeProcess(host, job.pid);
    const summary = toolByName(job.tool)?.finish?.(world, host, job) ?? '';
    emit(world, { host: job.host, user: job.account, type: 'tool.done', details: { tool: job.tool, job: job.id, result: 'done', summary } });
  });
}

/** The next background job to finish, for the clock (core/clock.ts). */
export function nextToolJob(world: World): { when: number; run: () => void } {
  let next: ToolJob | undefined;
  for (const job of world.toolkit.jobs) if (!next || job.finishAt < next.finishAt) next = job;
  return next ? { when: next.finishAt, run: () => finishJob(world, next!) } : { when: Infinity, run: () => undefined };
}

/** Is there a tool file at this path on this host? (Used by tests and the dispatcher.) */
export function toolAt(host: Host, path: string): string | null {
  return toolMarker(getNode(host, path)?.content);
}
