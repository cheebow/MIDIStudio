// 4th review (ADR-094): UI fixes that only show in the running app.
import { expect, test } from '@playwright/test';
import { format1Song } from '../fixtures/songs';
import { importMidi } from './helpers';

const rowOf = (page: import('@playwright/test').Page, name: RegExp) =>
  page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: name }) }).first();

test('conductor dialog: Enter in the value field confirms it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('bpm-readout').click();
  await page.getByTestId('context-menu').getByRole('menuitem', { name: /を変更…/ }).click();
  const field = page.getByTestId('conductor-dialog').getByRole('textbox', { name: 'テンポ' });
  await field.fill('96');
  await field.press('Enter');
  await expect(page.getByTestId('conductor-dialog')).toHaveCount(0);
  await expect(page.getByTestId('bpm-readout')).toContainText('96');
});

test('list: Delete on a conductor row removes that row', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, format1Song());
  await page.getByRole('tab', { name: 'リスト' }).click();
  const conductor = page.locator('[data-testid="list-row"].cat-conductor');
  const before = await conductor.count();
  expect(before).toBeGreaterThan(1);
  // the second tempo (bar 2), so the song keeps its first one
  const row = conductor.filter({ has: page.locator('[data-col="vel"]', { hasText: /^150$/ }) }).first();
  await row.locator('[data-col="detail"]').click();
  await expect(row).toHaveAttribute('aria-selected', 'false'); // conductor rows are not part of the selection (ADR-066)
  await page.keyboard.press('Delete');
  await expect(conductor).toHaveCount(before - 1);
});

test('list: a click inside the open cell editor places the caret and keeps the edit', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, format1Song());
  await page.getByRole('tab', { name: 'リスト' }).click();
  await rowOf(page, /^C4$/).locator('[data-col="vel"]').click();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: /を入力/ });
  await editor.fill('77');
  await editor.click();
  await expect(editor).toHaveValue('77');
  await editor.press('Enter');
  await expect(rowOf(page, /^C4$/).locator('[data-col="vel"]')).toHaveText('77');
});

test('list: a typed TICK that moves the row elsewhere takes the cursor with it', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, format1Song());
  await page.getByRole('tab', { name: 'リスト' }).click();
  const c4 = rowOf(page, /^C4$/);
  await c4.locator('[data-col="tick"]').click();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: /を入力/ });
  await editor.fill('100000');
  await editor.press('Enter');
  // the row is far down now: the cursor (and the selection) are still on it, not on the row that took its place
  const moved = page.getByTestId('list-row').filter({ has: page.locator('[data-col="tick"]', { hasText: /^100000$/ }) });
  await expect(moved.locator('[data-col="tick"]')).toHaveClass(/cursor/);
  await expect(moved).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid="list-row"][aria-selected="true"]')).toHaveCount(1);
});

test('list: 値を編集 from the menu of a selected row that is not the cursor row edits that row', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, format1Song());
  await page.getByRole('tab', { name: 'リスト' }).click();
  const c4 = rowOf(page, /^C4$/);
  const e4 = rowOf(page, /^E4$/);
  await c4.locator('[data-col="vel"]').click();
  await e4.locator('[data-col="vel"]').click({ modifiers: ['Shift'] });
  await expect(c4).toHaveAttribute('aria-selected', 'true');
  // cursor on E4 (last click); right-click the selected C4 row
  await c4.locator('[data-col="vel"]').click({ button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: '値を編集' }).click();
  await expect(c4.getByRole('textbox', { name: /を入力/ })).toBeVisible();
});
