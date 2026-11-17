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

/** Walks to a desk's chair. */
async function walkToDesk(page: Page, hostname: string): Promise<void> {
  const desk = (await page.evaluate(() => window.__insider!.desks())).find((d) => d.hostname === hostname)!;
  await walkTo(page, desk.seatX, desk.seatY);
}

/**
 * Walks to a point with the arrow keys, following a route around the walls.
 * When a closed badge door blocks the way, presses E to tap the badge.
 */
async function walkTo(page: Page, x: number, y: number): Promise<void> {
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
  await expect(page.getByTestId('card-badge')).toHaveText('#0412');
  const password = await page.getByTestId('card-password').innerText();
  await expect(page.getByTestId('room')).toHaveText('Finance');
  await page.screenshot({ path: `${SHOTS}/2-office-and-card.png` });

  // Her task list: three open tasks, none finished. T hides and shows it.
  await expect(page.getByTestId('tasks').locator('.task')).toHaveCount(3);
  await expect(page.getByTestId('tasks-completed')).toHaveText('0 done');
  await page.keyboard.press('t');
  await expect(page.getByTestId('tasks')).toBeHidden();
  await page.keyboard.press('t');
  await expect(page.getByTestId('tasks')).toBeVisible();

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

  // Pin evidence: double-click a word in the terminal to select it, then "Pin selection".
  await page.locator('.xterm-rows').getByText('FIN-LT-07', { exact: true }).first().dblclick();
  await page.getByTestId('pin-selection').click();
  await expect(page.getByTestId('notice')).toContainText('Pinned to the evidence board as E1');
  await expect(page.getByTestId('board-button')).toContainText('Evidence (1)');
  await page.locator('.xterm-helper-textarea').focus();

  // 6. Esc stands up; the PC stays unlocked (standing must not lock).
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('terminal')).toBeHidden();
  expect((await page.evaluate(() => window.__insider!.desks())).find((d) => d.hostname === 'FIN-LT-07')!.screen).toBe('unlocked');
  // The board (B) shows the pin.
  await page.keyboard.press('b');
  await expect(page.getByTestId('evidence-E1')).toContainText('FIN-LT-07 screen');
  await expect(page.getByTestId('evidence-E1')).toContainText('pinned by Sara Alharbi');
  await page.screenshot({ path: `${SHOTS}/15-evidence-board.png` });
  await page.keyboard.press('b');
  await expect(page.getByTestId('board')).toBeHidden();

  // 7. Walk to Lina's desk in HR, which she left unlocked. Two badge doors are on the way.
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
  await dev.getByLabel('Desk').selectOption('REC-PC-01');
  await dev.getByRole('button', { name: 'go' }).nth(1).click(); // teleport
  await expect(page.getByTestId('room')).toHaveText('Reception');
  await dev.getByRole('button', { name: 'show last' }).click();
  await expect(page.getByTestId('dev-log')).toContainText('Master event log');
  // Server-only views: the doors, and the latest picture of a camera (Khalid is in Reception, in view of CAM-01).
  await dev.getByRole('button', { name: 'doors' }).click();
  await expect(page.getByTestId('dev-log')).toContainText('SRV-ROOM    badge, zone server-room');
  // Cameras look every 2 game seconds, so ask again until the picture taken after the teleport is there.
  await expect.poll(async () => {
    await dev.getByRole('button', { name: 'snapshot' }).click();
    await page.waitForTimeout(300);
    return page.getByTestId('dev-log').innerText();
  }, { timeout: 15_000 }).toMatch(/CAM-01 Reception \(watches Reception[\s\S]*Khalid Nasser/);
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

test('badge doors: a refused badge keeps the security office shut', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('employee-p1').click(); // Sara: her badge opens only the normal doors
  await expect(page.getByTestId('card')).toBeVisible();
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__insider?.me() != null);
  const look = (id: string) => page.evaluate((door) => window.__insider!.doors().find((d) => d.id === door)!.look, id);

  // Out of Finance (her badge opens that door) and along the corridor to the security office door.
  await walkTo(page, 15.5 * 32, 17.5 * 32);
  await expect(page.getByTestId('room')).toHaveText('Corridor');
  await expect(page.getByTestId('hint')).toContainText('tap your badge at the security office door');
  await page.keyboard.press('e');
  await expect(page.getByTestId('notice')).toContainText('Access denied');
  expect(await look('SEC-OFFICE')).toBe('denied');
  await page.screenshot({ path: `${SHOTS}/10-badge-denied.png` });

  // She cannot walk in.
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(700);
  await page.keyboard.up('ArrowDown');
  await expect(page.getByTestId('room')).toHaveText('Corridor');
  await expect.poll(() => look('SEC-OFFICE')).toBe('closed');
});

