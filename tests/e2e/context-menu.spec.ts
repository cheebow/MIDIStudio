import { expect, test } from '@playwright/test';
import { build, off, on, program } from '../fixtures/songs';
import { exportedSmf, importMidi, rollPoint } from './helpers';
import type { SmfFile } from '../../src/core/smf/types';

const notesOf = (smf: SmfFile) =>
  smf.tracks
    .flatMap((t) => t.events)
    .filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0)
    .map((e) => ({ tick: e.tick, pitch: e.kind === 'channel' ? e.data[0] : -1 }))
    .sort((a, b) => a.tick - b.tick);

async function firstClip(page: import('@playwright/test').Page) {
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  return { x: box.x + 96 + 10, y: box.y + 50 + 24 }; // after the one-bar margin
}

test('track view: Delete removes the selected clip together with its notes', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60)]));
  const p = await firstClip(page);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual([]);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  expect(notesOf(await exportedSmf(page))).toEqual([{ tick: 0, pitch: 60 }]);
});

test('track view: right-click a clip → duplicate, then delete via the menu', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60)]));
  const p = await firstClip(page);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: '複製（すぐ後ろへ）' }).click();
  await expect(menu).toBeHidden();
  expect(notesOf(await exportedSmf(page)).length).toBe(2);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: /削除（中のノートごと）/ }).click();
  expect(notesOf(await exportedSmf(page)).length).toBe(1);
  // Esc closes the menu without doing anything
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('context-menu')).toBeHidden();
});

test('piano roll: right-click a note → transpose and delete; right-click empty → paste here', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60)]));
  let a = await rollPoint(page, 100, 60);
  await page.mouse.click(a.x, a.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: '半音上げる' }).click();
  expect(notesOf(await exportedSmf(page))).toEqual([{ tick: 0, pitch: 61 }]);
  a = await rollPoint(page, 100, 61);
  await page.mouse.click(a.x, a.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'コピー' }).click();
  const b = await rollPoint(page, 960, 63);
  await page.mouse.click(b.x, b.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'ここに貼り付け' }).click();
  expect(notesOf(await exportedSmf(page))).toEqual([{ tick: 0, pitch: 61 }, { tick: 960, pitch: 61 }]);
  await page.mouse.click(a.x, a.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: '削除' }).click();
  expect(notesOf(await exportedSmf(page))).toEqual([{ tick: 960, pitch: 61 }]);
  // the note menu also opens the quantize dialog for the clicked note (ADR-043); the pasted note kept pitch 61
  const c = await rollPoint(page, 960, 61);
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'クオンタイズ…' }).click();
  await expect(page.getByRole('dialog').getByRole('radio', { name: /選択中のノート（1 個）/ })).toBeChecked();
  await page.getByRole('button', { name: 'キャンセル' }).click();
});

test('track view: a clip can be quantized from its right-click menu (its notes only)', async ({ page }) => {
  await page.goto('/');
  // two tracks: the first clip's notes are off the grid; the second track's note must not move
  await importMidi(page, build(1, 480, [on(10, 0, 60), off(100, 0, 60), on(140, 0, 62), off(100, 0, 62)], [on(130, 1, 64), off(100, 1, 64)]));
  const p = await firstClip(page);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: /^クオンタイズ（1\/16）/ }).click();
  expect(notesOf(await exportedSmf(page))).toEqual([
    { tick: 0, pitch: 60 },
    { tick: 130, pitch: 64 },
    { tick: 240, pitch: 62 },
  ]);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'クオンタイズ…' }).click();
  await expect(page.getByRole('dialog').getByRole('radio', { name: /選択中のノート（2 個）/ })).toBeChecked();
  await page.getByRole('button', { name: 'キャンセル' }).click();
});

test('ADR-057: Shift+click / Shift+drag select clips across tracks; ⌘D, copy → paste here and Delete act on the group', async ({ page }) => {
  await page.goto('/');
  // two tracks, one clip each (0..480)
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60)], [on(0, 1, 64), off(480, 1, 64)]));
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const bar = 96; // px per bar at the default zoom, after the one-bar margin
  const p = await firstClip(page);
  const sorted = async () => notesOf(await exportedSmf(page)).sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  // Shift+click adds the second track's clip; ⌘D duplicates both right after the group (span 480), one undo step
  await page.mouse.click(p.x, p.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y + 48);
  await page.keyboard.up('Shift');
  await page.keyboard.press(`${mod}+d`);
  expect(await sorted()).toEqual([
    { tick: 0, pitch: 60 },
    { tick: 0, pitch: 64 },
    { tick: 480, pitch: 60 },
    { tick: 480, pitch: 64 },
  ]);
  await page.keyboard.press(`${mod}+z`);
  expect((await sorted()).length).toBe(2);
  // Shift+drag a rubber band from empty space over both lanes, then copy and paste at bar 3 (tick 3840)
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + bar * 2 + 10, box.y + 50 + 48 + 40);
  await page.mouse.down();
  await page.mouse.move(p.x - 4, box.y + 50 + 4, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.keyboard.press(`${mod}+c`);
  await page.mouse.click(box.x + bar * 3 + 10, p.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'ここに貼り付け' }).click();
  expect(await sorted()).toEqual([
    { tick: 0, pitch: 60 },
    { tick: 0, pitch: 64 },
    { tick: 3840, pitch: 60 },
    { tick: 3840, pitch: 64 },
  ]);
  // the pasted clips are selected: Delete removes both with their notes
  await page.keyboard.press('Delete');
  expect((await sorted()).map((n) => n.tick)).toEqual([0, 0]);
  // right-click a clip: select every clip at that position across tracks, then cut and paste at the playhead (tick 0)
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'この位置のクリップを全トラックで選択' }).click();
  await page.keyboard.press(`${mod}+x`);
  expect(await sorted()).toEqual([]);
  await page.keyboard.press(`${mod}+v`);
  expect((await sorted()).length).toBe(2);
});

