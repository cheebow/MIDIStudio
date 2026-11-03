# MIDI Studio — MIDI入力・ステップ録音・リアルタイム録音

## 1. 入力ソースの抽象化

すべての入力は `InputNoteOn`, `InputNoteOff`, `InputCC`, `InputPitchBend`, `InputPressure` の**共通入力イベント**へ正規化する。入力元は `mouse`, `pc-keyboard`, `numpad`, `web-midi` を保持。プレビュー発音と録音コミットを分ける。

```ts
type MusicalInputEvent =
  | { type:'note-on'; pitch:number; velocity:number; sourceId:string; atMs:number }
  | { type:'note-off'; pitch:number; releaseVelocity:number; sourceId:string; atMs:number }
  | { type:'cc'; controller:number; value:number; sourceId:string; atMs:number }
  | { type:'pitch-bend'; value:number; sourceId:string; atMs:number }
  | { type:'pressure'; value:number; sourceId:string; atMs:number };
```

UIが選ぶ `Armed Track / Port / Channel` に向けてルーティング。外部MIDI受信チャンネルを追従するか選択トラックへリマップするかは設定。対象トラックが曖昧なら録音しないで警告。

録音の設定「トラックを選ぶと、そのトラックを録音待機にする」をオンにすると、トラックを選択したときにそのトラックだけが Arm になる（ADR-040、既定はオフ）。オフのときは R を自分で押す。

## 2. PCキーボードの楽器モード

- 標準文字キーを仮想鍵盤として使用。音名割当は `KeyboardEvent.code` を使い物理配置を固定、JIS/USのラベルと位置を説明。
- 初期レイアウト例: 下段 `KeyZ`=C4、`KeyX`=D4、`KeyC`=E4、`KeyV`=F4、`KeyB`=G4、`KeyN`=A4、`KeyM`=B4、黒鍵は `KeyS`=C#4、`KeyD`=D#4、`KeyG`=F#4、`KeyH`=G#4、`KeyJ`=A#4。上段QWERTYには次オクターブを割り当て可能。
- オクターブ上下、Velocity増減、Sustain On/Off、キーマップ切替はメニュー/独立ショートカットで提供。文字入力中は発音しない。
- KeyDownでnote-on、KeyUpでnote-off。`event.repeat===true` を捨てる。`pressedCodes` を持ち、同じキーの多重Onを防ぐ。
- ウィンドウ非アクティブ/タブ非表示/モード変更/キーマップ変更/音源切替時は、PC鍵盤からの発音ノートをすべてNoteOff/All Notes Off相当で停止する。
- キーボードのゴースティング/Nキーロールオーバー限界はデバイス依存。3和音/4和音を実機確認し、ヘルプに明記。
- PCキーにはハードウェアVelocityがないため、既定固定値100、アクセントキー、16段階プリセット（必要に応じ増減）、ドラムレーンごとの既定値を使う。

## 3. ドラムパッド入力：テンキーなしとテンキーあり

**両方のプリセットを標準提供。テンキーは必須ではない。**

### ノートPC向け初期プリセット（物理コード）

| 物理キー | 割当（GM Note） | 物理キー | 割当（GM Note） | 物理キー | 割当（GM Note） |
|---|---|---|---|---|---|
| `KeyU` | Crash 49 | `KeyI` | Ride 51 | `KeyO` | Open HH 46 |
| `KeyJ` | Low Tom 45 | `KeyK` | Mid Tom 47 | `KeyL` | High Tom 50 |
| `KeyM` | Kick 36 | `Comma` | Snare 38 | `Period` | Closed HH 42 |

### テンキー初期プリセット

| Code | GM Note | Code | GM Note | Code | GM Note |
|---|---|---|---|---|---|
| `Numpad7` | Crash 49 | `Numpad8` | Ride 51 | `Numpad9` | Open HH 46 |
| `Numpad4` | Low Tom 45 | `Numpad5` | Mid Tom 47 | `Numpad6` | High Tom 50 |
| `Numpad1` | Kick 36 | `Numpad2` | Snare 38 | `Numpad3` | Closed HH 42 |
| `Numpad0` | Kick 36 | `NumpadDecimal` | Closed HH 42 | `NumpadEnter` | Snare 38 |

- これは変更可能なデフォルト例であり、GM/GSドラムマップごとに切り替え可能。ユーザー割当をキット切替で上書きしない。
- `NumpadAdd`/`NumpadSubtract` はステップ進む/戻るの**候補**。テンキーなし向けに専用の画面ボタンと設定可能な通常キーを必ず用意する。
- Num Lockの状態が異なる場合も `code` と `location` を見て適切に扱う。JIS/USで`NumpadDecimal` の表示文字が変わっても音色は同じ。
- 画面上の12〜16パッドをクリック/タップしても同じ入力イベントにする。PCキーボード未接続でもマウスで打ち込める。
- キーアサインを同時に2セット有効にできる。ただし同一キーを音階とドラムへ二重発音させず、モードで優先先を決める。

