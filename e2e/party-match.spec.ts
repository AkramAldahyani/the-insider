/**
 * Phase 6, part B: a lobby's match from the start to the end, with three
 * people and no bots: secret parts, the wait before handing in, who was who,
 * and the next match of the same lobby. It uses the match server of
 * playwright.config.ts (game time four times as fast).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { handIn, steal } from './helpers/heist';

async function person(browser: Browser, name: string, code?: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(code ? `/?lobby=${code}` : '/');
  await page.getByTestId('friends-name').fill(name);
  await page.getByTestId(code ? 'friends-join' : 'friends-create').click();
  await expect(page.getByTestId('party')).toBeVisible();
  return page;
}

test('three friends play a match to its end and start the next one from the same lobby', async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const anna = await person(browser, 'Anna');
  const code = (await anna.getByTestId('party-code').textContent())!;
  const ben = await person(browser, 'Ben', code);
  const cleo = await person(browser, 'Cleo', code);
  const everybody = [anna, ben, cleo];
  await anna.getByTestId('party-bots').click();
  for (const page of [ben, cleo]) await page.getByTestId('party-ready').click();
  await anna.getByTestId('party-start').click();

  let hacker: Page | null = null;
  for (const page of everybody) {
    if ((await page.getByTestId('reveal-role').textContent()) === 'You are the hacker') hacker = page;
    await page.getByTestId('reveal-close').click();
    await page.keyboard.press('c'); // the card gives way to the briefing or the case
  }
  expect(hacker).not.toBeNull();
  const thief = hacker!;
  const others = everybody.filter((p) => p !== thief);
  for (const page of others) {
    await expect(page.getByTestId('case')).toBeVisible();
    await expect(page.getByTestId('mission')).toHaveCount(0);
  }
  await expect(thief.getByTestId('mission-risk')).toContainText('3 game minutes after you first read it');
  await thief.keyboard.press('c');
  const card = await thief.getByTestId('card').innerText();
  const password = await thief.getByTestId('card-password').innerText();
  const employee = /IT ONBOARDING\s+×?\s*(.+)/.exec(card)![1].trim();
  await thief.keyboard.press('c');

  const flag = await steal(thief, card, password);
  await expect(thief.getByTestId('notice')).toContainText('Your contact takes it in 3 minutes');
  await thief.keyboard.press('Escape');
  if (!(await thief.getByTestId('mission').isVisible())) await thief.keyboard.press('m');
  await thief.getByTestId('flag-input').fill(flag);
  await handIn(thief);

  // Everybody is told who it was, and who was who.
  const names = new Map([[anna, 'Anna'], [ben, 'Ben'], [cleo, 'Cleo']]);
  for (const page of everybody) {
    await expect(page.getByTestId('match-over-hacker')).toHaveText(employee);
    await expect(page.getByTestId('cast').locator('li')).toHaveCount(3);
    await expect(page.getByTestId('cast')).toContainText(`${names.get(thief)} was ${employee}, the hacker`);
    await expect(page.getByTestId('play-again')).toHaveCount(0);
  }
  await others[0].screenshot({ path: 'e2e/screenshots/party-over.png' });

  // Back in the lobby: the host waits until all are back and ready.
  await anna.getByTestId('back-to-party').click();
  await expect(anna.getByTestId('party-code')).toHaveText(code);
  await expect(anna.getByTestId('party-note')).toHaveText('Waiting for Ben, Cleo to come back from the last match.');
  await ben.getByTestId('open-debrief').click();
  await ben.getByRole('button', { name: 'Close debrief' }).click();
  for (const page of [ben, cleo]) {
    await page.getByTestId('back-to-party').click();
    await page.getByTestId('party-ready').click();
  }
  await expect(anna.getByTestId('party-start')).toBeEnabled();
  await anna.getByTestId('party-start').click();
  for (const page of everybody) {
    await expect(page.getByTestId('reveal')).toBeVisible();
    await page.getByTestId('reveal-close').click();
    // A new office: nothing of the last match is left.
    await expect(page.getByTestId('match-over')).toHaveCount(0);
    await expect(page.getByTestId('hud-debrief')).toHaveCount(0);
    await expect(page.getByTestId('roster').locator('.roster-person')).toHaveCount(3);
    await expect(page.getByTestId('clock')).toContainText('09:0');
  }
  for (const page of everybody) await page.context().close();
});
