// LIST-04 / 05 / 09 / 10 / 11 / 12: in-place editing of every column, +/- steps with one undo,
// insertion of any kind, the SysEx dialog and the batch dialog (ADR-066).
import { expect, test, type Page } from '@playwright/test';
import { format1Song } from '../fixtures/songs';
import { exportedSmf, importMidi } from './helpers';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
type Smf = Awaited<ReturnType<typeof exportedSmf>>;
const piano = (smf: Smf) => smf.tracks[1].events;
const noteOns = (smf: Smf) => piano(smf).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0);
const ccs = (smf: Smf, n?: number) => piano(smf).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0xb0 && (n === undefined || e.data[0] === n));

async function openList(page: Page) {
  await page.goto('/');
  await importMidi(page, format1Song());
  await page.getByRole('tab', { name: 'リスト' }).click();
}
const rowByName = (page: Page, name: RegExp) => page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: name }) }).first();

async function typeCell(page: Page, rowName: RegExp, col: string, text: string) {
  await rowByName(page, rowName).locator(`[data-col="${col}"]`).click();
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: /を入力/ });
  await input.fill(text);
  await input.press('Enter');
}

test('LIST-05: the NOTE column takes note names and event prefixes; CC11 on a note row converts it', async ({ page }) => {
  await openList(page);
  await typeCell(page, /^E4$/, 'name', 'D#4');
  expect(noteOns(await exportedSmf(page)).map((e) => e.data[0]).sort()).toEqual([60, 63, 67]);
  await typeCell(page, /^G4$/, 'name', 'CC11');
  const smf = await exportedSmf(page);
  expect(noteOns(smf).map((e) => e.data[0]).sort()).toEqual([60, 63]);
  expect(ccs(smf, 11).map((e) => [e.tick, e.data[1]])).toEqual([[0, 100]]); // same tick, velocity carried as the value
  await expect(rowByName(page, /^CC11$/).locator('[data-col="detail"]')).toContainText('Expression');
  // a bad name is refused with a reason and nothing changes
  await typeCell(page, /^C4$/, 'name', 'H4');
  await expect(page.getByTestId('list-message')).toContainText('音名');
  expect(noteOns(await exportedSmf(page)).map((e) => e.data[0]).sort()).toEqual([60, 63]);
});

test('LIST-04 / LIST-12: + steps the cell; three presses are one undo step; CH edits the channel', async ({ page }) => {
  await openList(page);
  const before = noteOns(await exportedSmf(page)).find((e) => e.data[0] === 60)!.data[1];
  await rowByName(page, /^C4$/).locator('[data-col="vel"]').click();
  await page.keyboard.press('Shift+Equal'); // "+"
  await page.keyboard.press('Shift+Equal');
  await page.keyboard.press('Shift+Equal');
  await expect(rowByName(page, /^C4$/).locator('[data-col="vel"]')).toHaveText(String(before + 3));
  await page.keyboard.press('Minus');
  await expect(rowByName(page, /^C4$/).locator('[data-col="vel"]')).toHaveText(String(before + 2));
  await page.keyboard.press(`${mod}+z`);
  await expect(rowByName(page, /^C4$/).locator('[data-col="vel"]')).toHaveText(String(before)); // every press on the same cell is one undo step
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(rowByName(page, /^C4$/).locator('[data-col="vel"]')).toHaveText(String(before + 2));
  await rowByName(page, /^E4$/).locator('[data-col="vel"]').click(); // another cell starts a new step
  await page.keyboard.press('Shift+Equal');
  await page.keyboard.press(`${mod}+z`);
  await expect(rowByName(page, /^E4$/).locator('[data-col="vel"]')).toHaveText(String(before));
  await expect(rowByName(page, /^C4$/).locator('[data-col="vel"]')).toHaveText(String(before + 2));
  // ⌥↑ on K# is an octave
  await rowByName(page, /^C4$/).locator('[data-col="key"]').click();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(rowByName(page, /^C5$/)).toBeVisible();
  // CH column
  await typeCell(page, /^C5$/, 'ch', '10');
  await expect(rowByName(page, /^C5$/).locator('[data-col="ch"]')).toHaveText('10*');
  const smf = await exportedSmf(page);
  const c5 = noteOns(smf).find((e) => e.data[0] === 72)!;
  expect(c5.kind === 'channel' && c5.status & 0x0f).toBe(9);
});

