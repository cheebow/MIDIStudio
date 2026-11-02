import { expect, test, type Page } from '@playwright/test';
import { build, off, on } from '../fixtures/songs';
import { exportedSmf, importMidi, menu, rollPoint, setInputMode } from './helpers';

const notesOf = (smf: Awaited<ReturnType<typeof exportedSmf>>) =>
  smf.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0).map((e) => (e.kind === 'channel' ? `${e.tick}:${e.data[0]}` : ''));

async function laneY(page: Page, label: RegExp) {
  const lane = page.getByTestId('drum-lane').filter({ hasText: label }).first();
  const b = (await lane.boundingBox())!;
  return b.y + b.height / 2;
}

test('E02: a kick entered in the drum editor is note 36 and the same event is edited in the piano roll', async ({ page }) => {
  await page.goto('/');
  await menu(page, 'トラック', 'ドラムトラックにする');
  await page.getByRole('tab', { name: 'ドラム' }).click();
  await page.getByTestId('tool-draw').click();
  const grid = (await page.getByTestId('drum-grid').boundingBox())!;
  await page.mouse.click(grid.x + 320 + 2, await laneY(page, /^36 Bass Drum 1/)); // after the one-bar margin
  expect(notesOf(await exportedSmf(page))).toEqual(['0:36']);

  await page.getByRole('tab', { name: 'ピアノロール' }).click();
  await page.getByRole('button', { name: '選択', exact: true }).click();
  const p = await rollPoint(page, 0, 36);
  await page.mouse.click(p.x + 2, p.y);
  await page.keyboard.press('ArrowUp');
  expect(notesOf(await exportedSmf(page))).toEqual(['0:37']);
  await page.getByRole('tab', { name: 'ドラム' }).click();
  await expect(page.getByTestId('drum-lane').filter({ hasText: /^37 Side Stick/ })).toBeVisible();
});

test('E09: switching the drum map changes labels only, never pitches', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 9, 30), off(120, 9, 30), on(0, 9, 36), off(120, 9, 36)]));
  await page.getByRole('tab', { name: 'ドラム' }).click();
  await expect(page.getByTestId('drum-lane').filter({ hasText: /^30 Note 30/ })).toBeVisible(); // unknown to GM, still shown
  await page.getByRole('combobox', { name: 'ドラムマップ' }).selectOption('gs');
  await expect(page.getByTestId('drum-lane').filter({ hasText: /^30 Scratch Pull/ })).toBeVisible();
  expect(notesOf(await exportedSmf(page)).sort()).toEqual(['0:30', '120:36']);
});

test('I02 / I03 / I06: keyboard drum pads light the on-screen pad; text fields keep their keys', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'ドラム' }).click();
  await setInputMode(page, 'drum-performance');
  await expect(page.getByTestId('input-mode')).toContainText('ドラムパッド');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.down('KeyM');
  await expect(page.getByTestId('pad-36')).toHaveClass(/on/);
  await page.keyboard.up('KeyM');
  await expect(page.getByTestId('pad-36')).not.toHaveClass(/on/);
  // Same physical key in piano mode is not a drum pad
  await setInputMode(page, 'piano-performance');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.down('KeyM');
  await expect(page.getByTestId('pad-36')).not.toHaveClass(/on/);
  await page.keyboard.up('KeyM');
  // Typing in a text field never plays
  await setInputMode(page, 'drum-performance');
  const name = page.getByRole('complementary', { name: 'トラックインスペクター' }).getByRole('textbox').first();
  await name.click();
  await page.keyboard.down('KeyM');
  await expect(page.getByTestId('pad-36')).not.toHaveClass(/on/);
  await page.keyboard.up('KeyM');
  // Escape returns to edit mode
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('input-mode')).toContainText('編集');
});

test('mouse on the on-screen pad works without any keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'ドラム' }).click();
  const pad = page.getByTestId('pad-38');
  await pad.hover(); // scrolls the pad column if needed
  await page.mouse.down();
  await expect(pad).toHaveClass(/on/);
  await page.mouse.up();
  await expect(pad).not.toHaveClass(/on/);
});

test('key assignment dialog changes a pad key (saved with the project)', async ({ page }) => {
  await page.goto('/');
  await menu(page, 'ツール', /キー割り当て/);
  await page.getByRole('button', { name: /36 Bass Drum 1 のキーを変更/ }).first().click();
  await page.keyboard.press('KeyB');
  await expect(page.getByRole('dialog')).toContainText('B');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('tab', { name: 'ドラム' }).click();
  await setInputMode(page, 'drum-performance');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.down('KeyB');
  await expect(page.getByTestId('pad-36')).toHaveClass(/on/); // pad column shows the assigned key's pad lit
  await page.keyboard.up('KeyB');
  await page.keyboard.down('KeyM'); // the old key no longer plays the kick
  await expect(page.getByTestId('pad-36')).not.toHaveClass(/on/);
  await page.keyboard.up('KeyM');
  await expect(page.getByTestId('dirty-state')).toHaveText('● 未保存');
});
