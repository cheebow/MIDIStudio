// The UI items left over from the 4th review, fixed in ADR-098.
import { expect, test, type Page } from '@playwright/test';
import { build, off, on, program } from '../fixtures/songs';
import { exportedSmf, importMidi, menu } from './helpers';
import type { SmfFile } from '../../src/core/smf/types';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const notesOf = (smf: SmfFile) =>
  smf.tracks
    .flatMap((t) => t.events)
    .filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0)
    .map((e) => ({ tick: e.tick, pitch: e.kind === 'channel' ? e.data[0] : -1 }))
    .sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);

/** a point in the track view: `dx` px after the start of bar 1, on track row `row` */
async function arr(page: Page, dx: number, row = 0) {
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  return { x: box.x + 96 + dx, y: box.y + 50 + 48 * row + 24 };
}
const twoTracks = () => build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60)], [program(0, 1, 0), on(0, 1, 64), off(480, 1, 64)]);

test('track view: Shift+click near the edge of a clip adds it to the selection (it does not start a resize)', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, twoTracks());
  const a = await arr(page, 10, 0);
  const b = await arr(page, 1, 1); // 1 px inside the second clip: the zone that grabs its start
  await page.mouse.click(a.x, a.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Shift');
  await page.keyboard.press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual([]); // both clips were selected
});

test('track view: after クオンタイズ from the clip menu the clip alone is selected, so Delete removes the clip', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(10, 0, 60), off(480, 0, 60)]));
  const p = await arr(page, 10);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: /^クオンタイズ（/ }).click();
  expect(notesOf(await exportedSmf(page))).toEqual([{ tick: 0, pitch: 60 }]);
  await page.keyboard.press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual([]);
  // the clip itself is gone (it used to stay behind, empty): the menu here is the one of an empty spot
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.getByTestId('context-menu').getByRole('menuitem', { name: 'ピアノロールで開く' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // one undo brings the clip back with its (quantized) note
  await page.keyboard.press(`${mod}+z`);
  expect(notesOf(await exportedSmf(page))).toEqual([{ tick: 0, pitch: 60 }]);
});

test('track view: the same after the クオンタイズ… dialog', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(10, 0, 60), off(480, 0, 60)]));
  const p = await arr(page, 10);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'クオンタイズ…' }).click();
  await page.getByTestId('quantize-apply').click();
  expect(notesOf(await exportedSmf(page))).toEqual([{ tick: 0, pitch: 60 }]);
  await page.keyboard.press('Delete');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await expect(page.getByTestId('context-menu').getByRole('menuitem', { name: 'ピアノロールで開く' })).toHaveCount(0);
});

test('inspector: a Bank MSB typed digit by digit is written once, when the field is left (one undo step)', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60)]));
  const msb = page.getByLabel('Bank MSB');
  await msb.click();
  await msb.pressSequentially('120');
  await expect(page.getByTestId('dirty-state')).toHaveText('保存済み'); // nothing written while typing
  await msb.press('Enter');
  await expect(page.getByTestId('dirty-state')).toHaveText('● 未保存');
  await expect(msb).toHaveValue('120');
  await page.locator('.statusbar').click();
  await page.keyboard.press(`${mod}+z`);
  await expect(msb).toHaveValue(''); // not 12: the bank was one edit
  // Esc drops what was typed
  await msb.click();
  await msb.pressSequentially('5');
  await msb.press('Escape');
  await expect(msb).toHaveValue('');
});

test('autosave: nothing is offered for restore after the song was saved as a file', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, twoTracks());
  await menu(page, 'トラック', 'トラックを追加');
  await expect(page.getByTestId('dirty-state')).toHaveText('● 未保存');
  await page.waitForTimeout(2200); // the autosave is written
  await Promise.all([page.waitForEvent('download'), menu(page, 'ファイル', /\.midstudio として保存/)]);
  await expect(page.getByTestId('dirty-state')).toHaveText('保存済み');
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByTestId('track-header').first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: '復元' })).toHaveCount(0);
});

test('autosave: edits that were discarded by opening another song are not offered for restore', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, twoTracks());
  await menu(page, 'トラック', 'トラックを追加');
  await page.waitForTimeout(2200);
  await page.getByTestId('midi-input').setInputFiles({ name: 'other.mid', mimeType: 'audio/midi', buffer: Buffer.from(build(1, 480, [program(0, 0, 0), on(0, 0, 72), off(480, 0, 72)])) });
  // (the file input is set directly here; from the menu, the "discard?" question comes first)
  await expect(page.getByTestId('dirty-state')).toHaveText('保存済み');
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByTestId('track-header').first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: '復元' })).toHaveCount(0);
});
