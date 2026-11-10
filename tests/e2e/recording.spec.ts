import { expect, test } from '@playwright/test';
import { exportedSmf, menu, setInputMode, startAudio } from './helpers';

type Smf = Awaited<ReturnType<typeof exportedSmf>>;
const noteOns = (smf: Smf) => smf.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0).map((e) => (e.kind === 'channel' ? [e.tick, e.data[0]] : []));

test('I08 / I03: step input with letter keys only (no numpad): chord, rest, drum pads stacked', async ({ page }) => {
  await page.goto('/');
  await setInputMode(page, 'step-piano');
  await expect(page.getByTestId('step-cursor')).toContainText('001.01.000');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.down('KeyZ');
  await page.keyboard.down('KeyC');
  await page.keyboard.up('KeyZ');
  await page.keyboard.up('KeyC'); // chord C4+E4 at step 1
  await page.keyboard.press('ArrowRight'); // rest
  await page.keyboard.press('KeyB'); // G4 at step 3
  await expect(page.getByTestId('step-cursor')).toContainText('001.02.240');
  expect(noteOns(await exportedSmf(page)).sort()).toEqual([[0, 60], [0, 64], [480, 67]].sort());
  await page.keyboard.press('Backspace'); // undo last step
  expect(noteOns(await exportedSmf(page)).map((n) => n[1]).sort()).toEqual([60, 64]);

  await menu(page, 'トラック', 'トラックを追加');
  await menu(page, 'トラック', 'ドラムトラックにする');
  await setInputMode(page, 'step-drums');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('KeyM');
  await page.keyboard.press('Period'); // same step (auto-advance off)
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Comma');
  // the track added above gets channel 4 (first free one after the 4 starter tracks, ADR-046) and is inserted in channel order
  const drums = (await exportedSmf(page)).tracks.flatMap((t) => t.events).filter((e) => e.kind === 'channel' && e.status === 0x93 && e.data[1] > 0);
  expect(drums.map((e) => (e.kind === 'channel' ? [e.tick, e.data[0]] : []))).toEqual([[480, 36], [480, 42], [720, 38]]);
});

test('ADR-083: Backspace in step input undoes the last step even while the piano roll or the drum grid has focus', async ({ page }) => {
  await page.goto('/');
  await setInputMode(page, 'step-piano');
  await page.getByTestId('piano-roll-grid').focus();
  await page.keyboard.press('KeyZ');
  await page.keyboard.press('KeyX');
  await expect(page.getByTestId('step-cursor')).toContainText('001.02.000');
  await page.keyboard.press('Backspace'); // the last note goes and the cursor steps back
  await expect(page.getByTestId('step-cursor')).toContainText('001.01.240');
  expect(noteOns(await exportedSmf(page))).toEqual([[0, 60]]);
});

test('ADR-076: step length keys — ⇧← / ⇧→ halve / double, . dotted (⌥. in the drum mode), ⌥T triplet', async ({ page }) => {
  await page.goto('/');
  await setInputMode(page, 'step-piano');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const length = page.getByLabel('ステップの長さ');
  await expect(length).toHaveValue('240'); // 1/8 at PPQ 480
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(length).toHaveValue('120'); // 1/16
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(length).toHaveValue('480'); // 1/4
  await page.keyboard.press('Period'); // dotted: 1/4.
  await expect(length).toHaveValue('720');
  await page.keyboard.press('Shift+ArrowLeft'); // keeps the dot: 1/8.
  await expect(length).toHaveValue('360');
  await page.keyboard.press('Alt+KeyT'); // triplet replaces the dot: 1/8T
  await expect(length).toHaveValue('160');
  await page.keyboard.press('Alt+KeyT'); // back to 1/8
  await expect(length).toHaveValue('240');
  // the cursor did not move: ⇧←→ and . are not rest / back / notes
  await expect(page.getByTestId('step-cursor')).toContainText('001.01.000');
  // a note then advances by the current step
  await page.keyboard.press('KeyZ');
  await expect(page.getByTestId('step-cursor')).toContainText('001.01.240');
  // 1/1 is the end of the table: refused with a message, the value stays
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect(length).toHaveValue('1920');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(length).toHaveValue('1920');
  await expect(page.getByTestId('step-message')).toContainText('1/1');

  // drum mode: `.` is the hi-hat pad, so dotted is ⌥.
  await menu(page, 'トラック', 'トラックを追加');
  await menu(page, 'トラック', 'ドラムトラックにする');
  await setInputMode(page, 'step-drums');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(length).toHaveValue('480');
  await page.keyboard.press('Alt+Period');
  await expect(length).toHaveValue('720');
  await page.keyboard.press('Period'); // a hit, not the dot
  await expect(length).toHaveValue('720');
  const drums = (await exportedSmf(page)).tracks.flatMap((t) => t.events).filter((e) => e.kind === 'channel' && e.status === 0x93 && e.data[1] > 0);
  expect(drums.map((e) => (e.kind === 'channel' ? [e.tick, e.data[0]] : []))).toEqual([[240, 42]]);
});

