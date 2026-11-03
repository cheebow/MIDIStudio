import { expect, test } from '@playwright/test';
import { bend, build, off, on, program, smf, text, trackBytes } from '../fixtures/songs';
import { exportedSmf, importMidi, menu, rollPoint } from './helpers';

const notesOf = (smf: Awaited<ReturnType<typeof exportedSmf>>) =>
  smf.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0).map((e) => ({ tick: e.tick, pitch: e.kind === 'channel' ? e.data[0] : -1 }));

test('E01 / E10: draw C4 in the piano roll, export pitch 60; undo / redo', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tool-draw').click();
  const p = await rollPoint(page, 480, 60);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('dirty-state')).toHaveText('● 未保存');
  let smf = await exportedSmf(page);
  expect(notesOf(smf)).toEqual([{ tick: 480, pitch: 60 }]);

  await page.getByTestId('piano-roll-grid').focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  smf = await exportedSmf(page);
  expect(notesOf(smf)).toEqual([]);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
  smf = await exportedSmf(page);
  expect(notesOf(smf)).toEqual([{ tick: 480, pitch: 60 }]);
});

test('E10: drag-moving a note is one undo step; arrow keys transpose', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), off(480, 0, 60)]));
  const a = await rollPoint(page, 100, 60);
  const b = await rollPoint(page, 100 + 960, 62);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  await page.mouse.up();
  let smf = await exportedSmf(page);
  expect(notesOf(smf)).toEqual([{ tick: 960, pitch: 62 }]);
  await page.getByTestId('piano-roll-grid').focus();
  await page.keyboard.press('ArrowUp');
  smf = await exportedSmf(page);
  expect(notesOf(smf)).toEqual([{ tick: 960, pitch: 63 }]);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  smf = await exportedSmf(page);
  expect(notesOf(smf)).toEqual([{ tick: 0, pitch: 60 }]);
});

test('menu: Edit › 移調 submenu transposes the selected note', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tool-draw').click();
  const p = await rollPoint(page, 0, 60);
  await page.mouse.click(p.x, p.y); // drawn notes stay selected
  await menu(page, '編集', '+1 オクターブ', '移調');
  expect(notesOf(await exportedSmf(page))).toEqual([{ tick: 0, pitch: 72 }]);
});

test('E03: dragging a clip in the track view moves its events by whole beats', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60), off(480, 0, 60)]));
  const canvas = page.getByTestId('arrangement-canvas');
  const box = (await canvas.boundingBox())!;
  const y = box.y + 50 + 24; // first lane centre (ruler 24 + tempo lane 26)
  const x = box.x + 96 + 5; // 96 px: one bar of margin before bar 1
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 48, y);
  await page.mouse.move(x + 96, y); // 4 beats at 24 px per quarter = 1 bar
  await page.mouse.up();
  const smf = await exportedSmf(page);
  expect(notesOf(smf)).toEqual([{ tick: 1920, pitch: 60 }]);
});

