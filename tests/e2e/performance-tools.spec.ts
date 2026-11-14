// Performance tools under 入力支援 (ADR-092, revived from the shelved ADR-077 / 078; TEST_PLAN
// E-STR-*, E-PT-*): strum, arpeggio, legato and velocity shaper, from 編集 › 入力支援 and the
// right-click 入力支援 submenu (beside ギターボイシング ▸).
import { expect, test, type Page } from '@playwright/test';
import { build, off, on, program } from '../fixtures/songs';
import { exportedSmf, importMidi, menu, rollPoint } from './helpers';
import type { SmfFile } from '../../src/core/smf/types';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const SELECT_ALL = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';

/** [tick, pitch, velocity, length] of every note of the exported SMF, in tick / pitch order. */
function notesOf(smf: SmfFile): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const open = new Map<number, [number, number, number, number]>();
  for (const e of smf.tracks.flatMap((t) => t.events).sort((a, b) => a.tick - b.tick)) {
    if (e.kind !== 'channel') continue;
    const st = e.status & 0xf0;
    if (st === 0x90 && e.data[1] > 0) {
      const row: [number, number, number, number] = [e.tick, e.data[0], e.data[1], 0];
      open.set(e.data[0], row);
      out.push(row);
    } else if (st === 0x80 || (st === 0x90 && e.data[1] === 0)) {
      const row = open.get(e.data[0]);
      if (row) row[3] = e.tick - row[0];
      open.delete(e.data[0]);
    }
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** C - Am - F - G, one chord per beat (PPQ 480), each an eighth long. */
function progression() {
  const evs = [program(0, 0, 0)];
  const chords: [number, number[]][] = [
    [0, [60, 64, 67]],
    [480, [57, 60, 64]],
    [960, [53, 57, 60]],
    [1440, [55, 59, 62]],
  ];
  let t = 0;
  for (const [tick, ps] of chords) {
    evs.push(on(tick - t, 0, ps[0]), on(0, 0, ps[1]), on(0, 0, ps[2]));
    evs.push(off(240, 0, ps[0]), off(0, 0, ps[1]), off(0, 0, ps[2]));
    t = tick + 240;
  }
  return build(1, 480, evs);
}

/** Brings the C4 row near the top of the roll, so a right-click menu and its submenu fit on screen. */
async function rollPointC4(page: Page, tick: number) {
  await page.locator('.roll-scroll').evaluate((el) => (el.scrollTop = (127 - 60) * 12 - 120));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return rollPoint(page, tick, 60);
}

async function selectAllNotes(page: Page) {
  await page.getByTestId('piano-roll-grid').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(SELECT_ALL);
}

test('E-STR-01: 編集 › 入力支援 › ストラム… spreads every chord from its low string (on the beat = down), keeps ends and rhythm; one undo step', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, progression());
  await selectAllNotes(page);
  await menu(page, '編集', /^ストラム…/, /^入力支援$/);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('strum-dialog')).toBeVisible();
  await expect(dialog.getByTestId('perform-status')).toContainText('和音 4 個');
  await dialog.getByRole('checkbox', { name: /自然な強弱/ }).uncheck();
  await dialog.getByTestId('perform-apply').click();
  const rows = notesOf(await exportedSmf(page));
  // C = 60 64 67, low to high: 45 ms = 43 ticks at 120 BPM over 3 strings; the ends stay
  expect(rows.filter((r) => r[0] < 480)).toEqual([
    [0, 60, 100, 240],
    [22, 64, 100, 218],
    [43, 67, 100, 197],
  ]);
  expect(rows.filter((r) => r[0] >= 1440).map((r) => [r[0], r[1]])).toEqual([
    [1440, 55],
    [1462, 59],
    [1483, 62],
  ]);
  await page.getByTestId('piano-roll-grid').focus();
  await page.keyboard.press(UNDO);
  expect(notesOf(await exportedSmf(page)).every((r) => r[3] === 240)).toBe(true);
});

