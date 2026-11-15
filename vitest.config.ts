import { defineConfig } from 'vitest/config';

// One Vitest config for the whole repo: it picks up every *.test.ts under packages/.
// (Playwright's browser test lives in e2e/ and is run separately with `pnpm e2e`.)
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // Run tests in worker threads rather than child processes. The Colyseus
    // server talks to a parent process when it has one, which confuses
    // Vitest's own child-process channel; threads have no such channel.
    pool: 'threads',
  },
});
