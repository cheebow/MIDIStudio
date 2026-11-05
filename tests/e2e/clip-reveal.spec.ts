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
  // the editors share the zoom (80 px per beat); scrollLeft 0 shows the one-bar margin before bar 1,
  // so a bar is at the left edge when scrollLeft = (its start + one bar) in px
  const leftEdge = (tick: number) => ((tick + BAR) * 80) / 480;
  // the first clip of track 1 starts at bar 1: the roll goes back to bar 1 at the left edge
  await page.mouse.dblclick(box.x + bar + 10, box.y + 50 + 24);
  await expect.poll(() => roll.evaluate((el) => el.scrollLeft)).toBe(leftEdge(0));

  // move the playhead far away (bar 21): the newly opened drum editor must not page there
  const seek = page.getByTestId('seek-bar');
  const sb = (await seek.boundingBox())!;
  const endTick = Number(await seek.getAttribute('data-end-tick'));
  await page.mouse.click(sb.x + (sb.width * (BAR * 20 + 700)) / endTick, sb.y + sb.height / 2);
  await expect(page.getByTestId('transport-position')).toHaveText(/^021\./);
  // the seek also paged the track view; bring it back (after the 1.5 s follow window) to reach the clip
  await page.waitForTimeout(1700);
  await page.locator('.arrangement-scroll').evaluate((el) => (el.scrollLeft = 0));
  await expect.poll(() => page.locator('.arrangement-scroll').evaluate((el) => el.scrollLeft)).toBe(0);
  // the track view hit-tests with its React scroll state, which follows the scroll event a frame later
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // the drum clip starts at bar 5: the drum editor opens there
  await page.mouse.dblclick(box.x + bar * 5 + 10, box.y + 50 + 48 + 24);
  const drum = page.locator('.drum-scroll');
  await expect(drum).toBeVisible();
  await expect.poll(() => drum.evaluate((el) => el.scrollLeft)).toBe(leftEdge(BAR * 4));
  await page.waitForTimeout(500); // a few frames: following does not take it back to the playhead
  expect(await drum.evaluate((el) => el.scrollLeft)).toBe(leftEdge(BAR * 4));
});
