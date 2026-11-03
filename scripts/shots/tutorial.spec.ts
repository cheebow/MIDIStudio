// Screenshots for the beginner's guide (ADR-063), in Japanese and English. Each figure is a real
// app screen with numbered callouts drawn over it, so the pictures can be regenerated whenever the UI
// changes: `npm run shots:tutorial`. Output: public/images/tutorial/<name>.<lang>.jpg.
import { test, type Locator, type Page } from '@playwright/test';
import { build, off, on, program, text } from '../../tests/fixtures/songs';
import { importMidi, rollPoint } from '../../tests/e2e/helpers';

type Lang = 'ja' | 'en';
const OUT = 'public/images/tutorial';
const NAMES: Record<Lang, [string, string, string, string]> = { ja: ['ピアノ', 'ベース', 'ギター', 'ドラム'], en: ['Piano', 'Bass', 'Guitar', 'Drums'] };
const Q = 480;

/** The four starter tracks (same channels as a new song) with the notes a chapter talks about. */
function song(lang: Lang, parts: { piano?: number[][]; bass?: number[][]; drums?: number[][] }, ppq = Q): Uint8Array {
  const [piano, bass, guitar, drums] = NAMES[lang];
  // events are delta-timed: sort by absolute tick first, then convert
  const track = (name: string, ch: number, prog: number, list: number[][] = []) => {
    const abs: [number, number[]][] = [];
    for (const [tick, pitch, len, vel = 100] of list) abs.push([tick, on(0, ch, pitch, vel)], [tick + len, off(0, ch, pitch)]);
    abs.sort((a, b) => a[0] - b[0]);
    let last = 0;
    const evs = abs.map(([tick, ev]) => {
      const d = tick - last;
      last = tick;
      return [d, ...ev.slice(1)];
    });
    return [text(0, 0x03, name), program(0, ch, prog), ...evs];
  };
  return build(1, ppq, [], track(piano, 0, 0, parts.piano), track(bass, 1, 33, parts.bass), track(guitar, 2, 25), track(drums, 9, 0, parts.drums));
}

async function open(page: Page, lang: Lang, startup = false) {
  await page.context().addInitScript(([l, s]) => {
    localStorage.setItem('midi-studio.locale', l);
    if (s) localStorage.removeItem('midi-studio.startup');
  }, [lang, startup]);
  await page.goto('/');
  await page.addStyleTag({ content: '* { user-select: none !important; }' });
  await page.waitForTimeout(300);
}