test('joining as the hacker: a private briefing and a hidden tools folder; the role is then taken', async ({ page, browser }) => {
  await page.goto('/');
  const option = page.getByTestId('join-as-hacker');
  await expect(option).toBeEnabled();
  await option.check();
  await page.getByTestId('employee-p4').click(); // Omar, Marketing
  // First the ordinary onboarding card (he looks like any employee); closing it shows the briefing.
  const password = await page.getByTestId('card-password').innerText();
  await page.keyboard.press('c');
  await expect(page.getByTestId('mission')).toBeVisible();
  await expect(page.getByTestId('mission-goal')).toContainText('/root/flag.txt');
  await page.screenshot({ path: `${SHOTS}/11-hacker-briefing.png` });

  // M hides and shows the briefing.
  await page.keyboard.press('m');
  await expect(page.getByTestId('mission')).toBeHidden();
  await page.keyboard.press('m');
  await expect(page.getByTestId('mission')).toBeVisible();

  // Someone else opening the game sees that the role is taken, and gets no briefing.
  const other = await (await browser.newContext()).newPage();
  await other.goto('/');
  await expect(other.getByTestId('join-as-hacker')).toBeDisabled();
  await other.getByTestId('employee-p1').click();
  await expect(other.getByTestId('card')).toBeVisible();
  await expect(other.getByTestId('mission')).toHaveCount(0);
  await other.close();

  // On his own PC the tools folder is there, but only `ls -a` shows it.
  await walkToDesk(page, 'MKT-LT-11');
  await page.keyboard.press('e');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'locked');
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');
  await page.keyboard.type('ls -a');
  await page.keyboard.press('Enter');
  await expect.poll(() => terminalText(page)).toContain('.tools');
  await page.keyboard.type('cat .tools/README');
  await page.keyboard.press('Enter');
  await expect.poll(() => terminalText(page)).toContain('Every tool leaves a trace');

  // The USB stick: stand at Yousef's open PC (same room) and hold U for 5 seconds.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('terminal')).toBeHidden();
  await walkToDesk(page, 'MKT-LT-09');
  await expect(page.getByTestId('hint')).toContainText('hold U to plug in the USB stick');
  await page.keyboard.down('u');
  await expect(page.getByTestId('notice')).toContainText('keep holding U');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/12-usb-stick.png` });
  await expect(page.getByTestId('notice')).toContainText('Backdoor installed on MKT-LT-09 for y.khalil', { timeout: 10_000 });
  await page.keyboard.up('u');
});

test('the hacker reads a forgotten root password, gets the flag, hands it in, and everybody sees the end', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByTestId('join-as-hacker').check();
  await page.getByTestId('employee-p4').click(); // Omar
  const password = await page.getByTestId('card-password').innerText();
  await page.keyboard.press('c');

  // Somebody else is in the office too.
  const other = await (await browser.newContext()).newPage();
  await other.goto('/');
  await other.getByTestId('employee-p1').click();
  await expect(other.getByTestId('card')).toBeVisible();

  const run = async (line: string) => {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  };
  await walkToDesk(page, 'MKT-LT-11');
  await page.keyboard.press('e');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'locked');
  await run(password);
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');
  await run('ssh ADMIN-SRV-01');
  await expect.poll(() => terminalText(page)).toContain("o.farouk@ADMIN-SRV-01's password:");
  await run(password);
  await expect.poll(() => terminalText(page)).toContain('o.farouk@ADMIN-SRV-01:~$');
  await run('cat /srv/shared/old/backup-2025.sh');
  await expect.poll(() => terminalText(page)).toContain('ROOT_PW=');
  const rootPassword = /ROOT_PW='([^']+)'/.exec(await terminalText(page))![1];
  await run('clear');
  await run('su');
  await run(rootPassword);
  await expect.poll(() => terminalText(page)).toContain('root@ADMIN-SRV-01');
  await run('cat /root/flag.txt');
  await expect.poll(() => terminalText(page)).toMatch(/NEXORA\{[^}]+\}/);
  const flag = /NEXORA\{[^}]+\}/.exec(await terminalText(page))![0];

  // Stand up, open the briefing, hand it in.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('terminal')).toBeHidden();
  await expect(page.getByTestId('mission')).toBeVisible();
  await page.getByTestId('flag-input').fill(flag);
  await page.getByTestId('flag-submit').click();
  await expect(page.getByTestId('match-over')).toContainText('You got the flag out. You win.');
  await page.screenshot({ path: `${SHOTS}/13-hacker-wins.png` });
  // The other player is told who it was.
  await expect(other.getByTestId('match-over')).toContainText('The hacker got the flag out.');
  await expect(other.getByTestId('match-over-hacker')).toHaveText('Omar Farouk');
  await other.close();
});

test('the guard uses the security monitors: camera pictures, badge log', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('employee-p10').click(); // Tariq, in the security office
  await expect(page.getByTestId('card')).toBeVisible();
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__insider?.me() != null && window.__insider.map() != null);
  const station = await page.evaluate(() => window.__insider!.monitors());
  await walkTo(page, station.x, station.y);
  await expect(page.getByTestId('hint')).toContainText('security monitors');
  await page.keyboard.press('e');
  await expect(page.getByTestId('monitors')).toBeVisible();
  await page.getByTestId('camera-CAM-01').click();
  await expect(page.getByTestId('monitors-who')).toContainText(/\d\d:\d\d:\d\d/);
  await page.screenshot({ path: `${SHOTS}/14-security-monitors.png` });
  await page.getByTestId('monitors-tab-badges').click();
  await expect(page.getByTestId('monitors-badges')).toContainText('DOOR=MAIN-ENT BADGE=0119 USER=t.omar');
  // Walking away switches them off.
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowUp');
  await expect(page.getByTestId('monitors')).toBeHidden();
});
