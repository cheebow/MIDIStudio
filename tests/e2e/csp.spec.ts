import { expect, test } from '@playwright/test';
import { startAudio } from './helpers';

// ADR-087: the built app carries a Content-Security-Policy; the app itself (audio worklet, SoundFont,
// samples, editing) must work inside it, and an external URL in page styles must be blocked.
test('the built page has a CSP, the audio engine starts under it, and external loads are blocked', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto('/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  await startAudio(page);
  await page.keyboard.press('Space'); // play a moment
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  // an external image in a style (what a crafted colour would try) is refused
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.background = 'url(https://example.invalid/pixel.png)';
    d.style.width = d.style.height = '10px';
    document.body.appendChild(d);
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp.some((v) => v.startsWith('img-src')))).toBe(true);
});
