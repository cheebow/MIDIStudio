# MIDI Studio

**Web ブラウザで動く、MIDI 制作に特化したシーケンサー。**

DAW のような視覚的な編集と、レコンポーザのような数値入力を 1 つのアプリで。MIDI ファイルを読み込み、編集し、内蔵の GM/GS 互換音源で鳴らします。曲データも音源もブラウザの中だけで扱い、外部に送信しません。

紹介ページ: https://cheebow.github.io/MIDIStudio/about.html ・ 入門: https://cheebow.github.io/MIDIStudio/tutorial.html ・ ヘルプ: https://cheebow.github.io/MIDIStudio/help.html （アプリ: https://cheebow.github.io/MIDIStudio/ ）

![MIDI Studio の画面。上にトラックビュー、下にピアノロール](public/images/daw.jpg)

| ビジュアルモード: 数値リスト | ピアノロール | 鍵盤 |
| --- | --- | --- |
| ![数値リスト](public/images/visual-list.jpg) | ![ピアノロール](public/images/visual-roll.jpg) | ![鍵盤](public/images/visual-keys.jpg) |

![リストエディター。バンク・音色・CC、マーカー、テンポチェンジ、ノートが 1 つのリストに時刻順に並ぶ](public/images/list-editor.jpg)

> 開発中です。編集・再生・録音・書き出しの各機能は自動テスト（単体・結合・Chromium / Firefox / WebKit の E2E）で確認していますが、外部 MIDI キーボード実機での録音と、Safari / Firefox での実際の音は未確認です。

## 主な機能

- **トラックビュー** — クリップの作成・移動・複製・分割・長さ変更（ノートは壊さない）、トラックの並べ替え、ループ範囲のドラッグ
- **ピアノロール** — ノート編集、Velocity / CC / Pitch Bend レーン、クオンタイズ（音符・強さ・シャッフル・長さ）、ヒューマナイズ、ベロシティの一括編集
- **打ち込み支援** — 選んだ和音をギターで押さえられる形に置き換えるギターボイシング、拍の位置からダウン / アップを決めるストラムとカッティング（ポップ / ファンク / ロック）、アルペジオ、レガート調整、ベロシティ・シェイパー。適用前にエディター上でプレビューでき、1 回の取り消しで戻せる。ノートのタイミング・長さ・強さで表すもので、ギターのブラッシングやミュート音そのものは出ない
- **ドラムエディター** — 楽器名別のレーン（GM / GS マップ、ユーザーマップ）と画面上のドラムパッド
- **リストエディター** — `MEAS / STEP / NOTE / K# / ST / GT / VEL / CH / TICK` を全列その場で編集。音名や `CC7` / `PC5` の表記、`+`/`-` と縦ドラッグ、あらゆる種類の挿入（GS SysEx のテンプレートやバンク + 音色などのセットも）、種類の変更、選択行の一括変更、鍵盤を弾いて音高を入れる打ち込み。♩=48 表示にも対応
- **ミキサー** — Volume / Expression / Pan / Reverb / Chorus。曲頭の CC として保存
- **サンプル曲** — VISION (GS Version) と Merry X'mas For You!（作曲・制作: cheebow）を同梱。起動ダイアログかファイル › サンプル曲から
- **ビジュアルモード** — レコンポーザ風のイベントリスト（分割表示・3 種類の追従・譜表）、全トラックのピアノロール、トラックごとの鍵盤で演奏を眺める
- **演奏と録音** — PC の文字キー、テンキー（任意）、外部 MIDI キーボード。リアルタイム録音とステップ入力。DAW 風のショートカット（L でループ、M / S でミュート／ソロ、`,` `.` で小節移動など）は PC 鍵盤モードと衝突しないよう入力モードで切り替え
- **ファイル** — SMF Format 0/1 の読み込み、Format 1 の書き出し、内蔵音源での WAV 書き出し、プロジェクトの保存（`.midstudio` とブラウザ内の自動保存）
- **日本語 / English** — 表示 › 言語 で切り替え（ブラウザが英語なら最初から英語）。ヘルプ・入門・紹介ページも両方の言語で
- **GM / GS** — GM 音色、GS の SysEx を保持して書き出し。GS Reset、Use for Rhythm Part、パートの Level / Pan / Key Shift / Send、Reverb / Chorus などは意味付きで表示・編集（一覧は [MIDI_GS_SPEC.md](MIDI_GS_SPEC.md) 10 節）

