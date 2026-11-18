import { INTERACT_DISTANCE, nearestDesk, type OfficeMap, type ServerMessages } from '@insider/shared';

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
