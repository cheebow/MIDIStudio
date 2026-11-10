// Scissors and glue tools (ADR-095): E-NT-01..03.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { build, off, on, program } from '../fixtures/songs';
import { exportedSmf, importMidi, menu, rollPoint } from './helpers';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/** [tick, pitch, length] of every note in the exported file */
async function notes(page: Page) {
  const smf = await exportedSmf(page);
  const out: [number, number, number][] = [];
  for (const t of smf.tracks) {
    const open = new Map<number, number>();
    for (const e of t.events) {
      if (e.kind !== 'channel') continue;
      const hi = e.status & 0xf0;
      if (hi === 0x90 && e.data[1] > 0) open.set(e.data[0], e.tick);
      else if (hi === 0x80 || hi === 0x90) {
        const start = open.get(e.data[0]);
        if (start !== undefined) out.push([start, e.data[0], e.tick - start]);
        open.delete(e.data[0]);
      }
    }
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

test('E-NT-01: the scissors cut a note at the grid line under the pointer; the glue joins it with the next one; each is one undo step', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(1920, 0, 60)]));
  const grid = page.getByTestId('piano-roll-grid');
  await grid.focus();
  await page.keyboard.press('c');
  await expect(page.getByTestId('tool-scissors')).toHaveAttribute('aria-pressed', 'true');
  const p = await rollPoint(page, 960 + 20, 60); // a little past beat 3: the cut snaps to the grid line
  await page.mouse.click(p.x, p.y);
  expect(await notes(page)).toEqual([[0, 60, 960], [960, 60, 960]]);

  await grid.focus();
  await page.keyboard.press(`${MOD}+z`);
  expect(await notes(page)).toEqual([[0, 60, 1920]]);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
  expect(await notes(page)).toEqual([[0, 60, 960], [960, 60, 960]]);

  await page.keyboard.press('Escape'); // nothing selected: the glue takes the note and the next one of its key
  await page.keyboard.press('g');
  await expect(page.getByTestId('tool-glue')).toHaveAttribute('aria-pressed', 'true');
  const first = await rollPoint(page, 100, 60);
  await page.mouse.click(first.x, first.y);
  expect(await notes(page)).toEqual([[0, 60, 1920]]);

  // back to the select tool: a click on the note no longer edits it
  await grid.focus();
  await page.keyboard.press('v');
  await page.mouse.click(p.x, p.y);
  expect(await notes(page)).toEqual([[0, 60, 1920]]);
});

test('E-NT-02: with several notes selected, the scissors cut all of them at once and the glue joins them key by key', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), on(0, 0, 64), on(0, 0, 67), off(1920, 0, 60), off(0, 0, 64), off(0, 0, 67)]));
  const grid = page.getByTestId('piano-roll-grid');
  await grid.focus();
  await page.keyboard.press(`${MOD}+a`);
  await page.getByTestId('tool-scissors').click();
  const p = await rollPoint(page, 480, 64);
  await page.mouse.click(p.x, p.y);
  expect(await notes(page)).toEqual([[0, 60, 480], [0, 64, 480], [0, 67, 480], [480, 60, 1440], [480, 64, 1440], [480, 67, 1440]]);
  // the six halves are selected: one glue click puts the chord back
  await page.getByTestId('tool-glue').click();
  await page.mouse.click(p.x, p.y);
  expect(await notes(page)).toEqual([[0, 60, 1920], [0, 64, 1920], [0, 67, 1920]]);
  await grid.focus();
  await page.keyboard.press(`${MOD}+z`);
  expect((await notes(page)).length).toBe(6);
});

test('E-NT-03: in the track view the same tools split a clip and join it with the next one; the notes do not change', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60), on(1920 * 3, 0, 62), off(480, 0, 62)]));
  const clips = async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), menu(page, 'ファイル', /\.midstudio/)]);
    const project = JSON.parse(readFileSync((await download.path())!, 'utf8')).project as { clips: { startTick: number; endTick: number }[] };
    return project.clips.map((c) => [c.startTick, c.endTick]).sort((a, b) => a[0] - b[0]);
  };
  const before = await clips();
  expect(before.length).toBe(1);
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const bar = 96; // px per bar in the track view at the default zoom, after the one-bar margin
  await page.getByTestId('arr-tool-scissors').click();
  await page.mouse.click(box.x + bar * 3 + 4, box.y + 50 + 24); // just past the start of bar 3
  expect(await clips()).toEqual([[before[0][0], 3840], [3840, before[0][1]]]);
  await page.getByTestId('arr-tool-glue').click();
  await page.getByTestId('arrangement-canvas').click({ position: { x: 5, y: 5 } }); // drop the selection (ruler: seek)
  await page.mouse.click(box.x + bar + 20, box.y + 50 + 24); // the first part: joined with the next clip
  expect(await clips()).toEqual(before);
  expect(await notes(page)).toEqual([[0, 60, 480], [6240, 62, 480]]);
});
