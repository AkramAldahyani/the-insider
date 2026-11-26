/**
 * Builds the game server: reads the scenario and the map from disk and
 * registers the rooms. Kept apart from index.ts so tests can start a
 * server on another port.
 *
 * This file (with index.ts) is the only part of the server that reads or
 * writes files. The engine never does.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ALL_WEAKNESSES, type Scenario, type WeaknessChoice } from '@insider/engine';
import { PARTY_ROOM_NAME, ROOM_NAME, SOLO_ROOM_NAME, type TiledMap } from '@insider/shared';
import { officeRoom, soloRoom } from './OfficeRoom';
import { partyRoom } from './PartyRoom';
import { Gate } from './gate';
import type { OfficeGameOptions } from './game';
import { parseHackerDifficulty } from './bots/hacker-knowledge';
import { parseHackerPace } from './bots/hacker-pace';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface AppOptions {
  /** Scenario id (file name in scenarios/ without .json). */
  scenario?: string;
  /** Map name (file name in maps/ without .json). */
  map?: string;
  seed?: number;
  speed?: number;
  /** Developer tools on? Default: only when NODE_ENV is not "production". */
  dev?: boolean;
  /** Bot employees on? Default true. */
  bots?: boolean;
  /** Simulated bot hacker on? Default true when bots are enabled. */
  botHacker?: boolean;
  /** easy / normal (default) / hard: how much the bot knows before investigating. */
  botHackerDifficulty?: string;
  /** normal (default: depends on the difficulty) / fast (no pauses, for tests and demonstrations). */
  botHackerPace?: string;
  /** Today's weaknesses: "random" (default), "none", or a comma-separated list of weakness ids. */
  weaknesses?: string;
  /** Meeting lengths in seconds, "discussion,voting,result" (default 90,45,8). */
  meetingSeconds?: string;
  /** Anti-stall: game minutes between two re-scored hacker actions (default 10, 0 = off). */
  stallMinutes?: number;
  /** How many solo matches may run at the same time (default 20). */
  soloLimit?: number;
  /** How many lobbies (with or without a running match) may exist at the same time (default 20). */
  lobbyLimit?: number;
  /** The large office for lobbies of more than 11 (default: nexora-large on office-large, if they exist; "" = none). */
  largeScenario?: string;
  largeMap?: string;
  /** Tests only: a larger allowance for joining from one network address (see allowance.ts). */
  joinPoints?: number;
  /** Serve the built web page (packages/client/dist) from the same address. Default: only when NODE_ENV is "production". */
  page?: boolean;
}

/** "random" / "none" / "extra-sudo,tailgate" -> what the game expects. Unknown names stop the server. */
function parseWeaknesses(text = 'random'): WeaknessChoice {
  if (text === 'random') return 'random';
  if (text === 'none' || text === '') return [];
  const ids = text.split(',').map((t) => t.trim());
  const unknown = ids.filter((id) => !(ALL_WEAKNESSES as string[]).includes(id));
  if (unknown.length > 0) throw new Error(`Unknown weakness "${unknown.join(', ')}". Known: ${ALL_WEAKNESSES.join(', ')}, or "random" / "none".`);
  return ids as WeaknessChoice;
}

/** "90,45,8" -> meeting phase lengths. Anything else stops the server with a clear message. */
function parseMeetingSeconds(text?: string): { discussionMs: number; votingMs: number; resultMs: number } | undefined {
  if (!text) return undefined;
  const parts = text.split(',').map((t) => Number(t.trim()));
  if (parts.length !== 3 || parts.some((n) => !(n > 0))) throw new Error(`MEETING_SECONDS must be three positive numbers like "90,45,8", not "${text}"`);
  return { discussionMs: parts[0] * 1000, votingMs: parts[1] * 1000, resultMs: parts[2] * 1000 };
}

/** Loads the content files and returns what a room needs to create its game. */
export function loadGameOptions(options: AppOptions = {}): OfficeGameOptions {
  const scenarioId = options.scenario ?? 'nexora-small';
  const mapName = options.map ?? 'office-small';
  const scenario = JSON.parse(readFileSync(join(REPO_ROOT, 'scenarios', `${scenarioId}.json`), 'utf8')) as Scenario;
  const map = JSON.parse(readFileSync(join(REPO_ROOT, 'maps', `${mapName}.json`), 'utf8')) as TiledMap;
  const dev = options.dev ?? process.env.NODE_ENV !== 'production';
  return {
    scenario, map, mapName, dev,
    bots: options.bots ?? true,
    botOptions: { hacker: options.botHacker ?? true, hackerDifficulty: parseHackerDifficulty(options.botHackerDifficulty), hackerPace: parseHackerPace(options.botHackerPace) },
    weaknesses: parseWeaknesses(options.weaknesses),
    meetingTimes: parseMeetingSeconds(options.meetingSeconds),
    escalationMinutes: options.stallMinutes,
    seed: options.seed ?? 1,
    speed: options.speed ?? 1,
    writeDump: dev
      ? (json, name) => {
          const dir = join(REPO_ROOT, 'dumps');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, name), json);
          return join(dir, name);
        }
      : undefined,
  };
}

/** The large office, if there is one (Phase 6, part I). */
export function loadLarge(options: AppOptions = {}): OfficeGameOptions | undefined {
  const scenario = options.largeScenario ?? 'nexora-large';
  const map = options.largeMap ?? 'office-large';
  if (!scenario || !map || !existsSync(join(REPO_ROOT, 'scenarios', `${scenario}.json`))) return undefined;
  return loadGameOptions({ ...options, scenario, map });
}

/** Where `pnpm build` puts the web page. */
export const PAGE_DIR = join(REPO_ROOT, 'packages', 'client', 'dist');

/** Creates a Colyseus server with the shared office, the solo matches and the lobbies defined. Call `.listen(port)` on the result. */
export function createGameServer(options: AppOptions = {}): Server {
  const gate = new Gate(options.page ?? process.env.NODE_ENV === 'production' ? PAGE_DIR : undefined, options.joinPoints);
  // The largest message is a pasted command line (2000 characters, up to 4 bytes each).
  const transport = new WebSocketTransport({ maxPayload: 16 * 1024, verifyClient: gate.mayConnect });
  const server = new Server({ transport, greet: false });
  gate.guard(transport.server as HttpServer);
  const game = loadGameOptions(options);
  server.define(ROOM_NAME, officeRoom(game));
  server.define(SOLO_ROOM_NAME, soloRoom(game, { seed: options.seed, limit: options.soloLimit }));
  server.define(PARTY_ROOM_NAME, partyRoom(game, { seed: options.seed, limit: options.lobbyLimit, large: loadLarge(options) }));
  return server;
}