test('layout: the bottom editor can be resized and collapsed; the controller lane too (saved in settings)', async ({ page }) => {
  await page.goto('/');
  const panel = page.getByRole('region', { name: 'エディター' });
  const before = (await panel.boundingBox())!.height;
  const sp = page.getByRole('separator', { name: '下部エディターの高さ' });
  const b = (await sp.boundingBox())!;
  await page.mouse.move(b.x + 200, b.y + 3);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y - 80);
  await page.mouse.up();
  expect((await panel.boundingBox())!.height).toBeGreaterThan(before + 60);
  await page.getByTestId('editor-collapse').click();
  await expect(page.getByTestId('piano-roll-grid')).toHaveCount(0);
  await page.getByRole('tab', { name: 'ピアノロール' }).click(); // a tab click opens it again
  await expect(page.getByTestId('piano-roll-grid')).toBeVisible();
  await page.getByRole('button', { name: 'レーンを折り畳む' }).click();
  await expect(page.locator('.lane-canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'レーンを開く' }).click();
});

test('track view: the track names scroll together with the lanes', async ({ page }) => {
  await page.goto('/');
  const { smf, trackBytes } = await import('../fixtures/songs');
  const tracks = Array.from({ length: 24 }, (_, t) => trackBytes([on(0, t % 16, 60), off(480, t % 16, 60)]));
  await page.getByTestId('midi-input').setInputFiles({ name: 'many.mid', mimeType: 'audio/midi', buffer: Buffer.from(smf(1, 480, tracks)) });
  const scroller = page.locator('.arrangement-scroll');
  await scroller.evaluate((el) => (el.scrollTop = 240));
  await expect(page.getByTestId('track-header').nth(5)).toBeInViewport();
  const header = (await page.getByTestId('track-header').nth(5).boundingBox())!;
  const canvas = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  // header 6 (index 5) sits right below the ruler + tempo lane after scrolling 5 lanes (5 x 48 = 240 px)
  expect(Math.round(header.y - canvas.y)).toBe(50);
  // wheel over the names scrolls the lanes
  await page.getByTestId('track-header').nth(5).hover();
  await page.mouse.wheel(0, 96);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(336);
});

test('moving the seek bar pages the piano roll and the track view to the bar of the playhead', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60), off(480, 0, 60), on(1920 * 39, 0, 62), off(480, 0, 62)]));
  await expect(page.getByTestId('track-header')).toHaveCount(1);
  // click the seek bar inside bar 31 (ADR-053: a canvas strip; data-end-tick gives its range)
  const bar = page.getByTestId('seek-bar');
  const box = (await bar.boundingBox())!;
  const endTick = Number(await bar.getAttribute('data-end-tick'));
  await page.mouse.click(box.x + (box.width * (1920 * 30 + 700)) / endTick, box.y + box.height / 2);
  await expect(page.getByTestId('transport-position')).toHaveText(/^031\./);
  const barStart = 1920 * 30;
  await expect.poll(() => page.locator('.roll-scroll').evaluate((el) => el.scrollLeft)).toBe(Math.round((barStart * 80) / 480));
  await expect.poll(() => page.locator('.arrangement-scroll').evaluate((el) => el.scrollLeft)).toBe(Math.round((barStart * 24) / 480));
  // a manual scroll while stopped is not undone (after the 1.5 s follow window armed by the seek)
  await page.waitForTimeout(1700);
  await page.locator('.roll-scroll').evaluate((el) => (el.scrollLeft = 0));
  await page.waitForTimeout(200);
  expect(await page.locator('.roll-scroll').evaluate((el) => el.scrollLeft)).toBe(0);
});

const bendsOf = (smf: Awaited<ReturnType<typeof exportedSmf>>) => smf.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0xe0);

test('ADR-040: Pitch Bend lane: a click selects a point, a drag on empty space selects a box, Delete removes the selection', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [program(0, 0, 0), on(0, 0, 60), bend(480, 0, 0), bend(480, 0, 4000), bend(480, 0, -4000), off(480, 0, 60)]));
  await page.locator('select.lane-select').selectOption('pitch-bend');
  const lane = page.locator('.lane-canvas');
  const box = (await lane.boundingBox())!;
  const xOf = (tick: number) => box.x + 320 + (tick * 80) / 480; // piano roll: 80 px per quarter, one bar of margin, scrolled to 0
  const yOf = (value: number) => box.y + box.height - 4 - ((value + 8192) / 16383) * (box.height - 8);
  // click the point at tick 480 (value 0) and delete it
  await page.mouse.click(xOf(480), yOf(0));
  await page.keyboard.press('Delete');
  expect(bendsOf(await exportedSmf(page)).map((e) => e.tick)).toEqual([960, 1440]);
  // box over ticks 720..1560 and the whole value range: both remaining points
  await page.mouse.move(xOf(720), box.y + 3);
  await page.mouse.down();
  await page.mouse.move(xOf(1200), box.y + 30);
  await page.mouse.move(xOf(1560), box.y + box.height - 3);
  await page.mouse.up();
  await page.keyboard.press('Delete');
  const out = await exportedSmf(page);
  expect(bendsOf(out)).toEqual([]);
  expect(notesOf(out)).toEqual([{ tick: 0, pitch: 60 }]); // the note is untouched
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  expect(bendsOf(await exportedSmf(page)).map((e) => e.tick)).toEqual([960, 1440]); // one undo step for the box deletion
});

