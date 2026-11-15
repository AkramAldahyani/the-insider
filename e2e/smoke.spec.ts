/**
 * Smoke test: one player plays through the heart of Phase 2 in a real browser.
 *
 *   open the game -> pick Sara -> walk to her desk -> unlock it -> `whoami`
 *   -> stand up -> walk to Lina's UNLOCKED desk -> `whoami` says l.haddad
 *
 * The test only uses what a player has: the keyboard and what is on screen.
 * To know where to walk it reads the public position and map that the page
 * exposes as `window.__insider` (see client/src/main.tsx).
 */
import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'e2e/screenshots';

/** Text currently visible in the PC terminal. */
async function terminalText(page: Page): Promise<string> {
  return page.locator('.xterm-rows').innerText();
}

/** Walks to a desk's chair with the arrow keys, following a route around the walls. */
async function walkToDesk(page: Page, hostname: string): Promise<void> {
  // The route is computed inside the page: a breadth-first search over free tiles.
  const route = await page.evaluate((host) => {
    const api = window.__insider!;
    const map = api.map()!;
    const me = api.me()!;
    const desk = api.desks().find((d) => d.hostname === host)!;
    const tile = (v: number) => Math.floor(v / map.tile);
    const key = (c: number, r: number) => r * map.cols + c;
    const start = key(tile(me.x), tile(me.y));
    const goal = key(tile(desk.seatX), tile(desk.seatY));
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
    return [...corners, { x: desk.seatX, y: desk.seatY }];
  }, hostname);

  const held = new Set<string>();
  const hold = async (wanted: string[]) => {
    for (const k of [...held]) if (!wanted.includes(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of wanted) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  for (const point of route) {
    for (let guard = 0; guard < 600; guard++) {
      const me = await page.evaluate(() => window.__insider!.me()!);
      const dx = point.x - me.x;
      const dy = point.y - me.y;
      const keys: string[] = [];
      // Arrive within 6 px: a tile is 32 px and a player 20 px wide, so being
      // further off-centre than that can snag on a door frame at the next turn.
      if (Math.abs(dx) > 6) keys.push(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
      if (Math.abs(dy) > 6) keys.push(dy > 0 ? 'ArrowDown' : 'ArrowUp');
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

test('walk to a desk, log in, then use someone else\'s unlocked PC', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Open the game and pick an employee.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'THE INSIDER' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1-start-screen.png` });
  await page.getByTestId('employee-p1').click();

  // 2. The onboarding card shows her own credentials.
  await expect(page.getByTestId('card')).toBeVisible();
  await expect(page.getByTestId('card-username')).toHaveText('s.alharbi');
  await expect(page.getByTestId('card-your-pc')).toHaveText('FIN-LT-07');
  const password = await page.getByTestId('card-password').innerText();
  await expect(page.getByTestId('room')).toHaveText('Finance');
  await page.screenshot({ path: `${SHOTS}/2-office-and-card.png` });

  // C hides and shows the card.
  await page.keyboard.press('c');
  await expect(page.getByTestId('card')).toBeHidden();

  // 3. Walk to her desk; the hint appears; E opens the PC.
  await walkToDesk(page, 'FIN-LT-07');
  await expect(page.getByTestId('hint')).toContainText('FIN-LT-07');
  await page.screenshot({ path: `${SHOTS}/3-at-desk.png` });
  await page.keyboard.press('e');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', /locked|shell/);
  // If this test ran less than a minute ago on the same server, her PC is still open: lock it first.
  if ((await page.getByTestId('terminal').getAttribute('data-screen')) === 'shell') {
    await page.keyboard.type('loginctl lock-session');
    await page.keyboard.press('Enter');
  }
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'locked');
  await expect.poll(() => terminalText(page)).toContain('screen locked by s.alharbi');

  // 4. The password is shown as stars, never as text.
  await page.keyboard.type(password);
  const typed = await terminalText(page);
  expect(typed).toContain('*'.repeat(password.length));
  expect(typed).not.toContain(password);
  await page.screenshot({ path: `${SHOTS}/4-lock-screen.png` });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');

  // 5. Use the shell.
  await page.keyboard.type('whoami');
  await page.keyboard.press('Enter');
  await expect.poll(() => terminalText(page)).toMatch(/whoami\s*\n\s*s\.alharbi\s*\n/);
  await page.keyboard.type('hostname && ip a | grep inet');
  await page.keyboard.press('Enter');
  await expect.poll(() => terminalText(page)).toContain('FIN-LT-07');
  // Ctrl+C throws the half-typed line away.
  await page.keyboard.type('rm -rf everything');
  await page.keyboard.press('Control+c');
  await expect.poll(() => terminalText(page)).toContain('^C');
  await page.screenshot({ path: `${SHOTS}/5-shell.png` });

  // 6. Esc stands up; the PC stays unlocked (standing must not lock).
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('terminal')).toBeHidden();
  expect((await page.evaluate(() => window.__insider!.desks())).find((d) => d.hostname === 'FIN-LT-07')!.screen).toBe('unlocked');

  // 7. Walk to Lina's desk in HR, which she left unlocked.
  await walkToDesk(page, 'HR-LT-03');
  await expect(page.getByTestId('room')).toHaveText('HR');
  await page.screenshot({ path: `${SHOTS}/6-at-unlocked-desk.png` });
  await page.keyboard.press('e');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell'); // no password asked
  await page.keyboard.type('whoami');
  await page.keyboard.press('Enter');
  await expect.poll(() => terminalText(page)).toMatch(/whoami\s*\n\s*l\.haddad\s*\n/);
  await page.screenshot({ path: `${SHOTS}/7-someone-elses-shell.png` });

  expect(errors).toEqual([]);
});

test('switch user on a locked PC, and the developer panel', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('employee-p5').click(); // Khalid, the sysadmin
  const password = await page.getByTestId('card-password').innerText();
  await page.keyboard.press('c');

  // The developer panel (backtick) exists because this is a development server.
  await page.keyboard.press('Backquote');
  const dev = page.getByTestId('dev-panel');
  await expect(dev).toBeVisible();
  await dev.getByRole('combobox').selectOption('REC-PC-01');
  await dev.getByRole('button', { name: 'go' }).nth(1).click(); // teleport
  await expect(page.getByTestId('room')).toHaveText('Reception');
  await dev.getByRole('button', { name: 'show last' }).click();
  await expect(page.getByTestId('dev-log')).toContainText('Master event log');
  await page.screenshot({ path: `${SHOTS}/8-dev-panel.png` });
  await page.keyboard.press('Backquote');
  await expect(dev).toBeHidden();

  // Maha's PC is locked. Khalid has an account on it, so he can switch user.
  await walkToDesk(page, 'REC-PC-01');
  await page.keyboard.press('e');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'locked');
  await page.getByRole('button', { name: 'Switch user (F2)' }).click();
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'login');
  await expect.poll(() => terminalText(page)).toContain('still logged in and locked: m.yousef');
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('k.nasser');
  await page.keyboard.press('Enter');
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');
  await page.keyboard.type('who');
  await page.keyboard.press('Enter');
  await expect.poll(() => terminalText(page)).toMatch(/m\.yousef\s+tty1[\s\S]*k\.nasser\s+tty2/);
  await page.screenshot({ path: `${SHOTS}/9-switch-user.png` });

  // Logging out brings Maha's lock screen back: her session was never touched.
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'locked');
  await expect.poll(() => terminalText(page)).toContain('screen locked by m.yousef');
});
