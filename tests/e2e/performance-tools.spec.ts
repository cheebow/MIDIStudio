// Performance tools (docs/PERFORMANCE_TOOLS_SPEC.md, ADR-076..078): E26–E30.
import { expect, test, type Page } from '@playwright/test';
import { build, off, on, program } from '../fixtures/songs';
import { exportedSmf, importMidi, menu, rollPoint } from './helpers';
import type { SmfFile } from '../../src/core/smf/types';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';
const SELECT_ALL = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';

/** [tick, pitch, velocity, length] of every note of the exported SMF, in tick / pitch order. */
function notesOf(smf: SmfFile): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const open = new Map<number, [number, number, number, number]>();
  for (const e of smf.tracks.flatMap((t) => t.events).sort((a, b) => a.tick - b.tick)) {
    if (e.kind !== 'channel') continue;
    const st = e.status & 0xf0;
    if (st === 0x90 && e.data[1] > 0) {
      const row: [number, number, number, number] = [e.tick, e.data[0], e.data[1], 0];
      open.set(e.data[0], row);
      out.push(row);
    } else if (st === 0x80 || (st === 0x90 && e.data[1] === 0)) {
      const row = open.get(e.data[0]);
      if (row) row[3] = e.tick - row[0];
      open.delete(e.data[0]);
    }
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** C - Am - F - G, one chord per beat (PPQ 480), piano program. The builder takes deltas, so chords are listed in tick order. */
function progression() {
  const evs = [program(0, 0, 0)];
  // on/off deltas are relative to the previous event: write each chord as on,on,on then off,off,off
  const chords: [number, number[]][] = [
    [0, [60, 64, 67]],
    [480, [57, 60, 64]],
    [960, [53, 57, 60]],
    [1440, [55, 59, 62]],
  ];
  let t = 0;
  for (const [tick, ps] of chords) {
    evs.push(on(tick - t, 0, ps[0]), on(0, 0, ps[1]), on(0, 0, ps[2]));
    evs.push(off(240, 0, ps[0]), off(0, 0, ps[1]), off(0, 0, ps[2]));
    t = tick + 240;
  }
  return build(1, 480, evs);
}

async function selectAllNotes(page: Page) {
  await page.getByTestId('piano-roll-grid').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(SELECT_ALL);
}

test('E26: legato from the edit menu previews live, cancel keeps the song, apply is one undo step', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(100, 0, 60), on(380, 0, 62), off(100, 0, 62), on(380, 0, 64), off(100, 0, 64)]));
  const before = notesOf(await exportedSmf(page));
  expect(before).toEqual([
    [0, 60, 100, 100],
    [480, 62, 100, 100],
    [960, 64, 100, 100],
  ]);
  await selectAllNotes(page);
  await menu(page, '編集', /^レガート調整…/, /^打ち込み支援$/);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('legato-dialog')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /選択中のノート（3 個）/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /^つなぐ/ })).toBeChecked();
  await expect(dialog.getByTestId('perform-status')).toContainText('ノート 3 個');
  await dialog.getByRole('radio', { name: /少し離す/ }).check();
  await dialog.getByTestId('perform-cancel').click();
  await expect(dialog).toHaveCount(0);
  expect(notesOf(await exportedSmf(page))).toEqual(before);
  await expect(page.getByTestId('dirty-state')).not.toHaveText('● 未保存');

  await selectAllNotes(page);
  await menu(page, '編集', /^レガート調整…/, /^打ち込み支援$/);
  await page.getByRole('dialog').getByRole('radio', { name: /^つなぐ/ }).check();
  await page.getByRole('dialog').getByTestId('perform-apply').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(notesOf(await exportedSmf(page))).toEqual([
    [0, 60, 100, 480],
    [480, 62, 100, 480],
    [960, 64, 100, 100],
  ]);
  await expect(page.getByTestId('dirty-state')).toHaveText('● 未保存');
  await page.getByTestId('piano-roll-grid').focus();
  await page.keyboard.press(UNDO);
  expect(notesOf(await exportedSmf(page))).toEqual(before);
  await page.keyboard.press(REDO);
  expect(notesOf(await exportedSmf(page))[0][3]).toBe(480);
});

