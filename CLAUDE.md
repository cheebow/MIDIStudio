# Claude Code 実装指示 — MIDI Studio

このリポジトリにある `SPEC.md` を最優先の要件定義とする。作業開始時に `README.md`、`SPEC.md`、`ARCHITECTURE.md`、`MIDI_GS_SPEC.md`、`UI_DESIGN.md`、`INPUT_RECORDING.md`、`TEST_PLAN.md`、`IMPLEMENTATION_PLAN.md`、`docs/DECISIONS.md`、`docs/DEVELOPMENT_GUIDE.md` を読み、先行 Phase の状態を確認する。

## 守るべきルール

1. MML Studio は技術的な参考・再利用候補であり、MIDI Studio は**別プロジェクト**。MML をデータの正本にしない。流用する際は公開リポジトリの現物と依存ライブラリの API を確認してからコピー・適応する。コードの権利・第三者素材のライセンスを確認する。
2. コアは React、DOM、AudioWorklet、SpessaSynth に依存させず、TypeScript の単体テストで検証可能にする。音声はアダプターで分離する。
3. ノート・CC・Pitch Bend・Program・SysEx・未知メタイベントを**黙って捨てない**。未対応のものは raw event として保持し、音声未対応なら明示する。
4. 内部 Tick は整数、楽曲ごとの PPQ を正本とする。既存 SMF の PPQ を無条件で 480 に量子化しない。演奏位置・メトロノーム・UIは単一 Transport を参照する。
5. UI の各エディターとビジュアルモードは**同じ楽曲データ**を参照する。音符の変更を別々に保持しない。
6. PCキーボードで通常の MIDI ノート演奏とドラムパッド入力を可能にする。テンキーは任意。テンキーがなくても録音、ステップ入力、ステップ移動を完結できること。
7. Web MIDI 非対応でも通常の編集・再生・PCキーボード入力は機能させる。外部 MIDI 入力の許可拒否・抜き差し・フォーカス喪失に対処する。
8. Roland GS のイベントを保持/編集することと、Roland実機音色の完全再現を混同しない。対応済み・未対応・音源依存を UI/README に明記する。READMEはGitHub公開向けのプロジェクト紹介とし、未実装機能を実装済みと書かない。
9. 開発では音源・ファイルを外部 API に送らない。ローカルファイル処理、静的公開、ユーザー操作による保存を基本とする。収集・解析のための外部通信やクラウド保存機能は作らない。
10. Phase順を守り、各段階の unit / integration / E2E / 手動試聴のうち該当項目を検証する。テストが未実施なら理由と影響を報告する。常に `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test` を健全に保つ。
11. 完了前に実行されたテストコマンド、結果、残る制限、手動試聴の可否を報告。できていないことを「完成」と表記しない。
12. 実装途中の設計変更は `docs/DECISIONS.md` に日付・理由・選択肢・互換性影響・検証結果を記録。仕様書とテストも更新する。
13. ブランチ運用: 日々の作業は `develop` から切った作業ブランチで行い、PR は `develop` に向ける（GitHub の既定ブランチも `develop`）。`main` は公開版で、push すると GitHub Pages に配信される。公開は `develop` を `main` にマージするときに行い、そのたびに `package.json` の version を上げ（挙動が変わるなら minor、修正だけなら patch）、`CHANGELOG.md` に利用者向けの言葉で変更を書き、`vX.Y.Z` のタグを付けて `--tags` で push する（手順は `docs/DEVELOPMENT_GUIDE.md`）。

## Phase の実行方法

- `IMPLEMENTATION_PLAN.md` の **Phase 0 → 7** を順番に実施。
- 各 Phase の作業前に対応するテスト ID を確認し、変更内容を小さな単位で実装する。
- 依存ライブラリの version と型定義を実機確認。Web API / SpessaSynth に存在しないメソッドを推測で使用しない。
- 外部 MIDI 機器がない環境では擬似入力テストを実行し、実機動作を「未検証」と記載する。
- SF2 不在でも単体テストと UI は起動可能にし、再生不能の理由を表示する。
- 技術的に厳しい項目を発見した場合、スコープの縮小を独断で行わず、代替案と制限を記録した上で仕様に従う範囲を進める。

## 禁止事項

- MML Studio の旧仕様（480 PPQ 固定、16チャンネル1セットなど）を MIDI Studio に無批判に移植。
- `setInterval`/`setTimeout` だけを音声の正本クロックにする。
- 楽曲全体を毎 animation frame に再描画する UI。
- SysEx/未対応イベントの警告なし破棄。
- Windows専用のショートカットやUSキーボードしか想定しない固定キー割当。
- GS対応を「SC-88Pro完全再現」と宣伝。
- 公開音源への無断ホットリンク、第三者の商用 MIDI ファイルや音源のテスト素材への同梱。
