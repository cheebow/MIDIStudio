import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readSmf } from '../../src/core/smf/reader';
import type { SmfFile } from '../../src/core/smf/types';

/** Opens a menu-bar menu and clicks `item`; with `sub`, hovers that submenu first (ADR-041). */
export async function menu(page: Page, menuLabel: string, item: string | RegExp, sub?: string | RegExp) {
  await page.getByRole('button', { name: menuLabel, exact: true }).click();
  if (sub) {
    await page.getByRole('menuitem', { name: sub }).hover();
    await expect(page.locator('.submenu')).toBeVisible();
  }
  await page.getByRole('menuitem', { name: item }).click();
}

/** Toolbar input-mode switch (ADR-044): a button per mode, step modes behind the ステップ menu. */
export async function setInputMode(page: Page, mode: 'edit-shortcuts' | 'piano-performance' | 'drum-performance' | 'step-piano' | 'step-drums') {
  if (mode === 'step-piano' || mode === 'step-drums') {
    await page.getByTestId('input-mode-step').click();
    await page.getByRole('menuitem', { name: mode === 'step-piano' ? 'ステップ（鍵盤）' : /^ステップ（ドラム）/ }).click();
  } else await page.getByTestId(`input-mode-${mode}`).click();
}

export async function importMidi(page: Page, bytes: Uint8Array, name = 'song.mid') {
  await page.getByTestId('midi-input').setInputFiles({ name, mimeType: 'audio/midi', buffer: Buffer.from(bytes) });
  // close the import-notes dialog if it opened
  const close = page.getByRole('button', { name: '閉じる', exact: true });
  if (await close.first().isVisible().catch(() => false)) await close.first().click();
}

export async function exportedSmf(page: Page): Promise<SmfFile> {
  const [download] = await Promise.all([page.waitForEvent('download'), menu(page, 'ファイル', /MIDI を書き出す/)]);
  const path = await download.path();
  const r = readSmf(new Uint8Array(readFileSync(path!)));
  if (!r.ok) throw new Error(r.errors[0].message);
  return r.smf;
}

/** Client point of a (tick, pitch) cell in the piano roll grid. */
/** Ruler (20 px) + chord strip (16 px, shown by default: ADR-090) above the piano-roll notes. */
export const ROLL_TOP = 20 + 16;

export async function rollPoint(page: Page, tick: number, pitch: number) {
  const grid = page.getByTestId('piano-roll-grid');
  const box = (await grid.boundingBox())!;
  const { scrollLeft, scrollTop, zoom, ppq } = await page.evaluate(() => {
    const el = document.querySelector('.roll-scroll') as HTMLElement;
    return { scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, zoom: 80, ppq: 480 };
  });
  const lead = 4 * zoom; // one 4/4 bar of margin before bar 1
  const x = box.x + lead + (tick * zoom) / ppq - scrollLeft + 3;
  const y = box.y + ROLL_TOP + (127 - pitch) * 12 - scrollTop + 6;
  return { x, y };
}

/** The engine starts automatically on the first user gesture; click a neutral spot and wait. */
export async function startAudio(page: Page) {
  await page.locator('.statusbar').click();
  await expect(page.getByTestId('audio-status')).toBeVisible({ timeout: 60_000 });
}
