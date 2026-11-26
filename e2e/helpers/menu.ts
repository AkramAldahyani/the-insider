import type { Page } from '@playwright/test';

/** Opens the page and enters the shared office from the start menu (its mode tab, then the play button). */
export async function openOffice(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('mode-office').click();
  await page.getByTestId('menu-office').click();
}
