// ADR-073: the note info bar shows and edits the selected notes (piano roll and drum editor).
import { expect, test, type Page } from '@playwright/test';
import { build, off, on } from '../fixtures/songs';
import { exportedSmf, importMidi } from './helpers';

const notesOut = async (page: Page) =>
  (await exportedSmf(page)).tracks
    .flatMap((t) => t.events)
    .filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0)
    .map((e) => (e.kind === 'channel' ? { tick: e.tick, pitch: e.data[0], vel: e.data[1] } : null))
    .sort((a, b) => a!.tick - b!.tick || a!.pitch - b!.pitch);

const field = (page: Page, name: string) => page.getByTestId('note-info-bar').getByLabel(name, { exact: true });
const undo = (page: Page) => page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');

test('piano roll: the bar shows one note, a range for a chord, and edits by typing, +/− and arrow keys', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60, 100), on(0, 0, 64, 60), on(0, 0, 67, 30), off(480, 0, 60), off(0, 0, 64), off(0, 0, 67)]));
  const bar = page.getByTestId('note-info-bar');
  await expect(bar).toContainText('ノートを選ぶと');
  await page.getByTestId('piano-roll-grid').focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await expect(bar).toContainText('3 ノート');
  await expect(field(page, 'ベロシティ')).toHaveValue('30–100');
  await expect(field(page, '音高')).toHaveValue('C4–G4');
  await expect(field(page, '位置')).toHaveValue('001.01.000');
  // relative: each note +10
  await field(page, 'ベロシティ').fill('+10');
  await field(page, 'ベロシティ').press('Enter');
  expect((await notesOut(page)).map((n) => n!.vel)).toEqual([110, 70, 40]);
  // absolute: all the same
  await field(page, 'ベロシティ').fill('90');
  await field(page, 'ベロシティ').press('Enter');
  await expect(field(page, 'ベロシティ')).toHaveValue('90');
  // ↑ steps by 1, Shift+↓ by 10
  await field(page, 'ベロシティ').press('ArrowUp');
  await field(page, 'ベロシティ').press('Shift+ArrowDown');
  await expect(field(page, 'ベロシティ')).toHaveValue('81');
  // position keeps the chord together; pitch keeps its shape
  await field(page, '位置').fill('2.2.0');
  await field(page, '位置').press('Enter');
  await field(page, '音高').fill('D4');
  await field(page, '音高').press('Enter');
  expect(await notesOut(page)).toEqual([
    { tick: 2400, pitch: 62, vel: 81 },
    { tick: 2400, pitch: 66, vel: 81 },
    { tick: 2400, pitch: 69, vel: 81 },
  ]);
  // unreadable text is marked and not applied; Esc goes back to the value
  await field(page, '音高').fill('H9');
  await field(page, '音高').press('Enter');
  await expect(field(page, '音高')).toHaveAttribute('aria-invalid', 'true');
  await field(page, '音高').press('Escape');
  await expect(field(page, '音高')).toHaveValue('D4–A4');
  // each edit is one undo step (from the grid)
  await page.getByTestId('piano-roll-grid').focus();
  await undo(page);
  expect((await notesOut(page)).map((n) => n!.pitch)).toEqual([60, 64, 67]);
});

test('drum editor: the bar names the part and changes one hit of two that sound together', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 9, 36, 110), on(0, 9, 38, 100), off(120, 9, 36), off(0, 9, 38)]));
  await page.getByRole('tab', { name: 'ドラム' }).click();
  await page.getByTestId('tool-select').click();
  // click the snare's diamond on beat 1 (lane centre, at bar 1 after one bar of margin)
  const lane = page.locator('[data-testid="drum-lane"][data-pitch="38"]');
  const lb = (await lane.boundingBox())!;
  const grid = (await page.getByTestId('drum-grid').boundingBox())!;
  await page.mouse.click(grid.x + 320, lb.y + lb.height / 2);
  await expect(page.getByTestId('note-info-bar')).toContainText('1 ノート');
  await expect(field(page, '音高')).toHaveValue(/^38 /);
  await field(page, 'ベロシティ').fill('45');
  await field(page, 'ベロシティ').press('Enter');
  expect(await notesOut(page)).toEqual([
    { tick: 0, pitch: 36, vel: 110 },
    { tick: 0, pitch: 38, vel: 45 },
  ]);
});
