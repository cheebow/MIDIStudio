# MIDI Studio — Claude Code フェーズ別実装計画

> 開発は **Phase 0→7**。各フェーズの実装を省略して先に「完成」と呼ばない。後続Phaseに残す場合もデータモデルは全仕様に対応可能な形を最初に設計する。

## フェーズ一覧

| Phase | 焦点 | デモできる成果物 |
|---|---|---|
| 0 | リポジトリ・依存調査・音源スパイク | ブラウザでGMピアノが鳴る |
| 1 | MIDIコア・データモデル・保存 | SMF読込/変換/保存・プロジェクト入出力 |
| 2 | Transport・音源再生 | SMF再生/シーク/ループ・Chase |
| 3 | DAWビュー・ピアノロール | ノートをマウス編集して保存/再生 |
| 4 | ドラムエディター・PC/テンキー入力 | ドラムパターンを両レイアウトで作成 |
| 5 | レコンポーザリスト・ビジュアルモード | リスト打込と演奏連動モニター |
| 6 | ステップ録音・リアルタイム録音・外部MIDI IN | 各入力源から録音 |
| 7 | GS詳細機能・品質・公開 | GS対応/互換検証、安定版 |

## Phase 0 — 技術検証

**作業**

- 新規 `MIDIStudio` repoを作成。React/Vite/TypeScript strict/Vitest/Playwright/ESLintのセットアップ。
- MML Studioの `package.json`, `src/engine`, `src/audio` 相当を調査し、使える純粋関数・アダプター・workletスクリプト・音源取得手順を一覧化。
- `spessasynth_lib`で最小MIDIを読み、SF2から音が鳴るスパイクを作る（SMFでも手書きイベントでもよい）。AudioContext起動制限とWorkletパスを確認。
- ライセンスとSoundFont配布条件確認。バージョン固定。
- 初期デモプロジェクト、エラー表示、対応ブラウザのベースを作る。READMEはGitHub公開向けの紹介として維持し、実装できた範囲に合わせて「開発状況」を更新する。開発手順は `docs/DEVELOPMENT_GUIDE.md` に記載する。

**終了**: ビルド成功、手動で発音、ライブラリAPIの現物検証、調査結果をDECISIONSへ記録。

## Phase 1 — MIDIコア

**作業**

- `MidiProject`, `MidiTrack`, `MidiEvent`, `Conductor`, `MidiClip`, `TempoMap`, `TimeSignatureMap` を実装。
- SMF0/1 ReaderとFormat1 Writer、VLQ/running status、トラック/チャンネル/ポート、SysEx/未知Meta等の保持。
- NoteOn/NoteOffペア化、オーバーラップ曖昧性、Raw回避、import diagnostics。
- `.midstudio` JSON serializer+validator+migration、IndexedDBへの基本保存/読込。
- Command/Undo/Redo基盤、イベント並べ替え、選択インデックス。
- Tempo/拍子/Tickの時間演算、Classic48の有理数表示と検証。

**終了**: C01〜C15、O01/O04のユニット/統合テスト。SMFの意味的roundtripとプロジェクトsave-loadをデモ。

## Phase 2 — 音源・Transport

**作業**

- `PlaybackAdapter`/`SpessaAdapter`、Transport状態、Play/Pause/Stop/Seek/Loopを実装。
- Project→SMF snapshot→Sequencer、SoundFontロード、ミュート/ソロ、録音用プレビュー発音。
- `EventChase`、Safety Panic、SoundFont切替、再生中の編集確定に対する再ロード戦略。
- メトロノーム用音声スケジューリング、再生位置購読hook。

**終了**: P01/P03/P04/P05/P09/P10/P11。手動試聴、ノート張り付き対策確認。

## Phase 3 — 現代DAW編集

**作業**

- Transportバー、Track Inspector、Arrangement（Canvas/DOM）、MIDIクリップの選択/移動/複製/分割。
- ピアノロールノート編集、Velocity/CCレーン、グリッド、Zoom/Pan/Select、多重ノート、Undo。
- メニュー、ショートカット、トラック管理、編集済み/未保存状態。
- 再生追従、キー配置と編集フォーカス基盤。

