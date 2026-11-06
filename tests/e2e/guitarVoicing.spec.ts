// Guitar-voicing input assistant (ADR-091, TEST_PLAN E-GTR-*): opened from the piano roll and the
// list editor (右クリック › 入力支援 › ギターボイシング › コードを 1 つ入力…), with and without a detected chord.
import { expect, test, type Page } from '@playwright/test';
import { build, off, on, timeSig } from '../fixtures/songs';
import { exportedSmf, importMidi, menu, rollPoint, startAudio } from './helpers';
import type { SmfFile } from '../../src/core/smf/types';

const Q = 480;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** note-ons as [tick, pitch], sorted */
const noteOns = (smf: SmfFile) =>
  smf.tracks
    .flatMap((t) => t.events)
    .filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0)
    .map((e) => [e.tick, e.kind === 'channel' ? e.data[0] : -1])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
/** note-offs (0x80 or note-on velocity 0) as [tick, pitch], sorted */
const noteOffs = (smf: SmfFile) =>
  smf.tracks
    .flatMap((t) => t.events)
    .filter((e) => e.kind === 'channel' && ((e.status & 0xf0) === 0x80 || ((e.status & 0xf0) === 0x90 && e.data[1] === 0)))
    .map((e) => [e.tick, e.kind === 'channel' ? e.data[0] : -1])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const at = (tick: number, pitches: number[]) => pitches.map((p) => [tick, p]);

async function openFromMenu(page: Page) {
  const ctx = page.getByTestId('context-menu');
  await expect(ctx).toBeVisible();
  await ctx.getByRole('menuitem', { name: '入力支援' }).hover();
  await ctx.getByRole('menuitem', { name: 'ギターボイシング', exact: true }).hover();
  await ctx.getByRole('menuitem', { name: 'コードを 1 つ入力…' }).click();
  await expect(page.getByTestId('guitar-voicing-dialog')).toBeVisible();
}

async function openFromRoll(page: Page, tick: number, pitch = 60) {
  // bring the pitch row into view (a few rows below the top), and let the roll read the scroll event
  await page.locator('.roll-scroll').evaluate((el, top) => (el.scrollTop = top), (127 - pitch) * 12 - 120);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const p = await rollPoint(page, tick, pitch);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await openFromMenu(page);
}

async function undoDisabled(page: Page): Promise<boolean> {
  await page.getByRole('button', { name: '編集', exact: true }).click();
  const item = page.getByRole('menuitem', { name: /^元に戻す/ });
  const disabled = (await item.getAttribute('aria-disabled')) === 'true' || (await item.isDisabled());
  await page.keyboard.press('Escape');
  return disabled;
}

// Cmaj7 for bar 1 on the piano (plus a short E5 at beat 2), G7 in bar 2
const cmaj7Song = () =>
  build(
    1,
    Q,
    [timeSig(0, 4, 2)],
    [
      ...[48, 52, 55, 59, 64].map((p) => on(0, 0, p)),
      on(Q, 0, 76),
      off(Q / 2, 0, 76),
      off(Q * 2.5, 0, 48),
      ...[52, 55, 59, 64].map((p) => off(0, 0, p)),
      ...[43, 47, 50, 53].map((p) => on(0, 0, p)),
      off(Q * 4, 0, 43),
      ...[47, 50, 53].map((p) => off(0, 0, p)),
    ],
  );

