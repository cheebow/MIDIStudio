// Screenshots for the beginner's guide (ADR-063): `npm run shots:tutorial` renders the app in
// Chromium at 2x and writes public/images/tutorial/*.{ja,en}.jpg. Not part of the test suite.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'scripts/shots',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:4318',
    locale: 'ja-JP',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    storageState: { cookies: [], origins: [{ origin: 'http://localhost:4318', localStorage: [{ name: 'midi-studio.startup', value: 'skip' }] }] },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4318 --strictPort',
    url: 'http://localhost:4318',
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } }],
});
