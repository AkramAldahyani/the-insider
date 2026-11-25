/**
 * Phase 6, parts A and B: browsers that know nothing of each other meet in a
 * lobby, are told their secret parts, and play in the same office.
 * (party-match.spec.ts plays such a match to its end.)
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
  await anna.getByTestId('party-hackers').selectOption('3');
  await expect(ben.getByTestId('party-hacker-count')).toHaveText('Only 1: the defenders must keep the majority.');
  await anna.getByTestId('party-hackers').selectOption('0');
  await expect(ben.getByTestId('party-hacker-count')).toHaveText('This match: one hacker.');
  await anna.screenshot({ path: 'e2e/screenshots/party.png' });
  await anna.setViewportSize({ width: 390, height: 844 });
  expect(await anna.evaluate(() => document.querySelector('.start')!.scrollWidth <= window.innerWidth)).toBe(true);
  await anna.setViewportSize({ width: 1280, height: 800 });

  // Cleo is removed, and told so.
  await anna.getByTestId('remove-Cleo').click();
  await expect(cleo.getByText('The host removed you from the lobby.')).toBeVisible();
  await expect(anna.getByTestId('party-members').locator('li')).toHaveCount(2);

  // Without bots one of them is the hacker, and that takes three people.
  await expect(anna.getByTestId('party-note')).toHaveText('When one of you is the hacker, at least 3 people are needed.');
  const dora = await person(browser, 'Dora', link);
  await dora.getByTestId('friends-join').click();
  await dora.getByTestId('party-ready').click();
  await expect(anna.getByTestId('party-note')).toHaveText('Waiting for Ben to be ready.');
  await ben.getByTestId('party-ready').click();
  await expect(anna.getByTestId('party-start')).toBeEnabled();
  await anna.getByTestId('party-start').click();

  // Each of them is told their own part, and only that. Nobody chooses.
  const roles: string[] = [];
  for (const page of [anna, ben, dora]) {
    await expect(page.getByTestId('employee-p1')).toHaveCount(0);
    roles.push((await page.getByTestId('reveal-role').textContent())!);
    if (roles.at(-1) === 'You are the hacker') await page.screenshot({ path: 'e2e/screenshots/party-reveal.png' });
    await page.getByTestId('reveal-close').click();
    await expect(page.getByTestId('reveal')).toHaveCount(0);
  }
  expect(roles.sort()).toEqual(['You are not a hacker', 'You are not a hacker', 'You are the hacker']);
  for (const page of [anna, ben, dora]) {
    await expect(page.getByTestId('party-hud')).toHaveText(`Lobby ${code}`);
    await expect(page.getByTestId('roster').locator('.roster-person')).toHaveCount(3);
  }
  // A lobby that is playing takes nobody else.
  await cleo.goto(`/?lobby=${code}`);
  await cleo.getByTestId('friends-join').click();
  await expect(cleo.getByText(`No open lobby has the code ${code}`)).toBeVisible();
  for (const page of [anna, ben, cleo, dora]) await page.context().close();
});

test('two hackers: the one who is a person sees the partner, the others see nothing', async ({ browser }) => {
  const anna = await person(browser, 'Anna');
  await anna.getByTestId('friends-create').click();
  const link = await anna.getByTestId('party-link').inputValue();
  const others: Page[] = [];
  for (const name of ['Ben', 'Cleo']) {
    const page = await person(browser, name, link);
    await page.getByTestId('friends-join').click();
    await page.getByTestId('party-ready').click();
    others.push(page);
  }
  await anna.getByTestId('party-hacker').selectOption('human');
  await anna.getByTestId('party-hackers').selectOption('2');
  await expect(others[0].getByTestId('party-hacker-count')).toHaveText('This match: 2 hackers.');
  await anna.getByTestId('party-start').click();
  let hackers = 0;
  for (const page of [anna, ...others]) {
    const role = await page.getByTestId('reveal-role').textContent();
    await expect(page.getByTestId('roster').locator('.roster-person')).toHaveCount(11);
    if (role === 'You are a hacker') {
      hackers++;
      await page.screenshot({ path: 'e2e/screenshots/party-partner.png' });
      const partner = /You are not alone: (.+)\. Any of you/.exec((await page.getByTestId('reveal-partners').textContent())!)![1];
      await page.getByTestId('reveal-close').click();
      await page.keyboard.press('c');
      await expect(page.getByTestId('mission-partners')).toContainText(partner);
      await expect(page.locator('.roster-person', { hasText: partner }).locator('.partner-tag')).toHaveText('partner');
      await expect(page.locator('.partner-tag')).toHaveCount(1);
      await page.screenshot({ path: 'e2e/screenshots/party-partner-office.png' });
    } else {
      expect(role).toBe('You are not a hacker');
      await expect(page.getByTestId('reveal')).toContainText('2 of your colleagues are after a file');
      await expect(page.locator('.partner-tag')).toHaveCount(0);
    }
  }
  expect(hackers).toBe(1);
  for (const page of [anna, ...others]) await page.context().close();
});