test('E-GTR-01: empty song, piano roll: typed and picked Cmaj7 give the same forms; x32000 inserts 48 52 55 59 64 for one bar', async ({ page }) => {
  await page.goto('/');
  await openFromRoll(page, Q * 4); // bar 2, empty space
  const chord = page.getByTestId('gv-chord');
  await expect(chord).toHaveValue('');
  await expect(chord).toBeFocused();
  await expect(page.getByTestId('gv-insert')).toBeDisabled();
  await expect(page.getByTestId('gv-tick')).toHaveValue('002.01.000');
  // picked: root C + type maj7
  await page.getByTestId('gv-root').selectOption('0');
  await page.getByTestId('gv-quality').selectOption('maj7');
  await expect(chord).toHaveValue('Cmaj7');
  const forms = page.getByTestId('gv-form');
  const picked = await forms.evaluateAll((els) => els.map((e) => e.getAttribute('data-frets')));
  expect(picked).toEqual(expect.arrayContaining(['x32000', 'x35453', '8-10-9-9-8-8']));
  // typed: CM7 is the same chord, same forms
  await chord.fill('CM7');
  expect(await forms.evaluateAll((els) => els.map((e) => e.getAttribute('data-frets')))).toEqual(picked);
  // the first form (the open one) is chosen from the start
  await expect(page.locator('[data-testid="gv-form"][data-frets="x32000"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-testid="gv-form"][data-frets="x35453"]').click();
  await expect(page.locator('[data-testid="gv-form"][data-frets="x35453"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-testid="gv-form"][data-frets="x32000"]').click();
  await expect(page.getByTestId('gv-pitches')).toContainText('C3 E3 G3 B3 E4');
  await expect(page.getByTestId('gv-length')).toHaveText('1920 Tick');
  await page.getByTestId('gv-insert').click();
  await expect(page.getByTestId('guitar-voicing-dialog')).toBeHidden();
  const smf = await exportedSmf(page);
  expect(noteOns(smf)).toEqual(at(Q * 4, [48, 52, 55, 59, 64]));
  expect(noteOffs(smf)).toEqual(at(Q * 8, [48, 52, 55, 59, 64]));
  // one undo step
  await page.keyboard.press(`${mod}+z`);
  expect(noteOns(await exportedSmf(page))).toEqual([]);
  await page.keyboard.press(`${mod}+Shift+z`);
  expect(noteOns(await exportedSmf(page))).toEqual(at(Q * 4, [48, 52, 55, 59, 64]));
});

test('E-GTR-02: the tick is the right-click (not the playhead); cancel and preview change nothing', async ({ page }) => {
  await page.goto('/');
  await startAudio(page);
  // playhead to bar 3 from the ruler, then right-click bar 1 beat 3
  const ruler = await rollPoint(page, Q * 8, 60);
  const grid = (await page.getByTestId('piano-roll-grid').boundingBox())!;
  await page.mouse.click(ruler.x, grid.y + 8, { button: 'right' });
  await page.getByRole('menuitem', { name: '再生位置をここに移動' }).click();
  await openFromRoll(page, Q * 2);
  await expect(page.getByTestId('gv-tick')).toHaveValue('001.03.000');
  await page.getByTestId('gv-chord').fill('Am');
  await page.locator('[data-testid="gv-form"][data-frets="x02210"]').click();
  // preview: sounds on the preview synth only
  const previewBtn = page.getByTestId('gv-preview');
  await expect(previewBtn).toBeEnabled();
  await previewBtn.click();
  await previewBtn.click(); // again before the first one ends
  // cancel: nothing written, nothing to undo
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.getByTestId('guitar-voicing-dialog')).toBeHidden();
  expect(noteOns(await exportedSmf(page))).toEqual([]);
  expect(await undoDisabled(page)).toBe(true);
  // Esc closes it the same way
  await openFromRoll(page, Q * 2);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('guitar-voicing-dialog')).toBeHidden();
  expect(await undoDisabled(page)).toBe(true);
  // inserting goes to the right-clicked tick, not the playhead
  await openFromRoll(page, Q * 2);
  await page.getByTestId('gv-chord').fill('Am');
  await page.locator('[data-testid="gv-form"][data-frets="x02210"]').click();
  await page.getByTestId('gv-insert').click();
  expect(noteOns(await exportedSmf(page))).toEqual(at(Q * 2, [45, 52, 57, 60, 64]));
});

test('E-GTR-03: empty list editor: the empty area opens it at the cursor row (a note row: E-GTR-04)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'リスト' }).click();
  // right-click below the rows: the cursor is on the first row (tick 0)
  const scroll = page.locator('.list-scroll');
  const box = (await scroll.boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + box.height - 10, { button: 'right' });
  await openFromMenu(page);
  await expect(page.getByTestId('gv-chord')).toBeFocused();
  await expect(page.getByTestId('gv-tick')).toHaveValue('001.01.000');
  await page.getByTestId('gv-chord').fill('G7');
  await page.locator('[data-testid="gv-form"][data-frets="320001"]').click();
  await page.getByTestId('gv-insert').click();
  expect(noteOns(await exportedSmf(page))).toEqual(at(0, [43, 47, 50, 55, 59, 65]));
});

