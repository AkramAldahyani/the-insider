/**
 * Smoke test: one player plays through the heart of Phase 2 in a real browser.
 *
 *   open the game -> pick Sara -> walk to her desk -> unlock it -> `whoami`
 *   -> stand up -> walk to Lina's UNLOCKED desk -> `whoami` says l.haddad
 *
 * The test only uses what a player has: the keyboard and what is on screen.
 * To know where to walk it reads the public position and map that the page
 * exposes as `window.__insider` (see client/src/main.tsx).
 */
import { expect, test, type Page } from '@playwright/test';
import { walkAndSit, walkTo, walkToDesk } from './helpers/movement';
import { openOffice } from './helpers/menu';

const SHOTS = 'e2e/screenshots';

/** Text currently visible in the PC terminal. */
async function terminalText(page: Page): Promise<string> {
  return page.locator('.xterm-rows').innerText();
}

test('walk to a desk, log in, then use someone else\'s unlocked PC', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Open the game and pick an employee.
  await openOffice(page);
  await expect(page.getByRole('heading', { name: 'THE INSIDER' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/1-start-screen.png` });
  await page.getByTestId('employee-p1').click();

  // 2. The onboarding card shows her own credentials.
  await expect(page.getByTestId('card')).toBeVisible();
  await expect(page.getByTestId('card-username')).toHaveText('s.alharbi');
  await expect(page.getByTestId('card-your-pc')).toHaveText('FIN-LT-07');
  await expect(page.getByTestId('card-badge')).toHaveText('#0412');
  const password = await page.getByTestId('card-password').innerText();
  await expect(page.getByTestId('room')).toHaveText('Finance');
  await page.screenshot({ path: `${SHOTS}/2-office-and-card.png` });

  // Her task list: three open tasks, none finished. T hides and shows it.
  await expect(page.getByTestId('tasks').locator('.task')).toHaveCount(3);
  await expect(page.getByTestId('tasks-completed')).toHaveText('0 done');
  await page.keyboard.press('t');
  await expect(page.getByTestId('tasks')).toBeHidden();
  await page.keyboard.press('t');
  await expect(page.getByTestId('tasks')).toBeVisible();

  // C hides and shows the card.
  await page.keyboard.press('c');
  await expect(page.getByTestId('card')).toBeHidden();

  // 3. Walk to her desk; the hint appears; E opens the PC.
  await walkAndSit(page, 'FIN-LT-07', async () => {
    await expect(page.getByTestId('hint')).toContainText('FIN-LT-07');
    await page.screenshot({ path: `${SHOTS}/3-at-desk.png` });
  });
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', /locked|shell/);
  // If this test ran less than a minute ago on the same server, her PC is still open: lock it first.
  if ((await page.getByTestId('terminal').getAttribute('data-screen')) === 'shell') {
    await page.keyboard.type('loginctl lock-session');
    await page.keyboard.press('Enter');
  }
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'locked');
  await expect.poll(() => terminalText(page)).toContain('screen locked by s.alharbi');

  // 4. The password is shown as stars, never as text.
  await page.keyboard.type(password);
  const typed = await terminalText(page);
  expect(typed).toContain('*'.repeat(password.length));
  expect(typed).not.toContain(password);
  await page.screenshot({ path: `${SHOTS}/4-lock-screen.png` });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');

  // 5. Use the shell.
  await page.keyboard.type('whoami');
  await page.keyboard.press('Enter');
  await expect.poll(() => terminalText(page)).toMatch(/whoami\s*\n\s*s\.alharbi\s*\n/);
  await page.keyboard.type('hostname && ip a | grep inet');
  await page.keyboard.press('Enter');
  await expect.poll(() => terminalText(page)).toContain('FIN-LT-07');
  // Ctrl+C throws the half-typed line away.
  await page.keyboard.type('rm -rf everything');
  await page.keyboard.press('Control+c');
  await expect.poll(() => terminalText(page)).toContain('^C');
  await page.screenshot({ path: `${SHOTS}/5-shell.png` });

  // Pin evidence: double-click a word in the terminal to select it, then "Pin selection".
  await page.locator('.xterm-rows').getByText('FIN-LT-07', { exact: true }).first().dblclick();
  await page.getByTestId('pin-selection').click();
  await expect(page.getByTestId('notice')).toContainText('Pinned to the evidence board as E1');
  await expect(page.getByTestId('board-button')).toContainText('Evidence (1)');
  await page.locator('.xterm-helper-textarea').focus();

  // 6. Esc stands up; the PC stays unlocked (standing must not lock).
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('terminal')).toBeHidden();
  expect((await page.evaluate(() => window.__insider!.desks())).find((d) => d.hostname === 'FIN-LT-07')!.screen).toBe('unlocked');
  // The board (B) shows the pin.
  await page.keyboard.press('b');
  await expect(page.getByTestId('evidence-E1')).toContainText('FIN-LT-07 screen');
  await expect(page.getByTestId('evidence-E1')).toContainText('pinned by Sara Alharbi');
  await page.screenshot({ path: `${SHOTS}/15-evidence-board.png` });
  await page.keyboard.press('b');
  await expect(page.getByTestId('board')).toBeHidden();

  // 7. Walk to Lina's desk in HR, which she left unlocked. Two badge doors are on the way.
  await walkAndSit(page, 'HR-LT-03', async () => {
    await expect(page.getByTestId('room')).toHaveText('HR');
    await page.screenshot({ path: `${SHOTS}/6-at-unlocked-desk.png` });
  });
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell'); // no password asked
  await page.keyboard.type('whoami');
  await page.keyboard.press('Enter');
  await expect.poll(() => terminalText(page)).toMatch(/whoami\s*\n\s*l\.haddad\s*\n/);
  await page.screenshot({ path: `${SHOTS}/7-someone-elses-shell.png` });

  expect(errors).toEqual([]);
});

test('switch user on a locked PC, and the developer panel', async ({ page }) => {
  await openOffice(page);
  await page.getByTestId('employee-p5').click(); // Khalid, the sysadmin
  const password = await page.getByTestId('card-password').innerText();
  await page.keyboard.press('c');

  // The developer panel (backtick) exists because this is a development server.
  await page.keyboard.press('Backquote');
  const dev = page.getByTestId('dev-panel');
  await expect(dev).toBeVisible();
  await dev.getByLabel('Desk').selectOption('REC-PC-01');
  await dev.getByRole('button', { name: 'go' }).nth(1).click(); // teleport
  await expect(page.getByTestId('room')).toHaveText('Reception');
  await dev.getByRole('button', { name: 'show last' }).click();
  await expect(page.getByTestId('dev-log')).toContainText('Master event log');
  // Server-only views: the doors, and the latest picture of a camera (Khalid is in Reception, in view of CAM-01).
  await dev.getByRole('button', { name: 'doors' }).click();
  await expect(page.getByTestId('dev-log')).toContainText('SRV-ROOM    badge, zone server-room');
  // Cameras look every 2 game seconds, so ask again until the picture taken after the teleport is there.
  await expect.poll(async () => {
    await dev.getByRole('button', { name: 'snapshot' }).click();
    await page.waitForTimeout(300);
    return page.getByTestId('dev-log').innerText();
  }, { timeout: 15_000 }).toMatch(/CAM-01 Reception \(watches Reception[\s\S]*Khalid Nasser/);
  await page.screenshot({ path: `${SHOTS}/8-dev-panel.png` });
  await page.keyboard.press('Backquote');
  await expect(dev).toBeHidden();

  // Maha's PC is locked. Khalid has an account on it, so he can switch user.
  await walkAndSit(page, 'REC-PC-01');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'locked');
  await page.getByRole('button', { name: 'Switch user (F2)' }).click();
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'login');
  await expect.poll(() => terminalText(page)).toContain('still logged in and locked: m.yousef');
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('k.nasser');
  await page.keyboard.press('Enter');
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');
  await page.keyboard.type('who');
  await page.keyboard.press('Enter');
  await expect.poll(() => terminalText(page)).toMatch(/m\.yousef\s+tty1[\s\S]*k\.nasser\s+tty2/);
  await page.screenshot({ path: `${SHOTS}/9-switch-user.png` });

  // Logging out brings Maha's lock screen back: her session was never touched.
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'locked');
  await expect.poll(() => terminalText(page)).toContain('screen locked by m.yousef');
});

test('badge doors: a refused badge keeps the security office shut', async ({ page }) => {
  await openOffice(page);
  await page.getByTestId('employee-p1').click(); // Sara: her badge opens only the normal doors
  await expect(page.getByTestId('card')).toBeVisible();
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__insider?.me() != null);
  const look = (id: string) => page.evaluate((door) => window.__insider!.doors().find((d) => d.id === door)!.look, id);

  // Out of Finance (her badge opens that door) and along the corridor to the security office door.
  await walkTo(page, 15.5 * 32, 17.5 * 32);
  await expect(page.getByTestId('room')).toHaveText('Corridor');
  await expect(page.getByTestId('hint')).toContainText('tap your badge at the security office door');
  await page.keyboard.press('e');
  await expect(page.getByTestId('notice')).toContainText('Access denied');
  expect(await look('SEC-OFFICE')).toBe('denied');
  await page.screenshot({ path: `${SHOTS}/10-badge-denied.png` });

  // She cannot walk in.
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(700);
  await page.keyboard.up('ArrowDown');
  await expect(page.getByTestId('room')).toHaveText('Corridor');
  await expect.poll(() => look('SEC-OFFICE')).toBe('closed');
});

test('joining as the hacker: a private briefing and a hidden tools folder; the role is then taken', async ({ page, browser }) => {
  await openOffice(page);
  const option = page.getByTestId('join-as-hacker');
  await expect(option).toBeEnabled();
  await option.check();
  await page.getByTestId('employee-p4').click(); // Omar, Marketing
  // First the ordinary onboarding card (he looks like any employee); closing it shows the briefing.
  const password = await page.getByTestId('card-password').innerText();
  await page.keyboard.press('c');
  await expect(page.getByTestId('mission')).toBeVisible();
  await expect(page.getByTestId('mission-goal')).toContainText('/root/flag.txt');
  await page.screenshot({ path: `${SHOTS}/11-hacker-briefing.png` });

  // M hides and shows the briefing.
  await page.keyboard.press('m');
  await expect(page.getByTestId('mission')).toBeHidden();
  await page.keyboard.press('m');
  await expect(page.getByTestId('mission')).toBeVisible();

  // Someone else opening the game sees that the role is taken, and gets no briefing.
  const other = await (await browser.newContext()).newPage();
  await openOffice(other);
  await expect(other.getByTestId('join-as-hacker')).toBeDisabled();
  await other.getByTestId('employee-p1').click();
  await expect(other.getByTestId('card')).toBeVisible();
  await expect(other.getByTestId('mission')).toHaveCount(0);
  await other.close();

  // On his own PC the tools folder is there, but only `ls -a` shows it.
  await walkAndSit(page, 'MKT-LT-11');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'locked');
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');
  await page.keyboard.type('ls -a');
  await page.keyboard.press('Enter');
  await expect.poll(() => terminalText(page)).toContain('.tools');
  await page.keyboard.type('cat .tools/README');
  await page.keyboard.press('Enter');
  await expect.poll(() => terminalText(page)).toContain('Every tool leaves a trace');

  // The USB stick: stand at Yousef's open PC (same room) and hold U for 5 seconds.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('terminal')).toBeHidden();
  await walkToDesk(page, 'MKT-LT-09');
  await expect(page.getByTestId('hint')).toContainText('hold U to plug in the USB stick');
  await page.keyboard.down('u');
  await expect(page.getByTestId('notice')).toContainText('keep holding U');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/12-usb-stick.png` });
  await expect(page.getByTestId('notice')).toContainText('Backdoor installed on MKT-LT-09 for y.khalil', { timeout: 10_000 });
  await page.keyboard.up('u');
});

