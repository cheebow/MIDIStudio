import { expect, test } from '@playwright/test';
import { build, off, on } from '../fixtures/songs';
import { importMidi, setInputMode } from './helpers';

test('ADR-044: DAW-style single-key shortcuts work in the edit mode; the mode switch turns the same keys into an instrument', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60), off(480, 0, 60)]));
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const loop = page.getByRole('checkbox', { name: 'LOOP' });
  const mute = page.getByRole('button', { name: /をミュート$/ }).first();
  const mode = page.getByTestId('input-mode');

  await page.keyboard.press('l');
  await expect(loop).toBeChecked();
  await page.keyboard.press('m');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('k');
  await expect(page.getByRole('checkbox', { name: 'メトロノーム' })).toBeChecked();
  await page.keyboard.press('Digit3');
  await expect(page.getByRole('tab', { name: 'リスト' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Period');
  await expect(page.getByTestId('transport-position')).toHaveText('002.01.000');
  await page.keyboard.press('Period');
  await expect(page.getByTestId('transport-position')).toHaveText('003.01.000');
  await page.keyboard.press('o'); // loop end = end of bar 3 (shown as the exclusive bar 4); start stays at bar 1
  await expect(page.locator('.transport .bar-input').nth(1)).toHaveValue('4');
  await expect(page.locator('.transport .bar-input').nth(0)).toHaveValue('1');
  await page.keyboard.press('Comma');
  await expect(page.getByTestId('transport-position')).toHaveText('002.01.000');
  await page.keyboard.press('i'); // loop start = bar 2
  await expect(page.locator('.transport .bar-input').nth(0)).toHaveValue('2');
  await expect(page.locator('.transport .bar-input').nth(1)).toHaveValue('4');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('transport-position')).toHaveText('001.01.000');

  // ⌥K: the letters now play the PC keyboard, so L / M do nothing; the switch shows it
  await page.keyboard.press('Alt+k');
  await expect(mode).toContainText('PC 鍵盤');
  await expect(page.getByTestId('input-mode-piano-performance')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.input-mode-switch')).toHaveClass(/performing/);
  await page.keyboard.press('l');
  await page.keyboard.press('m');
  await expect(loop).toBeChecked();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Alt+k'); // toggles back
  await expect(mode).toContainText('入力: 編集');
  await page.keyboard.press('l');
  await expect(loop).not.toBeChecked();

  // the switch buttons and Esc
  await setInputMode(page, 'drum-performance');
  await expect(mode).toContainText('ドラムパッド');
  await page.keyboard.press('Alt+p');
  await expect(mode).toContainText('入力: 編集');
  await setInputMode(page, 'step-piano');
  await expect(mode).toContainText('ステップ（鍵盤）');
  await expect(page.getByTestId('input-mode-step')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(mode).toContainText('入力: 編集');
});

test('ADR-044 追記: in the PC-keyboard mode ↑ ↓ shift the octave and Tab holds sustain', async ({ page }) => {
  await page.goto('/');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+k');
  const mode = page.getByTestId('input-mode');
  await expect(mode).toContainText('オクターブ +0');
  await page.keyboard.press('ArrowUp');
  await expect(mode).toContainText('オクターブ +1');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(mode).toContainText('オクターブ -1');
  const sus = page.getByRole('button', { name: /^Sus/ });
  await page.keyboard.down('Tab');
  await expect(sus).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.up('Tab');
  await expect(sus).toHaveAttribute('aria-pressed', 'false');
  // in the edit mode the same keys are not taken (Tab moves the focus, arrows are the editors')
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowUp');
  await expect(mode).toContainText('入力: 編集');
});

test('Space on a focused toolbar button is play / pause, not the button; Enter still activates it', async ({ page }) => {
  await page.goto('/');
  const arr = page.locator('.arrangement-scroll');
  const before = await arr.evaluate((el) => el.scrollWidth);
  const zoomIn = page.getByRole('button', { name: 'トラックビューを拡大' });
  await zoomIn.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  expect(await arr.evaluate((el) => el.scrollWidth)).toBe(before); // the button did not fire
  await page.keyboard.press('Enter');
  await expect.poll(() => arr.evaluate((el) => el.scrollWidth)).toBeGreaterThan(before);
});

test('the piano roll keyboard lights the keys being played (PC keyboard mode)', async ({ page }) => {
  await page.goto('/');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const keyColour = () =>
    page.evaluate(() => {
      const c = document.querySelector('canvas.roll-keys') as HTMLCanvasElement;
      const sc = document.querySelector('.roll-scroll') as HTMLElement;
      const dpr = window.devicePixelRatio || 1;
      const y = Math.round(((127 - 60) * 12 - sc.scrollTop + 20 + 6) * dpr); // C4 row centre
      const [r, g, b] = c.getContext('2d')!.getImageData(Math.round(8 * dpr), y, 1, 1).data;
      return { r, g, b };
    });
  const idle = await keyColour();
  await page.keyboard.press('Alt+k');
  await page.keyboard.down('KeyZ'); // C4
  await expect.poll(async () => (await keyColour()).g).toBeLessThan(200); // a red tint over the white key (g drops from 255)
  await page.keyboard.up('KeyZ');
  await expect.poll(async () => (await keyColour()).g).toBe(idle.g);
});
