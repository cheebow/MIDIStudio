// ADR-083: a SoundFont picked while the standard one is still downloading stays in use; the
// download finishing afterwards must not replace it.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SF2 = 'public/soundfonts/GeneralUser-GS.sf2';

test('a local SoundFont picked during the standard download is not replaced when the download ends', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/soundfonts/GeneralUser-GS.sf2', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/');
  await page.locator('.statusbar').click(); // first gesture: starts the engine with the (held) standard bank
  await page.locator('input[type="file"][accept=".sf2,.sf3,.dls"]').setInputFiles({ name: 'mine.sf2', mimeType: 'application/octet-stream', buffer: readFileSync(SF2) });
  await expect(page.getByTestId('audio-status')).toHaveAttribute('title', /mine\.sf2/, { timeout: 60_000 });
  release(); // the standard download now finishes
  await page.waitForResponse('**/soundfonts/GeneralUser-GS.sf2');
  await page.waitForTimeout(1500); // give a stale load time to (wrongly) take over
  await expect(page.getByTestId('audio-status')).toHaveAttribute('title', /mine\.sf2/);
});
