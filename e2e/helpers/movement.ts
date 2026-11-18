import { expect, test, type Page } from '@playwright/test';
import { clearPath, steeringAxis } from './navigation';
import { PLAYER_RADIUS } from '../../packages/shared/src/constants';

declare global {
  interface Window {
    __walk?: { done: boolean; dispose(): void };
  }
}
/** Every PC interaction waits for that desk's hint and a server-confirmed stop. */
export async function walkAndSit(page: Page, hostname: string, beforeSit?: () => Promise<void>): Promise<void> {
  await testStep(page, hostname, async () => {
    await walkToDesk(page, hostname);
    await expect(page.getByTestId('hint'), `Expected the Press E hint for ${hostname}`).toContainText(`to use ${hostname}`);
    await expect.poll(() => page.evaluate(() => window.__insider!.me()?.stopped), {
      message: `Expected the server to confirm stopping at ${hostname}`,
    }).toBe(true);
    await beforeSit?.();
    await page.keyboard.press('e');
    await expect(page.getByTestId('terminal'), `E did not open the terminal at ${hostname}`).toBeVisible();
    await expect(page.locator('.term-host'), `Opened the wrong terminal instead of ${hostname}`).toContainText(hostname);
    await expect(page.getByTestId('terminal'), `Waiting for the initial screen at ${hostname}`).toHaveAttribute('data-screen', /locked|login|shell/);
  });
}

async function testStep(page: Page, hostname: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const state = await page.evaluate(() => window.__insider?.me()).catch(() => null);
    throw new Error(`Could not walk and sit at ${hostname}; last state: ${JSON.stringify(state)}`, { cause: error });
  }
}

/** Walks to a desk's chair. */
export async function walkToDesk(page: Page, hostname: string): Promise<void> {
  await page.waitForFunction(() => window.__insider?.me() != null);
  const desk = (await page.evaluate(() => window.__insider!.desks())).find((d) => d.hostname === hostname);
  if (!desk) throw new Error('Unknown desk ' + hostname);
  await walkTo(page, desk.seatX, desk.seatY, 28);
}

/**
 * Walks to a point with the arrow keys, following a route around the walls.
 * When a closed badge door blocks the way, presses E to tap the badge.
 */