test('I13: MIDI input settings work or explain the fallback, and the rest of the app keeps working', async ({ page }) => {
  await page.goto('/');
  await menu(page, 'MIDI', /MIDI 入力の設定/);
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  const unsupported = await page.getByTestId('midi-unsupported').count();
  if (unsupported) await expect(dlg).toContainText('PC キーボード');
  else await expect(dlg.getByRole('button', { name: /許可/ })).toBeVisible();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByTestId('tool-draw').click();
  await expect(page.getByTestId('piano-roll-grid')).toBeVisible();
});

test.describe('live recording with the real engine (Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'audio engine runs on Chromium');
  test('I01 / I11: PC keyboard live take lands on the selected track, one undo step', async ({ page }) => {
    await page.goto('/');
    await startAudio(page);
    await page.getByTestId('track-header').nth(1).click(); // ADR-080: the selected track is the record target
    await page.getByRole('button', { name: '録音の設定' }).click();
    await page.getByRole('dialog').getByRole('combobox').nth(1).selectOption('0'); // no count-in
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await setInputMode(page, 'piano-performance');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.getByTestId('record').click();
    await expect(page.locator('.rec-label')).toBeVisible();
    await page.waitForTimeout(400);
    await page.keyboard.down('KeyZ');
    await page.waitForTimeout(250);
    await page.keyboard.up('KeyZ');
    await page.waitForTimeout(150);
    await page.getByTestId('record').click();
    await expect(page.getByTestId('status-info')).toContainText('録音しました');
    const smfAfter = await exportedSmf(page);
    const ons = noteOns(smfAfter);
    expect(ons).toHaveLength(1);
    expect(ons[0][1]).toBe(60);
    const channels = smfAfter.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0).map((e) => (e.kind === 'channel' ? e.status & 0x0f : -1));
    expect(channels).toEqual([1]); // the second starter track (channel 2)
    expect(ons[0][0]).toBeGreaterThan(200); // recorded ~0.4 s after the start (tick ~384 at 120 BPM)
    await page.keyboard.press('Escape');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    expect(noteOns(await exportedSmf(page))).toHaveLength(0);
  });

  // Stopping the transport used to leave the recorder in "recording": the take was never saved.
  for (const how of ['Space', 'stop', 'pause'] as const) {
    test(`a take is ended and kept by ${how === 'Space' ? 'Space' : how === 'stop' ? 'the stop button' : 'the play / pause button'}`, async ({ page }) => {
      await page.goto('/');
      await startAudio(page);
      await page.getByRole('button', { name: '録音の設定' }).click();
      await page.getByRole('dialog').getByRole('combobox').nth(1).selectOption('0'); // no count-in
      await page.getByRole('button', { name: '閉じる', exact: true }).click();
      await setInputMode(page, 'piano-performance');
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.getByTestId('record').click();
      await expect(page.locator('.rec-label')).toBeVisible();
      await page.waitForTimeout(400);
      await page.keyboard.down('KeyZ');
      await page.waitForTimeout(250);
      await page.keyboard.up('KeyZ');
      await page.waitForTimeout(150);
      if (how === 'Space') await page.keyboard.press('Space');
      else await page.getByTestId(how === 'stop' ? 'transport-stop' : 'transport-play').click();
      await expect(page.getByTestId('record')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.rec-label')).toHaveCount(0);
      await expect(page.getByTestId('status-info')).toContainText('録音しました');
      await expect(page.getByTestId('transport-play')).toHaveAttribute('aria-label', '再生'); // not playing on
      expect(noteOns(await exportedSmf(page))).toHaveLength(1);
    });
  }

  test('count-in shows the remaining beats before recording starts', async ({ page }) => {
    await page.goto('/');
    await startAudio(page);
    await page.getByTestId('record').click();
    await expect(page.getByTestId('count-in')).toBeVisible();
    await expect(page.locator('.rec-label')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('record').click();
  });
});

test('ADR-080: there are no record-arm buttons; recording goes to the selected track', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('track-header').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /録音待機/ })).toHaveCount(0);
  await expect(page.getByTestId('record')).toHaveAttribute('title', /選んでいるトラック/);
});
