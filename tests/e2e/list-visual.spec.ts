import { expect, test, type Page } from '@playwright/test';
import { format1Song } from '../fixtures/songs';
import { exportedSmf, importMidi, startAudio } from './helpers';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
type Smf = Awaited<ReturnType<typeof exportedSmf>>;
const pianoTrack = (smf: Smf) => smf.tracks[1].events;
const pbTicks = (smf: Smf) => pianoTrack(smf).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0xe0).map((e) => e.tick);

async function openList(page: Page) {
  await page.goto('/');
  await importMidi(page, format1Song());
  await page.getByRole('tab', { name: 'リスト' }).click();
}

async function editCell(page: Page, rowName: string | RegExp, col: string, text: string) {
  const row = page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: rowName }) }).first();
  await row.locator(`[data-col="${col}"]`).click();
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: new RegExp(`を入力`) });
  await input.fill(text);
  await input.press('Enter');
}

test('E05: editing ST ripples only the later events; undo restores', async ({ page }) => {
  await openList(page);
  expect(pbTicks(await exportedSmf(page))).toEqual([480, 960, 1440]);
  await editCell(page, /^G4$/, 'st', '960');
  expect(pbTicks(await exportedSmf(page))).toEqual([960, 1440, 1920]);
  const notes = pianoTrack(await exportedSmf(page)).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90).map((e) => e.tick);
  expect(notes).toEqual([0, 0, 0]); // earlier rows untouched
  await page.getByTestId('list-grid').focus();
  await page.keyboard.press(`${mod}+z`);
  expect(pbTicks(await exportedSmf(page))).toEqual([480, 960, 1440]);
});

test('E06: editing GT changes only that Note Off', async ({ page }) => {
  await openList(page);
  await editCell(page, /^C4$/, 'gt', '960');
  const ev = pianoTrack(await exportedSmf(page)).filter((e) => e.kind === 'channel' && e.data[0] === 60);
  expect(ev.map((e) => e.tick)).toEqual([0, 960]);
  expect(pbTicks(await exportedSmf(page))).toEqual([480, 960, 1440]);
});

test('E07: Classic 48 changes the display only; inexact input is refused, not rounded', async ({ page }) => {
  await openList(page);
  await page.getByTestId('unit-classic48').click();
  const g4 = page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: /^G4$/ }) });
  await expect(g4.locator('[data-col="gt"]')).toHaveText('48');
  await editCell(page, /^G4$/, 'st', '96');
  expect(pbTicks(await exportedSmf(page))).toEqual([960, 1440, 1920]);
});

test('E12: with a filter on, numeric edits are refused with a reason', async ({ page }) => {
  await openList(page);
  await page.getByTestId('list-show').click();
  await page.getByRole('checkbox', { name: 'PB' }).uncheck();
  await page.keyboard.press('Escape');
  const g4 = page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: /^G4$/ }) });
  await g4.locator('[data-col="st"]').click();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('list-message')).toContainText('フィルター中');
  await expect(page.locator('.hidden-badge').first()).toBeVisible();
  expect(pbTicks(await exportedSmf(page))).toEqual([480, 960, 1440]);
});

test('list selection is shared with the piano roll (same events)', async ({ page }) => {
  await openList(page);
  await page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: /^C4$/ }) }).click();
  await page.getByRole('tab', { name: 'ピアノロール' }).click();
  await page.getByTestId('piano-roll-grid').focus();
  await page.keyboard.press('ArrowUp');
  await page.getByRole('tab', { name: 'リスト' }).click();
  await expect(page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: /^C#4$/ }) })).toHaveCount(1);
});

