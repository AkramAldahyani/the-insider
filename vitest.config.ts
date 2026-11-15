import { defineConfig } from 'vitest/config';

// One Vitest config for the whole repo: it picks up every *.test.ts under packages/.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
