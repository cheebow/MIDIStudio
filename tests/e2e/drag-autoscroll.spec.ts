// ADR-068: dragging past an edge of the piano roll / drum editor scrolls the view, and the drag
// (here a box selection) keeps its start where it was in the song.
import { expect, test, type Page } from '@playwright/test';
import { build, off, on } from '../fixtures/songs';
import { exportedSmf, importMidi, rollPoint } from './helpers';

const notesOf = (smf: Awaited<ReturnType<typeof exportedSmf>>) =>
  smf.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0).map((e) => (e.kind === 'channel' ? `${e.tick}:${e.data[0]}` : ''));

const scrollOf = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement;
    return { left: el.scrollLeft, top: el.scrollTop };
  }, selector);

const BAR = 480 * 4;

test('piano roll: a box selection dragged past the right edge scrolls and selects the far note', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60), off(240, 0, 60), on(BAR * 8 - 240, 0, 60), off(240, 0, 60)]));
  await page.getByTestId('tool-select').click();
  const grid = (await page.getByTestId('piano-roll-grid').boundingBox())!;
  const a = await rollPoint(page, 0, 61);
  await page.mouse.move(a.x - 20, a.y); // in the margin before bar 1, above the note
  await page.mouse.down();
  await page.mouse.move(grid.x + grid.width - 40, a.y + 12, { steps: 4 });
  await page.mouse.move(grid.x + grid.width - 1, a.y + 24, { steps: 4 }); // at the right edge (the window may end there), below the note's row
  await expect.poll(async () => (await scrollOf(page, '.roll-scroll')).left, { timeout: 20_000 }).toBeGreaterThan((BAR * 8 * 80) / 480);
  await page.mouse.up();
  await page.getByTestId('piano-roll-grid').press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual([]); // both notes were in the box
});

test('piano roll: a box selection dragged past the bottom edge scrolls down', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60), off(240, 0, 60), on(0, 0, 24), off(240, 0, 24), on(0, 0, 90), off(240, 0, 90)]));
  await page.getByTestId('tool-select').click();
  const grid = (await page.getByTestId('piano-roll-grid').boundingBox())!;
  const a = await rollPoint(page, 0, 61); // the view opens centred between 24 and 90
  await page.mouse.move(a.x - 20, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, grid.y + grid.height - 40, { steps: 4 });
  await page.mouse.move(a.x + 60, grid.y + grid.height + 30, { steps: 4 });
  // scrolls all the way down (pitch 24 is far below the first view)
  await expect
    .poll(() => page.evaluate(() => {
      const el = document.querySelector('.roll-scroll') as HTMLElement;
      return el.scrollHeight - el.clientHeight - el.scrollTop;
    }), { timeout: 20_000 })
    .toBeLessThan(1);
  await page.mouse.up();
  await page.getByTestId('piano-roll-grid').press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual(['480:90']); // 60 and the far-below 24 were in the box; 90 (above, later) was not
});

test('drum editor: a box selection dragged past the right edge scrolls and selects the far hit', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 9, 36), off(120, 9, 36), on(BAR * 8 - 120, 9, 36), off(120, 9, 36)]));
  await page.getByRole('tab', { name: 'ドラム' }).click();
  await page.getByTestId('tool-select').click();
  const grid = (await page.getByTestId('drum-grid').boundingBox())!;
  const lane = (await page.locator('[data-testid="drum-lane"][data-pitch="36"]').boundingBox())!;
  const y = lane.y + lane.height / 2;
  await page.mouse.move(grid.x + 280, y - 8); // in the margin before bar 1
  await page.mouse.down();
  await page.mouse.move(grid.x + grid.width - 40, y + 4, { steps: 4 });
  await page.mouse.move(grid.x + grid.width - 1, y + 6, { steps: 4 });
  await expect.poll(async () => (await scrollOf(page, '.drum-scroll')).left, { timeout: 20_000 }).toBeGreaterThan((BAR * 8 * 80) / 480);
  await page.mouse.up();
  await page.getByTestId('drum-grid').press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual([]);
});