test('E-STR-02: from the note right-click menu (入力支援 › ストラム…, next to ギターボイシング ▸); the preview shows live and Cancel / Esc leave the song unchanged', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, progression());
  const before = notesOf(await exportedSmf(page));
  await selectAllNotes(page);
  const p = await rollPointC4(page, 10);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const ctx = page.getByTestId('context-menu');
  // only under 入力支援 (not on the first level), beside the guitar-voicing submenu
  await expect(ctx.getByRole('menuitem', { name: 'ストラム…' })).toHaveCount(0);
  await ctx.getByRole('menuitem', { name: '入力支援' }).hover();
  await expect(ctx.getByRole('menuitem', { name: 'ギターボイシング', exact: true })).toBeVisible();
  await ctx.getByRole('menuitem', { name: 'ストラム…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('strum-dialog')).toBeVisible();
  await dialog.getByRole('radio', { name: /アップ固定/ }).check();
  await dialog.getByTestId('perform-cancel').click();
  await expect(dialog).toHaveCount(0);
  expect(notesOf(await exportedSmf(page))).toEqual(before);
  await expect(page.getByTestId('dirty-state')).not.toHaveText('● 未保存');
  // Esc cancels the same way
  await selectAllNotes(page);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name: '入力支援' }).hover();
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'ストラム…' }).click();
  await expect(page.getByRole('dialog').getByTestId('strum-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(notesOf(await exportedSmf(page))).toEqual(before);
});

test('E-PT-01: 編集 › 入力支援 › レガート調整… previews live, cancel keeps the song, apply is one undo step', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(100, 0, 60), on(380, 0, 62), off(100, 0, 62), on(380, 0, 64), off(100, 0, 64)]));
  const before = notesOf(await exportedSmf(page));
  expect(before).toEqual([
    [0, 60, 100, 100],
    [480, 62, 100, 100],
    [960, 64, 100, 100],
  ]);
  await selectAllNotes(page);
  await menu(page, '編集', /^レガート調整…/, /^入力支援$/);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('legato-dialog')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /選択中のノート（3 個）/ })).toBeChecked();
  await expect(dialog.getByTestId('perform-status')).toContainText('ノート 3 個');
  await dialog.getByRole('radio', { name: /少し離す/ }).check();
  await dialog.getByTestId('perform-cancel').click();
  await expect(dialog).toHaveCount(0);
  expect(notesOf(await exportedSmf(page))).toEqual(before);
  await expect(page.getByTestId('dirty-state')).not.toHaveText('● 未保存');

  await selectAllNotes(page);
  await menu(page, '編集', /^レガート調整…/, /^入力支援$/);
  await page.getByRole('dialog').getByRole('radio', { name: /^つなぐ/ }).check();
  await page.getByRole('dialog').getByTestId('perform-apply').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(notesOf(await exportedSmf(page))).toEqual([
    [0, 60, 100, 480],
    [480, 62, 100, 480],
    [960, 64, 100, 100],
  ]);
  await page.getByTestId('piano-roll-grid').focus();
  await page.keyboard.press(UNDO);
  expect(notesOf(await exportedSmf(page))).toEqual(before);
});

test('E-PT-02: 入力支援 › ベロシティ・シェイパー… from the right-click; Esc cancels the preview', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60), on(0, 0, 62), off(480, 0, 62), on(0, 0, 64), off(480, 0, 64)]));
  const open = async () => {
    await selectAllNotes(page);
    const p = await rollPointC4(page, 100);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    const ctx = page.getByTestId('context-menu');
    await ctx.getByRole('menuitem', { name: '入力支援' }).hover();
    await ctx.getByRole('menuitem', { name: 'ベロシティ・シェイパー…' }).click();
    await expect(page.getByRole('dialog').getByTestId('velocity-shaper-dialog')).toBeVisible();
  };
  await open();
  await page.getByRole('dialog').getByRole('radio', { name: /デクレッシェンド/ }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(notesOf(await exportedSmf(page)).map((n) => n[2])).toEqual([100, 100, 100]);
  await open();
  await page.getByRole('dialog').getByRole('radio', { name: /^クレッシェンド/ }).check();
  await page.getByRole('dialog').getByTestId('perform-apply').click();
  expect(notesOf(await exportedSmf(page)).map((n) => n[2])).toEqual([85, 100, 115]);
});