test('E-GTR-04: a detected Cmaj7 fills the chord and the rest of its span in both editors; changing it keeps the song; new track is one undo', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, cmaj7Song());
  const grid = page.getByTestId('piano-roll-grid');
  await expect(grid).toHaveAttribute('data-chords', 'Cmaj7 G7');
  const before = noteOns(await exportedSmf(page));
  const tracksBefore = (await exportedSmf(page)).tracks.length;

  // piano roll, on a note, beat 2: Cmaj7 to the end of bar 1 (1440 ticks)
  await openFromRoll(page, Q, 52);
  await expect(page.getByTestId('gv-chord')).toHaveValue('Cmaj7');
  await expect(page.getByTestId('gv-from-analysis')).toBeVisible();
  await expect(page.getByTestId('gv-length')).toHaveText('1440 Tick');
  await expect(page.getByTestId('gv-tick')).toHaveValue('001.02.000');
  // change it to Am7 and insert into a new guitar track
  await page.getByTestId('gv-chord').fill('Am7');
  await expect(page.getByTestId('gv-from-analysis')).toBeHidden();
  await page.getByTestId('gv-form').first().click();
  await page.getByTestId('gv-target').selectOption({ label: '新規ギタートラック（挿入時に作成）' });
  await page.getByTestId('gv-insert').click();
  let smf = await exportedSmf(page);
  expect(smf.tracks.length).toBe(tracksBefore + 1);
  // the original notes are untouched; the new ones start at beat 2 and end with bar 1
  const added = noteOns(smf).filter((n) => !before.some((b) => b[0] === n[0] && b[1] === n[1]));
  expect(added.every((n) => n[0] === Q)).toBe(true);
  expect(added.map((n) => n[1] % 12).sort()).toEqual(expect.arrayContaining([0, 4, 7, 9]));
  expect(noteOns(smf).filter((n) => before.some((b) => b[0] === n[0] && b[1] === n[1]))).toEqual(before);
  // undo removes the track and its notes in one step, redo brings them back
  await page.keyboard.press(`${mod}+z`);
  smf = await exportedSmf(page);
  expect(smf.tracks.length).toBe(tracksBefore);
  expect(noteOns(smf)).toEqual(before);
  await page.keyboard.press(`${mod}+Shift+z`);
  smf = await exportedSmf(page);
  expect(smf.tracks.length).toBe(tracksBefore + 1);
  await page.keyboard.press(`${mod}+z`);

  // list editor: the E5 row at beat 2 gives the same chord and length
  await page.getByRole('tab', { name: 'リスト' }).click();
  const row = page.getByTestId('list-row').filter({ has: page.locator('[data-col="name"]', { hasText: /^E5$/ }) }).first();
  await row.click({ button: 'right' });
  await openFromMenu(page);
  await expect(page.getByTestId('gv-chord')).toHaveValue('Cmaj7');
  await expect(page.getByTestId('gv-length')).toHaveText('1440 Tick');
});

test('E-GTR-05: with chord names off, manual entry works; bad / unregistered / slash chords never insert', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, cmaj7Song());
  await menu(page, '表示', 'コード名（推定）');
  await openFromRoll(page, Q, 52);
  const chord = page.getByTestId('gv-chord');
  await expect(chord).toHaveValue('');
  await expect(chord).toBeFocused();
  const insert = page.getByTestId('gv-insert');
  await chord.fill('H7');
  await expect(page.getByTestId('gv-chord-problem')).toContainText('読み取れません');
  await expect(insert).toBeDisabled();
  await chord.fill('Csus4');
  await expect(page.getByTestId('gv-chord-problem')).toContainText('登録フォームはありません');
  await expect(insert).toBeDisabled();
  await chord.fill('Am7/E');
  await expect(page.getByTestId('gv-chord-problem')).toContainText('ベース音');
  await expect(insert).toBeDisabled();
  // the user may choose to ignore the bass: Am7 forms, those with an E first
  await page.getByTestId('gv-ignore-bass').click();
  await expect(page.getByTestId('gv-bass-ignored')).toBeVisible();
  await expect(page.getByTestId('gv-form').first()).toHaveAttribute('aria-checked', 'true');
  await expect(insert).toBeEnabled();
  // changing the chord drops the chosen form (and the ignored bass): the new chord's first form is chosen
  await chord.fill('Am');
  await page.getByTestId('gv-form').nth(1).click();
  await chord.fill('Em');
  await expect(page.getByTestId('gv-form').first()).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('gv-pitches')).toContainText('E2 B2 E3 G3 B3 E4');
});

