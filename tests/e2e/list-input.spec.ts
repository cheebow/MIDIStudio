// LIST-07 / LIST-08: pitch capture from the PC keyboard into the list and the shared step cursor (ADR-066).
import { expect, test } from '@playwright/test';
import { format1Song } from '../fixtures/songs';
import { exportedSmf, importMidi, setInputMode } from './helpers';

type Smf = Awaited<ReturnType<typeof exportedSmf>>;
const noteOns = (smf: Smf) => smf.tracks[1].events.filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0).map((e) => e.data[0]);

test('LIST-07: in the PC-keyboard mode a key writes the K# of the current row and moves to the next row with a K#', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, format1Song());
  await page.getByRole('tab', { name: 'リスト' }).click();
  const byName = (re: RegExp) => page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: re }) }).first();
  await setInputMode(page, 'piano-performance');
  await byName(/^C4$/).locator('[data-col="name"]').click();
  await page.keyboard.press('KeyX'); // D4
  await expect(byName(/^D4$/)).toBeVisible();
  await expect(byName(/^E4$/).locator('[data-col="name"]')).toHaveClass(/cursor/); // advanced to the next K# row
  await page.keyboard.press('KeyV'); // F4
  await expect(byName(/^F4$/)).toBeVisible();
  expect(noteOns(await exportedSmf(page)).sort()).toEqual([62, 65, 67]);
  // on a row without a K# nothing is written and the reason is shown
  await byName(/^PB$/).locator('[data-col="name"]').click();
  await page.keyboard.press('KeyZ');
  await expect(page.getByTestId('list-message')).toContainText('ノート番号がありません');
  expect(noteOns(await exportedSmf(page)).sort()).toEqual([62, 65, 67]);
  // the toggle off keeps the cursor on the row
  await page.getByRole('checkbox', { name: '鍵盤入力後に次の行へ' }).uncheck();
  await byName(/^D4$/).locator('[data-col="name"]').click();
  await page.keyboard.press('KeyZ');
  await expect(byName(/^C4$/).locator('[data-col="name"]')).toHaveClass(/cursor/);
});

test('LIST-08: step mode — the list cursor follows the step cursor and a clicked row moves it', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, format1Song());
  await page.getByRole('tab', { name: 'リスト' }).click();
  const rows = page.getByTestId('list-row');
  const cursorRow = page.locator('.list-row:has(.lc.cursor)');
  await setInputMode(page, 'step-piano');
  await rows.first().locator('[data-col="name"]').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight'); // step cursor at 480
  await expect(page.getByTestId('step-cursor')).toContainText('001.02.000');
  await expect(cursorRow.locator('[data-col="tick"]')).toHaveText('480'); // the row at or before the step cursor
  await rows.last().locator('[data-col="name"]').click(); // the metas at tick 1440
  await expect(page.getByTestId('step-cursor')).toContainText('001.04.000');
  // a note entered from the keyboard lands at the row's position
  await page.keyboard.press('KeyZ');
  expect(noteOns(await exportedSmf(page))).toContain(60);
});
