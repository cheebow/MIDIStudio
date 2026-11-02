import { expect, test } from '@playwright/test';
import { build, cc, off, on, port, sysex, smf, tempo, trackBytes, GS_RESET, GS_RHYTHM_PART_11, type Ev } from '../fixtures/songs';
import { encodeGsDt1, partAddress, decodeGs } from '../../src/core/gs/gsSysex';
import { exportedSmf, importMidi, menu, startAudio } from './helpers';

const gsSong = () => build(1, 480, [tempo(0, 500000)], [sysex(0, GS_RESET), sysex(0, GS_RHYTHM_PART_11), sysex(0, encodeGsDt1(partAddress(0x19, 0), [100])), on(480, 0, 60), off(480, 0, 60)], [on(0, 10, 36), off(120, 10, 36)]);

test('GS: SysEx shown with meaning, Ch11 rhythm part shown as drums, value edit keeps a valid checksum', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, gsSong());
  await expect(page.getByTestId('track-header').nth(1)).toContainText('🥁');
  await page.getByRole('tab', { name: 'リスト' }).click();
  await expect(page.getByTestId('list-row').filter({ hasText: 'Use for Rhythm Part Ch11 = MAP2' })).toHaveCount(1);
  await menu(page, 'MIDI', /SysEx \/ イベントインスペクター/, 'GS / SysEx');
  const item = page.getByTestId('sysex-item').filter({ hasText: 'Part Level Ch1' });
  await expect(item).toContainText('処理する');
  const input = item.getByRole('spinbutton');
  await input.fill('64');
  await input.blur();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const out = await exportedSmf(page);
  const sx = out.tracks.flatMap((t) => t.events).filter((e) => e.kind === 'sysex').map((e) => decodeGs((e as { data: Uint8Array }).data)!);
  expect(sx.map((d) => d.text)).toEqual(['GS Reset', 'Use for Rhythm Part Ch11 = MAP2', 'Part Level Ch1 = 64']);
  expect(sx.every((d) => d.checksumOk)).toBe(true);
});

test('E13 / mixer / tempo: inspector, mixer and tempo track write real events that are exported', async ({ page }) => {
  await page.goto('/');
  const inspector = page.getByRole('complementary', { name: 'トラックインスペクター' });
  await inspector.getByRole('combobox').nth(3).selectOption('48'); // program 49 String Ensemble 1
  await inspector.getByRole('spinbutton').first().fill('8'); // bank MSB
  await page.getByRole('tab', { name: 'ミキサー' }).click();
  const vol = page.getByRole('slider', { name: 'ピアノ Volume' });
  await vol.focus();
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('tab', { name: 'コンダクター' }).click();
  const bpm = page.getByRole('textbox', { name: 'テンポの値' });
  await bpm.fill('150');
  await bpm.press('Enter');
  const out = await exportedSmf(page);
  const ch = out.tracks[1].events.filter((e) => e.kind === 'channel').map((e) => (e.kind === 'channel' ? [e.tick, e.status, ...e.data] : []));
  expect(ch).toEqual([[0, 0xb0, 0, 8], [0, 0xc0, 48], [0, 0xb0, 7, 99]]);
  const t = out.tracks[0].events.find((e) => e.kind === 'meta' && e.metaType === 0x51)!;
  const us = t.kind === 'meta' ? (t.data[0] << 16) | (t.data[1] << 8) | t.data[2] : 0;
  expect(us).toBe(400000);
});

test.describe('engine checks (Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'audio engine runs on Chromium');
  test('REQ-MIDI-06: a two-port song makes the synth create a second set of 16 channels', async ({ page }) => {
    await page.goto('/');
    await startAudio(page);
    await importMidi(page, build(1, 480, [port(0, 0), on(0, 0, 60), off(960, 0, 60)], [port(0, 1), on(0, 0, 64), off(960, 0, 64)]));
    await page.getByTestId('transport-play').click();
    await page.waitForTimeout(500);
    await page.getByTestId('transport-stop').click();
    await menu(page, 'ツール', /プロジェクト診断/);
    const text = await page.getByTestId('synth-channels').textContent();
    expect(Number(text!.replace(/\D/g, ''))).toBeGreaterThanOrEqual(32);
  });
});

/** Self-made load song: 32 tracks, ~100,000 MIDI messages, tempo changes and SysEx (TEST_PLAN 8). */
function loadSong(): Uint8Array {
  const conductor: Ev[] = [];
  for (let i = 0; i < 30; i++) conductor.push(tempo(i === 0 ? 0 : 480 * 4 * 30, 500000 - i * 2000));
  const tracks = [trackBytes(conductor)];
  for (let t = 0; t < 32; t++) {
    const ev: Ev[] = [sysex(0, GS_RESET)];
    const ch = t % 16 === 9 ? 10 : t % 16; // keep 32 separate tracks (two Ch10 drum tracks would be merged)
    for (let i = 0; i < 1050; i++) {
      ev.push(on(i === 0 ? 0 : 120, ch, 36 + ((i * 7 + t) % 48)), off(120, ch, 36 + ((i * 7 + t) % 48)));
      if (i % 2 === 0) ev.push(cc(0, ch, 11, i % 128));
    }
    tracks.push(trackBytes(ev));
  }
  return smf(1, 480, tracks);
}

