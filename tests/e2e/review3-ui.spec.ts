import { expect, test } from '@playwright/test';
import { build, off, on, program } from '../fixtures/songs';
import { exportedSmf, importMidi, menu, rollPoint } from './helpers';
import type { SmfFile } from '../../src/core/smf/types';

// ADR-087: UI bugs found in the third review (whole-codebase pass).
const notesOf = (smf: SmfFile) =>
  smf.tracks
    .flatMap((t) => t.events)
    .filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0)
    .map((e) => ({ tick: e.tick, pitch: e.kind === 'channel' ? e.data[0] : -1, vel: e.kind === 'channel' ? e.data[1] : -1 }))
    .sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);

test('piano roll with SNAP off: dragging a note straight up keeps its position', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(960, 0, 60), off(480, 0, 60)]));
  await page.getByRole('checkbox', { name: 'SNAP' }).uncheck();
  const a = await rollPoint(page, 1000, 60);
  const b = await rollPoint(page, 1000, 61);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  expect(notesOf(await exportedSmf(page)).map((n) => [n.tick, n.pitch])).toEqual([[960, 61]]);
});

test('a negative amount can be typed into a number field (velocity: add -20)', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60, 100), off(480, 0, 60)]));
  await menu(page, '編集', /^ベロシティ…/, /^ノート$/);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /加算/ }).check();
  const field = dialog.getByLabel('加算する量');
  await field.click();
  await field.press('ControlOrMeta+a');
  await field.pressSequentially('-20');
  await expect(field).toHaveValue('-20');
  await dialog.getByTestId('velocity-apply').click();
  expect(notesOf(await exportedSmf(page)).map((n) => n.vel)).toEqual([80]);
});

test('track view: Alt-copying clips dragged left past bar 1 copies them at the limit instead of failing', async ({ page }) => {
  await page.goto('/');
  // track 1: a clip at bar 1; track 2: a clip at bar 2
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60)], [on(1920, 1, 64), off(480, 1, 64)]));
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const bar = 96;
  const c1 = { x: box.x + bar + 10, y: box.y + 50 + 24 };
  const c2 = { x: box.x + bar * 2 + 10, y: box.y + 50 + 48 + 24 };
  await page.mouse.click(c1.x, c1.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(c2.x, c2.y);
  await page.keyboard.up('Shift');
  await page.mouse.move(c2.x, c2.y);
  await page.mouse.down();
  await page.keyboard.down('Alt');
  await page.mouse.move(c2.x - bar * 1.6, c2.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  // before: "貼り付け位置が不正です。" (the copy of the bar-1 clip would start before bar 1). The group
  // cannot go left of bar 1, so the drag is a no-op: no error, nothing changed.
  await expect(page.getByTestId('error')).toHaveCount(0);
  expect(notesOf(await exportedSmf(page)).map((n) => [n.tick, n.pitch])).toEqual([
    [0, 60],
    [1920, 64],
  ]);
});

test('an editor height saved on a tall window does not push the status bar off a smaller one', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.goto('/');
  const splitter = page.getByRole('separator', { name: '下部エディターの高さ' });
  const s = (await splitter.boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2, 120, { steps: 6 }); // as tall as the splitter allows
  await page.mouse.up();
  await page.setViewportSize({ width: 1200, height: 620 });
  await expect(page.locator('.statusbar')).toBeInViewport();
});
