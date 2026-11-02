import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// For GitHub Pages sub-path deployment set BASE_PATH, e.g. BASE_PATH=/MIDIStudio/ npm run build
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    // spessasynth_lib (~620 kB) is a separate chunk loaded on first audio start.
    chunkSizeWarningLimit: 700,
  },
});
