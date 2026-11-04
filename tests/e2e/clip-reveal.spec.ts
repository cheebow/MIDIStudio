import { expect, test } from '@playwright/test';
import { off, on, smf, trackBytes } from '../fixtures/songs';
import { importMidi } from './helpers';

// ADR-085: double-clicking a clip in the track view opens its editor at the clip's first bar.
const BAR = 1920;

test('double-clicking a clip scrolls the piano roll / drum editor to the bar where the clip starts', async ({ page }) => {
  await page.goto('/');
  // track 1: a melody at bar 1 and bar 30; track 2: drums (channel 10) from bar 5
  const melody = trackBytes([on(0, 0, 60), off(480, 0, 60), on(BAR * 29 - 480, 0, 62), off(480, 0, 62)]);
  const drums = trackBytes([on(BAR * 4, 9, 36), off(240, 9, 36)]);
  await importMidi(page, smf(1, 480, [melody, drums]));
  await expect(page.getByTestId('track-header')).toHaveCount(2);
  const roll = page.locator('.roll-scroll');
  await expect(roll).toBeVisible();
  await roll.evaluate((el) => (el.scrollLeft = (1920 * 20 * 80) / 480));
  await expect.poll(() => roll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const bar = 96; // px per bar in the track view at the default zoom, after the one-bar margin
  // the first clip of track 1 starts at bar 1: the roll goes back to the start
  await page.mouse.dblclick(box.x + bar + 10, box.y + 50 + 24);
  await expect.poll(() => roll.evaluate((el) => el.scrollLeft)).toBe(0);

  // the drum clip starts at bar 5: the drum editor opens there
  await page.mouse.dblclick(box.x + bar * 5 + 10, box.y + 50 + 48 + 24);
  const drum = page.locator('.drum-scroll');
  await expect(drum).toBeVisible();
  // the editors share the zoom (80 px per beat): bar 5 starts 4 bars in (the margin before bar 1 is at scrollLeft 0)
  await expect.poll(() => drum.evaluate((el) => el.scrollLeft)).toBe((BAR * 4 * 80) / 480);
});
