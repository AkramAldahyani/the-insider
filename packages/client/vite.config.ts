import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web page of the game. In development Vite serves it on port 5173 and
// reloads it when a file changes; `vite build` writes the production files to dist/.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 2500 }, // Phaser alone is about 1.5 MB
});