test('the hacker reads a forgotten root password, gets the flag, hands it in, and everybody sees the end', async ({ page, browser }) => {
  await openOffice(page);
  await page.getByTestId('join-as-hacker').check();
  await page.getByTestId('employee-p4').click(); // Omar
  const password = await page.getByTestId('card-password').innerText();
  await page.keyboard.press('c');

  // Somebody else is in the office too.
  const other = await (await browser.newContext()).newPage();
  await openOffice(other);
  await other.getByTestId('employee-p1').click();
  await expect(other.getByTestId('card')).toBeVisible();

  const run = async (line: string) => {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  };
  await walkAndSit(page, 'MKT-LT-11');
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'locked');
  await run(password);
  await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');
  await run('ssh ADMIN-SRV-01');
  await expect.poll(() => terminalText(page)).toContain("o.farouk@ADMIN-SRV-01's password:");
  await run(password);
  await expect.poll(() => terminalText(page)).toContain('o.farouk@ADMIN-SRV-01:~$');
  await run('cat /srv/shared/old/backup-2025.sh');
  await expect.poll(() => terminalText(page)).toContain('ROOT_PW=');
  const rootPassword = /ROOT_PW='([^']+)'/.exec(await terminalText(page))![1];
  await run('clear');
  await run('su');
  await run(rootPassword);
  await expect.poll(() => terminalText(page)).toContain('root@ADMIN-SRV-01');
  await run('cat /root/flag.txt');
  await expect.poll(() => terminalText(page)).toMatch(/NEXORA\{[^}]+\}/);
  const flag = /NEXORA\{[^}]+\}/.exec(await terminalText(page))![0];

  // Stand up, open the briefing, hand it in.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('terminal')).toBeHidden();
  await expect(page.getByTestId('mission')).toBeVisible();
  await page.getByTestId('flag-input').fill(flag);
  await page.getByTestId('flag-submit').click();
  await expect(page.getByTestId('match-over')).toContainText('You got the flag out. You win.');
  await page.screenshot({ path: `${SHOTS}/13-hacker-wins.png` });
  // The other player is told who it was.
  await expect(other.getByTestId('match-over')).toContainText('The hacker got the flag out.');
  await expect(other.getByTestId('match-over-hacker')).toHaveText('Omar Farouk');
  // ...and can now see everything he did: the steps, the technique, and the evidence nobody looked at.
  await other.getByTestId('open-debrief').click();
  const debrief = other.getByTestId('debrief');
  await expect(debrief).toContainText('What Omar Farouk did');
  await expect(other.getByTestId('debrief-totals')).toContainText('missed');
  const su = debrief.locator('li', { hasText: 'Became root on ADMIN-SRV-01 with su' });
  await su.getByRole('button').click();
  await expect(su).toContainText('MITRE ATT&CK T1078.003');
  await expect(su).toContainText('/var/log/auth.log');
  await expect(su).toContainText('nobody looked');
  await other.screenshot({ path: `${SHOTS}/18-debrief.png` });
  await other.getByRole('button', { name: 'Close debrief' }).click();
  await expect(debrief).toBeHidden();
  await other.close();
});