test('ADR-040: dragging a clip edge changes the clip range; notes are not moved, those outside leave the clip', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60), off(480, 0, 60), on(480, 0, 62), off(480, 0, 62)])); // notes at 0 and 960, clip 0..1440
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const y = box.y + 50 + 24; // first lane centre (ruler 24 + tempo lane 26)
  const x0 = box.x + 96; // bar 1 starts after one bar of margin
  await page.mouse.move(x0 + 1, y); // on the start edge
  await page.mouse.down();
  await page.mouse.move(x0 + 24, y);
  await page.mouse.move(x0 + 48, y); // 2 beats at 24 px per quarter → tick 960
  await page.mouse.up();
  // nothing moved, but the first note is outside every clip now: silent, so the export leaves it out (ADR-064)
  expect(notesOf(await exportedSmf(page))).toEqual([{ tick: 960, pitch: 62 }]);
  await expect(page.getByTestId('status-info')).toContainText('クリップの外にあるノート 1 個');
  await page.getByRole('button', { name: 'トラック', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'クリップの外のノートを削除（1 個）' })).toBeVisible();
  await page.keyboard.press('Escape');
  // the clip is 960..1440 and holds only the second note: deleting it leaves the (silent) first note
  await page.mouse.click(x0 + 60, y);
  await page.keyboard.press('Delete');
  expect(notesOf(await exportedSmf(page))).toEqual([]);
  // Track › delete the notes outside clips removes it for good; Undo brings it back
  await menu(page, 'トラック', 'クリップの外のノートを削除（1 個）');
  await page.getByRole('button', { name: 'トラック', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'クリップの外のノートを削除（0 個）' })).toBeDisabled();
  await page.keyboard.press('Escape');
});

test('ADR-040: tracks are reordered by dragging a header or with Alt+↑↓; the exported SMF follows', async ({ page }) => {
  await page.goto('/');
  const tracks = ['Piano', 'Bass', 'Drums'].map((name, i) => trackBytes([text(0, 3, name), on(0, i, 60), off(480, i, 60)]));
  await importMidi(page, smf(1, 480, tracks), 'three.mid');
  const headers = page.getByTestId('track-header');
  const names = () => headers.locator('.track-name').allTextContents();
  expect(await names()).toEqual(['Piano', 'Bass', 'Drums']);
  const grip = (await headers.nth(0).locator('.track-grip').boundingBox())!;
  const h0 = (await headers.nth(0).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 30);
  await page.mouse.move(grip.x + grip.width / 2, h0.y + h0.height * 2 + 10); // below the second header
  await expect(page.locator('.track-drop-line')).toBeVisible();
  await page.mouse.up();
  await expect.poll(names).toEqual(['Bass', 'Piano', 'Drums']);
  await expect(page.locator('.track-header.dragging')).toHaveCount(0);
  // pressing the name (not the grip) does not start a drag
  const n1 = (await headers.nth(1).locator('.track-name').boundingBox())!;
  await page.mouse.move(n1.x + 5, n1.y + 5);
  await page.mouse.down();
  await page.mouse.move(n1.x + 5, n1.y + 60);
  await page.mouse.up();
  await expect.poll(names).toEqual(['Bass', 'Piano', 'Drums']);
  await headers.nth(1).click(); // Piano
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(names).toEqual(['Bass', 'Drums', 'Piano']);
  await page.keyboard.press('Alt+ArrowDown'); // already last: nothing happens
  await expect.poll(names).toEqual(['Bass', 'Drums', 'Piano']);
  const out = await exportedSmf(page);
  const smfNames = out.tracks.map((t) => t.events.find((e) => e.kind === 'meta' && e.metaType === 3)).map((e) => (e && e.kind === 'meta' ? new TextDecoder().decode(e.data) : null));
  expect(smfNames.slice(1)).toEqual(['Bass', 'Drums', 'Piano']); // track 0 is the conductor track
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect.poll(names).toEqual(['Piano', 'Bass', 'Drums']);
});

