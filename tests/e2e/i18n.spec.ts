import { expect, test } from '@playwright/test';
import { menu } from './helpers';

const SKIP_STARTUP = { cookies: [], origins: [{ origin: 'http://localhost:4318', localStorage: [{ name: 'midi-studio.startup', value: 'skip' }] }] };

test('ADR-061: 表示 › 言語 › English switches the UI and is kept across reloads; 日本語 switches back', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await menu(page, '表示', 'English', '言語');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Piano roll' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  await menu(page, 'View', '日本語', 'Language');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByRole('button', { name: 'ファイル', exact: true })).toBeVisible();
});

test('ADR-061: a browser set to English starts in English until the user chooses otherwise', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-US', storageState: SKIP_STARTUP });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
  await ctx.close();
});