## 4. 外部MIDIキーボード（Web MIDI IN）

- `navigator.requestMIDIAccess({ sysex: false })` をユーザー操作から要求する。**外部鍵盤を入力するだけならSysex権限を要求しない**。
- `MIDIAccess.inputs`の一覧から選択。接続中の機器名、ステータス、入力チャンネルフィルタを表示。
- メッセージ解析: running status前提は機器の送信フォーマット次第なので標準的ステータスを扱い、NoteOn velocity 0 をNoteOffへ変換。
- NoteOn/Off, CC, Pitch Bend, Channel/Poly Pressureを受信。ProgramChangeを録音するかどうかは設定。SysEx入力は当面対象外（SMFでのSysEx編集は別）。
- MIDI機器の抜き差しで `statechange` を反映。デバイス切断時はそのデバイス由来のノートを止め、録音の不整合を通知する。
- 権限拒否や非対応環境でもPCキーボードとマウスは動作。Safariなどの対応差は機能検出で判断する。
- MIDIタイムスタンプは `MIDIMessageEvent.timeStamp` と共通の `performance.now()` 系クロックから録音基準へ写像。AudioContext/currentTimeとの時刻オフセットを計測し、ループ/一時停止/テンポ変更に対処。

## 5. リアルタイム録音

1. `Arm`した一つ以上の対象トラック、入力源、入力チャネル、録音モード（Replace/Overdub）を決定。
2. メトロノームと指定小節のカウントインを開始し、録音開始のTransport tick/timeを確定。
3. 入力イベントの時刻から絶対Tickを計算（TempoMap。録音中に曲のテンポが変わっても正しく変換）。
4. NoteOn/Offをペアリングしノートイベントを記録。音のプレビューは録音コミットと独立。
5. CC64（サステイン）はNoteOffをノート長から勝手に引き延ばさず、CC64イベントとして記録。音源側のペダル挙動は音源に任せる。
6. Record Stopで未終了ノートを停止位置に閉じ、`recording ended`警告を履歴へ表示。Undo一回で直前テイクを戻せる。
7. 録音直後にはクオンタイズしない（設定で録音クオンタイズを選べる）。まず元Tickを保存し、後から非破壊的な提案/確定操作を行う。

- Count-In: 0, 1, 2, 4 小節。カウントインの最後の 1 拍に弾いたノート（曲頭の少し手前のピックアップ）は捨てずに開始位置へ揃える。それより前の入力は記録しない（停止時のメッセージで件数を伝える）。SMF に負の時刻はないため、曲頭より前にはみ出したまま保持することはしない（ADR-047）。
- Metronome: ON/OFF、音量、強拍/弱拍、拍子変更追従。クリック音は低遅延音声タイミングにスケジューリングする。
- Punch-In/Out: 範囲外入力は記録しない。再生/プレビュー自体は継続可能。NoteOffが境界外へ出た場合の丸めルールを明示。
- Loop Record: 各周回のテイクを別take IDとして保存。初版は「Merge」/「最終テイク選択」を提供。Takeの自動優劣判定はしない。
- Replace録音でも録音前状態はUndoで回復できるようにする。

## 6. ステップ録音

- モード: 1音入力、和音入力、ドラムパターン入力。
- StepLength: 1/1, 1/2, 1/4, 1/8, 1/16, 1/32, 1/64、付点/三連符、Native Tick入力。GateLengthはStepLengthの割合(例90%)または独立Tickで指定可能。
- PCキーボード音階モード: 1キー押下でカーソル位置にNote作成、通常は1ステップ進む。和音モードでは鍵盤同時押しをまとめ、最後のKeyUp時に一度進む。必要なら最大同時押し待ち時間を設定。
- 外部MIDI鍵盤: 同様。受信velocityをノートに保存。接続できない場合も同機能へアクセス可能。
- ドラムモード: キー/パッドを押すと現在ステップに対応するノートを追加、**自動進行ON/OFF**を選べる（同ステップにKick＋HH＋Snareなどを重ねるため、ドラムは既定OFF）。次/前ステップの画面ボタンと通常キーショートカットを用意。
- 休符・タイ・取り消し・1ステップ戻る・ベロシティ変更・ゲート変更・ノート置換はキーボードまたは画面UIで完結。
- 入力位置はリスト、ピアノロール、ドラムエディターに共通の `StepCursor`。
- クラシックST/GTリストの「前の値を繰り返す」「入力後次セル/次行へ」操作と、ピアノ演奏入力を明確に分離。

## 7. 入力・UIのモード衝突防止

```ts
type InputMode =
  | 'edit-shortcuts'       // 初期状態
  | 'piano-performance'
  | 'drum-performance'
  | 'step-piano'
  | 'step-drums';
```