test('simulated reset mail leaves private loot and cleaning a log leaves a tamper marker', async ({ page, browser }) => {
  await openOffice(page);
  await page.getByTestId('join-as-hacker').check();
  await page.getByTestId('employee-p5').click(); // Khalid: a hacker with the sysadmin's ordinary permissions.
  const password = await page.getByTestId('card-password').innerText();
  await page.keyboard.press('c');
  const context = await browser.newContext();
  const victim = await context.newPage();
  try {
    await openOffice(victim);
    await victim.getByTestId('employee-p3').click();
    const victimPassword = await victim.getByTestId('card-password').innerText();
    await victim.keyboard.press('c');
    const run = async (tab: Page, line: string) => {
      await tab.locator('.xterm-helper-textarea').focus();
      await tab.keyboard.type(line);
      await tab.keyboard.press('Enter');
    };
    await walkAndSit(page, 'IT-WS-02');
    // The window mounts with data-screen="" before its effect delivers the queued term.open.
    // Visibility alone can therefore skip the unlock branch. Wait for the actual initial screen.
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'locked');
    await run(page, password);
    await expect(page.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');
    await run(page, '~/.tools/phish l.haddad');
    await expect.poll(() => terminalText(page)).toContain('Reset message sent');
    const file = /phish-\d+\.txt/.exec(await terminalText(page))![0];

    await walkAndSit(victim, 'HR-LT-03');
    await expect(victim.getByTestId('terminal')).toHaveAttribute('data-screen', 'shell');
    await run(victim, 'mail');
    await expect.poll(() => terminalText(victim)).toContain('IT password reset');
    const number = /N\s*(\d+)\s+IT\s/.exec(await terminalText(victim))![1];
    await run(victim, `mail ${number}`);
    await expect.poll(() => terminalText(victim)).toContain('spf=fail');
    await expect.poll(() => terminalText(victim)).toContain('password-reset.example/reset/');
    const link = /https:\/\/password-reset\.example\/reset\/\d+/.exec(await terminalText(victim))![0];
    await run(victim, `curl ${link}`);
    await expect.poll(() => terminalText(victim)).toContain('request has been received');
    expect(await terminalText(victim)).not.toContain(victimPassword);
    await run(page, `cat ~/.tools/loot/${file}`);
    await expect.poll(() => terminalText(page)).toContain(`l.haddad:${victimPassword}`);
    await run(page, 'sudo ~/.tools/clean /var/log/auth.log "session"');
    await expect.poll(() => terminalText(page)).toContain('[sudo] password for k.nasser');
    await run(page, password);
    await expect.poll(() => terminalText(page)).toContain('a log cleared trace remains');
    await run(page, 'tail -n 2 /var/log/auth.log');
    await expect.poll(() => terminalText(page)).toContain('EVENT=log-cleared');
  } finally {
    await context.close();
  }
});