test('performance: 32 tracks / ~100k messages — import, virtualised list, scrolling', async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const bytes = loadSong();
  const t0 = Date.now();
  await importMidi(page, bytes, 'load.mid');
  await expect(page.getByTestId('track-header')).toHaveCount(32);
  const importMs = Date.now() - t0;
  await page.getByRole('tab', { name: 'リスト' }).click();
  const domRows = await page.getByTestId('list-row').count();
  expect(domRows).toBeLessThan(200); // 1,576 events in the track, only visible rows in the DOM
  // Measure frames while scrolling the piano roll and the list.
  const fps = async (selector: string) =>
    page.evaluate(async (sel) => {
      const el = document.querySelector(sel) as HTMLElement;
      let frames = 0;
      let running = true;
      const count = () => {
        frames++;
        if (running) requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
      const start = performance.now();
      for (let i = 0; i < 60; i++) {
        el.scrollLeft += 40;
        el.scrollTop += 20;
        await new Promise((r) => requestAnimationFrame(r));
      }
      running = false;
      return (frames / (performance.now() - start)) * 1000;
    }, selector);
  const listFps = await fps('.list-scroll');
  await page.getByRole('tab', { name: 'ピアノロール' }).click();
  const rollFps = await fps('.roll-scroll');
  const arrFps = await fps('.arrangement-scroll');
  console.log(`[perf:${browserName}] import ${importMs} ms (incl. UI), list DOM rows ${domRows}, fps list ${listFps.toFixed(0)}, piano roll ${rollFps.toFixed(0)}, track view ${arrFps.toFixed(0)}`);
  expect(importMs).toBeLessThan(30_000);
});

test('mixer: knobs and the vertical fader write tick-0 CC events; double-click restores the default', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'ミキサー' }).click();
  const pan = page.getByRole('slider', { name: 'ピアノ Pan' });
  await pan.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  const fader = page.getByRole('slider', { name: 'ピアノ Volume' });
  const box = (await fader.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.5);
  await page.mouse.up();
  const rev = page.getByRole('slider', { name: 'ピアノ Reverb' });
  await rev.dblclick();
  const out = await exportedSmf(page);
  const cc = Object.fromEntries(out.tracks[1].events.filter((e) => e.kind === 'channel' && e.tick === 0).map((e) => (e.kind === 'channel' ? [e.data[0], e.data[1]] : [])));
  expect(cc[10]).toBe(68);
  expect(cc[7]).toBeGreaterThan(50);
  expect(cc[7]).toBeLessThan(80);
  expect(cc[91]).toBe(40); // reverb default via double-click
});

test.describe('mixer with the real engine (Chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'audio engine runs on Chromium');
  test('level meters light up while playing; a knob moved while playing does not stop or rewind playback', async ({ page }) => {
    await page.goto('/');
    await startAudio(page);
    // 16 bars of quarter notes (32 s at 120 BPM)
    const evs: Ev[] = [];
    for (let i = 0; i < 64; i++) evs.push(on(i === 0 ? 0 : 0, 0, 60 + (i % 8)), off(480, 0, 60 + (i % 8)));
    await importMidi(page, build(1, 480, evs));
    await page.getByRole('tab', { name: 'ミキサー' }).click();
    await page.getByTestId('transport-play').click();
    // some meter rises above the floor (the cover shrinks below 100 %)
    await expect
      .poll(async () => Math.min(...(await page.locator('.meter-cover').evaluateAll((els) => els.map((e) => parseFloat((e as HTMLElement).style.height || '100'))))), { timeout: 10_000 })
      .toBeLessThan(90);
    await page.waitForTimeout(1500);
    const clock = page.getByTestId('transport-position');
    const ticks = async () => {
      const [bar, beat, tick] = (await clock.textContent())!.trim().split(/\s+/)[0].split('.').map(Number);
      return (bar - 1) * 1920 + (beat - 1) * 480 + tick;
    };
    const before = await ticks();
    const pan = page.getByRole('slider', { name: /Pan$/ }).first();
    await pan.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    await pan.press('Home');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('transport-play')).toHaveAttribute('aria-label', '一時停止'); // still playing
    expect(await ticks()).toBeGreaterThan(before); // moved on, not rewound
    await page.getByTestId('transport-stop').click();
  });
});
