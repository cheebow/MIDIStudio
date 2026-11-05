import { expect, test, type Page } from '@playwright/test';
import { build, off, on } from '../fixtures/songs';
import { exportedSmf, importMidi } from './helpers';

/** [tick, µs per quarter] of every tempo event in the exported SMF */
async function tempos(page: Page) {
  const smf = await exportedSmf(page);
  return smf.tracks[0].events.filter((e) => e.kind === 'meta' && e.metaType === 0x51).map((e) => (e.kind === 'meta' ? [e.tick, (e.data[0] << 16) | (e.data[1] << 8) | e.data[2]] : []));
}

test('tempo tab: add a tempo change by bar and BPM; edit position and value in place; delete', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'コンダクター' }).click();
  await page.getByTestId('add-tempo').click();
  const dlg = page.getByTestId('conductor-dialog');
  await dlg.getByRole('textbox', { name: '位置' }).fill('5');
  await dlg.getByRole('textbox', { name: 'テンポ' }).fill('140');
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await tempos(page)).toEqual([[0, 500000], [7680, 428571]]);
  // rows: tempo @0, 4/4 @0, the new tempo
  const row = page.getByTestId('tempo-row').filter({ hasText: 'テンポ' }).nth(1);
  await row.getByRole('textbox', { name: '位置' }).fill('3.3');
  await row.getByRole('textbox', { name: '位置' }).press('Enter');
  expect(await tempos(page)).toEqual([[0, 500000], [3840 + 960, 428571]]);
  const row2 = page.getByTestId('tempo-row').filter({ hasText: 'テンポ' }).nth(1);
  await row2.getByRole('textbox', { name: 'テンポの値' }).fill('90');
  await row2.getByRole('textbox', { name: 'テンポの値' }).press('Enter');
  expect(await tempos(page)).toEqual([[0, 500000], [4800, 666667]]);
  await page.getByTestId('tempo-row').filter({ hasText: 'テンポ' }).nth(1).getByRole('button', { name: 'テンポを削除' }).click();
  expect(await tempos(page)).toEqual([[0, 500000]]);
  // time signature, key and marker through the same dialog
  await page.getByTestId('add-time-signature').click();
  await page.getByTestId('conductor-dialog').getByRole('textbox', { name: '位置' }).fill('2.3');
  await page.getByTestId('conductor-dialog').getByRole('textbox', { name: '拍子' }).fill('3/4');
  await page.getByTestId('conductor-dialog').getByRole('button', { name: 'OK' }).click();
  await page.getByTestId('add-marker').click();
  await page.getByTestId('conductor-dialog').getByRole('textbox', { name: 'マーカー' }).fill('Verse');
  await page.getByTestId('conductor-dialog').getByRole('button', { name: 'OK' }).click();
  const smf = await exportedSmf(page);
  const metas = smf.tracks[0].events.filter((e) => e.kind === 'meta' && (e.metaType === 0x58 || e.metaType === 0x06)).map((e) => (e.kind === 'meta' ? [e.tick, e.metaType, e.metaType === 0x58 ? e.data[0] : new TextDecoder().decode(e.data)] : []));
  expect(metas).toContainEqual([1920, 0x58, 3]); // snapped to the bar start
  expect(metas).toContainEqual([0, 0x06, 'Verse']);
  // filter by kind (view only): hide tempos, show markers; "すべて表示" resets
  const rows = page.getByTestId('tempo-row');
  const countBefore = await rows.count();
  await page.getByTestId('show-tempo').click();
  await expect(rows.filter({ hasText: 'テンポ' })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'マーカー' })).toHaveCount(1); // values are inputs, so match the kind cell
  await page.getByTestId('show-time-signature').click();
  await page.getByTestId('show-key-signature').click();
  await page.getByTestId('show-marker').click();
  await expect(rows).toHaveCount(0);
  await page.getByTestId('show-all').click();
  await expect(rows).toHaveCount(countBefore);
  expect(await tempos(page)).toEqual([[0, 500000]]); // filtering changed nothing
  // "再生位置にする" moves the playhead to the row (the 3/4 at bar 2), not the event
  await rows.filter({ hasText: '拍子' }).nth(1).getByRole('button', { name: /再生位置を/ }).click(); // the 3/4 at bar 2 (after the 4/4 at bar 1)
  await expect(page.getByTestId('transport-position')).toHaveText('002.01.000');
  expect(metas.filter((m) => m[1] === 0x58)).toEqual((await exportedSmf(page)).tracks[0].events.filter((e) => e.kind === 'meta' && e.metaType === 0x58).map((e) => (e.kind === 'meta' ? [e.tick, 0x58, e.data[0]] : [])));
});

