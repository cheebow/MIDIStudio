import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Static help page (ADR-055): the in-app help sections rendered to HTML, served on the fly at
 * /help.html by the dev server. The build writes dist/help.html with scripts/build-help.mjs.
 */
function helpPage(): Plugin {
  const render = async (loader: { ssrLoadModule(url: string): Promise<Record<string, unknown>> }) => {
    const mod = await loader.ssrLoadModule('/src/site/renderHelp.tsx');
    return (mod.renderHelpHtml as () => string)();
  };
  return {
    name: 'help-page',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.split('?')[0].endsWith('/help.html')) return next();
        try {
          const html = await render(server);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

// For GitHub Pages sub-path deployment set BASE_PATH, e.g. BASE_PATH=/MIDIStudio/ npm run build
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), helpPage()],
  worker: { format: 'es' },
  build: {
    // spessasynth_lib (~620 kB) is a separate chunk loaded on first audio start.
    chunkSizeWarningLimit: 700,
  },
});
