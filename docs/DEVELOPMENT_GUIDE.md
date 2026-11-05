# MIDI Studio — 開発者向けスタートガイド

文書版 **1.0.0** / 2026-11-01 / 言語: 日本語

## プロジェクトの目的

MML Studio の技術基盤を参考に、**本格的なブラウザ完結型 GM/GS 対応 MIDI シーケンサー**を新規に開発する。

- 現代の DAW 的なトラックビュー・ピアノロール・ドラムエディター
- レコンポーザ風の数値リスト編集（ST / GT）、演奏位置に追従する「ビジュアルモード」
- 内蔵 SoundFont による再生、GM/GS MIDI データの編集・読み書き
- PC キーボード、テンキー、外部 MIDI キーボードによるリアルタイム / ステップ入力
- テンキーのないノートPCでも全操作可能
- 音源・曲データを外部 API に送信しない。サーバーは不要

**MML Studio の拡張版ではなく別プロジェクト**とする。音源処理と SMF コードは実装調査後に適切な部分を移植・再利用する。

## 仕様書一覧と読む順番

| ファイル | 役割 |
|---|---|
| `CLAUDE.md` | Claude Code の実装・報告ルール。最初に読む |
| `SPEC.md` | プロダクト仕様・機能要件・受入基準の正本 |
| `ARCHITECTURE.md` | コアモデル、編集/再生アーキテクチャ、保存形式 |
| `MIDI_GS_SPEC.md` | SMF、MIDIイベント、GM/GS、SysEx の厳密な扱い |
| `UI_DESIGN.md` | 画面レイアウト、エディター・ビジュアルモード操作 |
| `INPUT_RECORDING.md` | PC/テンキー/MIDI鍵盤、ステップ入力、録音 |
| `TEST_PLAN.md` | テストマトリクス・手動検証・完成判定 |
| `IMPLEMENTATION_PLAN.md` | フェーズ順序、依存関係、終了条件 |
| `docs/DECISIONS.md` | 設計上の重要な決定・未検証事項 |

仕様間で衝突した場合の優先順位は `SPEC.md` → 各詳細仕様 → `IMPLEMENTATION_PLAN.md` → 本ガイド。曖昧な点は無断で機能を削らず、`docs/DECISIONS.md` に理由を記す。

## Claude Code に最初に渡す指示

```text
リポジトリ直下の CLAUDE.md を最初に読み、記載された仕様書を全て確認してください。
MML Studio (https://github.com/cheebow/MMLStudio) を技術的参考資料として調査し、
別プロジェクトとして MIDI Studio を Phase 0 から実装してください。
まず依存関係・音源の動作確認とアーキテクチャの検証を行い、
各 Phase の受入基準・テストを満たしてから次へ進んでください。
未実装機能を完成と報告しないでください。
仕様変更・未解決問題は docs/DECISIONS.md に追記してください。
```

## 環境と公開

- 推奨: Node.js 22 以降、TypeScript strict、React、Vite、Vitest、Playwright。
- ブラウザ内での GM/GS 再生: `spessasynth_lib` + SF2（MML Studio での実績を優先）。
- Web MIDI API は対応ブラウザ・HTTPS・ユーザー許可が必要。通常の編集、PCキーボード演奏、SoundFont再生は Web MIDI API がなくても動作させる。
- 再生音の **Roland 実機との完全な音色一致は保証しない**。

## 参考資料（2026-11-01 確認）

- MML Studio: https://github.com/cheebow/MMLStudio
- MML Studio 仕様: https://github.com/cheebow/MMLStudio/blob/main/SPEC.md
- SpessaSynth ライブラリ: https://spessasus.github.io/spessasynth_lib/
- SpessaSynth MIDI対応表: https://spessasus.github.io/spessasynth_core/extra/midi-implementation/
- SpessaSynth マルチポート: https://spessasus.github.io/spessasynth_core/extra/about-multi-port/
- Web MIDI API: https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API

## セットアップ（Phase 0 で整備）

```bash
npm install               # postinstall で AudioWorklet を public/ にコピー
npm run fetch-soundfont   # GeneralUser GS v2.0.3 を作者の公式 GitHub（固定コミット）から取得し SHA-256 を照合
npm run dev               # http://localhost:5173
```

- SoundFont 本体（約32MB）は `.gitignore` 対象。ライセンス原文は `public/licenses/` にコミットする。
- SF2 が無くてもアプリは起動し、音源が使えない理由を表示する。ローカルの `.sf2` を画面から選んで使うこともできる。

