import { describe, expect, it } from 'vitest';
import { INTERACT_DISTANCE, PLAYER_RADIUS, TAP_DISTANCE, isFree, nearestDesk, nearestReaderDoor, roomAt, type ServerMessages } from '@insider/shared';
import { Movement, besidesDesk } from '../../client/src/game/movement';
import { Recorder } from './helpers';

describe('E never falls through from a desk to something else', () => {
  /** Every free spot of the office (2 px apart) within reach of some desk / of no desk. */
  function spots(r: Recorder): { x: number; y: number; desk: string }[] {
    const list = [];
    for (let x = 0; x < r.map.width; x += 2) for (let y = 0; y < r.map.height; y += 2) {
      if (!isFree(r.map, x, y, PLAYER_RADIUS)) continue;
      const d = nearestDesk(r.map, x, y);
      list.push({ x, y, desk: d && d.distance <= INTERACT_DISTANCE ? d.desk.hostname : '' });
    }
    return list;
  }

  it('beside IT-WS-02, where the server room reader is in range too, a walking player can only mean the desk', () => {
    const r = new Recorder();
    r.connect('a', 'p1'); // Sara: her badge does not open the server room
    const spot = { x: 1542, y: 144 };
    const reader = nearestReaderDoor(r.map, spot.x, spot.y)!;
    expect(reader.door.code).toBe('SRV-ROOM');
    expect(reader.distance).toBeLessThanOrEqual(TAP_DISTANCE - 4); // the reader alone would accept a tap here
    const movement = new Movement();
    movement.request(); // a key is held: the desk hint is blank...
    expect(movement.desk(r.map, spot)).toBe('');
    expect(besidesDesk(r.map, spot)).toEqual({ door: null, monitors: false, button: false, talk: false }); // ...and E does not become a tap
  });

  it('holds everywhere in the office, and every reader, the monitors and the button can still be reached', () => {
    const r = new Recorder();
    const doors = new Set<string>();
    let monitors = 0;
    let button = 0;
    for (const s of spots(r)) {
      const other = besidesDesk(r.map, s);
      if (s.desk) expect(other, `${s.desk} at ${s.x},${s.y}`).toEqual({ door: null, monitors: false, button: false, talk: false });
      if (other.door) doors.add(`${other.door.code} from ${roomAt(r.map, s.x, s.y)}`);
      if (other.monitors) monitors++;
      if (other.button) button++;
    }
    for (const side of ['SRV-ROOM from IT department', 'SRV-ROOM from Server room']) expect(doors).toContain(side); // in and out
    for (const door of r.map.doors.filter((d) => d.reader)) expect([...doors].some((d) => d.startsWith(`${door.code} `)), door.code).toBe(true);
    expect(monitors).toBeGreaterThan(0);
    expect(button).toBeGreaterThan(0);
  });
});

describe('desk hints and authoritative stops', () => {
  it('reproduces a stale moving hint, then waits for the stop before offering a desk', () => {
    const r = new Recorder();
    r.connect('a', 'p5');
    r.connect('b', 'p1');
    const desk = r.map.desks.find((d) => d.hostname === 'IT-WS-02')!;
    expect(r.walkTo('a', 'p5', desk.seatX, desk.seatY + 38)).toBe(true);
    const old = r.position('p5');
    expect(Math.hypot(old.x - desk.seatX, old.y - desk.seatY)).toBeLessThanOrEqual(40);
    const movement = new Movement();
    const send = (dy: number) => {
      r.send('a', 'move', { dx: 0, dy, sequence: movement.request() });
      const ack = r.last('a', 'move.ack')!.payload as ServerMessages['move.ack'];
      movement.acknowledge(ack);
      return ack;
    };
    send(0);
    expect(movement.desk(r.map, old)).toBe(desk.hostname);
    send(1);
    r.tick(2); // The old 120 ms HUD still displayed the hint after these two ticks.
    expect(movement.desk(r.map, old)).toBe('');
    send(0);
    r.send('a', 'sit', { hostname: desk.hostname });
    expect(r.last('a', 'notice')!.payload).toEqual({ text: `You are too far from ${desk.hostname}.` });
    expect(movement.desk(r.map, r.position('p5'))).toBe('');
    expect(r.last('a', 'term.open')).toBeUndefined();
    expect(r.messages('b', 'move.ack')).toHaveLength(0);

    send(-1);
    r.tick(3);
    send(0);
    const stopped = r.position('p5');
    r.tick(10);
    expect(r.position('p5')).toEqual(stopped);
    expect(movement.desk(r.map, stopped)).toBe(desk.hostname);
    r.send('a', 'sit', { hostname: desk.hostname });
    expect(r.last('a', 'term.open')!.payload).toMatchObject({ hostname: desk.hostname });
  });

  it('ignores delayed acknowledgements, stale patches and positions outside the exact server boundary', () => {
    const r = new Recorder();
    const desk = r.map.desks.find((d) => d.hostname === 'IT-WS-02')!;
    const position = { x: desk.seatX, y: desk.seatY + INTERACT_DISTANCE };
    const movement = new Movement();
    const ack = { sequence: movement.request(), ...position, dx: 0, dy: 0 };
    movement.acknowledge(ack);
    expect(movement.desk(r.map, position)).toBe(desk.hostname);
    const fractional = { x: position.x + 0.1, y: position.y - 1.1 };
    movement.acknowledge({ ...ack, ...fractional });
    expect(movement.desk(r.map, { x: Math.fround(fractional.x), y: Math.fround(fractional.y) })).toBe(desk.hostname);
    movement.acknowledge(ack);
    expect(movement.desk(r.map, { ...position, y: position.y - 1 })).toBe('');
    movement.request();
    movement.acknowledge(ack);
    expect(movement.stopped).toBe(false);
    expect(movement.desk(r.map, position)).toBe('');
    const outside = { ...position, y: position.y + 0.01 };
    movement.acknowledge({ sequence: movement.sequence, ...outside, dx: 0, dy: 0 });
    // The patch rounds this just-outside position back onto the boundary. The
    // unrounded stop acknowledgement must still prevent a misleading hint.
    expect(movement.isStopped(position)).toBe(true);
    expect(movement.desk(r.map, position)).toBe('');
  });
});
