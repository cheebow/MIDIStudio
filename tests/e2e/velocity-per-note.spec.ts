// ADR-072: velocities of notes that start together (a chord, drum parts) can be changed one by one.
import { expect, test, type Page } from '@playwright/test';
import { build, off, on } from '../fixtures/songs';
import { exportedSmf, importMidi } from './helpers';

const velocities = async (page: Page) =>
  Object.fromEntries(
    (await exportedSmf(page)).tracks
      .flatMap((t) => t.events)
      .filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0)
      .map((e) => [`${e.tick}:${e.kind === 'channel' ? e.data[0] : -1}`, e.kind === 'channel' ? e.data[1] : -1]),
  );

async function laneGeometry(page: Page) {
  const box = (await page.locator('.lane-canvas').boundingBox())!;
  // 80 px per quarter and one 4/4 bar of margin (320 px) in both editors, scrolled to 0
  const xOf = (tick: number) => box.x + 320 + (tick * 80) / 480 + 1.5;
  const yOf = (v: number) => box.y + box.height - 4 - (v / 127) * (box.height - 8);
  return { box, xOf, yOf };
}

test('piano roll: grabbing one head of a chord changes only that note; a stroke elsewhere still paints the chord', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60, 100), on(0, 0, 64, 60), on(0, 0, 67, 30), off(480, 0, 60), off(0, 0, 64), off(0, 0, 67)]));
  const { xOf, yOf } = await laneGeometry(page);
  // E4's head (60) → 110: C4 and G4 stay
  await page.mouse.move(xOf(0), yOf(60));
  await page.mouse.down();
  await page.mouse.move(xOf(0) + 2, yOf(90), { steps: 3 });
  await page.mouse.move(xOf(0), yOf(110), { steps: 3 });
  await page.mouse.up();
  let v = await velocities(page);
  expect(v['0:60']).toBe(100);
  expect(v['0:67']).toBe(30);
  expect(Math.abs(v['0:64'] - 110)).toBeLessThanOrEqual(2);
  // the lowest head (G4, 30) can be grabbed too, even under the others
  await page.mouse.move(xOf(0), yOf(30));
  await page.mouse.down();
  await page.mouse.move(xOf(0), yOf(50), { steps: 3 });
  await page.mouse.up();
  v = await velocities(page);
  expect(Math.abs(v['0:67'] - 50)).toBeLessThanOrEqual(2);
  expect(v['0:60']).toBe(100);
  // a press away from every head (low in the bars) paints the whole chord, as before
  await page.mouse.move(xOf(0), yOf(8));
  await page.mouse.down();
  await page.mouse.move(xOf(0), yOf(80), { steps: 3 });
  await page.mouse.up();
  v = await velocities(page);
  for (const k of ['0:60', '0:64', '0:67']) expect(Math.abs(v[k] - 80)).toBeLessThanOrEqual(2);
});

test('drum editor: a click on a part name narrows the velocity lane to that part; the chip shows all again', async ({ page }) => {
  await page.goto('/');
  // kick + snare together on beat 1, snare alone on beat 2
  await importMidi(page, build(1, 480, [on(0, 9, 36, 110), on(0, 9, 38, 100), off(120, 9, 36), off(0, 9, 38), on(360, 9, 38, 100), off(120, 9, 38)]));
  await page.getByRole('tab', { name: 'ドラム' }).click();
  const snare = page.locator('[data-testid="drum-lane"][data-pitch="38"] .lane-name');
  await snare.click();
  await expect(snare).toHaveAttribute('aria-pressed', 'true');
  const chip = page.locator('.lane-filter');
  await expect(chip).toBeVisible();
  const { xOf, yOf } = await laneGeometry(page);
  // paint across both beats: only the snares change, the kick under the first one stays
  await page.mouse.move(xOf(0) - 3, yOf(40));
  await page.mouse.down();
  await page.mouse.move(xOf(240), yOf(40), { steps: 4 });
  await page.mouse.move(xOf(480), yOf(40), { steps: 4 });
  await page.mouse.up();
  let v = await velocities(page);
  expect(v['0:36']).toBe(110);
  expect(Math.abs(v['0:38'] - 40)).toBeLessThanOrEqual(2);
  expect(Math.abs(v['480:38'] - 40)).toBeLessThanOrEqual(2);
  // back to every part: the same stroke now reaches the kick as well
  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect(snare).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(xOf(0) - 3, yOf(20));
  await page.mouse.down();
  await page.mouse.move(xOf(0) + 3, yOf(20), { steps: 3 });
  await page.mouse.up();
  v = await velocities(page);
  expect(Math.abs(v['0:36'] - 20)).toBeLessThanOrEqual(2);
});
