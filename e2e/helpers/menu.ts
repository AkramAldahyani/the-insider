import type { Page } from '@playwright/test';

/** Opens the page and enters the shared office from the start menu. */
export async function openOffice(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('menu-office').click();
}
