// OGP images (the picture shown when a link to MIDI Studio is shared on social media): renders a
// 1200×630 card from the app screenshot (public/images/daw.jpg) and the logo, in Japanese and
// English, with Playwright's Chromium. Output: public/images/og.png, public/images/og.en.png.
// Run `npm run shots:og` after retaking daw.jpg or changing the wording. Not part of the build.
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const dataUrl = (path, type) => `data:${type};base64,${readFileSync(path).toString('base64')}`;
const shot = dataUrl('public/images/daw.jpg', 'image/jpeg');
const logo = dataUrl('public/favicon.svg', 'image/svg+xml');

const TEXT = {
  ja: {
    lang: 'ja',
    tagline: 'ブラウザで動く<br>MIDI シーケンサー',
    points: ['DAW の編集とレコンポーザ流の数値入力', 'GM / GS 互換の音源を内蔵', 'インストール不要・外部送信なし'],
    out: 'public/images/og.png',
  },
  en: {
    lang: 'en',
    tagline: 'A MIDI sequencer<br>in your browser',
    points: ['DAW editing + a numeric event list', 'Built-in GM / GS compatible synth', 'No install, nothing sent anywhere'],
    out: 'public/images/og.en.png',
  },
};

const page = (t) => `<!doctype html><html lang="${t.lang}"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif;
    background: linear-gradient(135deg, #f4f7fc 0%, #e3ecfa 100%); color: #1d2330; position: relative; }
  .text { position: absolute; left: 64px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand img { width: 64px; height: 64px; }
  .brand h1 { font-size: 46px; font-weight: 700; letter-spacing: -0.5px; }
  .tagline { margin-top: 28px; font-size: 40px; font-weight: 700; line-height: 1.3; color: #2f6fdb; }
  ul { margin-top: 30px; padding: 0; list-style: none; font-size: 21px; line-height: 1.75; color: #3b4456; }
  li::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 2px; background: #f2994a; margin-right: 12px; vertical-align: middle; }
  .shot { position: absolute; left: 580px; top: 70px; width: 820px; border-radius: 12px; overflow: hidden;
    box-shadow: 0 24px 60px rgba(29, 35, 48, 0.28), 0 0 0 1px rgba(29, 35, 48, 0.08); }
  .shot img { display: block; width: 100%; }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: #2f6fdb; }
</style></head><body>
  <div class="text">
    <div class="brand"><img src="${logo}" alt=""><h1>MIDI Studio</h1></div>
    <p class="tagline">${t.tagline}</p>
    <ul>${t.points.map((p) => `<li>${p}</li>`).join('')}</ul>
  </div>
  <div class="shot"><img src="${shot}" alt=""></div>
  <div class="bar"></div>
</body></html>`;

const browser = await chromium.launch();
try {
  const tab = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  for (const t of Object.values(TEXT)) {
    await tab.setContent(page(t), { waitUntil: 'load' });
    await tab.screenshot({ path: t.out, type: 'png' });
    console.log(`wrote ${t.out}`);
  }
} finally {
  await browser.close();
}