test('ADR-040: a header drag held at the top edge scrolls the list, so the last track can be dropped first; Escape cancels', async ({ page }) => {
  await page.goto('/');
  const tracks = Array.from({ length: 24 }, (_, t) => trackBytes([text(0, 3, `T${String(t + 1).padStart(2, '0')}`), on(0, t % 16, 60), off(480, t % 16, 60)]));
  await importMidi(page, smf(1, 480, tracks), 'many.mid');
  const scroller = page.locator('.arrangement-scroll');
  const headers = page.getByTestId('track-header');
  const names = () => headers.locator('.track-name').allTextContents();
  // The first user gesture starts the sound engine and the setup bar goes away, which moves the
  // header list; do that first and wait until the layout stays put, so the pointer held at the top
  // edge stays in the auto-scroll zone during the drag.
  await page.locator('.statusbar').click();
  const clipBox = () => page.locator('.track-headers-clip').boundingBox();
  let clip = (await clipBox())!;
  for (let i = 0, stable = 0; i < 30 && stable < 3; i++) {
    await page.waitForTimeout(500);
    const now = (await clipBox())!;
    stable = now.y === clip.y && now.height === clip.height ? stable + 1 : 0;
    clip = now;
  }
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(headers.nth(23)).toBeInViewport();
  const before = await names(); // the import orders tracks by channel, so read the names as shown
  const grip = (await headers.nth(23).locator('.track-grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 - 20);
  await page.mouse.move(grip.x + grip.width / 2, clip.y + 4); // hold in the top edge zone: the list scrolls up by itself
  // keep the pointer in the zone even if the layout still shifts (engine start under load)
  await expect
    .poll(async () => {
      const c = (await clipBox())!;
      await page.mouse.move(grip.x + grip.width / 2, c.y + 4);
      return scroller.evaluate((el) => el.scrollTop);
    }, { timeout: 20_000 })
    .toBe(0);
  await page.mouse.up();
  await expect.poll(async () => (await names()).slice(0, 2), { timeout: 10_000 }).toEqual([before[23], before[0]]);
  // Escape cancels a drag in progress without moving anything
  const g0 = (await headers.nth(0).locator('.track-grip').boundingBox())!;
  await page.mouse.move(g0.x + g0.width / 2, g0.y + g0.height / 2);
  await page.mouse.down();
  await page.mouse.move(g0.x + g0.width / 2, g0.y + 100);
  await expect(page.locator('.track-header.dragging')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.track-header.dragging')).toHaveCount(0);
  await page.mouse.up();
  expect((await names()).slice(0, 2)).toEqual([before[23], before[0]]);
});

test('ADR-071: a header drag held at the bottom edge scrolls down to the end, so the first track can be dropped last', async ({ page }) => {
  await page.goto('/');
  const tracks = Array.from({ length: 24 }, (_, t) => trackBytes([text(0, 3, `T${String(t + 1).padStart(2, '0')}`), on(0, t % 16, 60), off(480, t % 16, 60)]));
  await importMidi(page, smf(1, 480, tracks), 'many.mid');
  const scroller = page.locator('.arrangement-scroll');
  const headers = page.getByTestId('track-header');
  const names = () => headers.locator('.track-name').allTextContents();
  await page.locator('.statusbar').click(); // start the engine first: the setup bar going away moves the list
  await page.waitForTimeout(1000);
  const clipBox = () => page.locator('.track-headers-clip').boundingBox();
  const before = await names();
  const grip = (await headers.nth(0).locator('.track-grip').boundingBox())!;
  const x = grip.x + grip.width / 2;
  await page.mouse.move(x, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, grip.y + grip.height / 2 + 20);
  await expect
    .poll(async () => {
      const c = (await clipBox())!;
      await page.mouse.move(x, c.y + c.height - 4); // hold in the bottom edge zone
      return scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
    }, { timeout: 20_000 })
    .toBeLessThan(1);
  await page.mouse.up();
  await expect.poll(async () => (await names()).at(-1), { timeout: 10_000 }).toBe(before[0]);
  expect((await names()).slice(0, 23)).toEqual(before.slice(1));
});

test('ADR-043: the quantize dialog applies note value, shuffle-free strength and length rounding to the track; its values are kept', async ({ page }) => {
  await page.goto('/');
  // notes at 10 and 250 (PPQ 480), both 100 ticks long
  await importMidi(page, build(1, 480, [on(10, 0, 60), off(100, 0, 60), on(140, 0, 62), off(100, 0, 62)]));
  await menu(page, '編集', /^クオンタイズ…/, /^ノート$/);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: /のすべてのノート（2 個）/ })).toBeChecked(); // nothing selected: the track
  await dialog.getByLabel('音符').selectOption('8:straight');
  await dialog.getByRole('radio', { name: /長さをグリッドの倍数に揃える/ }).check();
  await dialog.getByTestId('quantize-apply').click();
  await expect(dialog).toHaveCount(0);
  const out = await exportedSmf(page);
  const evs = out.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'channel' && ((e.status & 0xf0) === 0x90 || (e.status & 0xf0) === 0x80));
  const onOff = evs.map((e) => (e.kind === 'channel' ? `${e.tick}:${(e.status & 0xf0) === 0x90 && e.data[1] > 0 ? 'on' : 'off'}` : '')).sort();
  expect(onOff).toEqual(['0:on', '240:off', '240:on', '480:off']); // onsets 0 / 240 (1/8), lengths rounded up to one grid (240)
  // one undo step
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  expect(notesOf(await exportedSmf(page))).toEqual([{ tick: 10, pitch: 60 }, { tick: 250, pitch: 62 }]);
  // the dialog remembers its values (saved with the project); ⇧Q opens it
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+q');
  await expect(page.getByRole('dialog').getByLabel('音符')).toHaveValue('8:straight');
  await expect(page.getByRole('dialog').getByRole('radio', { name: /長さをグリッドの倍数に揃える/ })).toBeChecked();
  await page.getByRole('button', { name: 'キャンセル' }).click();
});

