import { defineConfig } from '@playwright/test';

/**
 * Browser test of the whole game (`pnpm e2e`).
 *
 * Playwright starts its OWN game server and web page, on other ports than
 * `pnpm dev` uses (2577 and 5183), so the tests never share an office with a
 * game you have open, and every run starts from a fresh one.
 *
 * That server runs with BOTS=0: these tests walk to particular desks and
 * expect to find them free, which a bot sitting at its own desk would break.
 * The bots are tested in packages/server/test (and by hand: TESTING.md).
 * Screenshots are written to e2e/screenshots/.
 */
const GAME_PORT = '2577';
const PAGE_PORT = '5183';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PAGE_PORT}`,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'node scripts/dev.mjs',
    url: `http://localhost:${PAGE_PORT}`,
    env: { GAME_PORT, CLIENT_PORT: PAGE_PORT, VITE_SERVER_URL: `ws://localhost:${GAME_PORT}`, BOTS: '0' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