- かつて宣言だけあった `list-cell-edit` は削除した（ADR-066）。セル入力中の排他は、`input` にフォーカスがある間は router も global shortcuts もキーを無視する規則で成立している。
- リストのグリッドが持つキーは入力モードごとに `src/input/listKeys.ts` の表で決め、持たないキーは `stopPropagation` せずに通す（JIS / US の違いを吸収するため `e.key` で判定）:

| キー | 編集 | 鍵盤 | パッド | ステップ鍵盤 | ステップパッド |
|---|---|---|---|---|---|
| 楽器キー（`ownerOf` あり） | - | 通す | 通す | 通す | 通す |
| ↑↓（Shift で選択拡張） | 行移動 | 行移動 | 行移動 | 行移動 | 行移動 |
| ←→ | 列移動 | 列移動 | 列移動 | 通す（戻る / 休符） | 通す |
| Tab / ⇧Tab | 列移動 | 通す（サステイン） | 列移動 | 列移動 | 列移動 |
| Enter / ⇧Enter / F2 | 編集開始 | 同左 | 同左 | 同左 | 同左 |
| 数字 `0-9 . /` | 入力開始 | 通す | 通す | 通す | 通す |
| `+` `=` `-`（numpad も） | ±1 | 通す | 通す | 通す（`-` はタイ） | 通す |
| ⌥/Alt + ↑↓ | ×10（K# は ±12） | オクターブ | ×10 | オクターブ | ×10 |
| N C P B A Y S M | 直接挿入 | 通す（楽器） | 通す | 通す | 通す |
| ⌘/Ctrl + Enter | 前回値の繰り返し | 同左 | 同左 | 同左 | 同左 |
| Delete | 削除 | 削除 | 削除 | 削除 | 削除 |
| Backspace | 削除 | 削除 | 削除 | 通す（ステップ取消） | 通す |
| PgUp / PgDn / Home / End | グリッド | 同左 | 同左 | 同左 | 同左 |
| Insert / ⌥Enter | 挿入メニュー | 同左 | 同左 | 同左 | 同左 |
| Space, Esc, 英字, ⌘系 | 通す | 通す | 通す | 通す | 通す |

- リストにフォーカスがあるとき、弾いた音高は現在行の K# に書かれ、押さえたまま弾いた音は同じ位置に和音として入り、全部離すと次の K# 行へ進む（ステップモード以外。編集モードでは外部 MIDI 鍵盤から。録音中は Recorder が入力を所有し、リストは何もしない）。ステップモードは StepController が書く。

- `input`, `textarea`, `contenteditable`, ダイアログ、ファイル選択をフォーカスしている間はPC鍵盤演奏を禁止。
- キーボードショートカットはモードごとの表を持ち、競合をUIで警告。ドラム演奏中はテンキーを数字セル入力に使えないが、リストセル編集時はテンキーは数値入力を優先する。
- 全操作で現在モードを見えるようにする。モード切替時に鳴りっぱなしノートを確実に止める。
- 鍵盤モードの補助キー: ↑ ↓ でオクターブ（ツールバーの Oct− / Oct+ と同じ。ステップ（鍵盤）でも）、Tab を押している間サステイン（Sus ボタンは押すたびに切り替え）。
- 切り替えはツールバーのセグメント（編集 / 鍵盤 / パッド / ステップ ▾）、MIDI メニュー、キーボード（⌥K = PC 鍵盤 ⇄ 編集、⌥P = ドラムパッド ⇄ 編集、Esc = 編集へ）の 3 系統。鍵盤・パッド中はセグメントとステータスバーで「1 文字のショートカットは無効」と示す（ADR-044）。1 文字の DAW ショートカット（L / M / S / K …）は編集モードだけで働き、修飾キーつきのものはどのモードでも働く。
- Page/Browserグローバルショートカットを奪えないキーは割当候補から除くか警告。

## 8. 録音の精度と安全

- 固定 `Date.now()` のみでTick換算しない。受信の単調時刻とTransportを同期させる。
- ブラウザバックグラウンド時のタイマー制限やCPU高負荷で入力の遅延があり得る。テストで実測し、レイテンシ補正UI（オフセットms）を提供。
- オーディオ再生クロックとUI更新クロックを混同しない。正確な再生は音源、画面は購読描画。
- パッドのNoteOffが来ない、タブが非アクティブ、Midiデバイス切断、録音停止などの全ケースで Panic/Release-allを実装。

## 9. 検証

- 標準キーボードだけで: Pianoステップ→Pianoライブ→ドラムライブ→ドラムステップ→レコンポーザリスト数値編集まで完走。
- テンキーで: NumLock ON/OFF、Numpad0〜9/Decimal/Enter、JIS/US、同時押し、録音停止時のノート停止。
- Web MIDIで: MIDI鍵盤のキー押下/離し、Velocity、Sustain、Pitch Bend、MIDI切断、権限拒否。実機未所持なら擬似MIDIMessageEventで自動テストし、実機未検証と記録。
- ステップ入力で: コード、休符、タイ、和音の進行、ドラム同Tick複数入力、Undo/Redo、SMF出力一致。