test('ADR-050: the velocity dialog ramps the track; the humanize dialog moves notes within its ranges', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60), off(480, 0, 60), on(0, 0, 62), off(480, 0, 62), on(0, 0, 64), off(480, 0, 64)])); // notes at 0 / 480 / 960
  await menu(page, '編集', /^ベロシティ…/, /^ノート$/);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /傾斜/ }).check();
  await dialog.getByLabel('始点').fill('40');
  await dialog.getByLabel('終点').fill('100');
  await dialog.getByTestId('velocity-apply').click();
  const vel = (smf: Awaited<ReturnType<typeof exportedSmf>>) => smf.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'channel' && (e.status & 0xf0) === 0x90 && e.data[1] > 0).map((e) => (e.kind === 'channel' ? e.data[1] : -1));
  expect(vel(await exportedSmf(page))).toEqual([40, 70, 100]);
  await menu(page, '編集', /^ヒューマナイズ…/, /^ノート$/);
  await page.getByRole('dialog').getByLabel('位置（ Tick）').fill('0');
  await page.getByRole('dialog').getByLabel('長さ（%）').fill('0');
  await page.getByRole('dialog').getByLabel('ベロシティ（）').fill('5');
  await page.getByRole('dialog').getByTestId('humanize-apply').click();
  const v2 = vel(await exportedSmf(page));
  expect(v2.map((v, i) => Math.abs(v - [40, 70, 100][i]) <= 5)).toEqual([true, true, true]);
  expect(notesOf(await exportedSmf(page)).map((n) => n.tick)).toEqual([0, 480, 960]); // timing range 0: onsets untouched
});