test('E27: the velocity shaper from the note right-click menu; Esc cancels the preview', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60), on(0, 0, 62), off(480, 0, 62), on(0, 0, 64), off(480, 0, 64)]));
  await selectAllNotes(page);
  const p = await rollPoint(page, 100, 60);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: '打ち込み支援' }).hover();
  await page.getByRole('menuitem', { name: 'ベロシティ・シェイパー…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('velocity-shaper-dialog')).toBeVisible();
  await dialog.getByRole('radio', { name: /デクレッシェンド/ }).check();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(notesOf(await exportedSmf(page)).map((n) => n[2])).toEqual([100, 100, 100]);
  await selectAllNotes(page);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: '打ち込み支援' }).hover();
  await page.getByRole('menuitem', { name: 'ベロシティ・シェイパー…' }).click();
  await page.getByRole('dialog').getByRole('radio', { name: /^クレッシェンド/ }).check();
  await page.getByRole('dialog').getByTestId('perform-apply').click();
  expect(notesOf(await exportedSmf(page)).map((n) => n[2])).toEqual([85, 100, 115]);
});

test('E28: arpeggio adds the turning notes to the clip; undo removes them again', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), ...[on(0, 0, 60), on(0, 0, 64), on(0, 0, 67), off(960, 0, 60), off(0, 0, 64), off(0, 0, 67)]]));
  await selectAllNotes(page);
  await menu(page, '編集', /^アルペジオ…/, /^打ち込み支援$/);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('perform-status')).toContainText('和音 1 個');
  await dialog.getByRole('radio', { name: /往復/ }).check();
  await dialog.getByTestId('perform-apply').click();
  expect(notesOf(await exportedSmf(page))).toEqual([
    [0, 60, 100, 192],
    [240, 64, 100, 192],
    [480, 67, 100, 192],
    [720, 64, 100, 192],
  ]);
  await page.getByTestId('piano-roll-grid').focus();
  await page.keyboard.press(UNDO);
  expect(notesOf(await exportedSmf(page)).length).toBe(3);
});

test('E29: strum and cutting in one dialog; the cutting type appears with the style; auto direction follows the beat', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, progression());
  await selectAllNotes(page);
  await menu(page, '編集', /^ストラム…/, /^打ち込み支援$/);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('strum-dialog')).toBeVisible();
  await expect(dialog.getByTestId('perform-status')).toContainText('和音 4 個');
  await expect(dialog.getByRole('radio', { name: /ポップ/ })).toHaveCount(0);
  await dialog.getByRole('radio', { name: /^カッティング/ }).check();
  await expect(dialog.getByRole('radio', { name: /ポップ/ })).toBeChecked();
  await dialog.getByRole('radio', { name: /ファンク/ }).check();
  await dialog.getByRole('checkbox', { name: /自然な強弱/ }).uncheck();
  await dialog.getByTestId('perform-apply').click();
  const rows = notesOf(await exportedSmf(page));
  // every chord is on a beat (down strokes): low string first, 45 ms = 43 ticks spread, gate 30 % of 240 = 72, velocity 105 (beats 2 / 4: 113)
  expect(rows.filter((r) => r[1] === 60 && r[0] < 480)).toEqual([[0, 60, 105, 72]]);
  expect(rows.filter((r) => r[0] >= 0 && r[0] < 480).map((r) => r[0])).toEqual([0, 22, 43]);
  expect(rows.filter((r) => r[0] >= 480 && r[0] < 960).map((r) => r[2])).toEqual([113, 113, 113]);
  expect(rows.every((r) => r[3] <= 72)).toBe(true);
  await page.getByTestId('piano-roll-grid').focus();
  await page.keyboard.press(UNDO);
  expect(notesOf(await exportedSmf(page)).every((r) => r[3] === 240)).toBe(true);
});

test('E30: guitar voicing turns C - Am - F - G into playable forms, in English too', async ({ page }) => {
  await page.goto('/');
  await menu(page, '表示', 'English', '言語');
  await importMidi(page, progression());
  await selectAllNotes(page);
  await menu(page, 'Edit', /^Guitar voicing…/, /^Performance tools$/);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('voicing-dialog')).toBeVisible();
  await expect(dialog.getByTestId('perform-status')).toHaveText(/Target: 12 notes, 4 chords/);
  await dialog.getByRole('radio', { name: /Prefer open chords/ }).check();
  await dialog.getByRole('button', { name: /^Apply/ }).click();
  await expect(dialog).toHaveCount(0);
  await menu(page, 'View', '日本語', 'Language'); // the export helper uses the Japanese menu
  const rows = notesOf(await exportedSmf(page));
  expect(rows.filter((r) => r[0] === 0).map((r) => r[1])).toEqual([48, 52, 55, 60, 64]); // C = x32010
  expect(rows.filter((r) => r[0] === 480).map((r) => r[1])).toEqual([45, 52, 57, 60, 64]); // Am = x02210
  expect(rows.filter((r) => r[0] === 960).map((r) => r[1])).toEqual([53, 57, 60, 65]); // F = xx3211
  expect(rows.filter((r) => r[0] === 1440).map((r) => r[1])).toEqual([43, 47, 50, 55, 59, 67]); // G = 320003
});
