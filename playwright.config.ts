import { defineConfig } from '@playwright/test';

/**
 * Browser test of the whole game (`pnpm e2e`).
 * Playwright starts the game server and the web page itself (or reuses them
 * if `pnpm dev` is already running), then drives a real Chromium browser.
 * Screenshots are written to e2e/screenshots/.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'node scripts/dev.mjs',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