テンキーのないノート PC でも、ドラム入力やステップ入力を含むすべての操作ができることを基本方針にしています。ライト／ダークのテーマを選べます。

## 使い方

1. `npm install` のあと `npm run fetch-soundfont` で標準音源（GeneralUser GS）を取得し、`npm run dev` で起動します。
2. 起動時のダイアログで、曲（新しい曲 / 前回の自動保存）と MIDI キーボードを使うかどうかを選んで「開始」を押します。
3. 新しい曲はピアノ・ベース・ギター・ドラムの 4 トラックから始まります。

外部 MIDI キーボードを使うには Web MIDI API 対応のブラウザ（Chrome / Edge など）と許可が必要です。非対応のブラウザでも、編集・内蔵音源での再生・PC キーボードでの演奏と録音は使えます。

### GM / GS について

音は読み込んだ SoundFont（標準は GeneralUser GS。手元の .sf2 / .sf3 / .dls も 512 MiB まで使えます）で鳴ります。GS の SysEx は保持・編集できますが、**Roland SC-55 / SC-88Pro 実機の音色やエフェクトを再現するものではありません。**

## 技術構成

React / TypeScript（strict）/ Vite。音源は SpessaSynth（spessasynth_lib 4.4.2）+ SoundFont。MIDI データの読み書き・編集・時間計算は UI や音源に依存しない独自のコアで、単体テストで検証しています。内部の時間は楽曲ごとの PPQ をそのまま使う整数 Tick で、読み込んだ SMF の PPQ を勝手に変えません。ノート・CC・SysEx・未知のメタイベントは捨てずに保持します。

[MML Studio](https://github.com/cheebow/MMLStudio) の音源まわりの知見を参考にしていますが、MIDI Studio は独立したプロジェクトです。

## 既知の制限

- 外部 MIDI 出力はありません（内蔵音源で完結させる方針です）。
- 再生中に変えたノート・音色・テンポは、音を途切れさせないため停止・シーク・ループの折り返しのときに反映します（ミュート／ソロ・ループ範囲・CC は即時）。
- 途中でのポート変更は再生に反映しません。録音のタイミング精度は未実測です。
- 性能の計測は [docs/PERFORMANCE.md](docs/PERFORMANCE.md)、設計の判断の記録は [docs/DECISIONS.md](docs/DECISIONS.md) にあります。

## 開発

```bash
npm install
npm run fetch-soundfont   # 標準音源 GeneralUser GS を作者の公式リポジトリから取得（SHA-256 で照合）
npm run dev               # http://localhost:5173/
npm run build             # dist/ に静的ファイルを出力
npm test                  # 単体・結合テスト（Vitest）
npm run test:e2e          # E2E（Playwright: Chromium / Firefox / WebKit）
npm run lint && npm run typecheck
```

Node.js 22 以上。仕様書は [SPEC.md](SPEC.md)、[ARCHITECTURE.md](ARCHITECTURE.md)、[UI_DESIGN.md](UI_DESIGN.md)、[INPUT_RECORDING.md](INPUT_RECORDING.md)、[TEST_PLAN.md](TEST_PLAN.md)。Claude Code での開発の進め方は [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) と [CLAUDE.md](CLAUDE.md) を参照してください。

## ライセンス

MIDI Studio 本体は [MIT ライセンス](LICENSE)（© 2026 cheebow）です。同梱・取得する音源とライブラリはそれぞれのライセンスに従います。

- 標準音源: GeneralUser GS v2.0.3 © S. Christian Collins — [public/licenses/GeneralUser-GS-LICENSE.txt](public/licenses/GeneralUser-GS-LICENSE.txt)
- 音声合成: spessasynth_lib / spessasynth_core（Apache-2.0）— [public/licenses/spessasynth_lib-LICENSE.txt](public/licenses/spessasynth_lib-LICENSE.txt)
- その他のライブラリ: [public/licenses/THIRD_PARTY.md](public/licenses/THIRD_PARTY.md)
- サンプル曲（VISION (GS Version)、Merry X'mas For You!）: © cheebow。MIT の対象外で、試聴・編集用です。曲そのものの再配布・商用利用はできません — [public/samples/LICENSE.txt](public/samples/LICENSE.txt)

## 商標について

「レコンポーザ」は株式会社カモンミュージックの製品名です。本プロジェクトは同社とは無関係で、公認も受けていません。本文中の「レコンポーザ風」は、数値リストで MIDI データを編集・表示するという考え方に着想を得たことを説明するための表現で、同製品の画面やロゴは使用していません。
