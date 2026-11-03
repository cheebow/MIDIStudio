// ADR-071 / E23: dragging past an edge of the track view scrolls it (clip move, rubber band, loop
// range), and the drag keeps its start where it was in the song.
import { expect, test, type Page } from '@playwright/test';
import { build, off, on } from '../fixtures/songs';
import { exportedSmf, importMidi } from './helpers';

const notesOf = (smf: Awaited<ReturnType<typeof exportedSmf>>) =>
  smf.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0).map((e) => (e.kind === 'channel' ? e.tick : -1));
const loopInputs = (page: Page) => page.locator('.transport .bar-input');

const BAR = 480 * 4;
const BAR_PX = 96; // px per bar at the default zoom (24 px per quarter)
const HEAD_H = 50; // ruler 24 + tempo lane 26 (no markers)
const TRACK_H = 48;

const scroll = (page: Page) =>
  page.locator('.arrangement-scroll').evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop, roomY: el.scrollHeight - el.clientHeight }));

test('track view: a clip dragged to the right edge moves far along the song', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60), off(480, 0, 60)]));
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const y = box.y + HEAD_H + TRACK_H / 2;
  const x = box.x + BAR_PX + 5; // on the clip, just after the one-bar margin
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, y, { steps: 3 });
  await page.mouse.move(box.x + box.width - 1, y, { steps: 3 });
  await expect.poll(async () => (await scroll(page)).left, { timeout: 20_000 }).toBeGreaterThan(BAR_PX * 16);
  await page.mouse.move(box.x + box.width / 2, y, { steps: 3 }); // back inside so the clip lands in view
  await page.mouse.up();
  const [tick] = notesOf(await exportedSmf(page));
  expect(tick).toBeGreaterThan(BAR * 16);
  expect(tick % 480).toBe(0); // still snapped to beats
});

test('track view: a rubber band dragged past the right edge selects a clip that was out of view', async ({ page }) => {
  await page.goto('/');
  // track 1: a clip at bar 1; track 2: a clip at bar 21, far right of the first view
  await importMidi(page, build(1, 480, [on(0, 0, 60), off(480, 0, 60)], [on(BAR * 20, 1, 64), off(480, 1, 64)]));
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  expect(box.width).toBeLessThan(BAR_PX * 21); // the bar-21 clip starts out of view
  const y1 = box.y + HEAD_H + 10; // track 1 row
  await page.mouse.move(box.x + 40, y1); // in the margin before bar 1: empty space
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, y1 + TRACK_H, { steps: 3 });
  await page.mouse.move(box.x + box.width - 1, y1 + TRACK_H + 20, { steps: 3 }); // right edge, in the track 2 row
  // all the way to the end of the song (the bar-21 clip is near the end, so the view stops there)
  await expect.poll(() => page.locator('.arrangement-scroll').evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft), { timeout: 20_000 }).toBeLessThan(1);
  await page.mouse.up();
  await page.keyboard.press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual([]); // both clips (and their notes) were in the band
});

/** 14 tracks with a clip at bar 1 each: more lanes than the view shows */
const manyTracks = () => build(1, 480, ...Array.from({ length: 14 }, (_, i) => [on(0, i % 9, 60 + i), off(480, i % 9, 60 + i)]));

test('track view: a rubber band dragged past the bottom edge scrolls down and selects the last track', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, manyTracks());
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const before = await scroll(page);
  expect(before.top).toBe(0);
  expect(before.roomY).toBeGreaterThan(TRACK_H * 2); // the last lanes start out of view
  await page.mouse.move(box.x + 40, box.y + HEAD_H + 10); // margin before bar 1, track 1 row
  await page.mouse.down();
  await page.mouse.move(box.x + BAR_PX * 2, box.y + box.height - 40, { steps: 3 });
  await page.mouse.move(box.x + BAR_PX * 2, box.y + box.height + 30, { steps: 3 }); // below the view
  await expect
    .poll(async () => {
      const s = await scroll(page);
      return s.roomY - s.top;
    }, { timeout: 20_000 })
    .toBeLessThan(1);
  await page.mouse.up();
  await page.keyboard.press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual([]); // all 14 clips, the last one included
});

test('track view: the loop end dragged on the ruler past the right edge scrolls sideways only', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, manyTracks());
  await expect(loopInputs(page).nth(1)).toHaveValue('2'); // the import set the loop to the song (bar 1〜2)
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const x = box.x + BAR_PX * 2; // the loop end (tick 1920), after the one-bar margin
  const y = box.y + 6; // ruler
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 3 });
  await page.mouse.move(box.x + box.width - 1, box.y + box.height + 30, { steps: 4 }); // right edge, and below the view
  await expect.poll(async () => (await scroll(page)).left, { timeout: 20_000 }).toBeGreaterThan(BAR_PX * 8);
  await page.mouse.up();
  expect((await scroll(page)).top).toBe(0); // a loop drag never scrolls vertically
  expect(Number(await loopInputs(page).nth(1).inputValue())).toBeGreaterThan(9);
});

test('track view: pressing near an edge without moving does not scroll', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, manyTracks());
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const before = await scroll(page);
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4); // bottom-right corner, empty
  await page.mouse.down();
  await page.waitForTimeout(800);
  const after = await scroll(page);
  expect({ left: after.left, top: after.top }).toEqual({ left: before.left, top: before.top });
  await page.mouse.up();
});

test('track view: pressing in the margin before bar 1 starts a rubber band, it does not grab a clip at tick 0', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60), off(480, 0, 60)]));
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const y = box.y + HEAD_H + TRACK_H / 2;
  await page.mouse.move(box.x + 40, y); // the margin, in the row of a clip that starts at tick 0
  await page.mouse.down();
  await page.mouse.move(box.x + BAR_PX * 4, y, { steps: 4 });
  await page.mouse.up();
  expect(notesOf(await exportedSmf(page))).toEqual([0]); // the clip did not move
  await page.keyboard.press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual([]); // the band selected it instead
});
