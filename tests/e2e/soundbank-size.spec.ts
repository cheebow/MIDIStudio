// ADR-070: an oversized SoundFont is refused before it is read (the tab would run out of memory).
import { expect, test } from '@playwright/test';
import { startAudio } from './helpers';

test('a SoundFont over the size limit is refused with a reason and never read', async ({ page }) => {
  await page.goto('/');
  // let the standard SoundFont finish loading first: its start clears old errors (and the bank it
  // loads must stay in use after the oversized file is refused)
  await startAudio(page);
  await page.evaluate(() => {
    const input = document.querySelector('input[type="file"][accept=".sf2,.sf3,.dls"]') as HTMLInputElement;
    // a tiny file that reports 600 MiB: the test allocates nothing, the app must trust the size
    const f = new File([new Uint8Array(4)], 'huge.sf2');
    Object.defineProperty(f, 'size', { value: 600 * 1024 * 1024 });
    (window as unknown as { __read: boolean }).__read = false;
    f.arrayBuffer = () => {
      (window as unknown as { __read: boolean }).__read = true;
      return Promise.resolve(new ArrayBuffer(4));
    };
    Object.defineProperty(input, 'files', { value: [f], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByTestId('error')).toContainText('600 MiB');
  await expect(page.getByTestId('error')).toContainText('512 MiB');
  expect(await page.evaluate(() => (window as unknown as { __read: boolean }).__read)).toBe(false);
  await expect(page.getByTestId('audio-status')).toHaveAttribute('title', /GeneralUser GS/); // the standard bank is still the one in use
});
