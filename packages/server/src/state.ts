/**
 * The room state that Colyseus keeps in sync with every browser.
 *
 * Colyseus compares this object with what each browser already has and sends
 * only the differences ("patches") a few times per second. That is why it is
 * described with `schema(...)`: Colyseus needs to know every field and type.
 *
 * ONLY public, physical facts live here (see PublicState in @insider/shared):
 * where people are, who sits where, and what each monitor shows from afar.
 * Nothing from the engine's World is ever put in here directly.
 */
import { MapSchema, schema, type SchemaType } from '@colyseus/schema';
import type { PublicState } from '@insider/shared';

export const PlayerSchema = schema({
  id: 'string',
  name: 'string',
  x: 'number',
  y: 'number',
  facing: 'string',
  seatedAt: 'string',
  activity: 'string',
}, 'PlayerSchema');
export type PlayerSchema = SchemaType<typeof PlayerSchema>;

export const DeskSchema = schema({
  hostname: 'string',
  screen: 'string',
  lockUser: 'string',
  occupantId: 'string',
}, 'DeskSchema');
export type DeskSchema = SchemaType<typeof DeskSchema>;

export const DoorSchema = schema({
  id: 'string',
  look: 'string',
}, 'DoorSchema');
export type DoorSchema = SchemaType<typeof DoorSchema>;

export const OfficeState = schema({
  clock: 'number',
  speed: 'number',
  reputation: 'number',
  players: { map: PlayerSchema },
  desks: { map: DeskSchema },
  doors: { map: DoorSchema },
}, 'OfficeState');
export type OfficeState = SchemaType<typeof OfficeState>;

export function newOfficeState(): OfficeState {
  const state = new OfficeState();
  state.clock = 0;
  state.speed = 1;
  state.reputation = 100;
  state.players = new MapSchema<PlayerSchema>();
  state.desks = new MapSchema<DeskSchema>();
  state.doors = new MapSchema<DoorSchema>();
  return state;
}

/** Copies fields that differ, so Colyseus only sends what really changed. */
function copy<T extends object>(target: T, source: Record<string, string | number>): void {
  const t = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(source)) if (t[key] !== value) t[key] = value;
}

/** Makes the synced state equal to the game's current public state. */
export function syncState(state: OfficeState, snapshot: PublicState): void {
  if (state.clock !== snapshot.clock) state.clock = snapshot.clock;
  if (state.speed !== snapshot.speed) state.speed = snapshot.speed;
  if (state.reputation !== snapshot.reputation) state.reputation = snapshot.reputation;

  for (const [id, player] of Object.entries(snapshot.players)) {
    let row = state.players.get(id);
    if (!row) state.players.set(id, (row = new PlayerSchema()));
    copy(row, { ...player });
  }
  for (const id of [...state.players.keys()]) if (!snapshot.players[id]) state.players.delete(id);

  for (const [hostname, desk] of Object.entries(snapshot.desks)) {
    let row = state.desks.get(hostname);
    if (!row) state.desks.set(hostname, (row = new DeskSchema()));
    copy(row, { ...desk });
  }
  for (const [id, door] of Object.entries(snapshot.doors)) {
    let row = state.doors.get(id);
    if (!row) state.doors.set(id, (row = new DoorSchema()));
    copy(row, { ...door });
  }
}
