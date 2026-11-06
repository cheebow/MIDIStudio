// Estimated chord names (ADR-090, TEST_PLAN E-CHD-*): the strip under the piano-roll ruler, the
// menu toggle and the chord in the visual-mode title bar.
import { expect, test } from '@playwright/test';
import { build, off, on, timeSig } from '../fixtures/songs';
import { exportedSmf, importMidi, menu, rollPoint } from './helpers';

const Q = 480;
// C (bar 1) | G7 (bar 2) on the piano, a kick on channel 10 that must not count
const song = () =>
  build(
    1,
    Q,
    [timeSig(0, 4, 2)],
    [on(0, 0, 60), on(0, 0, 64), on(0, 0, 67), off(Q * 4, 0, 60), off(0, 0, 64), off(0, 0, 67), on(0, 0, 55), on(0, 0, 59), on(0, 0, 62), on(0, 0, 65), off(Q * 4, 0, 55), off(0, 0, 59), off(0, 0, 62), off(0, 0, 65)],
    [on(0, 9, 36), off(Q, 9, 36), on(0, 9, 37), off(Q, 9, 37)],
  );

test('E-CHD-01: the chord strip names the chords; drawing a note still hits the right pitch', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, song());
  const grid = page.getByTestId('piano-roll-grid');
  await expect(grid).toHaveAttribute('data-chords', 'C G7');
  // the note area starts below the strip: a click on the C5 row draws C5
  await page.getByTestId('tool-draw').click();
  // scroll so that C5 sits a few rows below the strip: a click right under it must not land in the strip
  await page.locator('.roll-scroll').evaluate((el) => (el.scrollTop = (127 - 72) * 12 - 24));
  // the roll reads the scroll position from its scroll event: let it arrive before clicking
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const p = await rollPoint(page, Q * 2, 72); // inside the imported clip (notes outside a clip are not exported: ADR-064)
  await page.mouse.click(p.x, p.y);
  const smf = await exportedSmf(page);
  const drawn = smf.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0 && e.tick === Q * 2);
  expect(drawn.map((e) => (e.kind === 'channel' ? e.data[0] : -1))).toEqual([72]);
});

test('E-CHD-02: the 表示 menu turns the chord names off and on', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, song());
  const grid = page.getByTestId('piano-roll-grid');
  await expect(grid).toHaveAttribute('data-chords', 'C G7');
  await menu(page, '表示', 'コード名（推定）');
  await expect(grid).not.toHaveAttribute('data-chords', /./);
  await menu(page, '表示', 'コード名（推定）');
  await expect(grid).toHaveAttribute('data-chords', 'C G7');
});

test('E-CHD-03: visual mode shows the chord at the playhead', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, song());
  await page.getByTestId('open-tm').click();
  await expect(page.getByTestId('tm-chord')).toHaveText('C');
  await page.getByTestId('visual-view-roll').click();
  await expect(page.getByTestId('visual-roll')).toBeVisible();
  // the toolbar button turns it off and on in visual mode (same setting as the 表示 menu);
  // the title bar keeps its height either way
  const bar = page.locator('.tm-titlebar');
  const shown = (await bar.boundingBox())!.height;
  await page.getByTestId('tm-chords-toggle').click();
  await expect(page.getByTestId('tm-chord')).toHaveCount(0);
  expect((await bar.boundingBox())!.height).toBe(shown);
  await expect(page.getByTestId('tm-chords-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('tm-chords-toggle').click();
  await expect(page.getByTestId('tm-chord')).toHaveText('C');
  await page.getByTestId('tm-close').click();
  await menu(page, '表示', 'コード名（推定）');
  await page.getByTestId('open-tm').click();
  await expect(page.getByTestId('tm-chord')).toHaveCount(0);
  await expect(page.getByTestId('tm-chords-toggle')).toHaveAttribute('aria-pressed', 'false');
});