| コマンド | 内容 |
|---|---|
| `npm run typecheck` | `tsc -b`（core / app / node / test の project references） |
| `npm run lint` | ESLint。`src/core` から React・DOM・SpessaSynth・IndexedDB を使うとエラー |
| `npm run test` | Vitest（node 環境。DOM・AudioWorklet・SF2 なしで動く unit / integration） |
| `npm run test:e2e` | Playwright（Chromium / Firefox / WebKit。ビルドして preview サーバーで実行） |
| `npm run build` | 本番ビルド。GitHub Pages 等のサブパスでは `BASE_PATH=/MIDIStudio/ npm run build`。`.github/workflows/pages.yml` が main への push で同じ手順を実行し Pages に公開する（リポジトリ設定で Pages の Source を GitHub Actions にする） |

### ディレクトリ

- `src/core/` — MIDI コア（純粋 TypeScript）。UI・音声に依存しない
- `src/playback/` — 音源アダプター（`SpessaAdapter.ts` だけが spessasynth_lib を参照する）
- `src/app/`, `src/ui/` — React UI
- `tests/unit`, `tests/integration`, `tests/e2e`, `tests/fixtures`（自作のテスト用データのみ）

依存バージョンの固定理由と SpessaSynth API の確認結果は `docs/DECISIONS.md`（ADR-011〜013）を参照。

### テスト ID と主なテストファイル

| テスト ID | ファイル |
|---|---|
| C01, C02, C07, C08, C11, C14 | `tests/unit/smf-reader.test.ts` |
| C01, C05, C06, C09, C10, E11 | `tests/unit/import.test.ts` |
| C08, C13 | `tests/integration/smf-roundtrip.test.ts` |
| C03, C04, C15 | `tests/unit/timing.test.ts` |
| E03, E04, E10（コア部分） | `tests/unit/editing.test.ts` |
| C12, O01, O04 | `tests/integration/project-file.test.ts`, `tests/e2e/project-io.spec.ts` |
| C11 / O06（負荷の下地） | `tests/integration/large-file.test.ts` |
| P10（一部）、起動時のダイアログ（ADR-049。Playwright の `storageState` で `midi-studio.startup = 'skip'` を入れて通常は非表示にし、smoke.spec.ts だけ空の storage で表示を確認） | `tests/e2e/smoke.spec.ts` |
| P01, P04, P05, P09, P10, P11 | `tests/integration/transport.test.ts`, `tests/e2e/audio-spike.spec.ts`（Chromium 実エンジン） |
| P03、メトロノーム拍位置 | `tests/unit/chase.test.ts` |
| E01, E03, E10（UI）、E14 / E15（レーンの選択、クリップの端、トラックの並べ替え） | `tests/e2e/editing.spec.ts` |
| メニュー（サブメニュー・キーボード操作） | `tests/e2e/smoke.spec.ts` |
| E08（グリッド・クオンタイズ）、E16（強さ・シャッフル・長さ） | `tests/unit/editing.test.ts`、`tests/e2e/editing.spec.ts`、`tests/integration/project-file.test.ts`（設定の保存） |
| E17（DAW ショートカット・入力モードの切替） | `tests/e2e/shortcuts.spec.ts` |
| E18（ヒューマナイズ・ベロシティ） | `tests/unit/editing.test.ts`、`tests/e2e/editing.spec.ts` |
| P02（DAW 内のタブ切替） | `tests/e2e/audio-spike.spec.ts` |
| O01, O02, O04（UI） | `tests/e2e/project-io.spec.ts` |
| I01〜I07（入力判定）、E09 | `tests/unit/keyboard-router.test.ts` |
| E02, E09, I02, I03, I06（UI） | `tests/e2e/drum-input.spec.ts` |
| E05, E06, E07, E12, P06〜P08（計算） | `tests/unit/list.test.ts` |
| E05, E06, E07, E12, P02（ビジュアルモード）（UI） | `tests/e2e/list-visual.spec.ts` |
| LIST-01〜03（音名・種類変更・挿入・CH） | `tests/unit/list-names.test.ts`, `tests/unit/list-convert.test.ts` |
| LIST-04, 06, 09, 12（増減・キー所有・一括変更） | `tests/unit/list-nudge.test.ts`, `tests/unit/list-keys.test.ts`, `tests/unit/list-transform.test.ts` |
| LIST-04〜12（UI） | `tests/e2e/list-editing.spec.ts`, `tests/e2e/list-keys.spec.ts`, `tests/e2e/list-input.spec.ts` |
| I08〜I12, I15 | `tests/unit/recording.test.ts`, `tests/integration/recording-flow.test.ts` |
| I13, I14（擬似 MIDI 機器） | `tests/unit/midi-input.test.ts` |
| I01, I03, I08, I11, I13（UI） | `tests/e2e/recording.spec.ts` |
| GS（MIDI_GS_SPEC 9）、E13 | `tests/unit/gs.test.ts`, `tests/e2e/gs-quality.spec.ts` |
| 性能（TEST_PLAN 8） | `tests/integration/large-file.test.ts`, `tests/e2e/gs-quality.spec.ts`（結果は `docs/PERFORMANCE.md`） |

