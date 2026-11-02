# MIDI Studio

**Webブラウザで動く、MIDI制作に特化した本格シーケンサー。**

MIDI Studioは、現代のDAWのような視覚的な編集と、レコンポーザのような数値入力を両立することを目指すプロジェクトです。MIDIファイルを読み込み、編集し、GM/GS互換の音源で演奏する。再生中はDAW風のタイムライン表示だけでなく、MIDIイベントのリストが演奏に合わせて流れる「ビジュアルモード」も楽しめる設計です。

> **開発状況：Phase 0〜7 を実装済み（初版候補）。** 自動テスト（単体・結合・3ブラウザの E2E）は通っていますが、実際の音の手動試聴と外部 MIDI キーボード実機での確認がまだのため、初版としての完成は未確定です。詳細は [docs/ACCEPTANCE_REPORT.md](docs/ACCEPTANCE_REPORT.md)。

## 主な機能

- **DAWスタイルの編集** — トラック／クリップ、ピアノロール、ベロシティ・CCレーンでMIDIを編集。クオンタイズは音符・強さ・シャッフル・長さを選べるダイアログつき。L / M / S / K / Enter / `,` `.` などDAW風の1文字ショートカットは、PC鍵盤モードと衝突しないようツールバーの入力モードで切り替える。
- **ドラム専用エディター** — Cubase風の楽器名別レーン。ピアノロールと表示を切り替え可能。
- **レコンポーザ風リスト編集** — `MEAS / STEP / NOTE / K# / ST / GT / VEL` を表示し、PCキーボードで高速な数値入力。
- **2つの再生表示** — DAWの再生ヘッド追従表示と、イベントリスト・全トラックのピアノロール・鍵盤で演奏を眺める「ビジュアルモード」。
- **多彩な演奏・録音入力** — マウス、PCの文字キー、テンキー（任意）、外部MIDIキーボード。リアルタイム録音とステップ入力に対応。
- **MIDIファイルとGM/GS** — SMF Format 0/1の読み込み、Format 1の書き出し、内蔵音源でのWAV書き出し。GM音色、GS系イベント、SysExデータの保持・編集を重視。
- **ブラウザ内で完結** — 音源はSoundFontとWeb Audioを利用。ユーザーのMIDIデータを外部APIに送信しない設計。

テンキーを持たないノートPCでも、ドラム入力やステップ入力を含めた全操作を行えることを基本方針としています。

## 画面の構想

| 編集・再生画面 | 用途 |
| --- | --- |
| トラックビュー | 曲全体の構成、MIDIクリップの作成・移動・複製・分割・長さ変更（非破壊）、トラックの並べ替え |
| ピアノロール | ノート編集、Velocity / CC / Pitch Bend レーン |
| ドラムエディター | 楽器名別レーン（GM / GS マップ、ユーザーマップ）、画面ドラムパッド |
| リストエディター | MEAS / STEP / NOTE / K# / ST / GT / VEL、♩=48 表示、テンポ・拍子の編集 |
| ミキサー | Volume / Expression / Pan / Reverb / Chorus（曲頭の CC として保存） |
| ビジュアルモード | 演奏の表示。レコンポーザ風のイベントリスト（分割表示・3 種類の追従方式・譜表）、全トラックのピアノロール、トラックごとの鍵盤を切り替え |

スクリーンショットは公開時に追加予定です。

## 技術構成

React / TypeScript（strict）/ Vite。音源は SpessaSynth（spessasynth_lib 4.4.2）+ SoundFont（標準は GeneralUser GS）。MIDI データの読み書き・編集・時間計算は UI や音源に依存しない独自のコアで、単体テストで検証しています。[MML Studio](https://github.com/cheebow/MMLStudio) の音源まわりの知見を参考にしていますが、MIDI Studio は**独立したプロジェクト**です。

外部MIDIキーボード入力にはWeb MIDI API対応ブラウザ（Chrome / Edge など）とユーザーの許可が必要です。Web MIDI非対応のブラウザでも、MIDI編集・内蔵音源再生・PCキーボード入力・録音は使えます。

### GM / GS について

GS の SysEx は保持・書き出しに対応し、GS Reset・Use for Rhythm Part・パートの Level / Pan / Key Shift / Send・Reverb / Chorus など一部の項目を意味付きで表示・編集できます（一覧は [MIDI_GS_SPEC.md](MIDI_GS_SPEC.md) 10 節）。それ以外は 16 進のまま保持します。**Roland SC-55 / SC-88Pro 実機の音色・エフェクトの再現ではありません。**音は読み込んだ SoundFont によります。

## 開発状況と既知の制限

- 実装済み: IMPLEMENTATION_PLAN の Phase 0〜7（詳細と各 Phase の判断は [docs/DECISIONS.md](docs/DECISIONS.md)）。
- 手動試聴（2026-11-02）: 内蔵音源での再生、再生中のミキサー操作、ループ、トラックの並べ替えを確認済み。未確認: 外部 MIDI キーボード実機での録音、Safari / Firefox での音。
- 制限: 外部 MIDI 出力なし、途中のポート変更は再生に反映しない、録音タイミング精度は未実測。再生中に変えたノート・音色・テンポは音を途切れさせないため停止・シーク・ループの折り返しで反映（ミュート／ソロ・ループ範囲・CC は即時）。性能の計測結果は [docs/PERFORMANCE.md](docs/PERFORMANCE.md)。

## 仕様・開発ドキュメント

- [SPEC.md](SPEC.md) — プロダクト仕様と必須要件
- [ARCHITECTURE.md](ARCHITECTURE.md) — データモデルと再生／編集アーキテクチャ
- [MIDI_GS_SPEC.md](MIDI_GS_SPEC.md) — SMF、MIDIイベント、GM/GS、SysEx
- [UI_DESIGN.md](UI_DESIGN.md) — 各エディターとビジュアルモードの操作
- [INPUT_RECORDING.md](INPUT_RECORDING.md) — キーボード入力、録音、ステップ入力
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — 開発フェーズと受入条件
- [TEST_PLAN.md](TEST_PLAN.md) — テスト計画
- [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) — Claude Codeを使った開発の始め方
- [CLAUDE.md](CLAUDE.md) — Claude Code向け実装ルール

## 開発者向けの起動方法

```bash
npm install
npm run fetch-soundfont   # 標準音源 GeneralUser GS を作者の公式リポジトリから取得
npm run dev
```

詳しくは [docs/DEVELOPMENT_GUIDE.md](docs/DEVELOPMENT_GUIDE.md) を参照してください。

## ライセンス表記

- 標準音源: GeneralUser GS v2.0.3 © S. Christian Collins — [public/licenses/GeneralUser-GS-LICENSE.txt](public/licenses/GeneralUser-GS-LICENSE.txt)
- 音声合成: spessasynth_lib / spessasynth_core（Apache-2.0）— [public/licenses/spessasynth_lib-LICENSE.txt](public/licenses/spessasynth_lib-LICENSE.txt)
- その他の同梱ライブラリ: [public/licenses/THIRD_PARTY.md](public/licenses/THIRD_PARTY.md)

MIDI Studio 本体は [MIT ライセンス](LICENSE)（© 2026 cheebow）です。同梱の音源・ライブラリはそれぞれのライセンスに従います。

## 商標について

「レコンポーザ」は株式会社カモンミュージックの製品名です。本プロジェクトは同社とは無関係で、公認も受けていません。本文中の「レコンポーザ風」は、数値リストで MIDI データを編集・表示するという考え方に着想を得たことを説明するための表現で、同製品の画面やロゴは使用していません。
