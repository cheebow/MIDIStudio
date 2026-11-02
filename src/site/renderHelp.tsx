// Static pages (ADR-055 / 056): the in-app help sections and the beginner's guide rendered to
// plain HTML so they can be read without opening the app. Built by the `static-pages` plugin in
// vite.config.ts (dev: served on the fly at /help.html and /tutorial.html; build: written to dist/).
import { renderToStaticMarkup } from 'react-dom/server';
import { HELP_SECTIONS, type HelpSection } from '../app/help/content';
import { TUTORIAL_CHAPTERS } from '../app/help/tutorial';

type PageId = 'about' | 'tutorial' | 'help';

const NAV: [PageId, string, string][] = [
  ['about', './about.html', '紹介'],
  ['tutorial', './tutorial.html', '入門'],
  ['help', './help.html', 'ヘルプ'],
];

function sectionsPage(opts: { current: PageId; title: string; heading: string; description: string; sections: HelpSection[]; intro?: string; footer: string }): string {
  const toc = renderToStaticMarkup(
    <ul className="toc">
      {opts.sections.map((s) => (
        <li key={s.id}>
          <a href={`#${s.id}`}>{s.title}</a>
        </li>
      ))}
    </ul>,
  );
  const sections = renderToStaticMarkup(
    <>
      {opts.sections.map((s) => (
        <section key={s.id} id={s.id} className="help-section">
          <h2>{s.title}</h2>
          {s.body}
        </section>
      ))}
    </>,
  );
  const nav = NAV.map(([id, href, label]) => `<a class="item" href="${href}"${id === opts.current ? ' aria-current="page"' : ''}>${label}</a>`).join('\n      ');
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${opts.title}</title>
    <meta name="description" content="${opts.description}" />
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
    <link rel="stylesheet" href="./site.css" />
  </head>
  <body>
    <nav class="nav" aria-label="サイト">
      <a class="brand" href="./about.html"><img src="./favicon.svg" alt="" width="22" height="22" /> MIDI Studio</a>
      ${nav}
      <a class="item" href="./">使う</a>
      <span class="spacer"></span>
      <a class="github" href="https://github.com/cheebow/MIDIStudio">GitHub</a>
    </nav>
    <main class="help-page">
      <aside class="help-toc" aria-label="目次">
        <h1>${opts.heading}</h1>
        ${toc}
        <p class="note">キーは Windows の表記です。Mac では Ctrl を ⌘、Alt を ⌥ と読み替えてください。</p>
      </aside>
      <div class="help-body">
        ${opts.intro ? `<p class="lead">${opts.intro}</p>` : ''}
        ${sections}
      </div>
    </main>
    <footer>
      <p>${opts.footer}</p>
    </footer>
  </body>
</html>
`;
}

export function renderHelpHtml(): string {
  return sectionsPage({
    current: 'help',
    title: 'MIDI Studio ヘルプ',
    heading: 'ヘルプ',
    description: 'MIDI Studio の使い方: 画面、各エディター、再生、演奏と録音、ファイル、ショートカット、GM / GS、困ったとき。',
    sections: HELP_SECTIONS,
    footer: 'アプリの中でも、ヘルプ › 使い方…（F1）で同じ内容を読めます。初めての方は<a href="./tutorial.html">入門</a>から。',
  });
}

export function renderTutorialHtml(): string {
  return sectionsPage({
    current: 'tutorial',
    title: 'MIDI Studio 入門',
    heading: '入門',
    description: 'MIDI シーケンサーが初めての人のための手引き。MIDI とは何か、最初の音を置くところから、リズム、コード、音色、録音、保存まで。',
    sections: TUTORIAL_CHAPTERS,
    intro: 'MIDI シーケンサーが初めての人向けです。順に進めると、短いループが 1 曲の形になります。<a href="./">ブラウザで MIDI Studio を開き</a>、並べて読んでください。',
    footer: 'アプリの中でも、ヘルプ › 入門… で同じ内容を読めます。操作の一覧は<a href="./help.html">ヘルプ</a>に。',
  });
}
