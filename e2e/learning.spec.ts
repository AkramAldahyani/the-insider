/**
 * Learning to defend: the training day's guide, the notebook and Tab at a PC,
 * the minimap and the player's own desk, and the defender ladder on the menu.
 */
import { expect, test } from '@playwright/test';
import { walkAndSit } from './helpers/movement';

const SHOTS = 'e2e/screenshots';

test('the training day: a guide step by step, Tab completion, and the notebook', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByTestId('mode-training').click();
  await page.getByTestId('menu-training').click();
  await expect(page.getByTestId('mode')).toHaveText('Training day');
  const guide = page.getByTestId('guide');
  await expect(guide).toHaveAttribute('data-step', '0');
  await expect(guide).toContainText('Your card');
  // The guide replaces the case; the minimap shows where the player is.
  await expect(page.getByTestId('case')).toBeHidden();
  await expect(page.getByTestId('minimap')).toBeVisible();
  const password = await page.getByTestId('card-password').innerText();
  await page.keyboard.press('c');
  await expect(guide).toHaveAttribute('data-step', '1');
  await expect(guide).toContainText('SOC-WS-01');
  await walkAndSit(page, 'SOC-WS-01');
  await expect(guide).toHaveAttribute('data-step', '2');
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');
  await expect(guide).toHaveAttribute('data-step', '3');

  // Tab completes a command; the line runs as completed.
  await page.keyboard.type('whoa');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('$ whoami');
  await expect(page.getByTestId('notice')).toContainText('New in your notebook: whoami');

  await page.keyboard.type('siem help');
  await page.keyboard.press('Enter');
  await expect(guide).toHaveAttribute('data-step', '4');
  await expect(guide).toContainText('siem source=alert severity=high');

  // The notebook beside the terminal: what was used, with its manual page.
  await page.getByTestId('term-notebook').click();
  await expect(page.getByTestId('notebook')).toBeVisible();
  await expect(page.getByTestId('notebook-whoami')).toContainText('print the current user name');
  await expect(page.getByTestId('notebook-siem')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/37-training.png` });

  // Standing up: the notebook stays (it is remembered by the browser), the desk is marked.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('terminal')).toBeHidden();
  await expect(page.getByTestId('desk-of-p11')).toHaveText('SOC-WS-01');
  await page.reload();
  await page.getByTestId('menu-forget').click();
  await page.getByTestId('mode-training').click();
  await page.getByTestId('menu-training').click();
  await expect(page.getByTestId('guide')).toHaveAttribute('data-step', '0');
  await page.keyboard.press('c');
  await page.keyboard.press('h');
  await expect(page.getByTestId('notebook')).toBeVisible();
  await expect(page.getByTestId('notebook-whoami')).toBeVisible();
});

test('the ladders: the defender ladder first, each case with its job', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('mode-ladder').click();
  await expect(page.getByTestId('track-defender')).toBeChecked();
  await expect(page.getByTestId('defender-1')).toContainText('SOC analyst');
  await expect(page.getByTestId('defender-3')).toContainText('Security guard');
  await expect(page.getByTestId('defender-play-2')).toBeDisabled();
  await expect(page.getByTestId('rank')).toContainText('Intern');
  await page.getByTestId('defender-play-1').click();
  await expect(page.getByTestId('mode')).toHaveText('Defender 1 · The first alert');
  await page.keyboard.press('c');
  await expect(page.getByTestId('case-level')).toContainText('The first alert');
  await expect(page.getByTestId('card')).toBeHidden();
});
