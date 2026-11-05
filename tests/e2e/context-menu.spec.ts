import { expect, test } from '@playwright/test';
import { build, off, on, program } from '../fixtures/songs';
import { exportedSmf, importMidi, menu, rollPoint } from './helpers';
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

test('ADR-084: the wheel events of a trackpad tap / scroll momentum do not close a menu that just opened; a real scroll later does', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60)]));
  const p = await firstClip(page);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await page.mouse.move(p.x - 60, p.y); // off the menu (it opens at the pointer, down-right)
  await page.mouse.wheel(0, 3); // comes with the two-finger click
  await page.mouse.wheel(0, 60); // momentum of a scroll just before
  await page.waitForTimeout(100);
  await expect(menu).toBeVisible();
  await page.waitForTimeout(500);
  await page.mouse.wheel(0, 5); // a nudge is not a scroll
  await expect(menu).toBeVisible();
  await page.mouse.wheel(0, 120);
  await expect(menu).toBeHidden();
});

test('ADR-084: splitting several selected clips at the playhead is one undo step; ⌘C with nothing selected keeps the clipboard', async ({ page }) => {
  await page.goto('/');
  // two tracks, each one clip 0..3840 (notes at 0 and 2880)
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60), on(2400, 0, 62), off(480, 0, 62)], [on(0, 1, 64), off(480, 1, 64), on(2400, 1, 65), off(480, 1, 65)]));
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const p = await firstClip(page);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y + 48);
  await page.keyboard.up('Shift');
  // copy the two clips, then press ⌘C again with nothing selected: the clipboard keeps the clips
  await page.keyboard.press(`${mod}+c`);
  await page.mouse.click(p.x + 96 * 7, p.y); // an empty part of the lane: nothing selected
  await page.keyboard.press(`${mod}+c`);
  await page.keyboard.press(`${mod}+v`);
  expect(notesOf(await exportedSmf(page))).toHaveLength(8);
  await page.keyboard.press(`${mod}+z`);
  expect(notesOf(await exportedSmf(page))).toHaveLength(4);
  // split both clips at bar 2 at once; one undo brings both back whole
  await page.mouse.click(p.x, p.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y + 48);
  await page.keyboard.up('Shift');
  await page.keyboard.press('Home');
  await page.keyboard.press('Period'); // playhead to bar 2
  await menu(page, '編集', '再生位置で分割', 'クリップ');
  await page.keyboard.press(`${mod}+z`);
  // if the first track were still split, deleting its clip at bar 1 would leave the note at 2880
  await page.mouse.click(p.x + 96 * 7, p.y); // clear the selection (both clips are still selected)
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual([{ tick: 0, pitch: 64 }, { tick: 2880, pitch: 65 }]);
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

test('ADR-057: Shift+click / rubber band select clips across tracks; ⌘D, copy → paste here and Delete act on the group', async ({ page }) => {
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
  // drag a rubber band (selection tool) from below the last track over both lanes, then copy and paste at bar 3 (tick 3840)
  await page.mouse.move(box.x + bar * 2 + 10, box.y + 50 + 48 * 2 + 20);
  await page.mouse.down();
  await page.mouse.move(p.x - 4, box.y + 50 + 4, { steps: 4 });
  await page.mouse.up();
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
  // with the draw tool a drag on empty space creates a clip instead: the new clip at bar 5 can be deleted on its own.
  // The tool is switched from the track view's own buttons (shared state with the piano roll; P / V do the same)
  await expect(page.getByTestId('arr-tool-select')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('arr-tool-draw').click();
  await expect(page.getByTestId('arr-tool-draw')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(box.x + bar * 5 + 4, p.y);
  await page.mouse.down();
  await page.mouse.move(box.x + bar * 6 - 4, p.y, { steps: 4 });
  await page.mouse.up();
  await page.mouse.click(box.x + bar * 5 + 40, p.y, { button: 'right' });
  await expect(page.getByTestId('context-menu').getByRole('menuitem', { name: /削除（中のノートごと）/ })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('ADR-062: dragging a clip up or down moves it to that track; paste here puts the copy on the right-clicked track', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60)], [on(0, 1, 64), off(480, 1, 64)]));
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const bar = 96;
  const p = await firstClip(page);
  // pitches per exported track (track 0 is the conductor track of a Format 1 file)
  const perTrack = async () => (await exportedSmf(page)).tracks.map((tr) => tr.events.filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0).map((e) => (e.kind === 'channel' ? `${e.tick}:${e.data[0]}` : '')));
  expect((await perTrack()).slice(1)).toEqual([['0:60'], ['0:64']]);
  // plain drag one lane down (no Alt): the clip and its note now live on the second track
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 2, p.y + 48, { steps: 6 });
  await page.mouse.up();
  expect((await perTrack()).slice(1)).toEqual([[], ['0:60', '0:64']]);
  await page.keyboard.press(`${mod}+z`);
  expect((await perTrack()).slice(1)).toEqual([['0:60'], ['0:64']]);
  // copy the first track's clip, right-click on the second track at bar 3: the copy lands there
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press(`${mod}+c`);
  await page.mouse.click(box.x + bar * 3 + 10, p.y + 48, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'ここに貼り付け' }).click();
  expect((await perTrack()).slice(1)).toEqual([['0:60'], ['0:64', '3840:60']]);
});

test('ADR-065: two clips on a track merge into one via the right-click menu or ⌘J; Delete then removes both notes', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60), on(1440, 0, 64), off(960, 0, 64)])); // notes at 0 and 1920 (2 beats long): one clip 0..2880
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const bar = 96;
  const p = await firstClip(page);
  // split at bar 2 (tick 1920) via the menu, then select both halves and merge
  await page.mouse.click(box.x + bar * 2 + 2, p.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'ここで分割' }).click();
  await page.mouse.click(p.x, p.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + bar * 2 + 20, p.y);
  await page.keyboard.up('Shift');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: /^結合/ }).click();
  // one clip again: deleting it removes both notes (before the merge, Delete on the first half would leave the second note)
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual([]);
  await page.keyboard.press(`${mod}+z`);
  await page.keyboard.press(`${mod}+z`); // undo the merge: two clips
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual([{ tick: 1920, pitch: 64 }]);
  await page.keyboard.press(`${mod}+z`);
  // ⌘J does the same from the keyboard
  await page.mouse.click(p.x, p.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + bar * 2 + 20, p.y);
  await page.keyboard.up('Shift');
  await page.keyboard.press(`${mod}+j`);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual([]);
});

