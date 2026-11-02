// Writes dist/help.html and dist/tutorial.html: the in-app help and the beginner's guide rendered
// to static HTML (ADR-055 / 056). A throw-away Vite dev server loads the TSX module in SSR mode, so
// no second toolchain is needed. Runs after `vite build` as its own process (doing this inside the
// build hook crashed the bundler).
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const mod = await server.ssrLoadModule('/src/site/renderHelp.tsx');
  for (const [file, fn] of [
    ['help.html', 'renderHelpHtml'],
    ['tutorial.html', 'renderTutorialHtml'],
  ]) {
    writeFileSync(`dist/${file}`, mod[fn]());
    console.log(`[build-pages] wrote dist/${file}`);
  }
} finally {
  await server.close();
}
