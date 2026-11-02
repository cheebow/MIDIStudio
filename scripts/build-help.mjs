// Writes dist/help.html: the in-app help sections rendered to static HTML (ADR-055).
// A throw-away Vite dev server loads the TSX module in SSR mode, so no second toolchain is needed.
// Runs after `vite build` as its own process (doing this inside the build hook crashed the bundler).
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const mod = await server.ssrLoadModule('/src/site/renderHelp.tsx');
  writeFileSync('dist/help.html', mod.renderHelpHtml());
  console.log('[build-help] wrote dist/help.html');
} finally {
  await server.close();
}
