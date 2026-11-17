import { defineConfig } from '@playwright/test';

/**
 * Browser test of the whole game (`pnpm e2e`).
 *
 * Playwright starts its OWN game server and web page, on other ports than
 * `pnpm dev` uses (2577 and 5183), so the tests never share an office with a
 * game you have open, and every run starts from a fresh one.
 *
 * It also runs with exactly one weakness (VULNS=plaintext-password: an extra file on the server, nothing
 * else changes), so every run sees the same office and the hacker test can reach the flag.
 * That server runs with BOTS=0: these tests walk to particular desks and
 * expect to find them free, which a bot sitting at its own desk would break.
 * The bots are tested in packages/server/test (and by hand: TESTING.md).
 * Screenshots are written to e2e/screenshots/.
 */
const GAME_PORT = '2577';
const PAGE_PORT = '5183';

export default defineConfig({
  testDir: 'e2e',
  // Files share one office and the same employee choices.
  workers: 1,
  timeout: 120_000,
  // The tests steer a character with real key presses and real timing. About one run in ten the walk
  // in the first test gets stuck on a slow moment; one retry keeps that from failing the whole run.
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PAGE_PORT}`,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'node scripts/dev.mjs',
    url: `http://localhost:${PAGE_PORT}`,
    env: { GAME_PORT, CLIENT_PORT: PAGE_PORT, VITE_SERVER_URL: `ws://localhost:${GAME_PORT}`, BOTS: '0', VULNS: 'plaintext-password' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
