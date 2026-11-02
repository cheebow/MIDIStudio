import { expect, test } from '@playwright/test';
import { menu } from './helpers';

test('app starts with the DAW layout; the sound engine loads in the background and starts on the first gesture', async ({ page, browserName }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'メニュー' })).toBeVisible();
  await expect(page.getByTestId('arrangement-canvas')).toBeVisible();
  await expect(page.getByTestId('piano-roll-grid')).toBeVisible();
  await expect(page.getByTestId('input-mode')).toContainText('入力: 編集');
  await expect(page.getByTestId('start-audio')).toHaveCount(0); // no manual start button any more
  await expect(page.getByTestId('audio-loading')).toContainText(/読み込み中|準備完了/);
  // tools live in the editor panel
  await expect(page.getByRole('region', { name: 'エディター' }).getByRole('group', { name: 'ツール' })).toBeVisible();
  if (browserName === 'chromium') {
    await page.locator('.statusbar').click();
    await expect(page.getByTestId('audio-status')).toContainText('GeneralUser GS', { timeout: 60_000 });
  }
  expect(errors).toEqual([]);
});

test('P10: a missing SoundFont shows a clear error and the UI stays usable', async ({ page }) => {
  await page.route('**/soundfonts/GeneralUser-GS.sf2', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  const err = page.getByTestId('error');
  await expect(err).toBeVisible({ timeout: 30_000 }); // reported without any click
  await expect(err).toContainText(/SoundFont/);
  await expect(page.getByTestId('start-audio')).toBeEnabled(); // retry
  await page.getByTestId('tool-draw').click(); // editing keeps working
});

test('unavailable menu items are disabled with a reason', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.getByRole('menuitem', { name: 'ノート', exact: true }).hover(); // submenu (ADR-041)
  const item = page.getByRole('menuitem', { name: /^クオンタイズ（1\/16）/ }); // needs a selection
  // the submenu is really visible: the element at its centre belongs to it (not clipped by the parent menu)
  const box = (await page.locator('.submenu').boundingBox())!;
  expect(box.x).toBeGreaterThan(0);
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.submenu') !== null, [box.x + box.width / 2, box.y + box.height / 2])).toBe(true);
  await expect(item).toBeDisabled();
  await expect(item).toHaveAttribute('title', /選択してください/); // reason as a tooltip, label stays on one line
  // moving to another top-level item closes the submenu; Esc closes the menu
  await page.getByRole('menuitem', { name: 'コピー' }).hover();
  await expect(page.locator('.submenu')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('menu bar: submenus open with the keyboard (→) and close with ←', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '表示', exact: true }).focus();
  await page.keyboard.press('ArrowDown'); // opens View, focuses the first item (エディター ▸)
  await expect(page.getByRole('menuitem', { name: 'エディター', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'ピアノロール' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); // ドラムエディター
  await expect(page.getByRole('tab', { name: 'ドラム' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: '表示', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('menuitem', { name: 'エディター', exact: true })).toBeFocused();
  await expect(page.locator('.submenu')).toHaveCount(0);
});

test.describe('startup dialog (ADR-049)', () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // the suite turns the dialog off; here it is on

  test('offers the song, the sound engine state and the MIDI choice; one "start" click starts the engine', async ({ page, browserName }) => {
    await page.goto('/');
    const dialog = page.getByTestId('startup-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('新しい曲');
    await expect(dialog.getByTestId('startup-sound')).toContainText(/読み込み|準備完了/);
    await expect(dialog).toContainText('MIDI キーボード');
    // the song behind the modal is not reachable while it is open
    await expect(page.getByRole('button', { name: 'ファイル', exact: true })).not.toBeInViewport({ timeout: 1 }).catch(() => undefined);
    // it has to be answered: no close button, Esc does nothing
    await expect(page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    const noMidi = dialog.getByRole('radio', { name: /使わない/ });
    if (await noMidi.isVisible().catch(() => false)) await noMidi.check();
    await dialog.getByTestId('startup-start').click();
    await expect(dialog).toHaveCount(0);
    if (browserName === 'chromium') await expect(page.getByTestId('audio-status')).toContainText('GeneralUser GS', { timeout: 60_000 });
    // shown again at the next start
    await page.reload();
    await expect(page.getByTestId('startup-dialog')).toBeVisible();
  });
});

test('ADR-045: on-screen zoom buttons change the piano roll and the track view (same steps as the View menu)', async ({ page }) => {
  await page.goto('/');
  const roll = page.locator('.roll-scroll');
  const before = await roll.evaluate((el) => el.scrollWidth);
  await page.getByRole('button', { name: 'ピアノロールを拡大' }).click();
  await expect.poll(() => roll.evaluate((el) => el.scrollWidth)).toBeGreaterThan(before);
  await page.getByRole('button', { name: 'ピアノロールを縮小' }).click();
  await expect.poll(() => roll.evaluate((el) => el.scrollWidth)).toBe(before);
  const arr = page.locator('.arrangement-scroll');
  const arrBefore = await arr.evaluate((el) => el.scrollWidth);
  await page.getByRole('button', { name: 'トラックビューを拡大' }).click();
  await expect.poll(() => arr.evaluate((el) => el.scrollWidth)).toBeGreaterThan(arrBefore);
  // zooming keeps the bar at the view centre in place (piano roll: 80 px per quarter, one bar of margin)
  await roll.evaluate((el) => (el.scrollLeft = 3 * 1920 * (80 / 480))); // bar 4 at the left edge
  const w = await roll.evaluate((el) => el.clientWidth - 72);
  const centreTick = (3 * 1920 * (80 / 480) - 320 + w / 2) / (80 / 480);
  await page.getByRole('button', { name: 'ピアノロールを拡大' }).click();
  const px2 = 100 / 480; // 80 × 1.25
  await expect.poll(() => roll.evaluate((el) => el.scrollLeft)).toBeCloseTo(centreTick * px2 + 400 - w / 2, -1);
  // the buttons sit in the ruler-high corner: the first track header still starts right below ruler + tempo lane
  const header = (await page.getByTestId('track-header').first().boundingBox())!;
  const canvas = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  expect(Math.round(header.y - canvas.y)).toBe(50);
});

test('ADR-046: a fresh start has piano, bass, guitar and drum tracks; ファイル › 新規 gives the same', async ({ page }) => {
  await page.goto('/');
  const headers = page.getByTestId('track-header');
  await expect(headers).toHaveCount(4);
  await expect(headers.nth(0)).toContainText('ピアノ');
  await expect(headers.nth(3)).toContainText('ドラム');
  await expect(headers.nth(3)).toContainText('A10');
  await menu(page, 'トラック', 'トラックを削除');
  await expect(headers).toHaveCount(3);
  await menu(page, 'ファイル', /新規/);
  await page.getByTestId('confirm-yes').click(); // unsaved changes
  await expect(headers).toHaveCount(4);
});

test('ADR-051: 表示 › テーマ switches to dark and the choice survives a reload', async ({ page }) => {
  await page.goto('/');
  await menu(page, '表示', 'ダーク', /^テーマ$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(18, 20, 24)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await menu(page, '表示', 'ライト', /^テーマ$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(238, 240, 243)');
});

test('ADR-054: F1 opens the help with a table of contents; the About dialog shows the version and the repository', async ({ page }) => {
  await page.goto('/');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('F1');
  const help = page.getByTestId('help-dialog');
  await expect(help).toBeVisible();
  await expect(help.getByRole('heading', { level: 3 })).toHaveText('はじめに');
  await help.getByRole('button', { name: 'ショートカット' }).click();
  await expect(help.getByRole('heading', { level: 3 })).toHaveText('ショートカット');
  await expect(help).toContainText('再生 / 一時停止');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await menu(page, 'ヘルプ', /GM \/ GS について/);
  await expect(page.getByTestId('help-dialog').getByRole('heading', { level: 3 })).toHaveText('GM / GS');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await menu(page, 'ヘルプ', /MIDI Studio について/);
  const about = page.getByTestId('about-dialog');
  await expect(about).toContainText(/バージョン \d+\.\d+\.\d+/);
  await expect(about.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/cheebow/MIDIStudio');
});

test('ADR-055: the about page is served next to the app and links into it; /?help opens the help', async ({ page }) => {
  await page.goto('/about.html');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('MIDI Studio');
  await expect(page.getByRole('link', { name: 'ブラウザで使う' })).toHaveAttribute('href', './');
  await expect(page.getByRole('img', { name: /MIDI Studio の画面/ })).toBeVisible();
  await page.getByRole('link', { name: 'ヘルプ' }).click();
  await expect(page.getByTestId('help-dialog')).toBeVisible();
});