async function openProgressionFromRoll(page: Page, tick: number, pitch = 60) {
  await page.locator('.roll-scroll').evaluate((el, top) => (el.scrollTop = top), (127 - pitch) * 12 - 120);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const p = await rollPoint(page, tick, pitch);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const ctx = page.getByTestId('context-menu');
  await ctx.getByRole('menuitem', { name: '入力支援' }).hover();
  await ctx.getByRole('menuitem', { name: 'ギターボイシング', exact: true }).hover();
  await ctx.getByRole('menuitem', { name: 'コード進行を入力…' }).click();
  await expect(page.getByTestId('guitar-progression-dialog')).toBeVisible();
}

test('E-GTR-06: a typed progression goes in as one undo step; a chord without forms is shown and left out', async ({ page }) => {
  await page.goto('/');
  await openProgressionFromRoll(page, Q * 4);
  const text = page.getByTestId('gp-text');
  // no chord names in an empty song: the hand entry is open and focused
  await expect(text).toBeFocused();
  // bar 2 is inside the default loop (bars 1-4): the range opens on the loop; take the right-click instead
  await expect(page.getByTestId('gp-start')).toHaveValue('001.01.000');
  await page.getByTestId('gp-range-click').click();
  await expect(page.getByTestId('gp-start')).toHaveValue('002.01.000');
  await expect(page.getByTestId('gp-end')).toHaveValue('006.01.000');
  await text.fill('C | G7 Csus4');
  await text.press('Enter');
  await expect(page.getByTestId('gp-row')).toHaveCount(3);
  await expect(page.getByTestId('gp-problem')).toHaveCount(1);
  await expect(page.getByTestId('gp-skipped')).toBeVisible();
  // the open forms are chosen first
  await expect(page.getByTestId('gp-form').first()).toHaveAttribute('data-frets', 'x32010');
  await expect(page.getByTestId('gp-insert')).toHaveText('挿入（2 コード）');
  // typed rows use only the start of the range: a cleared end does not block them (review fix)
  await page.getByTestId('gp-end').fill('');
  await expect(page.getByTestId('gp-insert')).toBeEnabled();
  await page.getByTestId('gp-insert').click();
  await expect(page.getByTestId('guitar-progression-dialog')).toBeHidden();
  const smf = await exportedSmf(page);
  expect(noteOns(smf)).toEqual([...at(Q * 4, [48, 52, 55, 60, 64]), ...at(Q * 8, [43, 47, 50, 55, 59, 65])]);
  expect(noteOffs(smf)).toEqual([...at(Q * 8, [48, 52, 55, 60, 64]), ...at(Q * 10, [43, 47, 50, 55, 59, 65])]);
  await page.keyboard.press(`${mod}+z`);
  expect(noteOns(await exportedSmf(page))).toEqual([]);
});

test('E-GTR-07: the chords of the strip over the loop range go in at once; the range can be changed; into a new guitar track', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, cmaj7Song());
  const tracksBefore = (await exportedSmf(page)).tracks.length;
  // right-click in bar 2 (inside the loop, bars 1-4): every detected chord of the loop is laid out
  await openProgressionFromRoll(page, Q * 5, 52);
  await expect(page.getByTestId('gp-start')).toHaveValue('001.01.000');
  await expect(page.getByTestId('gp-chord')).toHaveCount(2);
  await expect(page.getByTestId('gp-chord').nth(0)).toHaveValue('Cmaj7');
  await expect(page.getByTestId('gp-chord').nth(1)).toHaveValue('G7');
  await expect(page.getByTestId('gp-form').nth(0)).toHaveAttribute('data-frets', 'x32000');
  await expect(page.getByTestId('gp-insert')).toHaveText('挿入（2 コード）');
  // only the first bar
  await page.getByTestId('gp-end').fill('2');
  await expect(page.getByTestId('gp-chord')).toHaveCount(1);
  await page.getByTestId('gp-range-loop').click();
  await expect(page.getByTestId('gp-chord')).toHaveCount(2);
  await page.getByTestId('gp-end').fill('2');
  await page.getByTestId('gv-target').selectOption({ label: '新規ギタートラック（挿入時に作成）' });
  await page.getByTestId('gp-insert').click();
  const smf = await exportedSmf(page);
  expect(smf.tracks.length).toBe(tracksBefore + 1);
  await page.keyboard.press(`${mod}+z`);
  expect((await exportedSmf(page)).tracks.length).toBe(tracksBefore);
});