test('LIST-10: Insert ▾ adds a CC at the cursor (access key), the SysEx dialog builds a GS message, sets insert in order', async ({ page }) => {
  await openList(page);
  const ccBefore = ccs(await exportedSmf(page)).length;
  await rowByName(page, /^G4$/).locator('[data-col="name"]').click();
  await page.getByTestId('list-insert').click();
  await page.keyboard.press('c');
  expect(ccs(await exportedSmf(page)).length).toBe(ccBefore + 1);
  // the cursor sits on the new row's NOTE cell: typing refines it at once (the export menu took the focus; give it back)
  await page.getByTestId('list-grid').focus();
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: /を入力/ });
  await input.fill('CC91');
  await input.press('Enter');
  expect(ccs(await exportedSmf(page), 91).map((e) => e.tick)).toEqual([0]);

  // Enter moved the cursor down to the PB row (tick 480): go back to tick 0 for the next insertions
  await rowByName(page, /^CC91$/).locator('[data-col="name"]').click();
  await page.getByTestId('list-insert').click();
  await page.getByRole('menuitem', { name: 'SysEx…' }).click();
  await expect(page.getByTestId('event-bytes-dialog')).toBeVisible();
  await page.getByTestId('gs-template').selectOption('Master Volume');
  await page.getByTestId('gs-value').fill('100');
  await expect(page.getByTestId('sysex-hex')).toHaveValue('41 10 42 12 40 00 04 64 58 F7');
  await page.getByTestId('event-bytes-apply').click();
  const smf = await exportedSmf(page);
  const sx = piano(smf).filter((e) => e.kind === 'sysex').map((e) => (e.kind === 'sysex' ? Array.from(e.data) : []));
  expect(sx).toContainEqual([0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x04, 0x64, 0x58, 0xf7]);
  await expect(rowByName(page, /^GS$/).locator('[data-col="detail"]')).toContainText('Master Volume = 100');

  await page.getByTestId('list-insert').click();
  await page.getByRole('menuitem', { name: 'セット' }).click(); // click opens the submenu (hover needs the menu to settle first)
  await page.getByRole('menuitem', { name: /RPN ピッチベンドレンジ/ }).click();
  await expect(rowByName(page, /^CC101$/)).toBeVisible();
  await expect(rowByName(page, /^CC101$/).locator('[data-col="tick"]')).toHaveText('0');
  const after = ccs(await exportedSmf(page)).filter((e) => e.tick === 0).map((e) => e.data[0]);
  const i = after.indexOf(101);
  expect(after.slice(i, i + 4)).toEqual([101, 100, 6, 38]);
});

test('LIST-10: on the grid itself N / C / P insert without opening the menu (edit mode)', async ({ page }) => {
  await openList(page);
  await rowByName(page, /^G4$/).locator('[data-col="name"]').click();
  await page.keyboard.press('c');
  await expect(page.getByRole('textbox', { name: /を入力/ })).toHaveCount(0);
  await expect(page.locator('.lc.cursor')).toHaveAttribute('data-col', 'name');
  await page.keyboard.press('n');
  await page.keyboard.press('b');
  const smf = await exportedSmf(page);
  expect(noteOns(smf).length).toBe(4);
  expect(piano(smf).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0xe0 && e.tick === 0).length).toBe(1);
  expect(ccs(smf).length).toBe(4);
});

test('LIST-09: the batch dialog changes the selected rows', async ({ page }) => {
  await openList(page);
  await rowByName(page, /^C4$/).locator('[data-col="vel"]').click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await rowByName(page, /^G4$/).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '選択行の一括変更…' }).click();
  await expect(page.getByTestId('list-batch-dialog')).toBeVisible();
  await page.getByRole('radio', { name: /値を一定にする/ }).check();
  await page.getByTestId('batch-value').fill('64');
  await page.getByTestId('list-batch-apply').click();
  expect(noteOns(await exportedSmf(page)).map((e) => e.data[1])).toEqual([64, 64, 64]);
  await rowByName(page, /^G4$/).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '選択行の一括変更…' }).click();
  await page.getByRole('radio', { name: /GT を比率で/ }).check();
  await page.getByTestId('batch-gate-percent').fill('50');
  await page.getByTestId('list-batch-apply').click();
  await expect(rowByName(page, /^C4$/).locator('[data-col="gt"]')).toHaveText('240');
  await page.getByTestId('list-grid').focus();
  await page.keyboard.press(`${mod}+z`);
  await expect(rowByName(page, /^C4$/).locator('[data-col="gt"]')).toHaveText('480');
});

test('LIST-11: a meta row opens the bytes dialog; text is stored as UTF-8', async ({ page }) => {
  await openList(page);
  await page.getByTestId('list-insert').click();
  await page.getByRole('menuitem', { name: 'Meta…' }).click();
  await page.getByTestId('meta-type').selectOption('5'); // Lyric
  await page.getByTestId('meta-text').fill('ら');
  await page.getByTestId('event-bytes-apply').click();
  const lyric = piano(await exportedSmf(page)).find((e) => e.kind === 'meta' && e.metaType === 5);
  expect(lyric && lyric.kind === 'meta' && Array.from(lyric.data)).toEqual([0xe3, 0x82, 0x89]);
  await expect(rowByName(page, /^Meta$/).first().locator('[data-col="detail"]')).toContainText('Lyric');
});
