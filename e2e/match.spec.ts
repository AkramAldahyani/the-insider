/**
 * A whole match in a real browser (Phase 5, part J; the goal of Phase 5 in
 * DESIGN.md section 15: "a full match as defender vs a bot hacker, with debrief").
 *
 * Huda, the SOC analyst, plays against a full office of bots, one of them the
 * hacker. The test does not know who that is: it waits for a HIGH alert in the
 * SIEM and follows the evidence to a person, like a player would.
 *
 * It runs on its own game server (see playwright.config.ts): bots on, game
 * time four times as fast, and the anti-stall alert every game minute, so the
 * match takes a few minutes instead of a quarter of an hour.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { walkAndSit, walkTo } from './helpers/movement';

const SHOTS = 'e2e/screenshots';
const staff = (JSON.parse(readFileSync('scenarios/nexora-small.json', 'utf8')) as { players: { id: string; name: string; desk: string }[] }).players;

/** A line of the terminal that contains this text. */
const line = (page: Page, text: string) => page.locator('.xterm-rows > div', { hasText: text }).last();

async function run(page: Page, command: string): Promise<void> {
  // Two lines: `siem` reads the rest of the line itself (with its own "|"), so it has to come first on it.
  for (const text of ['clear', command]) {
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  }
}

/** Selects the whole line (three clicks, like in any terminal) and pins it. */
async function pin(page: Page, text: string, number: number): Promise<string> {
  const row = line(page, text);
  await expect(row).toBeVisible();
  const shown = await row.innerText();
  await row.click({ clickCount: 3, position: { x: 30, y: 6 } });
  await page.getByTestId('pin-selection').click();
  await expect(page.getByTestId('board-button')).toContainText(`Evidence (${number})`);
  await page.locator('.xterm-helper-textarea').focus();
  return shown;
}

test('a defender follows the evidence to the bot hacker, has them voted out, and reads the debrief', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await page.goto('/');
  await page.getByTestId('employee-p11').click();
  const password = await page.getByTestId('card-password').innerText();
  await page.keyboard.press('c');
  await walkAndSit(page, 'SOC-WS-01');
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');

  // 1. Wait for the first HIGH alert, asking the SIEM every few seconds.
  await expect(async () => {
    await run(page, 'siem source=alert severity=high');
    await expect(line(page, 'severity=high rule=')).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 5 * 60_000, intervals: [4_000] });

  // 2. Where did it come from? Whose PC is that?
  const alert = await pin(page, 'severity=high rule=', 1);
  const ip = /src_ip=(\d+\.\d+\.\d+\.\d+)/.exec(alert)![1];
  await run(page, `siem source=dhcp ip=${ip} | tail 1`);
  const lease = await pin(page, 'client=', 2);
  const pc = /client=(\S+)/.exec(lease)![1];
  await run(page, `siem source=auth host=ADMIN-SRV-01 action=login src_ip=${ip} | tail 1`);
  await pin(page, 'action=login', 3);
  const suspect = staff.find((p) => p.desk === pc)!;
  await page.screenshot({ path: `${SHOTS}/19-soc-trail.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('terminal')).toBeHidden();

  // 3. Call a meeting, accuse, vote.
  const button = await page.evaluate(() => window.__insider!.button());
  await walkTo(page, button.x, button.y, 24);
  await expect(page.getByTestId('hint')).toContainText('call an emergency meeting');
  await page.keyboard.press('e');
  await expect(page.getByTestId('meeting')).toBeVisible();
  await page.getByTestId('accuse-suspect').selectOption(suspect.id);
  for (const id of ['E1', 'E2', 'E3']) await page.getByTestId(`accuse-evidence-${id}`).check();
  await page.getByTestId('accuse-submit').click();
  await expect(page.getByTestId('accusation-A1')).toContainText(suspect.name);
  await page.getByTestId(`vote-${suspect.id}`).click({ timeout: 40_000 });

  // 4. They were the hacker: the defenders win, and the debrief tells the whole story.
  await expect(page.getByTestId('match-over')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('match-over-hacker')).toHaveText(suspect.name);
  await page.getByTestId('open-debrief').click();
  const debrief = page.getByTestId('debrief');
  await expect(debrief).toContainText(`What ${suspect.name} did`);
  await expect(page.getByTestId('debrief-totals')).toBeVisible();
  await expect(page.getByTestId('debrief-meetings')).toContainText('Huda Rahman');
  await expect(debrief).not.toContainText('Handed in the flag');
  await page.screenshot({ path: `${SHOTS}/20-match-debrief.png` });
});
