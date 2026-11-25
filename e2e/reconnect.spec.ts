/**
 * Phase 6, part F: lost connections in real browsers. The line breaks and the
 * page comes back by itself; a reload can go back too; leaving ends what it must.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

/** A browser of its own whose line to the server can be cut. */
async function person(browser: Browser, name: string, code?: string) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  let down = false;
  // The page's own connections, so that the test can break them (not those of Vite, which would reload the page).
  await page.addInitScript(() => {
    const open: WebSocket[] = [];
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (!String(protocols ?? '').includes('vite')) open.push(this);
      }
    };
    Object.assign(window, {
      __cut: () => { for (const s of open.splice(0)) s.close(3001, 'cut'); },
      __deaf: () => { for (const s of open) s.onmessage = null; },
    });
  });
  await page.route('**/matchmake/**', (route) => (down ? route.abort() : route.continue()));
  await page.goto(code ? `/?lobby=${code}` : '/');
  await page.getByTestId('friends-name').fill(name);
  await page.getByTestId(code ? 'friends-join' : 'friends-create').click();
  await expect(page.getByTestId('party')).toBeVisible();
  return {
    page,
    cut: async () => {
      down = true;
      await page.evaluate(() => (window as unknown as { __cut: () => void }).__cut());
    },
    repair: () => { down = false; },
    /** The line looks open, but nothing arrives any more (as after the Wi-Fi went away). */
    deaf: () => page.evaluate(() => (window as unknown as { __deaf: () => void }).__deaf()),
  };
}
const me = (page: Page) => page.evaluate(() => window.__insider!.me());
const roster = (page: Page) => page.getByTestId('roster').locator('.roster-person');

test('the line breaks and comes back, a reload goes back, and leaving ends the match of three', async ({ browser }) => {
  test.setTimeout(3 * 60_000);
  const { page: anna } = await person(browser, 'Anna');
  const code = (await anna.getByTestId('party-code').textContent())!;
  const benLine = await person(browser, 'Ben', code);
  const ben = benLine.page;
  const { page: cleo } = await person(browser, 'Cleo', code);
  await anna.getByTestId('party-bots').click();

  // In the lobby: Cleo reloads her page. The others see it, the start waits, and she can go back.
  await cleo.getByTestId('party-ready').click();
  await cleo.goto('/');
  await expect(anna.getByTestId('party-members')).toContainText('connection lost');
  await expect(anna.getByTestId('party-note')).toHaveText('Cleo lost the connection. Their place is kept for a minute.');
  await expect(cleo.getByTestId('menu-place')).toContainText(code);
  await cleo.screenshot({ path: 'e2e/screenshots/reconnect-menu.png' });
  await cleo.getByTestId('menu-go-back').click();
  await expect(cleo.getByTestId('party-code')).toHaveText(code);
  await expect(anna.getByTestId('party-members')).not.toContainText('connection lost');
  await expect(anna.getByTestId('party-members').locator('li')).toHaveCount(3);

  for (const page of [ben, cleo]) await page.getByTestId('party-ready').click();
  await anna.getByTestId('party-start').click();
  for (const page of [anna, ben, cleo]) {
    await page.getByTestId('reveal-close').click();
    await page.keyboard.press('c');
    await page.waitForFunction(() => window.__insider?.me() != null);
  }
  const self = await ben.locator('.roster-self').innerText();
  const before = (await me(ben))!;

  // In the match: Ben's line breaks. Nobody else notices anything.
  await benLine.cut();
  await expect(ben.getByTestId('reconnecting')).toBeVisible({ timeout: 25_000 }); // (a closing connection may take a moment; at the latest the silence is noticed)
  await ben.screenshot({ path: 'e2e/screenshots/reconnect.png' });
  await ben.keyboard.press('ArrowRight');
  for (const page of [anna, cleo]) await expect(roster(page)).toHaveCount(3);
  await ben.waitForTimeout(3000);
  await expect(ben.getByTestId('reconnecting')).toBeVisible();
  benLine.repair();
  await expect(ben.getByTestId('reconnecting')).toHaveCount(0, { timeout: 15_000 });
  await expect(ben.getByTestId('notice')).toHaveText('You are back.');
  expect(await ben.locator('.roster-self').innerText()).toBe(self);
  await expect.poll(async () => (await me(ben))?.stopped).toBe(true);
  expect(await me(ben)).toMatchObject({ x: before.x, y: before.y });
  // The keys walk again.
  await ben.bringToFront();
  let walked = false;
  for (const key of ['ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight']) { // (furniture may be in the way of some)
    await ben.keyboard.down(key);
    await ben.waitForTimeout(400);
    await ben.keyboard.up(key);
    const p = (await me(ben))!;
    walked ||= p.x !== before.x || p.y !== before.y;
  }
  expect(walked).toBe(true);

  // A reload in the middle of the match.
  await ben.goto('/');
  await ben.getByTestId('menu-go-back').click();
  await expect(ben.getByTestId('party-hud')).toHaveText(`Lobby ${code}`, { timeout: 20_000 }); // (drawing the map again blocks a slow machine for seconds)
  await expect(ben.getByTestId('reveal')).toHaveCount(0);
  expect(await ben.locator('.roster-self').innerText()).toBe(self);
  await expect(ben.getByTestId('tasks').locator('.task').first()).toBeVisible();

  // A dead line that looks alive: the page notices the silence by itself.
  // (It may be back so quickly that "Connection lost" is hardly seen.)
  await expect(ben.getByTestId('notice')).toHaveCount(0, { timeout: 10_000 });
  await benLine.deaf();
  await expect(ben.getByTestId('notice')).toHaveText('You are back.', { timeout: 40_000 });
  await expect(ben.getByTestId('reconnecting')).toHaveCount(0);

  // Anna, the host, leaves for good: with two people left somebody has won, and the lobby has a new host.
  await anna.getByTestId('leave').click();
  await anna.getByTestId('leave').click();
  await expect(anna.getByTestId('menu')).toBeVisible();
  await expect(anna.getByTestId('menu-place')).toHaveCount(0); // she left, so nothing is kept
  for (const page of [ben, cleo]) {
    await expect(page.getByTestId('match-over')).toBeVisible();
    await expect(page.getByTestId('cast').locator('li')).toHaveCount(3);
    expect(await page.getByTestId('match-over').innerText()).toMatch(/The hacker left the company\.|Only 1 defender is left/);
    await page.getByTestId('back-to-party').click();
  }
  await expect(ben.getByTestId('party-members').locator('li')).toHaveCount(2);
  await expect(ben.getByTestId('party-start')).toBeVisible(); // the one who was here longest
  await expect(cleo.getByTestId('party-ready')).toBeVisible();
  for (const page of [anna, ben, cleo]) await page.context().close();
});

test('a solo match survives a reload, and the player may also forget it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('menu-investigation').click();
  await expect(page.getByTestId('mode')).toBeVisible();
  const name = await page.getByTestId('card').innerText();
  await page.reload();
  await expect(page.getByTestId('menu-place')).toContainText('Investigation');
  await page.getByTestId('menu-go-back').click();
  await expect(page.getByTestId('mode')).toBeVisible();
  await page.keyboard.press('c');
  expect(await page.getByTestId('card').innerText()).toBe(name);
  await page.reload();
  await page.getByTestId('menu-forget').click();
  await expect(page.getByTestId('menu-place')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('menu')).toBeVisible();
  await expect(page.getByTestId('menu-place')).toHaveCount(0);
});
