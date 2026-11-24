/**
 * Phase 6, part A: two browsers that know nothing of each other meet in a
 * lobby and go to the same office together.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

/** A second browser with its own storage, like another computer. */
async function person(browser: Browser, name: string, path = '/'): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(path);
  await page.getByTestId('friends-name').fill(name);
  return page;
}

test('friends gather in a lobby with a code and start a match together', async ({ browser }) => {
  const anna = await person(browser, 'Anna');
  await anna.getByTestId('friends-create').click();
  const code = (await anna.getByTestId('party-code').textContent())!;
  expect(code).toMatch(/^[A-Z]{5}$/);
  await expect(anna.getByTestId('party-start')).toBeDisabled();

  // Ben opens the link Anna sent him: the code is already filled in.
  const link = await anna.getByTestId('party-link').inputValue();
  const ben = await person(browser, 'Ben', link);
  await expect(ben.getByTestId('friends-code')).toHaveValue(code);
  await ben.getByTestId('friends-join').click();
  await expect(ben.getByTestId('party-members')).toContainText('Anna');
  // Cleo types it by hand.
  const cleo = await person(browser, 'Cleo');
  await cleo.getByTestId('friends-code').fill(code.toLowerCase());
  await cleo.getByTestId('friends-join').click();
  await expect(anna.getByTestId('party-members').locator('li')).toHaveCount(3);

  // Only the host decides.
  await expect(ben.getByTestId('party-bots')).toBeDisabled();
  await expect(ben.getByTestId('party-start')).toHaveCount(0);
  await anna.getByTestId('party-bots').click(); // (not uncheck(): the box changes when the server has answered)
  await expect(ben.getByTestId('party-bots')).not.toBeChecked();
  await anna.getByTestId('party-meetings').selectOption('short');
  await expect(ben.getByTestId('party-meetings')).toHaveValue('short');
  await anna.screenshot({ path: 'e2e/screenshots/party.png' });
  await anna.setViewportSize({ width: 390, height: 844 });
  expect(await anna.evaluate(() => document.querySelector('.start')!.scrollWidth <= window.innerWidth)).toBe(true);
  await anna.setViewportSize({ width: 1280, height: 800 });

  // Cleo is removed, and told so.
  await anna.getByTestId('remove-Cleo').click();
  await expect(cleo.getByText('The host removed you from the lobby.')).toBeVisible();
  await expect(anna.getByTestId('party-members').locator('li')).toHaveCount(2);

  await expect(anna.getByTestId('party-note')).toHaveText('Waiting for Ben to be ready.');
  await ben.getByTestId('party-ready').click();
  await expect(anna.getByTestId('party-start')).toBeEnabled();
  await anna.getByTestId('party-start').click();

  // The same office for both.
  await anna.getByTestId('employee-p1').click();
  await expect(ben.getByTestId('employee-p1')).toBeDisabled();
  await ben.getByTestId('employee-p4').click();
  for (const page of [anna, ben]) {
    await expect(page.getByTestId('party-hud')).toHaveText(`Lobby ${code}`);
    await expect(page.getByTestId('roster').locator('.roster-person')).toHaveCount(2);
  }
  // A lobby that is playing takes nobody else.
  await cleo.goto(`/?lobby=${code}`);
  await cleo.getByTestId('friends-join').click();
  await expect(cleo.getByText(`No open lobby has the code ${code}`)).toBeVisible();
  for (const page of [anna, ben, cleo]) await page.context().close();
});
