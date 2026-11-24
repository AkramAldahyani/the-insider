/**
 * Infiltration in a real browser (Phase 5a, part F): from the start menu to
 * the flag, past the wait for the contact, to the rating. It uses the match
 * server of playwright.config.ts (bots on, game time four times as fast).
 */
import { expect, test, type Page } from '@playwright/test';
import { walkAndSit } from './helpers/movement';

const SHOTS = 'e2e/screenshots';
const terminalText = (page: Page) => page.locator('.xterm-rows').innerText();

const run = async (page: Page, line: string) => {
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
};

/** Walks to the own PC (the card says which), gets to root with the old script, and returns the flag. */
async function steal(page: Page, card: string, password: string): Promise<string> {
  await walkAndSit(page, /Your PC\s+([A-Z0-9-]+)/.exec(card)![1]);
  if ((await page.getByTestId('terminal').getAttribute('data-screen')) === 'login') await run(page, /Username\s+(\S+)/.exec(card)![1]);
  if ((await page.getByTestId('terminal').getAttribute('data-screen')) !== 'shell') await run(page, password);
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');
  await run(page, 'ssh ADMIN-SRV-01');
  await expect.poll(() => terminalText(page)).toContain("@ADMIN-SRV-01's password:");
  await run(page, password);
  await expect.poll(() => terminalText(page)).toContain('@ADMIN-SRV-01:~$');
  await run(page, 'cat /srv/shared/old/backup-2025.sh');
  await expect.poll(() => terminalText(page)).toContain('ROOT_PW=');
  const root = /ROOT_PW='([^']+)'/.exec(await terminalText(page))![1];
  await run(page, 'clear');
  await run(page, 'su');
  await run(page, root);
  await expect.poll(() => terminalText(page)).toContain('root@ADMIN-SRV-01');
  await run(page, 'cat /root/flag.txt');
  await expect.poll(() => terminalText(page)).toMatch(/NEXORA\{[^}]+\}/);
  return /NEXORA\{[^}]+\}/.exec(await terminalText(page))![0];
}

/** Hands the flag in, again and again until the contact is there. */
async function handIn(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByTestId('flag-submit').click();
    await expect(page.getByTestId('match-over')).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 60_000, intervals: [2000] });
}

test('the hacker gets the flag past the bots and waits for the contact before handing it in', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await page.goto('/');
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
  await page.getByTestId('menu-investigation').click();
  await expect(page.getByTestId('mode')).toHaveText('Investigation · Normal');
  await page.keyboard.press('c');
  await expect(page.getByTestId('case')).toBeVisible();
  await expect(page.getByTestId('mission')).toBeHidden();
});

test('the scenario ladder: winning a level opens the next one, and the browser remembers it', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  await page.goto('/');
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
  await expect(page.getByTestId('ladder-1')).toContainText(`won: ${rating}`);
  await expect(page.getByTestId('ladder-play-2')).toBeEnabled();
  await expect(page.getByTestId('ladder-play-3')).toBeDisabled();
});