test('ADR-084: a time-signature change re-labels the other rows; leaving a row untouched does not move its event', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'コンダクター' }).click();
  await page.getByTestId('add-tempo').click();
  await page.getByTestId('conductor-dialog').getByRole('textbox', { name: '位置' }).fill('5');
  await page.getByTestId('conductor-dialog').getByRole('textbox', { name: 'テンポ' }).fill('140');
  await page.getByTestId('conductor-dialog').getByRole('button', { name: 'OK' }).click();
  await page.getByTestId('add-time-signature').click();
  await page.getByTestId('conductor-dialog').getByRole('textbox', { name: '位置' }).fill('2');
  await page.getByTestId('conductor-dialog').getByRole('textbox', { name: '拍子' }).fill('3/4');
  await page.getByTestId('conductor-dialog').getByRole('button', { name: 'OK' }).click();
  // tick 7680 is bar 6 in 3/4 from bar 2 (1920 + 4 × 1440)
  const pos = page.getByTestId('tempo-row').filter({ hasText: 'テンポ' }).nth(1).getByRole('textbox', { name: '位置' });
  await expect(pos).toHaveValue('006.01.000');
  await pos.focus();
  await pos.blur();
  expect(await tempos(page)).toEqual([[0, 500000], [7680, 428571]]);
});

test('track view: right-click the tempo lane to add a tempo; double-click it to change it', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60), off(480, 0, 60)]));
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const y = box.y + 24 + 13; // tempo lane
  const x = box.x + 96 * 3; // bar 3 (24 px per quarter, one bar of margin before bar 1)
  await page.mouse.click(x, y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'ここにテンポを追加…' }).click();
  const dlg = page.getByTestId('conductor-dialog');
  await expect(dlg.getByRole('textbox', { name: '位置' })).toHaveValue('003.01.000');
  await dlg.getByRole('textbox', { name: 'テンポ' }).fill('150');
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await tempos(page)).toEqual([[3840, 400000]]); // the imported song had no tempo event
  await page.mouse.dblclick(x + 1, y);
  await expect(page.getByRole('dialog', { name: 'テンポを変更' })).toBeVisible(); // an existing change, not a new one
  await page.getByTestId('conductor-dialog').getByRole('textbox', { name: 'テンポ' }).fill('100');
  await page.getByTestId('conductor-dialog').getByRole('button', { name: 'OK' }).click();
  expect(await tempos(page)).toEqual([[3840, 600000]]);
  // the lane title opens the tempo tab
  await page.getByTestId('tempo-lane-label').click();
  await expect(page.getByTestId('tempo-editor')).toBeVisible();
});

test('transport bar: clicking BPM changes the tempo in effect', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('bpm-readout').click();
  await page.getByTestId('context-menu').getByRole('menuitem', { name: /を変更…/ }).click();
  await page.getByTestId('conductor-dialog').getByRole('textbox', { name: 'テンポ' }).fill('96');
  await page.getByTestId('conductor-dialog').getByRole('button', { name: 'OK' }).click();
  expect(await tempos(page)).toEqual([[0, 625000]]);
  await expect(page.getByTestId('bpm-readout')).toContainText('96');
});
