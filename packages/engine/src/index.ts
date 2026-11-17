/**
 * @insider/engine - public API.
 *
 * The whole simulation is driven through a handful of functions:
 *
 *   const world = createWorld(scenario, seed);          // build the office
 *   const t = openTerminal(world, 'FIN-LT-07', 'p1');   // sit at a PC
 *   const r = sendInput(world, t.terminalId, 'whoami'); // type a line
 *   advanceTime(world, 5 * 60_000);                     // let 5 minutes pass
 *   const save = serializeWorld(world);                 // JSON text
 *
 * The engine does no I/O at all: loading scenario files, printing and reading
 * the keyboard are the caller's job (see packages/cli).
 */
import type { World } from './types';

export * from './types';
export type {
  Scenario, ScenarioAccount, ScenarioFile, ScenarioHistoryItem, ScenarioHost, ScenarioPlayer, ScenarioTask, ScenarioTaskStep,
} from './core/scenario';
export { validateScenario } from './core/scenario';
export { createWorld } from './core/world';
export { ROLES, ROLE_IDS, roleOf } from './core/roles';
export type { RoleId, RoleInfo } from './core/roles';
export type { WorldOptions } from './core/world';
export { ALL_WEAKNESSES, briefing, chooseWeaknesses, setHacker, submitFlag } from './mission/mission';
export { watchedFile } from './security/alerts';
export type { Severity } from './security/alerts';
export { TOOLS, toolByName, toolAt } from './tools/toolkit';
export { USB_COOLDOWN_MS, glimpse, plugUsb, shoulderSurf, usbCooldown } from './tools/physical';
export type { ToolDefinition, Noise } from './tools/toolkit';
export type { WeaknessChoice } from './mission/mission';
export { advanceTime, advanceTo } from './core/clock';
export { parseDuration, dateStamp } from './core/time';
export {
  openTerminal, leaveTerminal, sendInput, currentPrompt, awaitingSecret, cancelInput, switchUser, refreshTerminal, screenState,
} from './terminal';
export type { TerminalResult, OpenResult, ScreenKind, ScreenState } from './terminal';
export { queryEvents } from './events/log';
export { unattendedMs } from './auth/unattended';
export type { EventFilter } from './events/log';
export { dhcpRequest, dhcpRelease, leaseHistory, leaseHolderAt, activeLease } from './net/dhcp';
export { resolveHost } from './net/dns';
export { tapBadge, doorOpened, doorClosed, doorPassed, cctvMotion } from './physical/badges';
export type { TapInput, TapResult, TapDirection } from './physical/badges';
export { commandNames } from './commands/index';

/** The complete world as JSON text (save games, replays, debugging). */
export function serializeWorld(world: World, pretty = false): string {
  return JSON.stringify(world, null, pretty ? 2 : undefined);
}

/** The inverse of serializeWorld. The result can be played on exactly as before. */
export function deserializeWorld(json: string): World {
  const world = JSON.parse(json) as World;
  if (world.version !== 1) throw new Error(`Unsupported world version: ${String(world.version)}`);
  return world;
}
