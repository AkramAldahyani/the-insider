/** Phase 6, part D: chat in real browsers. Open chat is heard in the same room only. */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { openOffice } from './helpers/menu';
import { walkAndSit } from './helpers/movement';

async function employee(browser: Browser, id: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await openOffice(page);
  await page.getByTestId(`employee-${id}`).click();
  await expect(page.getByTestId('card')).toBeVisible({ timeout: 15_000 }); // (the first test of a run waits for the page to be compiled)
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__insider?.me() != null);
  return page;
}

test('open chat: heard in the same room, typed without walking or running commands, and people can be muted', async ({ browser }) => {
  // The first file of a run: three pages load the game cold, which can take long on a busy computer.
  test.setTimeout(4 * 60_000);
  const sara = await employee(browser, 'p1');
  const rami = await employee(browser, 'p2'); // also in Finance
  const lina = await employee(browser, 'p3'); // HR

  // Enter opens the box; letters that usually do something only become text.
  const before = await sara.evaluate(() => window.__insider!.me());
  await sara.keyboard.press('Enter');
  await expect(sara.getByTestId('chat-input-room')).toBeFocused();
  await sara.keyboard.type('was anybody at my desk? ece');
  await sara.keyboard.press('Enter');
  await expect(sara.getByTestId('chat-room')).toContainText('Sara Alharbi: was anybody at my desk? ece');
  expect(await sara.evaluate(() => window.__insider!.me())).toMatchObject({ x: before!.x, y: before!.y });
  await expect(sara.getByTestId('card')).toHaveCount(0);

  // Rami hears it although his panel is closed; Lina next door does not.
  await expect(rami.getByTestId('chat-recent')).toContainText('was anybody at my desk?');
  await rami.getByTestId('chat-button').click();
  await rami.getByTestId('chat-input-room').fill('no');
  await rami.keyboard.press('Enter');
  await expect(sara.getByTestId('chat-room')).toContainText('Rami Mansour: no');
  await expect(sara.getByTestId('chat-panel')).toContainText('Finance');
  await sara.screenshot({ path: 'e2e/screenshots/chat.png' });
  await lina.keyboard.press('Enter');
  await expect(lina.getByTestId('chat-room')).toHaveText('Nobody here has said anything.');

  // Mute and hear again.
  await sara.getByTitle('Mute Rami Mansour').first().click();
  await expect(sara.getByTestId('chat-room')).not.toContainText('Rami Mansour: no');
  await expect(sara.getByTestId('chat-muted')).toContainText('Rami Mansour');
  await sara.getByTitle('Hear Rami Mansour again').click();
  await expect(sara.getByTestId('chat-room')).toContainText('Rami Mansour: no');

  // Esc closes it, and the keys walk again.
  await sara.getByTestId('chat-input-room').press('Escape');
  await expect(sara.getByTestId('chat-panel')).toHaveCount(0);

  // Sitting at the PC: the button opens it, the line does not reach the terminal, and Esc goes back to the PC without standing up.
  await walkAndSit(sara, 'FIN-LT-07');
  await sara.getByTestId('chat-button').click();
  await sara.getByTestId('chat-input-room').fill('I am at my PC');
  await sara.keyboard.press('Enter');
  await expect(rami.getByTestId('chat-room')).toContainText('I am at my PC');
  await sara.screenshot({ path: 'e2e/screenshots/chat-seated.png' });
  await sara.getByTestId('chat-input-room').press('Escape');
  await expect(sara.getByTestId('terminal')).toBeVisible();
  expect(await sara.locator('.xterm-rows').innerText()).not.toContain('I am at my PC');
  await sara.keyboard.press('Escape');
  await expect(sara.getByTestId('terminal')).toBeHidden();
  for (const page of [sara, rami, lina]) await page.context().close();
});
