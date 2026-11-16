/** Visual integration checks: real clients, unchanged public state and keyboard inputs. */
import { expect, test, type Page } from '@playwright/test';

async function publicBody(page: Page, id: string) {
  return page.evaluate(async (playerId) => {
    const modulePath = '/src/game/store.ts';
    const { store } = await import(/* @vite-ignore */ modulePath);
    const p = store.room?.state.players.get(playerId);
    return p ? { x: p.x, y: p.y, facing: p.facing, seatedAt: p.seatedAt } : null;
  }, id);
}

test('office presentation stays readable and follows two clients', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('employee-p1').click();
  await expect(page.getByTestId('card')).toBeVisible();
  await page.keyboard.press('c');
  const second = await context.newPage();
  second.on('pageerror', (e) => errors.push(e.message));
  await second.goto('/');
  await second.getByTestId('employee-p2').click();
  await expect(second.getByTestId('card')).toBeVisible();
  await second.keyboard.press('c');
  await expect(page.locator('.roster-person')).toHaveCount(2);
  await expect(second.locator('.roster-person')).toHaveCount(2);
  await expect(page.locator('.roster-self')).toContainText('Sara Alharbi');
  await expect(page.locator('.roster')).not.toContainText(/hacker|password|eliminated|bot/i);

  // Selection affects only the directory, and both clients agree on physical movement.
  await page.locator('.roster-person').filter({ hasText: 'Rami Mansour' }).click();
  await expect(page.locator('.roster-person').filter({ hasText: 'Rami Mansour' })).toHaveAttribute('aria-pressed', 'true');
  const start = await publicBody(page, 'p1');
  for (const [key, facing] of [['ArrowRight', 'right'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowUp', 'up']]) {
    const before = await publicBody(page, 'p1');
    await page.keyboard.down(key);
    await expect.poll(async () => (await publicBody(second, 'p1'))?.facing).toBe(facing);
    await page.waitForTimeout(160);
    await page.screenshot({ path: `test-results/design/walk-${facing}.png` });
    await page.keyboard.up(key);
    await page.waitForTimeout(150);
    const after = await publicBody(page, 'p1');
    expect(Math.hypot(after!.x - before!.x, after!.y - before!.y)).toBeGreaterThan(5);
    await expect.poll(() => publicBody(second, 'p1')).toEqual(await publicBody(page, 'p1'));
  }
  expect(start).not.toBeNull();

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(250);
    const map = (await page.locator('.map').boundingBox())!;
    const tasks = (await page.getByTestId('tasks').boundingBox())!;
    const roster = (await page.getByTestId('roster').boundingBox())!;
    expect(map.width).toBeGreaterThan(700);
    expect(map.x).toBeGreaterThanOrEqual(tasks.x + tasks.width);
    expect(roster.x + roster.width <= map.x || roster.x >= map.x + map.width).toBeTruthy();
    const canvas = (await page.locator('.map canvas').boundingBox())!;
    expect(Math.abs(canvas.width - (map.width - 2))).toBeLessThanOrEqual(2);
    await page.screenshot({ path: `test-results/design/office-${viewport.width}.png` });
  }
  await page.setViewportSize({ width: 2308, height: 1210 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/design/office-overview.png' });
  await second.close();
  await expect(page.locator('.roster-person')).toHaveCount(1);
  expect(errors).toEqual([]);
});
