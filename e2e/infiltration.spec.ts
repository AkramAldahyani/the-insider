/**
 * Infiltration in a real browser (Phase 5a, part F): from the start menu to
 * the flag, past the wait for the contact, to the rating. It uses the match
 * server of playwright.config.ts (bots on, game time four times as fast).
 */
import { expect, test } from '@playwright/test';
import { handIn, steal } from './helpers/heist';

const SHOTS = 'e2e/screenshots';
test('the hacker gets the flag past the bots and waits for the contact before handing it in', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await page.goto('/');
  await page.getByTestId('mode-infiltration').click();
  await page.getByTestId('risk-easy').check();
  await page.getByTestId('menu-infiltration').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/24-infiltration-menu.png` });
  await page.getByTestId('menu-infiltration').click();
  await expect(page.getByTestId('mode')).toHaveText('Infiltration · Easy');

  // The card of an ordinary employee, and behind it the private briefing.
  const card = await page.getByTestId('card').innerText();
  const password = await page.getByTestId('card-password').innerText();
  await page.keyboard.press('c');
  await expect(page.getByTestId('mission')).toBeVisible();
  await expect(page.getByTestId('mission-risk')).toContainText('2 game minutes after you first read it');
  await expect(page.getByTestId('case')).toBeHidden(); // the defenders' panel is not for the hacker
  await page.screenshot({ path: `${SHOTS}/25-infiltration-briefing.png` });
  await page.keyboard.press('m');
  await expect(page.getByTestId('mission')).toBeHidden();

  const flag = await steal(page, card, password);
  await expect(page.getByTestId('notice')).toContainText('You have the file. Your contact takes it in 2 minutes');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('terminal')).toBeHidden();

  // Too early.
  await page.keyboard.press('m');
  await page.getByTestId('flag-input').fill(flag);
  await page.getByTestId('flag-submit').click();
  await expect(page.getByTestId('notice')).toContainText('Your contact is not here yet');
  await expect(page.getByTestId('match-over')).toBeHidden();
  // Two game minutes are half a minute here. Keep trying until the contact takes it.
  await handIn(page);
  await expect(page.getByTestId('match-over')).toContainText('You got the flag out. You win.');
  await expect(page.getByTestId('rating')).toHaveText(/Like a ghost|Clean getaway|By a hair/);
  await page.getByTestId('open-debrief').click();
  await expect(page.getByTestId('debrief-rating')).toContainText('suspicious actions that left evidence');
  await page.screenshot({ path: `${SHOTS}/26-infiltration-debrief.png` });

  // Back to the menu, and nothing of the hacker's briefing is left behind for the next match.
  await page.getByRole('button', { name: 'Close debrief' }).click();
  await page.getByTestId('to-menu').click();
  await page.getByTestId('mode-investigation').click();
  await page.getByTestId('menu-investigation').click();
  await expect(page.getByTestId('mode')).toHaveText('Investigation · Normal');
  await page.keyboard.press('c');
  await expect(page.getByTestId('case')).toBeVisible();
  await expect(page.getByTestId('mission')).toBeHidden();
});

test('the scenario ladder: winning a level opens the next one, and the browser remembers it', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await page.goto('/');
  await page.getByTestId('mode-ladder').click();
  await page.getByTestId('track-hacker').check();
  await expect(page.getByTestId('ladder-play-2')).toBeDisabled();
  await expect(page.getByTestId('ladder-2')).toContainText('Win the level before it first.');
  await page.getByTestId('ladder-play-1').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/27-ladder.png` });
  await page.getByTestId('ladder-play-1').click();
  await expect(page.getByTestId('mode')).toHaveText('Level 1 · Old habits');
  const card = await page.getByTestId('card').innerText();
  const password = await page.getByTestId('card-password').innerText();
  expect(card).toContain('Omar Farouk'); // a level is always the same
  await page.keyboard.press('c');
  await expect(page.getByTestId('mission-level')).toContainText('look for an old script');
  await page.keyboard.press('m');
  const flag = await steal(page, card, password);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('terminal')).toBeHidden();
  await page.keyboard.press('m');
  await page.getByTestId('flag-input').fill(flag);
  await handIn(page);
  await expect(page.getByTestId('lesson')).toContainText('Passwords in scripts');
  const rating = await page.getByTestId('rating').innerText();
  await page.screenshot({ path: `${SHOTS}/28-ladder-won.png` });

  // On to level 2, then away from there: level 2 stays open, also after reloading the page.
  await page.getByTestId('next-level').click();
  await expect(page.getByTestId('mode')).toHaveText('Level 2 · The company password');
  await expect(page.getByTestId('card')).toContainText('Sara Alharbi');
  await page.reload();
  await page.getByTestId('mode-ladder').click();
  await page.getByTestId('track-hacker').check();
  await expect(page.getByTestId('ladder-1')).toContainText(`won: ${rating}`);
  await expect(page.getByTestId('ladder-play-2')).toBeEnabled();
  await expect(page.getByTestId('ladder-play-3')).toBeDisabled();
});
