// Static pages (ADR-055 / 056 / 061): the in-app help sections and the beginner's guide rendered to
// plain HTML so they can be read without opening the app, in Japanese (help.html, tutorial.html) and
// English (help.en.html, tutorial.en.html). Built by the `static-pages` plugin in vite.config.ts
// (dev: served on the fly; build: written to dist/ by scripts/build-pages.mjs).
import { renderToStaticMarkup } from 'react-dom/server';
import { HELP_SECTIONS, type HelpSection } from '../app/help/content';
import { HELP_SECTIONS_EN } from '../app/help/content.en';
import { TUTORIAL_CHAPTERS } from '../app/help/tutorial';
import { TUTORIAL_CHAPTERS_EN } from '../app/help/tutorial.en';

type PageId = 'about' | 'tutorial' | 'help';
type Lang = 'ja' | 'en';

/** page file name per language: the Japanese pages keep their names, the English ones get `.en` */
const file = (id: PageId, lang: Lang) => `./${id}${lang === 'en' ? '.en' : ''}.html`;

const TEXT: Record<
  Lang,
  { nav: Record<PageId, string>; app: string; site: string; toc: string; keys: string; other: { lang: Lang; label: string } }
> = {
  ja: {
    nav: { about: '紹介', tutorial: '入門', help: 'ヘルプ' },
    app: '使う',
    site: 'サイト',
    toc: '目次',
    keys: 'キーは Windows の表記です。Mac では Ctrl を ⌘、Alt を ⌥ と読み替えてください。',
    other: { lang: 'en', label: 'English' },
  },
  en: {
    nav: { about: 'About', tutorial: 'Getting started', help: 'Help' },
    app: 'Open the app',
    site: 'Site',
    toc: 'Contents',
    keys: 'Keys are written the Windows way. On a Mac, read Ctrl as ⌘ and Alt as ⌥.',
    other: { lang: 'ja', label: '日本語' },
  },
};

function sectionsPage(opts: { lang: Lang; current: PageId; title: string; heading: string; description: string; sections: HelpSection[]; intro?: string; footer: string }): string {
  const tx = TEXT[opts.lang];
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
  const nav = (['about', 'tutorial', 'help'] as PageId[]).map((id) => `<a class="item" href="${file(id, opts.lang)}"${id === opts.current ? ' aria-current="page"' : ''}>${tx.nav[id]}</a>`).join('\n      ');
  return `<!doctype html>
<html lang="${opts.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${opts.title}</title>
    <meta name="description" content="${opts.description}" />
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
    <link rel="stylesheet" href="./site.css" />
    <link rel="alternate" hreflang="${tx.other.lang}" href="${file(opts.current, tx.other.lang)}" />
  </head>
  <body>
    <nav class="nav" aria-label="${tx.site}">
      <a class="brand" href="${file('about', opts.lang)}"><img src="./favicon.svg" alt="" width="22" height="22" /> MIDI Studio</a>
      ${nav}
      <a class="item" href="./">${tx.app}</a>
      <span class="spacer"></span>
      <a class="item" href="${file(opts.current, tx.other.lang)}" lang="${tx.other.lang}" hreflang="${tx.other.lang}">${tx.other.label}</a>
      <a class="github" href="https://github.com/cheebow/MIDIStudio">GitHub</a>
    </nav>
    <main class="help-page">
      <aside class="help-toc" aria-label="${tx.toc}">
        <h1>${opts.heading}</h1>
        ${toc}
        <p class="note">${tx.keys}</p>
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
    lang: 'ja',
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
    lang: 'ja',
    current: 'tutorial',
    title: 'MIDI Studio 入門',
    heading: '入門',
    description: 'MIDI シーケンサーが初めての人のための手引き。MIDI とは何か、最初の音を置くところから、リズム、コード、音色、録音、保存まで。',
    sections: TUTORIAL_CHAPTERS,
    intro: 'MIDI シーケンサーが初めての人向けです。順に進めると、短いループが 1 曲の形になります。<a href="./">ブラウザで MIDI Studio を開き</a>、並べて読んでください。',
    footer: 'アプリの中でも、ヘルプ › 入門… で同じ内容を読めます。操作の一覧は<a href="./help.html">ヘルプ</a>に。',
  });
}

export function renderHelpEnHtml(): string {
  return sectionsPage({
    lang: 'en',
    current: 'help',
    title: 'MIDI Studio help',
    heading: 'Help',
    description: 'How to use MIDI Studio: the screen, each editor, playback, playing and recording, files, shortcuts, GM / GS, troubleshooting.',
    sections: HELP_SECTIONS_EN,
    footer: 'The same contents are in the app under Help › How to use… (F1). New to sequencing? Start with <a href="./tutorial.en.html">Getting started</a>.',
  });
}

export function renderTutorialEnHtml(): string {
  return sectionsPage({
    lang: 'en',
    current: 'tutorial',
    title: 'Getting started with MIDI Studio',
    heading: 'Getting started',
    description: 'A guide for people new to MIDI sequencers: what MIDI is, placing the first notes, rhythm, chords, patches, recording and saving.',
    sections: TUTORIAL_CHAPTERS_EN,
    intro: 'For people who have never used a MIDI sequencer. Follow the chapters in order and a short loop turns into a song. <a href="./">Open MIDI Studio in your browser</a> and read along.',
    footer: 'The same contents are in the app under Help › Getting started…. The full list of operations is in the <a href="./help.en.html">help</a>.',
  });
}
