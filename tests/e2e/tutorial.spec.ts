// ADR-063: following the beginner's guide step by step (chapters 1–3 and 6) with the mouse and the
// keys it names yields the eight-bar song the guide describes. Guards the text against the app.
import { expect, test, type Page } from '@playwright/test';
import { exportedSmf, rollPoint } from './helpers';

const Q = 480;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const header = (page: Page, name: string) => page.getByTestId('track-header').filter({ hasText: name }).first();
const grid = (page: Page) => page.getByRole('combobox', { name: 'グリッド' });

async function showPitch(page: Page, pitch: number) {
  // scroll the roll so the row is in view; after a track switch the roll first settles its own scroll
  await page.waitForTimeout(150);
  await page.locator('.roll-scroll').evaluate((el, p) => (el.scrollTop = Math.max(0, (127 - p) * 12 - 200)), pitch);
  await page.waitForTimeout(100);
}
async function draw(page: Page, tick: number, pitch: number) {
  const p = await rollPoint(page, tick, pitch);
  await page.mouse.click(p.x, p.y);
}
async function drumHit(page: Page, label: RegExp, tick: number) {
  const g = (await page.getByTestId('drum-grid').boundingBox())!;
  const lane = page.getByTestId('drum-lane').filter({ hasText: label }).first();
  const b = (await lane.boundingBox())!;
  await page.mouse.click(g.x + 320 + (tick * 80) / Q + 2, b.y + b.height / 2);
}
/** ⌘A → ⌘D (→ ↑ × n) in the editor of the selected track, as chapter 3 says */
async function duplicateBar(page: Page, up = 0) {
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+d`);
  for (let i = 0; i < up; i++) await page.keyboard.press('ArrowUp');
}

test('ADR-063: the beginner\'s guide, followed literally, produces the eight-bar C → F song', async ({ page }) => {
  await page.goto('/');
  // 1. 最初の音を置く: grid 1/4, draw tool, four C4 quarter notes in bar 1
  await header(page, 'ピアノ').click();
  await page.getByRole('tab', { name: 'ピアノロール' }).click();
  await grid(page).selectOption('4:straight');
  await page.getByTestId('tool-draw').click();
  for (let beat = 0; beat < 4; beat++) await draw(page, beat * Q, 60);
  // 2. リズムを足す: grid 1/8, kick 1・3, snare 2・4, hat on every 8th; loop on
  await header(page, 'ドラム').click();
  await page.getByRole('tab', { name: 'ドラム' }).click();
  await grid(page).selectOption('8:straight');
  for (const t of [0, 2 * Q]) await drumHit(page, /^36 Bass Drum 1/, t);
  for (const t of [Q, 3 * Q]) await drumHit(page, /^38 Acoustic Snare/, t);
  for (let i = 0; i < 8; i++) await drumHit(page, /^42 Closed Hi-Hat/, (i * Q) / 2);
  await page.keyboard.press('l');
  // 3. ベースとコード
  await header(page, 'ベース').click();
  await page.getByRole('tab', { name: 'ピアノロール' }).click();
  await grid(page).selectOption('4:straight');
  await showPitch(page, 36);
  for (let beat = 0; beat < 4; beat++) await draw(page, beat * Q, 36);
  await header(page, 'ピアノ').click();
  await showPitch(page, 64);
  for (let beat = 0; beat < 4; beat++) {
    await draw(page, beat * Q, 64);
    await draw(page, beat * Q, 67);
  }
  // bar 2: click the roll (select tool), ⌘A, ⌘D, ↑ × 5
  await page.getByTestId('tool-select').click();
  const empty = await rollPoint(page, 6 * Q, 80);
  await page.mouse.click(empty.x, empty.y);
  await duplicateBar(page, 5);
  await header(page, 'ベース').click();
  await showPitch(page, 36);
  const emptyB = await rollPoint(page, 6 * Q, 40);
  await page.mouse.click(emptyB.x, emptyB.y);
  await duplicateBar(page, 5);
  await header(page, 'ドラム').click();
  await page.getByRole('tab', { name: 'ドラム' }).click();
  await duplicateBar(page);
  // 6. 曲の形にする: rubber band from below the drums, ⌘D three times
  await page.getByTestId('arr-tool-select').click();
  const arr = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  await page.mouse.move(arr.x + 96 * 3 + 20, arr.y + arr.height - 6);
  await page.mouse.down();
  await page.mouse.move(arr.x + 96 - 6, arr.y + 50 + 4, { steps: 6 });
  await page.mouse.up();
  for (let i = 0; i < 3; i++) await page.keyboard.press(`${mod}+d`);

  // --- the result, per track: [tick, pitch, length, velocity]
  const smf = await exportedSmf(page);
  const notesOf = (i: number) => {
    const evs = smf.tracks[i].events.filter((e) => e.kind === 'channel');
    const open = new Map<number, [number, number]>();
    const out: number[][] = [];
    for (const e of evs) {
      if (e.kind !== 'channel') continue;
      const type = e.status & 0xf0;
      if (type === 0x90 && e.data[1] > 0) open.set(e.data[0], [e.tick, e.data[1]]);
      else if (type === 0x80 || (type === 0x90 && e.data[1] === 0)) {
        const o = open.get(e.data[0]);
        if (o) out.push([o[0], e.data[0], e.tick - o[0], o[1]]);
        open.delete(e.data[0]);
      }
    }
    return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  };
  const piano: number[][] = [], bass: number[][] = [], drums: number[][] = [];
  for (let bar = 0; bar < 8; bar++) {
    const t0 = bar * 4 * Q, isC = bar % 2 === 0;
    for (let beat = 0; beat < 4; beat++) {
      for (const p of isC ? [60, 64, 67] : [65, 69, 72]) piano.push([t0 + beat * Q, p, Q, 100]);
      bass.push([t0 + beat * Q, isC ? 36 : 41, Q, 100]);
    }
    drums.push([t0, 36, Q / 2, 110], [t0 + 2 * Q, 36, Q / 2, 110], [t0 + Q, 38, Q / 2, 110], [t0 + 3 * Q, 38, Q / 2, 110]);
    for (let i = 0; i < 8; i++) drums.push([t0 + (i * Q) / 2, 42, Q / 2, 85]);
  }
  const sortKey = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1];
  expect(notesOf(1)).toEqual(piano.sort(sortKey));
  expect(notesOf(2)).toEqual(bass.sort(sortKey));
  expect(notesOf(3)).toEqual([]); // guitar: nothing placed
  expect(notesOf(4)).toEqual(drums.sort(sortKey));
});