export async function walkTo(page: Page, x: number, y: number, arrivalRadius = 16): Promise<void> {
  await page.bringToFront(); // The two-player tests alternate tabs; steer the visible one.
  await page.waitForFunction(() => window.__insider?.me() != null && window.__insider.map() != null);
  // The route is computed inside the page: a breadth-first search over free tiles.
  const { route, map } = await page.evaluate((target) => {
    const api = window.__insider!;
    const map = api.map()!;
    const me = api.me()!;
    const tile = (v: number) => Math.floor(v / map.tile);
    const key = (c: number, r: number) => r * map.cols + c;
    const start = key(tile(me.x), tile(me.y));
    const goal = key(tile(target.x), tile(target.y));
    const previous = new Map<number, number>([[start, -1]]);
    const queue = [start];
    while (queue.length > 0) {
      const k = queue.shift()!;
      if (k === goal) break;
      const c = k % map.cols;
      const r = Math.floor(k / map.cols);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = key(c + dc, r + dr);
        if (map.solid[r + dr]?.[c + dc] !== false || previous.has(n)) continue;
        previous.set(n, k);
        queue.push(n);
      }
    }
    if (!previous.has(goal)) throw new Error('No route to ' + JSON.stringify(target));
    const points: { x: number; y: number }[] = [];
    for (let k = goal; k !== -1; k = previous.get(k)!) {
      points.unshift({ x: ((k % map.cols) + 0.5) * map.tile, y: (Math.floor(k / map.cols) + 0.5) * map.tile });
    }
    // Keep only the corners: fewer, longer walks.
    const corners = points.filter((p, i) => {
      const a = points[i - 1];
      const b = points[i + 1];
      return !a || !b || (a.x === p.x) !== (p.x === b.x);
    });
    return { route: [...corners, target], map };
  }, { x, y });

  let held: string | null = null;
  const stop = async () => {
    if (held) {
      await page.keyboard.up(held);
      held = null;
      await page.waitForFunction(() => window.__insider!.me()?.stopped);
    }
  };
  const began = Date.now();
  // A 20 px body in a 32 px tile has 6 px clearance on either side. Keep a
  // small rounding margin, but not a 1-5 px target that an entire server tick skips.
  const tolerance = map.tile / 2 - PLAYER_RADIUS - 0.1;
  const waypoints: { target: { x: number; y: number }; ms: number; corrections: number }[] = [];
  try {
    for (const [index, point] of route.entries()) {
      const started = Date.now();
      let corrections = 0;
      for (;;) {
        const me = await page.evaluate(() => window.__insider!.me()!);
        // Desks can be used before reaching the exact chair centre.
        if (Math.hypot(x - me.x, y - me.y) <= arrivalRadius) return;
        const dx = point.x - me.x, dy = point.y - me.y;
        if (Math.abs(dx) <= tolerance && Math.abs(dy) <= tolerance) break;
        const next = route[index + 1];
        // A waypoint is a route guide, not a pixel the player must land on. Once
        // nearby, continue if the whole body's next axis-aligned path is clear.
        // This avoids chasing a tile centre back and forth in an open corridor.
        if (next && Math.hypot(dx, dy) <= 32 && clearPath(map, me, next)) break;
        if (++corrections > 20) {
          const doors = await page.evaluate(() => window.__insider!.doors());
          throw new Error('No progress at waypoint ' + JSON.stringify({ point, me, doors }));
        }
        // Prefer the longer direction when that whole-body segment is clear. Requiring
        // exact sideways centring first can oscillate even in a wide, empty corridor.
        const axis = steeringAxis(map, me, point, tolerance);
        if (!axis) throw new Error('No clear approach to waypoint ' + JSON.stringify({ point, me }));
        const direction = Math.sign(point[axis] - me[axis]);
        held = axis === 'x' ? (direction > 0 ? 'ArrowRight' : 'ArrowLeft') : (direction > 0 ? 'ArrowDown' : 'ArrowUp');
        // Stop in the page's state-update callback. Waiting for Node to observe a patch and
        // send key-up adds automation round trips; in measured runs that overshot by 20-40 px.
        // This still uses the ordinary keyboard handler, never a position or movement bypass.
        await page.evaluate(async ({ axis, direction, point, key, tolerance, playerRadius }) => {
          const modulePath = '/src/game/store.ts';
          const { store } = await import(/* @vite-ignore */ modulePath);
          let armed = false;
          let previous = window.__insider!.me()!;
          let unchanged = 0;
          const arm = (event: KeyboardEvent) => { if (event.code === key) armed = true; };
          const check = () => {
            if (!armed) return;
            const api = window.__insider!, p = api.me()!;
            unchanged = p.x === previous.x && p.y === previous.y ? unchanged + 1 : 0;
            previous = p;
            // An unbadged door opens itself on the server tick after a walker reaches
            // its approach strip.  Its first few state patches have the same position
            // while that happens, so they are not evidence that the route is blocked.
            const automaticDoor = api.map()!.doors.find((door) => {
              if (door.reader) return false;
              const x = Math.max(door.x - p.x, 0, p.x - (door.x + door.width));
              const y = Math.max(door.y - api.map()!.tile - p.y, 0, p.y - (door.y + door.height + api.map()!.tile));
              return Math.hypot(x, y) <= playerRadius;
            });
            // Keep holding the ordinary movement key throughout an automatic door's
            // approach strip. The server opens it after the first blocked tick, and
            // stopping merely because that open event has not moved the body yet can
            // close the door again before the following tick carries the player through.
            if (direction * (point[axis] - p[axis]) <= tolerance || (unchanged >= 3 && !automaticDoor)) {
              window.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }));
              window.__walk!.done = true;
              window.__walk!.dispose();
            }
          };
          window.__walk = { done: false, dispose: () => {
            store.room.onStateChange.remove(check);
            window.removeEventListener('keydown', arm);
          } };
          window.addEventListener('keydown', arm);
          store.room.onStateChange(check);
        }, { axis: axis as 'x' | 'y', direction, point, key: held, tolerance, playerRadius: PLAYER_RADIUS });
        await page.keyboard.down(held);
        await page.waitForFunction(() => window.__walk?.done);
        await stop();
        const arrived = await page.evaluate(({ x, y, radius }) => {
          const p = window.__insider!.me()!;
          return Math.hypot(x - p.x, y - p.y) <= radius;
        }, { x, y, radius: arrivalRadius });
        if (arrived) return;
        const door = await page.evaluate(() => {
          const api = window.__insider!, p = api.me()!;
          return p.nearDoor && api.doors().find((d) => d.id === p.nearDoor && d.look !== 'open');
        });
        if (door) {
          await page.keyboard.press('e');
          await expect.poll(() => page.evaluate((id) => window.__insider!.doors().find((d) => d.id === id)?.look, door.id),
            { message: 'Badge did not open door ' + door.id }).toBe('open');
        }
      }
      waypoints.push({ target: point, ms: Date.now() - started, corrections });
    }
    const me = await page.evaluate(() => window.__insider!.me()!);
    expect(Math.hypot(x - me.x, y - me.y), 'Walk ended outside the requested destination').toBeLessThanOrEqual(arrivalRadius + 2);
  } finally {
    await page.evaluate(() => { window.__walk?.dispose(); delete window.__walk; }).catch(() => {});
    await stop();
    await test.info().attach('walk-' + x + '-' + y, {
      body: JSON.stringify({ destination: { x, y }, ms: Date.now() - began, waypoints,
        last: await page.evaluate(() => window.__insider?.me()).catch(() => null) }, null, 2),
      contentType: 'application/json',
    });
  }
}


