import { expect, type Page } from '@playwright/test';
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
  const desk = (await page.evaluate(() => window.__insider!.desks())).find((d) => d.hostname === hostname)!;
  await walkTo(page, desk.seatX, desk.seatY);
}

/**
 * Walks to a point with the arrow keys, following a route around the walls.
 * When a closed badge door blocks the way, presses E to tap the badge.
 */
export async function walkTo(page: Page, x: number, y: number): Promise<void> {
  // The route is computed inside the page: a breadth-first search over free tiles.
  const route = await page.evaluate((target) => {
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
    return [...corners, target];
  }, { x, y });

  const held = new Set<string>();
  const hold = async (wanted: string[]) => {
    for (const k of [...held]) if (!wanted.includes(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of wanted) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  let before = { x: NaN, y: NaN };
  let still = 0; // looks in a row without any movement
  for (const point of route) {
    for (let guard = 0; guard < 600; guard++) {
      const me = await page.evaluate(() => window.__insider!.me()!);
      // Did not move since the last look, next to a closed badge door: tap.
      if (me.x === before.x && me.y === before.y && me.nearDoor) {
        const closed = await page.evaluate((id) => window.__insider!.doors().find((d) => d.id === id)!.look !== 'open', me.nearDoor);
        if (closed) {
          await hold([]); // let go of the arrows, as a person would, then walk on
          await page.keyboard.press('e');
          await page.waitForTimeout(150);
        }
      }
      still = me.x === before.x && me.y === before.y ? still + 1 : 0;
      before = me;
      // Not moving although we should be: we are probably a few pixels off-centre and caught on a
      // door frame. Line up exactly (1 px instead of 6) until we are moving again.
      const tolerance = still >= 3 ? 1 : 6;
      const dx = point.x - me.x;
      const dy = point.y - me.y;
      const keys: string[] = [];
      // Arrive within 6 px: a tile is 32 px and a player 20 px wide, so being
      // further off-centre than that can snag on a door frame at the next turn.
      if (Math.abs(dx) > tolerance) keys.push(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
      if (Math.abs(dy) > tolerance) keys.push(dy > 0 ? 'ArrowDown' : 'ArrowUp');
      await hold(keys);
      if (keys.length === 0) break;
      await page.waitForTimeout(60); // at least one server tick (50 ms), or the step might not happen at all
      // Close to the target: take one short step, stop, and look again.
      // (Walking on while reading a slightly old position would overshoot,
      // turn back, and oscillate on a slow computer.)
      if (Math.max(Math.abs(dx) > 6 ? Math.abs(dx) : 0, Math.abs(dy) > 6 ? Math.abs(dy) : 0) < 40) {
        await hold([]);
        await page.waitForTimeout(130);
      }
    }
  }
  await hold([]);
}


