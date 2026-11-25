/**
 * Phase 6, part E: somebody is voted out in a real browser and watches: a free
 * view, following people, hearing every room, and nothing that reaches the others.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { openOffice } from './helpers/menu';
import { walkAndSit, walkTo } from './helpers/movement';

async function employee(browser: Browser, id: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await openOffice(page);
  await page.getByTestId(`employee-${id}`).click();
  await expect(page.getByTestId('card')).toBeVisible();
  await page.waitForFunction(() => window.__insider?.me() != null);
  return page;
}
const view = (page: Page) => page.evaluate(() => window.__insider!.view());
const names = (page: Page) => page.locator('.roster-name').allInnerTexts();

test('voted out: a free view, following people, hearing every room, and no way to reach the others', async ({ browser }) => {
  test.setTimeout(6 * 60_000);
  const sara = await employee(browser, 'p1');
  const password = await sara.getByTestId('card-password').innerText();
  await sara.keyboard.press('c');

  // Sara pins three lines of her screen and goes to the emergency button. (The others come later: steering three windows at once is slow.)
  await walkAndSit(sara, 'FIN-LT-07');
  if ((await sara.getByTestId('terminal').getAttribute('data-screen')) === 'login') {
    await sara.keyboard.type('s.alharbi');
    await sara.keyboard.press('Enter');
  }
  await sara.keyboard.type(password);
  await sara.keyboard.press('Enter');
  await expect(sara.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');
  for (const n of [1, 2, 3]) {
    await sara.keyboard.type(`echo evidence-${n}`);
    await sara.keyboard.press('Enter');
    await sara.locator('.xterm-rows > div', { hasText: new RegExp(`^evidence-${n}`) }).last().click({ clickCount: 3, position: { x: 30, y: 6 } });
    await sara.getByTestId('pin-selection').click();
    await expect(sara.getByTestId('board-button')).toContainText(`Evidence (${n})`);
    await sara.locator('.xterm-helper-textarea').focus();
  }
  await sara.keyboard.press('Escape');
  const button = await sara.evaluate(() => window.__insider!.button());
  await walkTo(sara, button.x, button.y, 24);
  const rami = await employee(browser, 'p2');
  const lina = await employee(browser, 'p3');
  await lina.keyboard.press('c');
  // She calls a meeting and accuses Rami.
  await sara.bringToFront();
  await expect(sara.getByTestId('hint')).toContainText('call an emergency meeting');
  await sara.keyboard.press('e');
  await sara.getByTestId('accuse-suspect').selectOption('p2');
  for (const id of ['E1', 'E2', 'E3']) await sara.getByTestId(`accuse-evidence-${id}`).check();
  await sara.getByTestId('accuse-submit').click();
  await Promise.all([sara, lina].map((page) => page.getByTestId('vote-p2').click({ timeout: 40_000 })));
  await expect(rami.getByTestId('fired')).toBeVisible({ timeout: 30_000 });

  // Rami can still follow the rest of the meeting, and then watches.
  await expect(rami.getByTestId('meeting')).toBeHidden({ timeout: 15_000 });
  await expect(rami.getByTestId('fired')).toContainText('You were voted out at the meeting.');
  for (const id of ['tasks', 'card', 'case', 'mission', 'chat-panel', 'chat-button', 'hint']) await expect(rami.getByTestId(id)).toHaveCount(0);
  for (const key of ['c', 't', 'm', 'e', 'x', 'u']) await rami.keyboard.press(key);
  for (const id of ['tasks', 'card', 'case', 'mission']) await expect(rami.getByTestId(id)).toHaveCount(0);
  expect(await names(sara)).not.toContain('Rami Mansour');
  const clock = await rami.getByTestId('clock').innerText();
  await expect.poll(() => rami.getByTestId('clock').innerText()).not.toBe(clock); // time goes on for him too

  // Following: N, the buttons, the list of people.
  await rami.keyboard.press('n');
  await expect(rami.getByTestId('watching')).toHaveText('Following Sara Alharbi');
  await rami.getByTestId('watch-next').click();
  await expect(rami.getByTestId('watching')).toHaveText('Following Lina Haddad');
  await rami.locator('.roster-person', { hasText: 'Sara Alharbi' }).click();
  await expect(rami.getByTestId('watching')).toHaveText('Following Sara Alharbi');
  // The view goes with her.
  const start = await view(rami);
  await sara.bringToFront();
  await sara.keyboard.down('ArrowLeft');
  await sara.keyboard.down('ArrowDown');
  await sara.waitForTimeout(900);
  await sara.keyboard.up('ArrowLeft');
  await sara.keyboard.up('ArrowDown');
  const her = (await sara.evaluate(() => window.__insider!.me()))!;
  await rami.bringToFront();
  await rami.waitForTimeout(1500);
  const now = await view(rami);
  expect(Math.hypot(now.x - start.x, now.y - start.y)).toBeGreaterThan(20);
  await expect(rami.getByTestId('room')).toHaveText(her.room);
  await rami.screenshot({ path: 'e2e/screenshots/watching.png' });

  // Moving freely: keys, the mouse, the wheel.
  await rami.bringToFront();
  const before = await view(rami);
  await rami.keyboard.down('ArrowRight');
  await rami.waitForTimeout(700);
  await rami.keyboard.up('ArrowRight');
  await expect(rami.getByTestId('watching')).toHaveText('Moving freely');
  const moved = await view(rami);
  expect(moved.follows).toBe('');
  expect(moved.x).toBeGreaterThan(before.x + 60);
  const box = (await rami.locator('.map canvas').boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  await rami.mouse.move(cx - 80, cy);
  await rami.mouse.down();
  await rami.mouse.move(cx, cy, { steps: 8 });
  await rami.mouse.up();
  await expect.poll(async () => (await view(rami)).x).toBeLessThan(moved.x - 30); // dragged to the right: the view goes left
  await rami.mouse.wheel(0, -300);
  await expect.poll(async () => (await view(rami)).zoom).toBeGreaterThan(1.05);
  for (let i = 0; i < 12; i++) await rami.getByTestId('watch-further').click();
  await expect.poll(async () => (await view(rami)).zoom).toBeLessThan(1);
  // A click on a person follows them.
  await rami.keyboard.press('n');
  await rami.waitForTimeout(1200);
  await rami.getByTestId('watch-free').click();
  await expect(rami.getByTestId('watching')).toHaveText('Moving freely');
  const at = await view(rami);
  const there = (await sara.evaluate(() => window.__insider!.me()))!;
  await rami.mouse.click(cx + (there.x - at.x) * at.zoom, cy + (there.y - 8 - at.y) * at.zoom);
  await expect(rami.getByTestId('watching')).toHaveText('Following Sara Alharbi');

  // He hears every room; nobody alive reads him.
  await lina.bringToFront();
  await lina.keyboard.press('Enter');
  await lina.getByTestId('chat-input-room').fill('is it quiet in HR?');
  await lina.keyboard.press('Enter');
  await expect(rami.getByTestId('chat-fired')).toContainText('Lina Haddad: is it quiet in HR?');
  await expect(rami.getByTestId('chat-fired').locator('.chat-room').last()).toHaveText(await lina.getByTestId('room').innerText());
  await rami.bringToFront();
  await rami.keyboard.press('Enter');
  await expect(rami.getByTestId('chat-input-fired')).toBeFocused();
  await rami.keyboard.type('it was not me, n c t');
  await rami.keyboard.press('Enter');
  await expect(rami.getByTestId('chat-fired')).toContainText('Rami Mansour: it was not me, n c t');
  await expect(rami.getByTestId('watching')).toHaveText('Following Sara Alharbi'); // typing "n" did not follow the next one
  await expect(lina.getByTestId('chat-room')).not.toContainText('it was not me');
  // The board: to read, not to change.
  await rami.getByTestId('board-button').click();
  await expect(rami.getByTestId('evidence-E1')).toContainText('evidence-1');
  await rami.keyboard.press('b');

  // It also fits smaller windows.
  for (const [width, height, name] of [[1000, 700, 'medium'], [390, 844, 'phone']] as const) {
    await rami.setViewportSize({ width, height });
    await rami.waitForTimeout(400);
    await expect(rami.getByTestId('chat-input-fired')).toBeInViewport({ ratio: 1 });
    expect(await rami.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await rami.screenshot({ path: `e2e/screenshots/watching-${name}.png` });
  }
  for (const page of [sara, rami, lina]) await page.context().close();
});
