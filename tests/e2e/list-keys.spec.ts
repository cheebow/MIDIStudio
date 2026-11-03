// LIST-06 (REQ-EDT-13): while the list has focus, the musical keys, the octave keys and the step
// keys still belong to the input mode; the grid takes only what the mode leaves (ADR-066).
import { expect, test } from '@playwright/test';
import { format1Song } from '../fixtures/songs';
import { importMidi, setInputMode } from './helpers';

test('piano mode: digits do not open a cell, ↑ shifts the octave; step mode: → is a rest', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, format1Song());
  await page.getByRole('tab', { name: 'リスト' }).click();
  const grid = page.getByTestId('list-grid');
  const row = page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: /^C4$/ }) }).first();

  // edit mode: a digit starts typing into the cell
  await row.locator('[data-col="vel"]').click();
  await page.keyboard.press('Digit2');
  await expect(page.getByRole('textbox', { name: /を入力/ })).toHaveValue('2');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: /を入力/ })).toHaveCount(0);

  await setInputMode(page, 'piano-performance');
  await row.locator('[data-col="vel"]').click();
  await expect(grid).toBeFocused();
  await page.keyboard.press('Digit2'); // C#5 on the PC keyboard, never a cell edit: it is written into the row's K# (LIST-07)
  await expect(page.getByRole('textbox', { name: /を入力/ })).toHaveCount(0);
  await expect(page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: /^C#5$/ }) })).toHaveCount(1);
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('input-mode')).toContainText('オクターブ +1');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('input-mode')).toContainText('編集');

  await setInputMode(page, 'step-piano');
  const e4 = page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: /^E4$/ }) }).first();
  await e4.locator('[data-col="vel"]').click();
  await expect(page.getByTestId('step-cursor')).toContainText('001.01.000');
  await page.keyboard.press('ArrowRight'); // rest, not "next column"
  await expect(page.getByTestId('step-cursor')).toContainText('001.01.240');
  // the list cursor follows the step cursor: the last row at or before tick 240 (LIST-08)
  const g4 = page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: /^G4$/ }) }).first();
  await expect(g4.locator('[data-col="vel"]')).toHaveClass(/cursor/);
});