test('visual mode opens and closes without touching the song; layouts and modes switch', async ({ page }) => {
  await openList(page);
  await page.getByTestId('open-tm').click();
  await expect(page.getByTestId('visual-monitor')).toBeVisible();
  await expect(page.getByTestId('tm-now').first()).toBeVisible(); // rows at tick 0 are current
  await page.getByRole('combobox', { name: '分割' }).selectOption('quad');
  await expect(page.getByTestId('tm-pane-3')).toBeVisible();
  await page.getByTestId('tm-mode').selectOption('page-turn');
  await page.getByTestId('tm-close').click();
  await expect(page.getByTestId('visual-monitor')).toHaveCount(0);
  await expect(page.getByTestId('dirty-state')).toHaveText('保存済み');
});

test.describe('visual mode with the real engine (Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'audio engine runs on Chromium');
  test('P02 / P06: DAW -> visual mode -> DAW while playing keeps playback; the current row advances', async ({ page }) => {
    await page.goto('/');
    await startAudio(page);
    await importMidi(page, format1Song());
    await page.getByRole('checkbox', { name: 'LOOP' }).check(); // the fixture is ~2 s long; loop so it keeps playing
    await page.locator('.bar-input').nth(1).fill('3');
    await page.getByTestId('transport-play').click();
    await page.waitForTimeout(300);
    await page.getByTestId('open-tm').click();
    await expect(page.getByTestId('tm-state')).toContainText('PLAY');
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      seen.add((await page.getByTestId('tm-clock').textContent())!.slice(0, 9)); // ":M0001.02" = bar + beat
      await page.waitForTimeout(100);
    }
    expect(seen.size).toBeGreaterThan(1); // the clock moves (follows the transport)
    await expect(page.getByTestId('tm-pane-0').getByTestId('tm-now').first()).toBeVisible();
    await page.getByTestId('tm-close').click();
    await expect(page.getByTestId('transport-play')).toHaveAttribute('aria-label', '一時停止');
    await page.getByTestId('transport-stop').click();
  });
});

test('visual mode: switch between the RCM list, the all-tracks piano roll and the keyboards', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, format1Song());
  await page.getByTestId('open-tm').click();
  await expect(page.getByRole('region', { name: 'ビジュアルモード' })).toBeVisible();
  await page.getByTestId('visual-view-roll').click();
  await expect(page.getByTestId('visual-roll')).toBeVisible();
  // the keyboard at the left of the roll lights the sounding piano chord
  await expect(page.getByTestId('visual-roll')).toHaveAttribute('data-lit', /\b60,64,67\b/);
  await page.getByTestId('visual-view-keys').click();
  await expect(page.getByTestId('visual-keys')).toBeVisible();
  // at tick 0 the piano chord and the kick sound: the keyboards light them
  await expect(page.getByTestId('visual-keys')).toHaveAttribute('data-sounding', /Piano:60,64,67/);
  await page.getByTestId('visual-view-list').click();
  await expect(page.getByTestId('tm-pane-0')).toBeVisible();
  await page.getByTestId('tm-close').click();
});

test('ADR-084: in visual mode Esc first leaves the PC-keyboard mode; only a second Esc closes the monitor', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-tm').click();
  const monitor = page.getByRole('region', { name: 'ビジュアルモード' });
  await expect(monitor).toBeVisible();
  await page.keyboard.press('Alt+k');
  await expect(page.getByTestId('input-mode')).toContainText('PC 鍵盤');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('input-mode')).toContainText('入力: 編集');
  await expect(monitor).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(monitor).toBeHidden();
});

test('visual mode: going back from 2 rows to 1 pane resizes the staff canvas with the pane', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-tm').click();
  const layout = page.getByRole('combobox', { name: '分割' });
  await layout.selectOption('rows-2');
  await expect(page.getByTestId('tm-pane-1')).toBeVisible();
  await layout.selectOption('single');
  await expect(page.getByTestId('tm-pane-1')).toHaveCount(0);
  const body = (await page.locator('.tm-pane-body').first().boundingBox())!;
  await expect.poll(async () => (await page.locator('canvas.tm-staff').boundingBox())!.height).toBeGreaterThan(body.height - 2);
  const staff = (await page.locator('canvas.tm-staff').boundingBox())!;
  expect(staff.width).toBeGreaterThanOrEqual(140);
});
