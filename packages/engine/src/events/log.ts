/**
 * The master event log - "the heart of the game".
 *
 * Every meaningful action calls `emit()`. That does two things:
 *  1. appends a structured GameEvent to `world.events` (the ground truth that
 *     only the engine sees: later used by the SIEM and the post-match debrief);
 *  2. "materializes" the event into the realistic places a defender would look
 *     (auth.log, the journal, ...). See materialize.ts.
 */
import type { GameEvent, World } from '../types';
import { materialize } from './materialize';

/**
 * Which PLAYER is physically at the keyboard for the input being processed.
 * It is set by the terminal for the duration of one `sendInput` call. This is
 * deliberately not stored in the World: it is not game state, just "who typed
 * the thing we are handling right now". The engine is synchronous, so a simple
 * module variable is safe.
 */
let currentActor: string | null = null;

export function withActor<T>(actor: string | null, fn: () => T): T {
  const previous = currentActor;
  currentActor = actor;
  try {
    return fn();
  } finally {
    currentActor = previous;
  }
}

export interface EmitInput {
  host: string;
  user: string;
  sourceIp?: string | null;
  type: string;
  details?: Record<string, unknown>;
}

export function emit(world: World, input: EmitInput): GameEvent {
  const event: GameEvent = {
    id: ++world.counters.event,
    time: world.time,
    host: input.host,
    user: input.user,
    sourceIp: input.sourceIp ?? null,
    type: input.type,
    details: input.details ?? {},
    actor: currentActor,
  };
  world.events.push(event);
  materialize(world, event);
  return event;
}

export interface EventFilter {
  host?: string;
  user?: string;
  /** Exact type ("ssh.accept") or a prefix ending in "." ("ssh."). */
  type?: string;
  sourceIp?: string;
  actor?: string;
  since?: number;
  until?: number;
}

/** Engine-side query over the master log (for the future SIEM and debrief). */
export function queryEvents(world: World, filter: EventFilter = {}): GameEvent[] {
  return world.events.filter((e) => {
    if (filter.host && e.host !== filter.host) return false;
    if (filter.user && e.user !== filter.user) return false;
    if (filter.sourceIp && e.sourceIp !== filter.sourceIp) return false;
    if (filter.actor && e.actor !== filter.actor) return false;
    if (filter.since !== undefined && e.time < filter.since) return false;
    if (filter.until !== undefined && e.time > filter.until) return false;
    if (filter.type) {
      if (filter.type.endsWith('.')) return e.type.startsWith(filter.type);
      return e.type === filter.type;
    }
    return true;
  });
}