test('the guard uses the security monitors: camera pictures, badge log', async ({ page }) => {
  await openOffice(page);
  await page.getByTestId('employee-p10').click(); // Tariq, in the security office
  await expect(page.getByTestId('card')).toBeVisible();
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__insider?.me() != null && window.__insider.map() != null);
  const station = await page.evaluate(() => window.__insider!.monitors());
  await walkTo(page, station.x, station.y);
  await expect(page.getByTestId('hint')).toContainText('security monitors');
  await page.keyboard.press('e');
  await expect(page.getByTestId('monitors')).toBeVisible();
  await page.getByTestId('camera-CAM-01').click();
  await expect(page.getByTestId('monitors-who')).toContainText(/\d\d:\d\d:\d\d/);
  await page.screenshot({ path: `${SHOTS}/14-security-monitors.png` });
  await page.getByTestId('monitors-tab-badges').click();
  await expect(page.getByTestId('monitors-badges')).toContainText('DOOR=MAIN-ENT BADGE=0119 USER=t.omar');
  // Walking away switches them off.
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowUp');
  await expect(page.getByTestId('monitors')).toBeHidden();
});

test('an emergency meeting: the button, the meeting chat, and nobody voted out without an accusation', async ({ page, browser }) => {
  await openOffice(page);
  await page.getByTestId('employee-p6').click(); // Noor, HR
  await expect(page.getByTestId('card')).toBeVisible();
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__insider?.me() != null && window.__insider.map() != null);
  const other = await (await browser.newContext()).newPage();
  await openOffice(other);
  await other.getByTestId('employee-p2').click(); // Rami
  await expect(other.getByTestId('card')).toBeVisible();

  const button = await page.evaluate(() => window.__insider!.button());
  await walkTo(page, button.x, button.y, 24); // Within the button's 40 px hint, not an exact floor pixel.
  await expect(page.getByTestId('hint')).toContainText('call an emergency meeting (1 left)');
  await page.keyboard.press('e');
  await expect(page.getByTestId('meeting')).toBeVisible();
  await expect(page.getByTestId('meeting')).toContainText('called by Noor Saleh');
  await expect(other.getByTestId('meeting')).toBeVisible(); // everybody is in it
  await page.getByTestId('chat-input-meeting').fill('Anyone seen anything odd?');
  await page.getByTestId('chat-input-meeting').press('Enter');
  await expect(other.getByTestId('chat-meeting')).toContainText('Noor Saleh: Anyone seen anything odd?');
  await expect(page.getByTestId('accuse-form')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/16-meeting.png` });
  // Nobody accused anybody: the meeting ends with nobody voted out.
  await expect(page.getByTestId('meeting-result')).toContainText('Nobody was voted out.', { timeout: 30_000 });
  await expect(page.getByTestId('meeting')).toBeHidden({ timeout: 10_000 });
  await other.close();
});

test('the guard detains someone: X asks, X again does it; an innocent person costs the power', async ({ page, browser }) => {
  const other = await (await browser.newContext()).newPage();
  await openOffice(other);
  await other.getByTestId('employee-p9').click(); // Maha, at reception (no hacker in this match)
  await expect(other.getByTestId('card')).toBeVisible();
  await other.keyboard.press('c');
  await other.waitForFunction(() => window.__insider?.me() != null);
  const maha = await other.evaluate(() => window.__insider!.me()!);

  await openOffice(page);
  await page.getByTestId('employee-p10').click(); // Tariq, the guard
  await expect(page.getByTestId('card')).toBeVisible();
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__insider?.me() != null && window.__insider.map() != null);
  // Between Maha and her chair: within detaining distance AND beside a desk, where the warning used to be hidden.
  await walkTo(page, maha.x, maha.y - 40, 16); // 24 px from the chair (44 allowed), 40 px from her (60 allowed)
  await expect(page.getByTestId('hint')).toContainText('to use REC-PC-01');
  await expect(page.getByTestId('detain-hint')).toContainText('Press X to detain');
  await expect(page.getByTestId('detain-hint')).toContainText('Maha Yousef');
  const warning = (await page.getByTestId('detain-hint').boundingBox())!;
  const deskHint = (await page.getByTestId('hint').boundingBox())!;
  expect(warning.y + warning.height, 'the warning must not cover the desk hint').toBeLessThanOrEqual(deskHint.y);
  await page.keyboard.press('x');
  await expect(page.getByTestId('detain-hint')).toContainText('Press X again to detain Maha Yousef');
  await page.screenshot({ path: `${SHOTS}/17-detain.png` });
  await page.keyboard.press('x');
  await expect(other.getByTestId('notice')).toContainText('Tariq Omar detained Maha Yousef, who was not the hacker');
  await page.keyboard.press('x');
  await page.keyboard.press('x');
  await expect(page.getByTestId('notice')).toContainText('you cannot detain anyone any more');
  await other.close();
});

