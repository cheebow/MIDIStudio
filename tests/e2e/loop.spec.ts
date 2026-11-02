import { expect, test } from '@playwright/test';
import { build, off, on } from '../fixtures/songs';
import { importMidi } from './helpers';

const loopInputs = (page: import('@playwright/test').Page) => page.locator('.transport .bar-input');

test('ADR-053: the loop range is dragged on the track-view ruler: an end resizes, the band moves (bar snap)', async ({ page }) => {
  await page.goto('/');
  await importMidi(page, build(1, 480, [on(0, 0, 60), off(480, 0, 60)]));
  await loopInputs(page).nth(1).fill('5'); // 1〜5 (ticks 0..7680); the import had set the loop to the song's length
  await expect(loopInputs(page).nth(1)).toHaveValue('5');
  const box = (await page.getByTestId('arrangement-canvas').boundingBox())!;
  const xOf = (tick: number) => box.x + 96 + (tick * 24) / 480; // 24 px per quarter after the one-bar margin
  const y = box.y + 10; // ruler
  // end edge: bar 5 → bar 7
  await page.mouse.move(xOf(7680), y);
  await page.mouse.down();
  await page.mouse.move(xOf(7680) + 100, y);
  await page.mouse.move(xOf(7680 + 1920 * 2), y);
  await page.mouse.up();
  await expect(loopInputs(page).nth(1)).toHaveValue('7');
  await expect(loopInputs(page).nth(0)).toHaveValue('1');
  // band: the handle strip at the bottom of the ruler moves the range by one bar; a click higher up seeks
  const strip = box.y + 24 - 3;
  await page.mouse.move(xOf(3000), strip);
  await page.mouse.down();
  await page.mouse.move(xOf(3000) + 50, strip);
  await page.mouse.move(xOf(3000 + 1920), strip);
  await page.mouse.up();
  await expect(loopInputs(page).nth(0)).toHaveValue('2');
  await expect(loopInputs(page).nth(1)).toHaveValue('8');
  // start edge with Shift snaps to beats: bar 2 beat 1 → bar 2 beat 3 (not a bar line)
  await page.keyboard.down('Shift');
  await page.mouse.move(xOf(1920), y);
  await page.mouse.down();
  await page.mouse.move(xOf(1920) + 20, y);
  await page.mouse.move(xOf(1920 + 960), y);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(loopInputs(page).nth(0)).toHaveValue('2'); // the bar inputs show bars; the exact tick is in the export
  await page.mouse.click(xOf(1920 * 4 + 480), y); // inside the loop but above the strip: seeks
  await expect(page.getByTestId('transport-position')).toHaveText('005.02.000');
});

test('ADR-053: the seek bar seeks on click / drag and its loop ends are draggable; ← → step by bar', async ({ page }) => {
  await page.goto('/');
  const bar = page.getByTestId('seek-bar');
  const box = (await bar.boundingBox())!;
  const endTick = Number(await bar.getAttribute('data-end-tick'));
  const xOf = (tick: number) => box.x + (box.width * tick) / endTick;
  const y = box.y + box.height / 2;
  await page.mouse.click(xOf(1920 * 2 + 240), y);
  await expect(page.getByTestId('transport-position')).toHaveText(/^003\.01\.2/);
  // drag the loop end edge (bar 5 → bar 3)
  await page.mouse.move(xOf(7680), y);
  await page.mouse.down();
  await page.mouse.move(xOf(7680) - 10, y);
  await page.mouse.move(xOf(1920 * 2), y);
  await page.mouse.up();
  await expect(loopInputs(page).nth(1)).toHaveValue('3');
  await expect(loopInputs(page).nth(0)).toHaveValue('1');
  // keyboard: focus, then → moves to the next bar start
  await bar.locator('canvas').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('transport-position')).toHaveText('004.01.000');
  await page.keyboard.press('Home');
  await expect(page.getByTestId('transport-position')).toHaveText('001.01.000');
});
