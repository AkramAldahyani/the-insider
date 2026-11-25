/** What the hacker does to win, for the browser tests (the only weakness there is the forgotten script). */
import { expect, type Page } from '@playwright/test';
import { walkAndSit } from './movement';

export const terminalText = (page: Page) => page.locator('.xterm-rows').innerText();

export const run = async (page: Page, line: string) => {
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
};

/** Walks to the own PC (the card says which), gets to root with the old script, and returns the flag. */
export async function steal(page: Page, card: string, password: string): Promise<string> {
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
export async function handIn(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByTestId('flag-submit').click();
    await expect(page.getByTestId('match-over')).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 60_000, intervals: [2000] });
}
