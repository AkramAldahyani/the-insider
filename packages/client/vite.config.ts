import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web page of the game. In development Vite serves it on port 5173 and
// reloads it when a file changes; `vite build` writes the production files to dist/.
// CLIENT_PORT lets the browser tests run a second copy next to `pnpm dev`.
const port = Number(process.env.CLIENT_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: { port, strictPort: true },
  preview: { port, strictPort: true },
  build: { chunkSizeWarningLimit: 2500 }, // Phaser alone is about 1.5 MB
});
