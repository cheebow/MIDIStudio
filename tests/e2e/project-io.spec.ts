import { expect, test } from '@playwright/test';
import { format1Song } from '../fixtures/songs';
import { compareSmfSemantics } from '../../src/core/smf/semantic';
import { readSmf } from '../../src/core/smf/reader';
import { readFileSync } from 'node:fs';
import { exportedSmf, importMidi, menu, startAudio } from './helpers';

test('C13 / O04: import -> export is semantically equal; broken files keep the current song', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, format1Song());
  await expect(page.getByTestId('track-header')).toHaveCount(2);
  await expect(page.getByTestId('track-header').first()).toContainText('Piano');
  const out = await exportedSmf(page);
  const original = readSmf(format1Song());
  if (!original.ok) throw new Error();
  expect(compareSmfSemantics(original.smf, out).differences).toEqual([]);

  await page.getByTestId('midi-input').setInputFiles({ name: 'broken.mid', mimeType: 'audio/midi', buffer: Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0]) });
  await expect(page.getByTestId('error')).toContainText('現在の曲はそのまま');
  await expect(page.getByTestId('track-header')).toHaveCount(2);
  await page.getByTestId('project-input').setInputFiles({ name: 'bad.midstudio', mimeType: 'application/json', buffer: Buffer.from('{oops') });
  await expect(page.getByTestId('error')).toContainText('現在の曲はそのまま');
  await expect(page.getByTestId('track-header')).toHaveCount(2);
});

test('O01: browser save -> reload -> recent restores tracks, loop and editor settings', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, format1Song());
  await page.getByRole('checkbox', { name: 'LOOP' }).check();
  await page.getByRole('combobox', { name: 'グリッド' }).selectOption('8:triplet');
  await page.getByRole('tab', { name: 'リスト' }).click();
  await expect(page.getByTestId('dirty-state')).toHaveText('● 未保存');
  await menu(page, 'ファイル', /ブラウザに保存/);
  await expect(page.getByText('ブラウザ内に保存しました')).toBeVisible();
  await expect(page.getByTestId('dirty-state')).toHaveText('保存済み');
  await page.reload();
  // the autosave banner may appear; the saved project is opened from the recent list
  await menu(page, 'ファイル', /最近のプロジェクト/);
  await page.getByRole('button', { name: 'Test Song' }).click();
  await expect(page.getByTestId('track-header')).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: 'LOOP' })).toBeChecked();
  await expect(page.getByRole('tab', { name: 'リスト' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'ピアノロール' }).click();
  await expect(page.getByRole('combobox', { name: 'グリッド' })).toHaveValue('8:triplet');
});

test('O02: unsaved edits are offered for restore after a reload', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, format1Song());
  await page.getByTestId('track-header').first().getByRole('button', { name: /ミュート/ }).click();
  await menu(page, 'トラック', 'トラックを追加');
  await expect(page.getByTestId('dirty-state')).toHaveText('● 未保存');
  await page.waitForTimeout(2000); // autosave delay
  page.on('dialog', (d) => void d.accept()); // beforeunload prompt
  await page.reload();
  await page.getByRole('button', { name: '復元' }).click();
  await expect(page.getByTestId('track-header')).toHaveCount(3);
});

test.describe('WAV export (ADR-052, real engine)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'audio engine runs on Chromium');
  test('ファイル › WAV を書き出す… renders the song with the loaded SoundFont and downloads a WAV', async ({ page }) => {
    await page.goto('/');
    await importMidi(page, format1Song());
    await startAudio(page);
    await menu(page, 'ファイル', /WAV を書き出す/);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('余韻（秒）').fill('0.5');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), dialog.getByTestId('wav-start').click()]);
    expect(download.suggestedFilename()).toMatch(/\.wav$/);
    const bytes = readFileSync((await download.path())!);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString('latin1')).toBe('WAVE');
    expect(bytes.readUInt32LE(24)).toBe(44100);
    expect(bytes.length).toBeGreaterThan(44100 * 4); // more than a second of stereo 16-bit audio
    await expect(dialog).toHaveCount(0);
  });
});
