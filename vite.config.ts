import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// For GitHub Pages sub-path deployment set BASE_PATH, e.g. BASE_PATH=/MIDIStudio/ npm run build
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    // spessasynth_lib (~620 kB) is a separate chunk loaded on first audio start.
    chunkSizeWarningLimit: 700,
  },
});
