/**
 * Infiltration in a real browser (Phase 5a, part F): from the start menu to
 * the flag, past the wait for the contact, to the rating. It uses the match
 * server of playwright.config.ts (bots on, game time four times as fast).
 */
import { expect, test, type Page } from '@playwright/test';
import { walkAndSit } from './helpers/movement';

const SHOTS = 'e2e/screenshots';
const terminalText = (page: Page) => page.locator('.xterm-rows').innerText();

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
  const desk = /Your PC\s+([A-Z0-9-]+)/.exec(card)![1];
  await page.keyboard.press('c');
  await expect(page.getByTestId('mission')).toBeVisible();
  await expect(page.getByTestId('mission-risk')).toContainText('2 game minutes after you first read it');
  await expect(page.getByTestId('case')).toBeHidden(); // the defenders' panel is not for the hacker
  await page.screenshot({ path: `${SHOTS}/25-infiltration-briefing.png` });
  await page.keyboard.press('m');
  await expect(page.getByTestId('mission')).toBeHidden();

  const run = async (line: string) => {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  };
  await walkAndSit(page, desk);
  if ((await page.getByTestId('terminal').getAttribute('data-screen')) === 'login') await run(/Username\s+(\S+)/.exec(card)![1]);
  if ((await page.getByTestId('terminal').getAttribute('data-screen')) !== 'shell') await run(password);
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');
  await run('ssh ADMIN-SRV-01');
  await expect.poll(() => terminalText(page)).toContain("@ADMIN-SRV-01's password:");
  await run(password);
  await expect.poll(() => terminalText(page)).toContain('@ADMIN-SRV-01:~$');
  await run('cat /srv/shared/old/backup-2025.sh');
  await expect.poll(() => terminalText(page)).toContain('ROOT_PW=');
  const root = /ROOT_PW='([^']+)'/.exec(await terminalText(page))![1];
  await run('clear');
  await run('su');
  await run(root);
  await expect.poll(() => terminalText(page)).toContain('root@ADMIN-SRV-01');
  await run('cat /root/flag.txt');
  await expect.poll(() => terminalText(page)).toMatch(/NEXORA\{[^}]+\}/);
  await expect(page.getByTestId('notice')).toContainText('You have the file. Your contact takes it in 2 minutes');
  const flag = /NEXORA\{[^}]+\}/.exec(await terminalText(page))![0];
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('terminal')).toBeHidden();

  // Too early.
  await page.keyboard.press('m');
  await page.getByTestId('flag-input').fill(flag);
  await page.getByTestId('flag-submit').click();
  await expect(page.getByTestId('notice')).toContainText('Your contact is not here yet');
  await expect(page.getByTestId('match-over')).toBeHidden();
  // Two game minutes are half a minute here. Keep trying until the contact takes it.
  await expect(async () => {
    await page.getByTestId('flag-submit').click();
    await expect(page.getByTestId('match-over')).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 60_000, intervals: [2000] });
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