## 静的サイトとして公開する

```bash
npm ci
npm run fetch-soundfont                     # SoundFont を dist に含めるため、ビルド前に取得
BASE_PATH=/MIDIStudio/ npm run build        # GitHub Pages のサブパスの例。ルートなら BASE_PATH 不要
# dist/ を静的ホスティングに配置（HTTPS 必須: Web MIDI と AudioWorklet のため）
```

- バックエンドは不要。曲データはブラウザ内（IndexedDB）とユーザーがダウンロードしたファイルにだけ保存される。
- SoundFont は自サイトのコピーを配信する（GeneralUser GS のライセンスにより作者のダウンロードファイルへの直リンクは不可）。
- 受入状況は `docs/ACCEPTANCE_REPORT.md`。

### 入門の図を撮り直す

入門（ヘルプ › 入門、`tutorial.html`）の図はアプリの実画面を Playwright で撮ったもの（ADR-063）。UI を変えたら撮り直す。

```bash
npm run shots:tutorial     # Chromium で日本語・英語の 20 枚を public/images/tutorial/ に書く
```

章ごとの状況と番号の枠は `scripts/shots/tutorial.spec.ts` で作る。撮ったあとは `npm run build` で静的ページに反映される。

### リンクを共有したときの画像（OGP）を作り直す

アプリ（`index.html`）と紹介ページ（`public/about.html` / `about.en.html`）には OGP / Twitter Card のタグがあり、SNS でリンクを共有すると `public/images/og.png`（英語ページは `og.en.png`、1200×630）が出る（ADR-089）。画像は `public/images/daw.jpg` とロゴから作る。画面写真や文言を変えたら作り直す。

```bash
npm run shots:og           # Playwright の Chromium で public/images/og.png と og.en.png を書く
```

OGP の URL は絶対 URL が必要なので、公開先 `https://cheebow.github.io/MIDIStudio/` を直接書いている。公開先を変えるときは 3 つのページのタグも直す。

### ブランチ運用

- `develop`: 日々の作業の合流先。GitHub の既定ブランチなので PR は自動的にここへ向く。
- `main`: 公開版。push すると `.github/workflows/pages.yml` が GitHub Pages に配信する。直接コミットせず、`develop` からのマージだけを入れる。
- 作業は `develop` から切ったブランチで行い、PR を `develop` に出す。
- `develop` と `main` は GitHub のルールセット「Protect develop and main」で**削除と強制 push を禁止**している（2026-11-03〜）。`git push --force` や履歴の書き換えはできないので、間違えたコミットは `git revert` で戻す。PR 必須・ステータスチェック必須は付けていない（公開の版上げコミットを `develop` に直接 push するため。テストの CI もまだない）。ルールは GitHub の Settings › Rules › Rulesets で確認・変更できる。

### 版を上げて公開する（develop → main）

公開するたびに版を上げる。番号は `package.json` の `version` が正本で、ビルド時に `__APP_VERSION__` として「MIDI Studio について」に出る。

```bash
git switch develop && git pull
npm version minor --no-git-tag-version   # 操作や挙動が変わるとき。直すだけなら patch
# CHANGELOG.md に利用者向けの言葉で変更を書く（ADR 番号を添える）
git add -A && git commit -m "v0.3.0" && git push
git switch main && git pull && git merge --ff-only develop   # 公開 = develop を main に取り込む
git tag v0.3.0 && git push origin main --tags
# GitHub の Release を作る（本文は CHANGELOG.md のその版の節）
awk '/^## 0\.3\.0 /{f=1;next} /^## /{f=0} f' CHANGELOG.md > /tmp/notes.md
gh release create v0.3.0 --title "MIDI Studio 0.3.0" --notes-file /tmp/notes.md
git switch develop
```

公開のたびに、タグに対応する GitHub の Release も作る（タグだけでは Releases の一覧に出ない）。題は「MIDI Studio X.Y.Z」、本文は CHANGELOG のその版の節をそのまま使う。

