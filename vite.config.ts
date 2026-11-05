import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Static pages (ADR-055 / 056 / 061): the in-app help and the beginner's guide rendered to HTML in
 * Japanese and English, served on the fly at /help.html, /tutorial.html, /help.en.html and
 * /tutorial.en.html by the dev server. The build writes them to dist/ with scripts/build-pages.mjs.
 */
function staticPages(): Plugin {
  const pages: Record<string, string> = {
    '/help.html': 'renderHelpHtml',
    '/tutorial.html': 'renderTutorialHtml',
    '/help.en.html': 'renderHelpEnHtml',
    '/tutorial.en.html': 'renderTutorialEnHtml',
  };
  return {
    name: 'static-pages',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        const fn = Object.entries(pages).find(([suffix]) => path.endsWith(suffix))?.[1];
        if (!fn) return next();
        try {
          const mod = await server.ssrLoadModule('/src/site/renderHelp.tsx');
          const html = (mod[fn] as () => string)();
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

/**
 * Content-Security-Policy for the built app (ADR-087). GitHub Pages cannot send headers, so it is a
 * <meta> tag. Everything comes from the site itself: no external host can be reached even if a
 * crafted file got a URL into the page. 'wasm-unsafe-eval': SpessaSynth's SF3 (Vorbis) decoder is
 * WebAssembly. Build only: the dev server needs inline scripts and a WebSocket for hot reload.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  };
}

// For GitHub Pages sub-path deployment set BASE_PATH, e.g. BASE_PATH=/MIDIStudio/ npm run build
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), staticPages(), contentSecurityPolicy()],
  worker: { format: 'es' },
  build: {
    // spessasynth_lib (~620 kB) is a separate chunk loaded on first audio start.
    chunkSizeWarningLimit: 700,
  },
});
