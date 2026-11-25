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
 * match.spec.ts and infiltration.spec.ts play whole solo matches, and
 * party-match.spec.ts one of a lobby. They have a server of their own (2578/5184) with a fixed seed, game time four times as
 * fast, and an anti-stall alert every game minute.
 * Screenshots are written to e2e/screenshots/.
 */
const GAME_PORT = '2577';
const PAGE_PORT = '5183';
const MATCH_GAME_PORT = '2578';
const MATCH_PAGE_PORT = '5184';
/** Files that play whole matches. */
const MATCHES = ['match.spec.ts', 'infiltration.spec.ts', 'party-match.spec.ts'];

/** Starts a game server and a web page of its own. */
const server = (gamePort: string, pagePort: string, env: Record<string, string>) => ({
  command: 'node scripts/dev.mjs',
  url: `http://localhost:${pagePort}`,
  env: { GAME_PORT: gamePort, CLIENT_PORT: pagePort, VITE_SERVER_URL: `ws://localhost:${gamePort}`, VULNS: 'plaintext-password', ...env },
  reuseExistingServer: false,
  timeout: 60_000,
});

export default defineConfig({
  testDir: 'e2e',
  // Files share one office and the same employee choices.
  workers: 1,
  timeout: 120_000,
  // Movement waits for authoritative state; a retry must not hide a broken walk.
  retries: 0,
  reporter: [['list']],
  use: { viewport: { width: 1280, height: 800 } },
  projects: [
    { name: 'office', testIgnore: MATCHES, use: { baseURL: `http://localhost:${PAGE_PORT}` } },
    { name: 'match', testMatch: MATCHES, use: { baseURL: `http://localhost:${MATCH_PAGE_PORT}` } },
  ],
  webServer: [
    server(GAME_PORT, PAGE_PORT, { BOTS: '0', MEETING_SECONDS: '20,12,3' }),
    server(MATCH_GAME_PORT, MATCH_PAGE_PORT, { SEED: '1', TIME_SPEED: '4', STALL_MINUTES: '1', MEETING_SECONDS: '20,15,5' }),
  ],
});
