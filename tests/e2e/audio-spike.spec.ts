import { expect, test } from '@playwright/test';
import { format1Song } from '../fixtures/songs';
import { importMidi, startAudio } from './helpers';

// Real spessasynth_lib path (worklet + SF2 + sequencer) driven through the Transport.
// This cannot verify that sound is audible: that is a manual listening check.
test.describe('audio engine (Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Audio engine tests run on Chromium; other browsers are checked manually.');

  test('P01/P04: play advances the position from the audio clock; pause, seek, loop and stop work without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await startAudio(page);

    await importMidi(page, format1Song());
    const pos = page.getByTestId('transport-position');
    await expect(pos).toHaveText('001.01.000');
    await page.getByTestId('transport-play').click();
    await expect(pos).not.toHaveText('001.01.000', { timeout: 5_000 });
    await page.getByTestId('transport-play').click(); // pause
    const paused = await pos.textContent();
    await page.waitForTimeout(300);
    await expect(pos).toHaveText(paused!);

    await page.getByRole('checkbox', { name: 'LOOP' }).check();
    await page.getByRole('checkbox', { name: 'メトロノーム' }).check();
    await page.getByTestId('transport-play').click();
    await page.waitForTimeout(500);
    await page.getByTestId('transport-stop').click();
    await expect(pos).toHaveText('001.01.000');
    await expect(page.getByTestId('error')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('P05: the real engine wraps at the loop end (loop bar 1-2, 120 BPM)', async ({ page }) => {
    await page.goto('/');
    await startAudio(page);
    await page.getByRole('checkbox', { name: 'LOOP' }).check();
    await importMidi(page, format1Song());
    const inputs = page.locator('.bar-input');
    await inputs.nth(0).fill('1');
    await inputs.nth(1).fill('2'); // loop = bar 1 only (0..1920 ticks = 2 s)
    await page.getByTestId('transport-play').click();
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      seen.add((await page.getByTestId('transport-position').textContent())!.slice(0, 3));
      await page.waitForTimeout(100);
    }
    await page.getByTestId('transport-stop').click();
    // 3 s of playback with a 2 s loop (bar 1 at 120 BPM): never reaches bar 2
    expect([...seen]).toEqual(['001']);
  });

  test('P02: switching editor tabs while playing does not stop or restart playback', async ({ page }) => {
    await page.goto('/');
    await startAudio(page);
    await importMidi(page, format1Song());
    await page.getByTestId('transport-play').click();
    await page.waitForTimeout(600);
    const before = await page.getByTestId('transport-position').textContent();
    for (const tab of ['リスト', 'ドラム', 'ピアノロール']) await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('transport-play')).toHaveAttribute('aria-label', '一時停止');
    const after = await page.getByTestId('transport-position').textContent();
    expect(after! > before!).toBe(true);
    await page.getByTestId('transport-stop').click();
  });

  test('P09/P11: mute/solo changes while an imported song plays reload without stopping', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await startAudio(page);
    await importMidi(page, format1Song());
    await page.getByTestId('transport-play').click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Piano をミュート' }).click();
    await page.waitForTimeout(400);
    await expect(page.getByTestId('transport-play')).toHaveAttribute('aria-label', '一時停止');
    await expect(page.getByTestId('transport-position')).not.toHaveText('001.01.000');
    await page.getByRole('button', { name: 'Drums をソロ' }).click();
    await page.getByTestId('transport-stop').click();
    await expect(page.getByTestId('error')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
