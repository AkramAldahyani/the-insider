/**
 * Phase 6, part I: a lobby plays in the large office (30 desks) and somebody
 * calls a department meeting.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { walkTo } from './helpers/movement';

async function person(browser: Browser, name: string, code?: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(code ? `/?lobby=${code}` : '/');
  await page.getByTestId('friends-name').fill(name);
  await page.getByTestId(code ? 'friends-join' : 'friends-create').click();
  await expect(page.getByTestId('party')).toBeVisible();
  return page;
}
const BUTTONS = ['Finance', 'HR', 'Marketing', 'Sales', 'Legal', 'IT'].map((d) => `${d} meeting button`);

test('the large office: thirty desks, and a department meeting with whoever is near', async ({ browser }) => {
  test.setTimeout(4 * 60_000);
  const anna = await person(browser, 'Anna');
  const code = (await anna.getByTestId('party-code').textContent())!;
  const ben = await person(browser, 'Ben', code);
  await expect(anna.getByTestId('party-office-now')).toHaveText('This match: the small office (11 desks).');
  await anna.getByTestId('party-office').selectOption('large');
  await expect(ben.getByTestId('party-office-now')).toHaveText('This match: the large office (30 desks).');
  await expect(ben.getByTestId('party-office')).toBeDisabled();
  await ben.getByTestId('party-ready').click();
  await anna.getByTestId('party-start').click();
  for (const page of [anna, ben]) {
    await page.getByTestId('reveal-close').click();
    await page.keyboard.press('c');
    await page.waitForFunction(() => window.__insider?.me() != null);
    await expect(page.getByTestId('roster').locator('.roster-person')).toHaveCount(30);
  }
  expect(await anna.evaluate(() => window.__insider!.map()!.cols)).toBeGreaterThan(100);

  // Anna walks to the department meeting button nearest to her.
  const me = (await anna.evaluate(() => window.__insider!.me()))!;
  const spots = await anna.evaluate((names) => names.map((n) => ({ name: n, at: window.__insider!.talk(n)! })), BUTTONS);
  const nearest = spots.sort((a, b) => Math.hypot(a.at.x - me.x, a.at.y - me.y) - Math.hypot(b.at.x - me.x, b.at.y - me.y))[0];
  for (let attempt = 1; ; attempt++) {
    try {
      await walkTo(anna, nearest.at.x, nearest.at.y, 12);
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  await expect(anna.getByTestId('hint')).toContainText('call a department meeting');
  await anna.keyboard.press('e');
  await expect(anna.getByTestId('notice')).toContainText('A department meeting in');
  await anna.keyboard.press('Enter');
  await expect(anna.getByTestId('talk-head')).toContainText('DEPARTMENT MEETING');
  await anna.getByTestId('chat-input-talk').fill('anything odd in here today?');
  await anna.keyboard.press('Enter');
  await expect(anna.getByTestId('chat-talk')).toContainText('anything odd in here today?');
  await anna.screenshot({ path: 'e2e/screenshots/party-large.png' });
  // Ben is not there, so he reads nothing of it.
  const room = (await anna.evaluate(() => window.__insider!.me()!.room));
  if ((await ben.evaluate(() => window.__insider!.me()!.room)) !== room) {
    await ben.keyboard.press('Enter');
    await expect(ben.getByTestId('chat-panel')).not.toContainText('anything odd in here today?');
  }
  for (const page of [anna, ben]) await page.context().close();
});
