// Static help page (ADR-055): the in-app help sections rendered to plain HTML so they can be read
// without opening the app. Built by the `help-page` plugin in vite.config.ts (dev: served on the
// fly at /help.html; build: written to dist/help.html).
import { renderToStaticMarkup } from 'react-dom/server';
import { HELP_SECTIONS } from '../app/help/content';

export function renderHelpHtml(): string {
  const toc = renderToStaticMarkup(
    <ul className="toc">
      {HELP_SECTIONS.map((s) => (
        <li key={s.id}>
          <a href={`#${s.id}`}>{s.title}</a>
        </li>
      ))}
    </ul>,
  );
  const sections = renderToStaticMarkup(
    <>
      {HELP_SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="help-section">
          <h2>{s.title}</h2>
          {s.body}
        </section>
      ))}
    </>,
  );
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MIDI Studio ヘルプ</title>
    <meta name="description" content="MIDI Studio の使い方: 画面、各エディター、再生、演奏と録音、ファイル、ショートカット、GM / GS、困ったとき。" />
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
    <link rel="stylesheet" href="./site.css" />
  </head>
  <body>
    <nav class="nav" aria-label="サイト">
      <a class="brand" href="./about.html"><img src="./favicon.svg" alt="" width="22" height="22" /> MIDI Studio</a>
      <a class="item" href="./about.html">紹介</a>
      <a class="item" href="./help.html" aria-current="page">ヘルプ</a>
      <a class="item" href="./">使う</a>
      <span class="spacer"></span>
      <a class="github" href="https://github.com/cheebow/MIDIStudio">GitHub</a>
    </nav>
    <main class="help-page">
      <aside class="help-toc" aria-label="目次">
        <h1>ヘルプ</h1>
        ${toc}
        <p class="note">キーは Windows の表記です。Mac では Ctrl を ⌘、Alt を ⌥ と読み替えてください。</p>
      </aside>
      <div class="help-body">
        ${sections}
      </div>
    </main>
    <footer>
      <p>アプリの中でも、ヘルプ › 使い方…（F1）で同じ内容を読めます。</p>
    </footer>
  </body>
</html>
`;
}