**終了**: E01/E03/E04/E08/E10/E11、P02(DAW内)、O01。UIで短曲を作り保存/再生可能。

## Phase 4 — ドラムとPCキーボード

**作業**

- Cubase風ドラムレーン描画、GMマップ、ユーザーマップ、キットプレビュー。
- PC鍵盤仮想ピアノ/ドラムパッド、ノートPC文字列プリセット、テンキー、画面ドラムパッド。
- InputFocusRouter、IME/キーフォーカス/blur/NumLock等の安全処理。
- 文字キー/テンキーのリアルタイム**演奏プレビュー**。録音機能はPhase6で統合。

**終了**: E02/E07/E09、I01〜I07（録音機能以外）、テンキーなし機種でパッド演奏確認。

## Phase 5 — リスト編集とビジュアルモード

**作業**

- リストのMEAS/STEP/NOTE/K#/ST/GT/VEL、NativeTick/Classic48、行/セル選択、数値入力、リップル、インスペクター。
- Note/CC/Program/PB/SysEx/Metaの表示。表示フィルター、安全な数値入力、ショートカット。
- ビジュアルモードの単一/複数トラック表示、FixedCursor/PageTurn/SmoothFollow、レトロテーマ、Fullscreen。
- Transport positionだけを参照し、テンポ変化・ループ・Seekで追従再構築。

**終了**: E05/E06/E07/E12、P02/P06〜P08。デモとしてビジュアルモードで自作曲を再生し画面を追従させる。

## Phase 6 — 入力と録音

**作業**

- StepRecorderをPiano/Drum/Listすべてに接続。休符/タイ/和音/ステップ前後/Velocity/GT設定。
- LiveRecorder: PC鍵盤/テンキー/外部MIDI鍵盤を統合。TempoMapでevent timestamp→Tick、Overdub/Replace/LoopTake/Punch、RecordQuantize、CountIn。
- Web MIDI IN接続/許可/切断/非対応フォールバック。Panic、音源モニター、レイテンシ補正。

**終了**: I01〜I15、手動PCキーボードリアルタイム録音、外部MIDI機器があれば実機検証。なければ結果を未検証と明記。

## Phase 7 — GM/GS詳細と製品品質

**作業**

- GM/GS音色・ドラムキット/Bank/Program、SysEx編集インスペクター、GS Reset/リズムパート等を追加。
- RPN/NRPN/CCレーン、GS decoder/checksum、未対応パラメータのraw保持/明示。
- EventChase、複数ポート、mixer UI、SMF roundtripの回帰を確認。
- 大規模曲・ブラウザ比較・エラー時復旧・音源ライセンスの監査。ヘルプ・FAQ・ユーザーテスト。
- 静的配布の設定、無償サーバーでの動作確認、e2eと最終受入レポート作成。

**終了**: SPEC第9節全項目、MIDI_GS_SPEC第9節、TEST_PLANの自動/手動項目。公開可能ビルドと制限事項を報告。

## フェーズ完了報告の指示（Claude Code用）

フェーズごとに以下を必ず出す。

```text
Phase X completed?
- Implemented: ...
- Test IDs passed: ...
- Commands run: ...
- Manual audio check: ...
- Browser(s) verified: ...
- Known limitations / deferred items: ...
- Updated specs / decisions: ...
- Next Phase:
```

**ユーザーが何を指示するまで実装を止める必要はない**。可能な限り順次進める。ただしフェーズを飛ばして不完全なプロトタイプを「製品完成」とするのは禁止。

## 改修時の注意

- ライブラリの内部APIが変わった場合、アダプターを先に修正し、coreの型を音源に依存させない。
- 大規模SMFの変換を重くする場合はWorker導入を検討するが、仕様要件の削除と混同しない。
- ユーザーが設計変更を依頼したら、まず正本 `SPEC.md` と詳細仕様、テスト表、DECISIONSの整合性を更新してから改修する。