/** Numbered callout frames drawn over the page (removed by clearCallouts). */
async function callout(page: Page, target: Locator | { x: number; y: number; width: number; height: number }, n: number, pad = 4) {
  const box = 'x' in target ? target : (await target.boundingBox())!;
  await page.evaluate(
    ([b, n, pad]) => {
      // an open <dialog> sits in the top layer, so the frame must live inside it to be visible
      const host = (document.querySelector('dialog[open]') as HTMLElement | null) ?? document.body;
      const origin = host === document.body ? { x: 0, y: 0 } : host.getBoundingClientRect();
      if (host !== document.body) host.style.position = host.style.position || 'relative';
      const left = b.x - pad - origin.x;
      const top = b.y - pad - origin.y;
      const d = document.createElement('div');
      d.className = 'shot-callout';
      Object.assign(d.style, { position: host === document.body ? 'fixed' : 'absolute', left: `${left}px`, top: `${top}px`, width: `${b.width + pad * 2}px`, height: `${b.height + pad * 2}px`, border: '3px solid #e5533d', borderRadius: '8px', boxShadow: '0 0 0 2px rgba(255,255,255,.85), 0 2px 10px rgba(0,0,0,.15)', zIndex: '99999', pointerEvents: 'none', boxSizing: 'border-box' });
      const badge = document.createElement('span');
      badge.textContent = String(n);
      // the badge sits on the top-left corner, or just inside it when the frame touches the window edge
      const bx = b.x - pad - 14 < 2 ? 4 : -14;
      const by = b.y - pad - 14 < 2 ? 4 : -14;
      Object.assign(badge.style, { position: 'absolute', left: `${bx}px`, top: `${by}px`, width: '28px', height: '28px', borderRadius: '50%', background: '#e5533d', color: '#fff', font: '700 16px/28px system-ui, sans-serif', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,.3)' });
      d.appendChild(badge);
      host.appendChild(d);
    },
    [box, n, pad] as const,
  );
}
const clearCallouts = (page: Page) => page.evaluate(() => document.querySelectorAll('.shot-callout').forEach((e) => e.remove()));

async function shot(page: Page, name: string, lang: Lang, opts: { clip?: { x: number; y: number; width: number; height: number }; locator?: Locator } = {}) {
  await page.waitForTimeout(150);
  const path = `${OUT}/${name}.${lang}.jpg`;
  if (opts.locator) await opts.locator.screenshot({ path, type: 'jpeg', quality: 90 });
  else await page.screenshot({ path, type: 'jpeg', quality: 90, clip: opts.clip });
  await clearCallouts(page);
}

const trackHeader = (page: Page, name: string) => page.getByTestId('track-header').filter({ hasText: name }).first();
const tab = (page: Page, lang: Lang, ja: string, en: string) => page.getByRole('tab', { name: lang === 'ja' ? ja : en });

for (const lang of ['ja', 'en'] as Lang[]) {
  test.describe(lang, () => {
    test('startup dialog', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await open(page, lang, true);
      const dialog = page.getByTestId('startup-dialog');
      await callout(page, dialog.getByText(lang === 'ja' ? '新しい曲' : /new song/i).first(), 1);
      await callout(page, dialog.getByTestId('startup-start'), 2);
      await shot(page, 'startup', lang, { locator: page.locator('dialog.dialog').first() });
      await ctx.close();
    });

    test('screens', async ({ page }) => {
      const [piano, , , drums] = NAMES[lang];
      await page.setViewportSize({ width: 1280, height: 920 });
      await open(page, lang);
      // --- 画面の見かた: a song with something in every track
      await importMidi(
        page,
        song(lang, {
          piano: [[0, 60, Q], [0, 64, Q], [0, 67, Q], [Q * 4, 65, Q], [Q * 4, 69, Q], [Q * 4, 72, Q]],
          bass: [[0, 36, Q], [Q, 36, Q], [Q * 2, 36, Q], [Q * 3, 36, Q], [Q * 4, 41, Q], [Q * 5, 41, Q], [Q * 6, 41, Q], [Q * 7, 41, Q]],
          drums: [[0, 36, Q / 2, 110], [Q, 38, Q / 2], [Q * 2, 36, Q / 2, 110], [Q * 3, 38, Q / 2], ...Array.from({ length: 8 }, (_, i) => [i * (Q / 2), 42, Q / 4, 80])],
        }),
      );
      await trackHeader(page, piano).click();
      await callout(page, page.locator('.transport'), 1);
      await callout(page, page.locator('.arrangement'), 2);
      await callout(page, page.locator('.editor-panel'), 3);
      await callout(page, page.locator('.inspector'), 4);
      await shot(page, 'screen', lang);

      // --- 1. 最初の音を置く: draw tool, C4, four 16th notes in bar 1
      await importMidi(page, song(lang, { piano: [[0, 60, Q / 4], [Q / 4, 60, Q / 4], [Q / 2, 60, Q / 4], [(Q * 3) / 4, 60, Q / 4]] }));
      await trackHeader(page, piano).click();
      await tab(page, lang, 'ピアノロール', 'Piano roll').click();
      await page.getByTestId('tool-draw').click();
      const grid = (await page.getByTestId('piano-roll-grid').boundingBox())!;
      const keys = (await page.locator('.roll-keys').boundingBox())!;
      const c4 = await rollPoint(page, 0, 60); // the note row of C4 (keys are drawn on a canvas)
      await callout(page, page.getByTestId('tool-draw'), 1);
      await callout(page, { x: keys.x, y: c4.y - 10, width: keys.width, height: 16 }, 2);
      await callout(page, { x: c4.x - 6, y: c4.y - 10, width: 92, height: 16 }, 3);
      await shot(page, 'first-notes', lang, { clip: { x: 0, y: grid.y - 60, width: 1280, height: 920 - (grid.y - 60) } });
      await page.getByTestId('tool-select').click();

      // --- 2. リズムを足す: drum editor, kick / snare / hat, loop on
      await importMidi(page, song(lang, { drums: [[0, 36, Q / 2, 110], [Q, 38, Q / 2], [Q * 2, 36, Q / 2, 110], [Q * 3, 38, Q / 2], ...Array.from({ length: 8 }, (_, i) => [i * (Q / 2), 42, Q / 4, 80])] }));
      await trackHeader(page, drums).click();
      await tab(page, lang, 'ドラム', 'Drums').click();
      await page.getByRole('checkbox', { name: 'LOOP' }).check();
      const lanes = page.getByTestId('drum-lane');
      await callout(page, lanes.filter({ hasText: /Bass Drum 1/ }).first(), 1);
      await callout(page, lanes.filter({ hasText: /Acoustic Snare/ }).first(), 2);
      await callout(page, lanes.filter({ hasText: /Closed Hi-Hat/ }).first(), 3);
      await callout(page, page.getByRole('checkbox', { name: 'LOOP' }).locator('..'), 4);
      await shot(page, 'rhythm', lang);
      await page.getByRole('checkbox', { name: 'LOOP' }).uncheck();

      // --- 3. ベースとコード: C chord then F chord over a bass line, grid 1/4
      await importMidi(
        page,
        song(lang, {
          piano: [[0, 60, Q], [0, 64, Q], [0, 67, Q], [Q * 4, 65, Q], [Q * 4, 69, Q], [Q * 4, 72, Q]],
          bass: [[0, 36, Q], [Q, 36, Q], [Q * 2, 36, Q], [Q * 3, 36, Q], [Q * 4, 41, Q], [Q * 5, 41, Q], [Q * 6, 41, Q], [Q * 7, 41, Q]],
        }),
      );
      await trackHeader(page, piano).click();
      await tab(page, lang, 'ピアノロール', 'Piano roll').click();
      await page.getByRole('combobox', { name: lang === 'ja' ? 'グリッド' : 'Grid' }).selectOption('4:straight');
      const grid2 = (await page.getByTestId('piano-roll-grid').boundingBox())!;
      await callout(page, page.getByRole('combobox', { name: lang === 'ja' ? 'グリッド' : 'Grid' }), 1);
      const g4 = await rollPoint(page, 0, 67);
      const c5 = await rollPoint(page, Q * 4, 72);
      await callout(page, { x: g4.x - 6, y: g4.y - 10, width: 86, height: 12 * 7 + 16 }, 2); // C4–E4–G4
      await callout(page, { x: c5.x - 6, y: c5.y - 10, width: 86, height: 12 * 7 + 16 }, 3); // F4–A4–C5
      await shot(page, 'chords', lang, { clip: { x: 0, y: grid2.y - 60, width: 1280, height: 920 - (grid2.y - 60) } });
      await page.getByRole('combobox', { name: lang === 'ja' ? 'グリッド' : 'Grid' }).selectOption('16:straight');

      // --- 4. 音色とテンポ、音量: patch select, BPM, then the mixer
      await callout(page, page.locator('.inspector select').last(), 1);
      await callout(page, page.getByTestId('bpm-readout'), 2);
      await callout(page, tab(page, lang, 'ミキサー', 'Mixer'), 3);
      await shot(page, 'sound-tempo', lang, { clip: { x: 0, y: 0, width: 1280, height: 700 } });
      await tab(page, lang, 'ミキサー', 'Mixer').click();
      await shot(page, 'mixer', lang, { locator: page.locator('.mixer') });
      await tab(page, lang, 'ピアノロール', 'Piano roll').click();

      // --- 5. 弾いて入れる: keyboard mode, record arm, record button
      await trackHeader(page, piano).click();
      await page.getByTestId('input-mode-piano-performance').click();
      await trackHeader(page, piano).getByRole('button', { name: /録音待機|arm/i }).click();
      await callout(page, page.getByTestId('input-mode-piano-performance'), 1);
      await callout(page, trackHeader(page, piano).getByRole('button', { name: /録音待機|arm/i }), 2);
      await callout(page, page.getByTestId('record'), 3);
      await shot(page, 'play-in', lang, { clip: { x: 0, y: 0, width: 1280, height: 420 } });
      await trackHeader(page, piano).getByRole('button', { name: /録音待機|arm/i }).click();
      await page.keyboard.press('Escape');

      // --- 6. 曲の形にする: rubber-band the four clips
      await importMidi(
        page,
        song(lang, {
          piano: [[0, 60, Q], [0, 64, Q], [0, 67, Q], [Q * 4, 65, Q], [Q * 4, 69, Q], [Q * 4, 72, Q]],
          bass: [[0, 36, Q], [Q, 36, Q], [Q * 2, 36, Q], [Q * 3, 36, Q], [Q * 4, 41, Q], [Q * 5, 41, Q], [Q * 6, 41, Q], [Q * 7, 41, Q]],
          drums: [[0, 36, Q / 2, 110], [Q, 38, Q / 2], [Q * 2, 36, Q / 2, 110], [Q * 3, 38, Q / 2], ...Array.from({ length: 8 }, (_, i) => [i * (Q / 2), 42, Q / 4, 80])],
        }),
      );
      await page.keyboard.press('Escape');
      await page.getByTestId('arr-tool-select').click();
      const arr = (await page.getByTestId('arrangement-canvas').boundingBox())!;
      await page.mouse.move(arr.x + 96 * 3 + 20, arr.y + arr.height - 6);
      await page.mouse.down();
      await page.mouse.move(arr.x + 96 - 6, arr.y + 50 + 4, { steps: 6 });
      await page.mouse.up();
      await callout(page, { x: arr.x + 96 - 6, y: arr.y + 50 + 4, width: 96 * 2 + 26, height: arr.height - 60 }, 1);
      await shot(page, 'arrange', lang, { clip: { x: 0, y: 0, width: 1280, height: 420 } });

      // --- 7. 保存と書き出し: the File menu
      await page.getByRole('button', { name: lang === 'ja' ? 'ファイル' : 'File', exact: true }).click();
      await page.waitForTimeout(200);
      await shot(page, 'save', lang, { clip: { x: 0, y: 0, width: 640, height: 480 } });
      await page.keyboard.press('Escape');
    });
  });
}
