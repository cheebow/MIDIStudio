// Issue #19 / ADR-099: positions as bar.beat.tick in the list, the conductor tab and the transport.
import { expect, test, type Page } from '@playwright/test';
import { build, off, on, program, tempo, timeSig } from '../fixtures/songs';
import { exportedSmf, importMidi, rollPoint } from './helpers';
import type { SmfFile } from '../../src/core/smf/types';

const rowOf = (page: Page, name: RegExp) => page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: name }) }).first();
const noteTicks = (smf: SmfFile) =>
  smf.tracks
    .flatMap((t) => t.events)
    .filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0)
    .map((e) => e.tick);
/** 4/4 for two bars, 3/4 from bar 3 (tick 3840); one C4 at the start */
const song = () => build(1, 480, [tempo(0, 500000), timeSig(0, 4, 2), timeSig(3840, 3, 2)], [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60)]);

async function typeTick(page: Page, text: string) {
  await rowOf(page, /^C4$/).locator('[data-col="tick"]').click();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: /を入力/ });
  await editor.fill(text);
  await editor.press('Enter');
}

test('list: with 小節.拍.Tick the TICK column shows and takes bar.beat.tick; the piano roll has the note at the same place', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, song());
  await page.getByRole('tab', { name: 'リスト' }).click();
  const cell = rowOf(page, /^C4$/).locator('[data-col="tick"]');
  await expect(cell).toHaveText('0');
  await page.getByTestId('pos-mbt').click();
  await expect(page.getByRole('columnheader', { name: 'M.B.T' })).toBeVisible();
  await expect(cell).toHaveText('001.01.000');
  // bar 3 is the first 3/4 bar: 3.2.120 = 3840 + 480 + 120
  await typeTick(page, '3.2.120');
  await expect(cell).toHaveText('003.02.120');
  expect(noteTicks(await exportedSmf(page))).toEqual([4440]);
  // a beat the 3/4 bar does not have is refused, and nothing moves
  await typeTick(page, '3.4.0');
  await expect(page.getByRole('status').filter({ hasText: '小節.拍.Tick' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cell).toHaveText('003.02.120');
  // shortened input, and a move relative to where the note is
  await typeTick(page, '2');
  await expect(cell).toHaveText('002.01.000');
  await typeTick(page, '+240');
  await expect(cell).toHaveText('002.01.240');
  expect(noteTicks(await exportedSmf(page))).toEqual([2160]);
  // the piano roll and its info bar show the same position
  await page.getByRole('tab', { name: 'ピアノロール' }).click();
  const p = await rollPoint(page, 2160, 60);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('note-info-bar').getByLabel('位置', { exact: true })).toHaveValue('002.01.240');
});

test('list: in 小節.拍.Tick, +/- moves the position by one tick and ⌥↑ / ⌥↓ by one beat; ST keeps its unit', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, song());
  await page.getByRole('tab', { name: 'リスト' }).click();
  await page.getByTestId('pos-mbt').click();
  await page.getByTestId('unit-classic48').click(); // 10 ticks per unit at PPQ 480: the MBT position still counts ticks
  const row = rowOf(page, /^C4$/);
  const cell = row.locator('[data-col="tick"]');
  await cell.click();
  await page.keyboard.press('+');
  await expect(cell).toHaveText('001.01.001');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(cell).toHaveText('001.02.001');
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('-');
  await expect(cell).toHaveText('001.01.000');
  await expect(row.locator('[data-col="gt"]')).toHaveText('48'); // a quarter note in Classic 48
});

test('list: the notation is kept with the song (undoing nothing: it is a view setting saved in the project)', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, song());
  await page.getByRole('tab', { name: 'リスト' }).click();
  await page.getByTestId('pos-mbt').click();
  await page.getByRole('tab', { name: 'ピアノロール' }).click();
  await page.getByRole('tab', { name: 'リスト' }).click();
  await expect(page.getByTestId('pos-mbt')).toHaveAttribute('aria-pressed', 'true');
  await expect(rowOf(page, /^C4$/).locator('[data-col="tick"]')).toHaveText('001.01.000');
});

test('conductor tab: the position can be shown and typed as ticks; bar.beat.tick stays the default', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, song());
  await page.getByRole('tab', { name: 'コンダクター' }).click();
  const row = page.getByTestId('tempo-row').filter({ hasText: '拍子' }).nth(1);
  await expect(row.getByRole('textbox', { name: '位置' })).toHaveValue('003.01.000');
  await page.getByTestId('conductor-pos-tick').click();
  const pos = page.getByTestId('tempo-row').filter({ hasText: '拍子' }).nth(1).getByRole('textbox', { name: '位置' });
  await expect(pos).toHaveValue('3840');
  await pos.fill('1920');
  await pos.press('Enter');
  await expect(page.getByTestId('tempo-row').filter({ hasText: '拍子' }).nth(1).getByRole('textbox', { name: '位置' })).toHaveValue('1920');
  await page.getByTestId('conductor-pos-mbt').click();
  await expect(page.getByTestId('tempo-row').filter({ hasText: '拍子' }).nth(1).getByRole('textbox', { name: '位置' })).toHaveValue('002.01.000');
});

test('transport: a click on the position lets you type where to go', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, song());
  const readout = page.getByTestId('transport-position');
  await expect(readout).toHaveText('001.01.000');
  await readout.click();
  const field = page.getByTestId('transport-locate');
  await expect(field).toBeFocused();
  await field.fill('3.2');
  await field.press('Enter');
  await expect(readout).toHaveText('003.02.000');
  // relative, in ticks
  await readout.click();
  await field.fill('+120');
  await field.press('Enter');
  await expect(readout).toHaveText('003.02.120');
  // a beat that bar does not have: the field stays open and says so; Esc leaves the playhead where it was
  await readout.click();
  await field.fill('3.4');
  await field.press('Enter');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await field.press('Escape');
  await expect(readout).toHaveText('003.02.120');
  // Space typed in the field does not start playback
  await readout.click();
  await field.fill('1 1');
  await field.press('Enter');
  await expect(readout).toHaveText('001.01.000');
});
