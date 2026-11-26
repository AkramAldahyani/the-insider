/**
 * Phase 6, part J: friends in a lobby find the hacker among them and vote them
 * out. Three people without bots: one of them is the hacker, the other two need
 * both their votes.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { walkAndSit, walkTo } from './helpers/movement';

async function person(browser: Browser, name: string, code?: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(code ? `/?lobby=${code}` : '/');
  await page.getByTestId('friends-name').fill(name);
  await page.getByTestId(code ? 'friends-join' : 'friends-create').click();
  await expect(page.getByTestId('party')).toBeVisible();
  return page;
}
const card = async (page: Page) => {
  await page.keyboard.press('c');
  const text = await page.getByTestId('card').innerText();
  await page.keyboard.press('c');
  return { name: /IT ONBOARDING\s+×?\s*(.+)/.exec(text)![1].trim(), pc: /Your PC\s+([A-Z0-9-]+)/.exec(text)![1], user: /Username\s+(\S+)/.exec(text)![1], password: /Password\s+(\S+)/.exec(text)![1] };
};

test('three friends without bots: the two who are not the hacker vote the third one out', async ({ browser }) => {
  test.setTimeout(8 * 60_000);
  const anna = await person(browser, 'Anna');
  const code = (await anna.getByTestId('party-code').textContent())!;
  const ben = await person(browser, 'Ben', code);
  const cleo = await person(browser, 'Cleo', code);
  await anna.getByTestId('party-bots').click();
  for (const page of [ben, cleo]) await page.getByTestId('party-ready').click();
  await anna.getByTestId('party-start').click();

  const everybody = [anna, ben, cleo];
  let hacker: Page | null = null;
  for (const page of everybody) {
    if ((await page.getByTestId('reveal-role').textContent()) === 'You are the hacker') hacker = page;
    await page.getByTestId('reveal-close').click();
    await page.keyboard.press('c');
    await page.waitForFunction(() => window.__insider?.me() != null);
  }
  // The one whose PC is closer to the meeting room pins and calls (long walks are where the test's steering helper is weakest).
  const defenders = everybody.filter((p) => p !== hacker);
  const button0 = await anna.evaluate(() => window.__insider!.button());
  const away = async (page: Page) => {
    const pc = (await card(page)).pc;
    const desk = (await page.evaluate(() => window.__insider!.desks())).find((d) => d.hostname === pc)!;
    return Math.hypot(desk.seatX - button0.x, desk.seatY - button0.y);
  };
  const [first, second] = (await away(defenders[0])) <= (await away(defenders[1])) ? defenders : [defenders[1], defenders[0]];
  const them = await card(hacker!);
  await expect(hacker!.locator('.roster-self')).toContainText(them.name);

  // The first defender pins three lines at their own PC (it takes three to accuse; without bots nobody else judges them).
  const me = await card(first);
  await first.bringToFront();
  await walkAndSit(first, me.pc);
  if ((await first.getByTestId('terminal').getAttribute('data-screen')) === 'login') {
    await first.keyboard.type(me.user);
    await first.keyboard.press('Enter');
  }
  if ((await first.getByTestId('terminal').getAttribute('data-screen')) !== 'shell') {
    await first.keyboard.type(me.password);
    await first.keyboard.press('Enter');
  }
  await expect(first.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');
  for (const n of [1, 2, 3]) {
    await first.keyboard.type(`echo note-${n}`);
    await first.keyboard.press('Enter');
    await first.locator('.xterm-rows > div', { hasText: new RegExp(`^note-${n}`) }).last().click({ clickCount: 3, position: { x: 30, y: 6 } });
    await first.getByTestId('pin-selection').click();
    await expect(first.getByTestId('board-button')).toContainText(`Evidence (${n})`);
    await first.locator('.xterm-helper-textarea').focus();
  }
  await first.keyboard.press('Escape');
  await expect(first.getByTestId('terminal')).toBeHidden();
  const button = await first.evaluate(() => window.__insider!.button());
  // A long walk across the office: on a busy machine the steering helper sometimes gives up half way; it simply goes on from there.
  for (let attempt = 1; ; attempt++) {
    try {
      await walkTo(first, button.x, button.y, 24);
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  await expect(first.getByTestId('hint')).toContainText('call an emergency meeting');
  await first.keyboard.press('e');

  // The meeting: an accusation, and the vote of both who are not the hacker.
  const suspect = await first.getByTestId('accuse-suspect').locator('option', { hasText: them.name }).getAttribute('value');
  await first.getByTestId('accuse-suspect').selectOption(suspect!);
  for (const e of ['E1', 'E2', 'E3']) await first.getByTestId(`accuse-evidence-${e}`).check();
  await first.getByTestId('accuse-submit').click();
  await expect(second.getByTestId('accusation-A1')).toContainText(them.name);
  await second.getByTestId('chat-input-meeting').fill(`I think it is ${them.name} too`);
  await second.getByTestId('chat-input-meeting').press('Enter');
  await expect(hacker!.getByTestId('chat-meeting')).toContainText(`I think it is ${them.name} too`);
  for (const page of [first, second]) await page.getByTestId(`vote-${suspect}`).click({ timeout: 40_000 });
  await expect(first.getByTestId('votes-needed')).toContainText('at least 2 votes');

  // The defenders win, and everybody learns who was who.
  for (const page of everybody) {
    await expect(page.getByTestId('match-over')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('match-over-hacker')).toHaveText(them.name);
    await expect(page.getByTestId('cast').locator('li')).toHaveCount(3);
  }
  await expect(first.getByTestId('match-over')).toContainText('The hacker was caught. The company is safe.');
  await expect(hacker!.getByTestId('match-over')).toContainText('You were caught.');
  await first.screenshot({ path: 'e2e/screenshots/party-defenders.png' });
  await first.getByTestId('open-debrief').click();
  await expect(first.getByTestId('debrief-meetings')).toContainText(them.name);
  await first.getByRole('button', { name: 'Close debrief' }).click();
  for (const page of everybody) {
    await page.getByTestId('back-to-party').click();
    await expect(page.getByTestId('party-code')).toHaveText(code);
  }
  await expect(anna.getByTestId('party-members').locator('li')).toHaveCount(3);
  for (const page of everybody) await page.context().close();
});
