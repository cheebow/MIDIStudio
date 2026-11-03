import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  // the startup dialog (ADR-049) is turned off for the suite; smoke.spec.ts tests it with an empty storage state
  use: { baseURL: 'http://localhost:4318', locale: 'ja-JP', storageState: { cookies: [], origins: [{ origin: 'http://localhost:4318', localStorage: [{ name: 'midi-studio.startup', value: 'skip' }] }] } },
  webServer: {
    command: 'npm run build && npx vite preview --port 4318 --strictPort',
    url: 'http://localhost:4318',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