test('E-PT-03: 入力支援 › アルペジオ… adds the turning notes to the clip; undo removes them again', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), ...[on(0, 0, 60), on(0, 0, 64), on(0, 0, 67), off(960, 0, 60), off(0, 0, 64), off(0, 0, 67)]]));
  await selectAllNotes(page);
  const p = await rollPointC4(page, 100);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const ctx = page.getByTestId('context-menu');
  await ctx.getByRole('menuitem', { name: '入力支援' }).hover();
  await ctx.getByRole('menuitem', { name: 'アルペジオ…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('perform-status')).toContainText('和音 1 個');
  await dialog.getByRole('radio', { name: /往復/ }).check();
  await dialog.getByTestId('perform-apply').click();
  expect(notesOf(await exportedSmf(page))).toEqual([
    [0, 60, 100, 192],
    [240, 64, 100, 192],
    [480, 67, 100, 192],
    [720, 64, 100, 192],
  ]);
  await page.getByTestId('piano-roll-grid').focus();
  await page.keyboard.press(UNDO);
  expect(notesOf(await exportedSmf(page)).length).toBe(3);
});


test('E-PT-04: arpeggio: the automatic length is named (quarter triplets); by 8th notes, held to the end of the chord (a slow strum)', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), ...[on(0, 0, 60), on(0, 0, 64), on(0, 0, 67), off(960, 0, 60), off(0, 0, 64), off(0, 0, 67)]]));
  await selectAllNotes(page);
  await menu(page, '編集', /^アルペジオ…/, /^入力支援$/);
  const dialog = page.getByRole('dialog');
  // automatic: the 3-note chord over 2 beats comes to quarter triplets, and the dialog says so
  await expect(dialog.getByTestId('arpeggio-length')).toHaveValue('even');
  await expect(dialog.getByTestId('arpeggio-length-note')).toHaveText('→ 3 連 4 分（1 和音）');
  await dialog.getByTestId('arpeggio-length').selectOption('8');
  await expect(dialog.getByTestId('arpeggio-length-note')).toHaveText('和音が終わるまでくり返します');
  await dialog.getByRole('radio', { name: /^和音の終わりまで伸ばす/ }).check();
  await dialog.getByTestId('perform-apply').click();
  // 8ths from the chord start: 60 64 67 60; each held to the end, or until its pitch comes back
  expect(notesOf(await exportedSmf(page))).toEqual([
    [0, 60, 100, 720],
    [240, 64, 100, 720],
    [480, 67, 100, 480],
    [720, 60, 100, 240],
  ]);
});

test('E-PT-05: up-and-down 8ths over four bars of guitar forms spread every bar, the 6-string Em7 too (user report)', async ({ page }) => {
  await page.goto('/');
  // Fmaj7 xx3210 | Em7 022030 | Am7 x02010 | Dm7 xx0211, one bar each
  const bars = [
    [53, 57, 60, 64],
    [40, 47, 52, 55, 62, 64],
    [45, 52, 55, 60, 64],
    [50, 57, 60, 65],
  ];
  const evs = [program(0, 0, 25)];
  for (const ps of bars) {
    evs.push(...ps.map((p) => on(0, 0, p)));
    evs.push(...ps.map((p, i) => off(i === 0 ? 1920 : 0, 0, p)));
  }
  await importMidi(page, build(1, 480, evs));
  await selectAllNotes(page);
  await menu(page, '編集', /^アルペジオ…/, /^入力支援$/);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /^往復/ }).check();
  await dialog.getByTestId('arpeggio-length').selectOption('8');
  await dialog.getByRole('radio', { name: /^和音の終わりまで伸ばす/ }).check();
  await expect(dialog.getByTestId('perform-notice')).toHaveCount(0);
  await dialog.getByTestId('perform-apply').click();
  const rows = notesOf(await exportedSmf(page));
  // every bar has eight 8th-note onsets now (bar 2 included)
  for (let bar = 0; bar < 4; bar++) {
    const onsets = [...new Set(rows.filter((r) => r[0] >= bar * 1920 && r[0] < (bar + 1) * 1920).map((r) => r[0] - bar * 1920))];
    expect(onsets, `bar ${bar + 1}`).toEqual([0, 240, 480, 720, 960, 1200, 1440, 1680]);
  }
  // bar 2 goes up the six strings and turns: E2 B2 E3 G3 D4 E4, then D4 G3
  expect(rows.filter((r) => r[0] >= 1920 && r[0] < 3840).map((r) => r[1])).toEqual([40, 47, 52, 55, 62, 64, 62, 55]);
});
