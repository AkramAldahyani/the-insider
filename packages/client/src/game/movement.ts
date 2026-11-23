import {
  BUTTON_DISTANCE, INTERACT_DISTANCE, TAP_DISTANCE, distanceToRect, nearestDesk, nearestReaderDoor,
  type MapDoor, type OfficeMap, type ServerMessages,
} from '@insider/shared';

/**
 * What else the E key could mean at this point: a badge reader, the security
 * monitors or the emergency button. None of them while a desk is within reach.
 *
 * The desk's own hint is blank while walking (see Movement below), so without
 * this rule E would "fall through" to the next thing. Next to IT-WS-02 that is
 * the server room's badge reader, and a badge log line nobody meant to leave is
 * false evidence against an innocent player.
 */
export function besidesDesk(map: OfficeMap, position: { x: number; y: number }): { door: MapDoor | null; monitors: boolean; button: boolean } {
  const { x, y } = position;
  const desk = nearestDesk(map, x, y);
  if (desk && desk.distance <= INTERACT_DISTANCE) return { door: null, monitors: false, button: false };
  const door = nearestReaderDoor(map, x, y);
  const near = (kind: string, distance: number) => map.furniture.some((f) => f.kind === kind && distanceToRect(f, x, y) <= distance);
  // A little less than the server allows, so a hint is never shown a step too early.
  return {
    door: door && door.distance <= TAP_DISTANCE - 4 ? door.door : null,
    monitors: near('monitors', INTERACT_DISTANCE - 4),
    button: near('button', BUTTON_DISTANCE - 4),
  };
}

/** A stop is confirmed by the server, not inferred from two identical pictures. */
export class Movement {
  sequence = 0;
  stopped = false;
  position: { x: number; y: number } | null = null;

  request(): number {
    this.stopped = false;
    this.position = null;
    return ++this.sequence;
  }

  acknowledge(reply: ServerMessages['move.ack']): void {
    // An older stop may arrive after the player has already started walking again.
    if (reply.sequence !== this.sequence) return;
    this.stopped = reply.dx === 0 && reply.dy === 0;
    this.position = this.stopped ? { x: reply.x, y: reply.y } : null;
  }

  isStopped(position: { x: number; y: number }): boolean {
    // Public patches round to tenths, then Colyseus encodes them as float32.
    const publicCoordinate = (n: number) => Math.fround(Math.round(n * 10) / 10);
    return this.stopped && this.position !== null && Math.fround(position.x) === publicCoordinate(this.position.x)
      && Math.fround(position.y) === publicCoordinate(this.position.y);
  }

  desk(map: OfficeMap, position: { x: number; y: number }): string {
    if (!this.isStopped(position)) return '';
    const near = nearestDesk(map, this.position!.x, this.position!.y);
    return near && near.distance <= INTERACT_DISTANCE ? near.desk.hostname : '';
  }
}
