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
import type { Scenario } from '@insider/engine';
import { ROOM_NAME, type TiledMap } from '@insider/shared';
import { officeRoom } from './OfficeRoom';
import type { OfficeGameOptions } from './game';

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
