# MIDI Studio — 受入レポート（Phase 7 終了時点, 2026-11-01）

```text
Phase / Version: Phase 0〜7 実装済み / 0.0.1（初版候補。手動受入は未完了）
Implementations completed: 下記「SPEC 第9節」参照
Automated tests: typecheck / lint / unit+integration（Vitest）/ E2E（Playwright: Chromium・Firefox・WebKit）/ build — すべて成功
Manual sound test: not tested（実際に音が聞こえるか・音の張り付き・メトロノームの同期はユーザーの手動試聴待ち）
Web MIDI hardware test: not tested（実機の MIDI キーボードなし。擬似 MIDIAccess で自動テスト）
Browser coverage: Chromium・Firefox・WebKit（Playwright ヘッドレス）で編集・入出力・入力を確認。実音エンジンの自動確認は Chromium のみ
Known limitations: 下記
Compatibility notes (GM/GS, SF2): MIDI_GS_SPEC 10 節。SC-55 / SC-88Pro 実機の再現ではない
```

## SPEC 第9節 全体受入条件

| # | 条件 | 状態 | 根拠 |
|---|---|---|---|
| 1 | SoundFont で MIDI0/1 を取り込み再生 / 停止 / シーク | 自動確認済み（音は手動待ち） | `audio-spike.spec.ts`（Chromium 実エンジン）、`transport.test.ts` |
| 2 | DAW で作ったノートがピアノロール / リスト / ドラムで同じイベント | 自動確認済み | `editing.spec.ts`、`drum-input.spec.ts`（E02）、`list-visual.spec.ts`（選択共有） |
| 3 | リストの ST / GT 編集がピアノロールと書き出しに正確に反映、丸めない | 自動確認済み | `list.test.ts`、`list-visual.spec.ts`（E05 / E06 / E07） |
| 4 | GM ドラム曲をドラムエディターで編集、マップ切替で音高不変 | 自動確認済み | `drum-input.spec.ts`（E09） |
| 5 | PC 鍵盤とテンキー / テンキーなしで演奏・ステップ入力・リアルタイム録音 | 自動確認済み（音・実キーボードの手触りは手動待ち） | `keyboard-router.test.ts`、`recording.spec.ts`、`recording-flow.test.ts` |
| 6 | Web MIDI 対応環境で外部鍵盤録音、非対応では分かりやすく無効化 | 一部（擬似機器・UI は確認、実機は未検証） | `midi-input.test.ts`、`recording-flow.test.ts`、`recording.spec.ts`（I13） |
| 7 | 再生中に DAW → ビジュアルモードで中断しない、ループ / テンポ / シーク追従 | 自動確認済み | `list-visual.spec.ts`（Chromium 実エンジン）、`list.test.ts`（P06〜P08） |
| 8 | GS SysEx を含む SMF を編集・再書き出ししても保持、未対応効果を明示 | 自動確認済み | `gs.test.ts`、`gs-quality.spec.ts`、`smf-roundtrip.test.ts` |
| 9 | .midstudio 保存 / 再読込でデータ・画面設定・キー割当が復元、SMF 往復比較 | 自動確認済み | `project-file.test.ts`、`project-io.spec.ts`（O01） |
| 10 | TEST_PLAN の自動 / 手動試験を実行し、機能未達とブラウザ制約を説明 | 自動は実行済み、手動は未実施 | 本書 |

SPEC の定義では「すべての受入条件を満たした時点で初版完成」のため、**手動試聴と実機 MIDI の確認が終わるまで「完成」とは表記しない**。

## TEST_PLAN の ID 別状況

- 自動テストで合格: C01〜C15、E01〜E13、P01〜P11（P は偽エンジンの結合テストと Chromium 実エンジンの E2E）、I01〜I15（I13 / I14 は擬似 MIDI 機器）、O01、O02、O04、O06（負荷曲の計測）、O07（Firefox / WebKit で Web MIDI が無い場合の表示）
- 一部のみ: O03（IndexedDB の容量超過は通知処理を実装済みだが、実際に容量を使い切る試験は未実施）、O05（SoundFont 切替でイベントが変わらないことはコード上保証。音の比較は手動）
- 手動待ち: TEST_PLAN 9 の手動受入シナリオ 1〜10 すべて（実際の音、ドラムのキー入力の手触り、テンキー実機、JIS 実機、NumLock OFF、外部 MIDI キーボード、Safari / Firefox での音）

## 手動試聴チェックリスト（ユーザー確認用）

1. `npm run dev` → Chrome で「音源を起動」→ ピアノロールで C4 / E4 / G4 を描いて再生。音が出る・止まる・張り付かない。
2. ループ ON で再生、折り返しで音・サステインが残らない。メトロノームがずれない。
3. ドラムトラックでパッド（M , . / テンキー 1 2 3）を鳴らす。テンキーなしのノート PC でも鳴る。
4. PC 鍵盤モードで Z〜M を弾き、R で録音 → 再生で同じタイミングか。
5. 外部 MIDI キーボードがあれば Chrome で MIDI 入力を許可 → 録音、途中で USB を抜いて音が止まるか。
6. GS SysEx 入りの手持ち SMF（第三者の曲はリポジトリに入れない）で、再生・書き出し後に SysEx が残るか。
7. Safari / Firefox で編集・PC 鍵盤・再生ができ、Web MIDI 無しの表示になるか。

## 既知の制限

- 外部 MIDI 出力なし（ADR-004）。SC-55 / SC-88Pro 実機の音は再現しない。GS は MIDI_GS_SPEC 10 節の項目のみ意味付き、他は 16 進。
- 途中のポート変更（FF 21）は保持・書き出しのみで再生に反映しない。
- クリップは編集グループで、非破壊トリムやテイクコンピングは無い（ADR-005）。
- ヒューマナイズ、ビジュアルモードの全トラック巡回表示は未実装。
- 録音のタイミング精度・入力レイテンシは未実測（レイテンシ補正の設定あり）。
- 性能値はヘッドレスブラウザでの計測（docs/PERFORMANCE.md）。
