/**
 * Builds the game server: reads the scenario and the map from disk and
 * registers the "office" room. Kept apart from index.ts so tests can start a
 * server on another port.
 *
 * This file (with index.ts) is the only part of the server that reads or
 * writes files. The engine never does.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ALL_WEAKNESSES, type Scenario, type WeaknessChoice } from '@insider/engine';
import { ROOM_NAME, type TiledMap } from '@insider/shared';
import { officeRoom } from './OfficeRoom';
import type { OfficeGameOptions } from './game';
import { parseHackerDifficulty } from './bots/hacker-knowledge';

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
  /** Today's weaknesses: "random" (default), "none", or a comma-separated list of weakness ids. */
  weaknesses?: string;
  /** Meeting lengths in seconds, "discussion,voting,result" (default 90,45,8). */
  meetingSeconds?: string;
  /** Anti-stall: game minutes between two re-scored hacker actions (default 10, 0 = off). */
  stallMinutes?: number;
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
    botOptions: { hacker: options.botHacker ?? true, hackerDifficulty: parseHackerDifficulty(options.botHackerDifficulty) },
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

/** Creates a Colyseus server with the office room defined. Call `.listen(port)` on the result. */
export function createGameServer(options: AppOptions = {}): Server {
  const server = new Server({ transport: new WebSocketTransport(), greet: false });
  server.define(ROOM_NAME, officeRoom(loadGameOptions(options)));
  return server;
}
