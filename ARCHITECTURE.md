# MIDI Studio — 技術アーキテクチャ

> `SPEC.md` に従う実装設計。型・関数例は**設計上の契約**であり、SpessaSynthの公開APIと同一とは限らない。依存ライブラリの現物で検証すること。

## A. 技術スタックと再利用

| 層 | 方針 |
|---|---|
| UI | React 19系 / TypeScript strict / Vite / CSS Modulesまたは同等の局所スタイル |
| タイムライン描画 | Canvas 2Dベース（ピアノロール/ドラム/アレンジ）。アクセシビリティ用DOMを併用 |
| リスト | 仮想スクロール付きDOM表。セル編集はHTML inputを使用 |
| 状態 | Reactは描画担当。編集エンジンのCommand/immutable snapshotを正本にする |
| MIDI Core | 独自のSMF parser/writer、モデル、時間変換、ノート編集、GS decoder |
| SoundFont | `spessasynth_lib` + `spessasynth_core` を音源アダプター内部に封じ込める |
| External MIDI IN | Web MIDI API（対応環境のみ、遅延なく受信） |
| Storage | `.midstudio` JSON + IndexedDB + File API |
| Tests | Vitest / Playwright（Chromium、Firefox、WebKit）/ 手動試聴 |

MML Studio 2026-11-01 時点の公開構成は React/Vite/TypeScript、`spessasynth_lib@4.4.2`、独自SMF実装、GeneralUser GS SF2、Vitest/Playwright。**再利用候補はコードを精査した上で確定**し、非MML用に責務を整理して移植する。

## B. ディレクトリ設計

```text
MIDIStudio/
├── CLAUDE.md
├── SPEC.md / ARCHITECTURE.md / UI_DESIGN.md / MIDI_GS_SPEC.md
├── INPUT_RECORDING.md / TEST_PLAN.md / IMPLEMENTATION_PLAN.md
├── docs/
│   └── DECISIONS.md
├── public/
│   ├── licenses/
│   └── soundfonts/           # gitignore: 取得したSF2
├── scripts/
│   ├── copy-worklet.mjs
│   └── fetch-soundfont.mjs
├── src/
│   ├── core/
│   │   ├── model/            # Project, Track, MidiEvent, Clip, TempoMap
│   │   ├── smf/              # parser, writer, running status, VLQ
│   │   ├── timing/           # tick/time/bar-beat, rational unit conversion
│   │   ├── editing/          # Command, history, selection, quantize
│   │   ├── events/           # pairing, ordering, note-off, indexing
│   │   ├── gs/               # SysEx parser, GS bank/kit mapping
│   │   └── project-io/       # .midstudio serialization + migrations
│   ├── playback/
│   │   ├── Transport.ts      # 共通の再生状態/位置
│   │   ├── PlaybackAdapter.ts
│   │   ├── SpessaAdapter.ts
│   │   ├── PreviewRouter.ts
│   │   └── EventChase.ts
│   ├── input/
│   │   ├── KeyboardRouter.ts
│   │   ├── MidiInputAdapter.ts
│   │   ├── LiveRecorder.ts
│   │   ├── StepRecorder.ts
│   │   └── Presets.ts
│   ├── storage/
│   │   ├── indexedDb.ts
│   │   └── files.ts
│   ├── ui/
│   │   ├── transport/
│   │   ├── arrangement/
│   │   ├── piano-roll/
│   │   ├── drum-editor/
│   │   ├── list-editor/
│   │   ├── tm-monitor/
│   │   ├── inspector/
│   │   ├── mixer/
│   │   └── settings/
│   └── app/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── fixtures/             # 自作SMF・イベント列
│   └── e2e/
└── package.json
```

## C. 内部データモデル（規範）

すべての時間値は、原則 **非負安全整数の絶対Tick**。`ppq` はプロジェクト単位で保持する。既存SMFを無条件に480PPQへ変換しない。マウスや録音時の小数Tickは確定編集で丸めて整数化し、量子化とは別に扱う。

```ts
export type Tick = number; // safe integer, >= 0
export type PortId = string; // UI表示 A/B/C/D; exporterは0..127のport番号
export type TrackId = string;
export type EventId = string;

export interface MidiProject {
  schemaVersion: 1;
  id: string;
  title: string;
  ppq: number;               // 通常は480/960、import時はソース値
  conductor: ConductorEvent[]; // tempo/time-signature/marker/key-signature
  tracks: MidiTrack[];
  clips: MidiClip[];
  loop: { enabled: boolean; startTick: Tick; endTick: Tick };
  settings: ProjectViewSettings;
  inputPresets: SavedInputPresets;
  metadata?: Record<string, string>;
}

export interface MidiTrack {
  id: TrackId;
  name: string;
  color: string;
  port: PortId;
  channel: number;            // UI 1..16; serializer 0..15
  displayMode: 'melodic' | 'drum';
  drumMapId?: string;
  mute: boolean;
  solo: boolean;
  recordArm: boolean;
  events: MidiEvent[];
}

export interface MidiClip {
  id: string;
  trackId: TrackId;
  startTick: Tick;
  endTick: Tick;
  eventIds: EventId[];        // 指定イベントをグルーピング。別コピーなし
  name?: string;
  color?: string;
}

export interface NoteEvent {
  id: EventId;
  kind: 'note';
  tick: Tick;                 // onset
  pitch: number;              // 0..127
  velocity: number;           // 1..127 (0はNoteOffとして正規化)
  durationTicks: number;      // >= 1
  releaseVelocity: number;    // 0..127; SMFで保持
  originOrder: number;
  channelOverride?: number;   // importしたマルチチャンネル曲に必要なら設定
  sourceEncoding?: 'note-off' | 'note-on-zero';
}
export type MidiEvent = NoteEvent | ChannelEvent | SysExEvent | RawMidiEvent | TrackMetaEvent;
export type ChannelEvent =
  | {id: EventId; kind:'cc'; tick:Tick; controller:number; value:number; originOrder:number; channelOverride?:number}
  | {id: EventId; kind:'program'; tick:Tick; program:number; originOrder:number; channelOverride?:number}
  | {id: EventId; kind:'pitch-bend'; tick:Tick; value:number; originOrder:number; channelOverride?:number} // -8192..8191
  | {id: EventId; kind:'channel-pressure'; tick:Tick; pressure:number; originOrder:number; channelOverride?:number}
  | {id: EventId; kind:'poly-pressure'; tick:Tick; pitch:number; pressure:number; originOrder:number; channelOverride?:number};
export interface SysExEvent {id:EventId;kind:'sysex';tick:Tick;status:'F0'|'F7';dataBase64:string;originOrder:number}
export interface RawMidiEvent {id:EventId;kind:'raw';tick:Tick;rawBase64:string;originOrder:number;reason:string}
export interface TrackMetaEvent {id:EventId;kind:'meta';tick:Tick;metaType:number;dataBase64:string;originOrder:number}
export type ConductorEvent =
 | {id:EventId;kind:'tempo';tick:Tick;usPerQuarter:number;originOrder:number}
 | {id:EventId;kind:'time-signature';tick:Tick;numerator:number;denominator:number;originOrder:number}
 | {id:EventId;kind:'key-signature';tick:Tick;sharpsFlats:number;minor:boolean;originOrder:number}
 | {id:EventId;kind:'marker';tick:Tick;text:string;originOrder:number};
```

> 実装済みの型は `src/core/model/types.ts`。ここに無いフィールドの追加理由は `docs/DECISIONS.md` ADR-015、同一 Tick の順序の実装は ADR-014 を参照。

型は参考実装契約。運用で必要なら `sourceSmfTrack`, `portChange`, `originalMetaData` と `ImportWarning` 等を拡張。`channelOverride` は元SMFのチャンネル混在を維持するために必要。各トラックには任意の meta/port prefix を保持する。

- SMFに存在する NoteOn/NoteOff は、通常は `NoteEvent` 1件に正規化。重複・未ペアリング・曖昧な同音リトリガーは診断し、**元イベントをRaw/ソース順として保持できる設計**にする。
- テンポや拍子が各SMFトラックに存在する場合、import時に`conductor`へ統合し、衝突と元トラックの情報を記録する。エクスポート前に衝突を明示。Track Metaの未知情報は元のトラックへ保持。
- 同時刻のイベントは `tick`→`orderingPolicy`→`originOrder`→`id` の安定順。既存SMFでは元順を尊重し、生成ノートの場合のみ安全なNoteOff→NoteOn等の順を適用する。
- MIDIポート番号はデータ、表示のA/B/C/Dはラベルにすぎない。port0= A 等のマッピングを保持。

## D. クリップと編集コマンド

- 初回SMF取り込み時は、各トラックのイベント全体を包含するクリップを自動生成。
- **イベントは Track.events だけが正本**。クリップは `eventIds` を通した編集グループ。移動時は属するイベントの Tick を差分移動。範囲に含まれるCC/Program/SysExもイベント単位で移動対象。
- クリップの範囲内（onset が `[startTick, endTick)`）に後から追加されたイベント（録音・ピアノロールやドラムの入力・ステップ入力・貼り付け・CC 入力）は、そのクリップに自動的に所属する（`addEvents`、ADR-059）。範囲外にノートを加えたときは、隣のクリップとの隙間の中で小節に揃えた新しいクリップを作り、そこに所属させる（録音・入力した範囲にリージョンができる。ADR-060）。CC / Program / SysEx だけの追加（ミキサー・音色設定）ではクリップを作らない。既存クリップの範囲は広げない。**どのクリップにも属さないノートは鳴らず、MIDI / WAV の書き出しにも入らない**（ADR-064、`withoutLooseNotes`）。CC / Program / SysEx は常に効く。プロジェクトファイルを開くときは外れたノートにクリップを付ける（`adoptLooseNotes`）。ピアノロールでクリップ内のノートを範囲の外へ動かしたときは、ノートを外すのではなくクリップの範囲がノートを追って伸びる（`refreshClipBounds`）。
- クリップ分割: イベントの onset Tick によって左右へ所属。分割境界をまたぐノートは左側に残り、NoteOffは元の位置に保つ。表示上の音尾は境界を越えてよい。分割だけではMIDIの演奏内容は変わらない。
- **v1のクリップは非破壊的な再生マスクではない**。クリップ長を短縮しても自動でNoteOffを切らない。`Trim Notes to Clip` などは明示的な別コマンド。UIで説明。
- コピーは EventId と source-order を新規採番する。clipコピーで新しい独立したイベント群を作る。
- EditCommandは `apply(state)->{state,inverse}`、ドラッグ中はプレビュー、pointerupで1コミット。取り消しで選択/再生位置を不要に飛ばさない。
- SelectionはイベントID集合と track/clipID の別状態。Undo後に存在しないIDを取り除く。

## E. 時間エンジン

- PPQ `P` 、Tempoイベントの `usPerQuarter`（整数）を使用し、区分的な積分でTick↔秒を換算。TempoMapインデックスはテンポイベント変更時に再構築。
- 拍子は表示座標用。時刻Tickの音声速度はテンポが決定する。4/4以外（6/8、変拍子）の小節位置をTimeSignatureMapで計算し、途中変更も扱う。
- 旧レコンポーザのST/GTを表示する場合、**レコンポーザの「1/4=48」は表示単位**。内部変換は `displayUnit = ticks * 48 / ppq` の有理数。逆変換は整数Tickを正確に求められない場合「精度注意/内部Tick表示」を要求し、確認なしで丸めない。
- 演奏ヘッド位置はTransportから取得した高精度時刻とTempoMapから算出。AudioContextのフレームや実際のSequencer位置を優先し、UI側が独立にカウントアップしない。

## F. Transport / PlaybackAdapter

```ts
interface PlaybackAdapter {
  initialize(): Promise<void>;
  loadProject(snapshot: MidiProject): Promise<void>;
  play(fromTick: number): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(tick: number): Promise<void>;
  setLoop(enabled: boolean, startTick: number, endTick: number): Promise<void>;
  auditionNote(port: string, channel: number, pitch: number, velocity: number): Promise<void>;
  releaseAuditionNote(port: string, channel: number, pitch: number): Promise<void>;
  panic(): Promise<void>;
  getPosition(): { tick: number; seconds: number; playing: boolean };
  dispose(): Promise<void>;
}
```

これはプロジェクト側のインターフェース。`spessasynth_lib.Sequencer` のメソッド名を推測したものではない。実装では `src/playback/Transport.ts` がこの役割を持ち、秒単位の `PlaybackEngine`（`SpessaAdapter`）を使う（`docs/DECISIONS.md` ADR-018）。アダプター内で実際のAPIへ変換。MML Studioの Worklet コピー/アセットのセットアップを参考にする。

### 再生設計

- 編集モデルから **SMFスナップショット**を構築→SpessaSynth Sequencerへロードして再生。編集中のリアルタイム試聴は必要ならシンセへ直接 NoteOn/Off。
- 再生中の編集を受け付けるときは、破壊されないデータスナップショットと再読み込み手順を定義。初版は「編集を確定→安全な境界で再スケジュール/再ロード」し、その際の再生位置とノートの停止状態を保つ。連続ドラッグ中に曲全体のSMFを毎フレーム再構築しない。
- ループ境界はNoteOffやCC64ペダルをまたぐため、チャンネル状態を明示的に更新。必要に応じPanic→State Chase。
- `EventChase`は任意TickへSeekした際にBank/Program/CC/Pitch Bend/GS初期化などの最終状態を再構成する。過去のNoteOnを誤って永続再生しない。発音中のノートをSeek時に再発音するかは初版はOFFを既定とし、マニュアルに記載。
- 不用意な二重発音・ノートの取り残し防止のため liveプレビューとSequencer再生のノート管理を分離する。

## G. リストエディターとビジュアルモード

- イベント一覧は `(tick, originOrder)` で安定整列し仮想スクロール。リストで見ている表示行は `EventId` で選択し、ピアノロールとの相互選択に利用。
- STの対象は「次の演奏イベントまでのdelta」で、同時刻の別音はST=0。NoteのGTは独立。`ST変更` は既定で**後続イベントをすべてそのdeltaぶん移動（リップル）**。別操作「絶対位置変更」は当該イベントだけ移動、他はそのまま。
- プレイ表示は `tick` に対する二分探索でアクティブ行を決定。各トラック独立の追従インデックス。スクロールは音楽的タイミングとは独立した表示操作。
- 演奏中イベントのない長い空白は次イベントを選択表示するだけでなく「現在位置 / 次イベントまでのTick」を表示。Seekやループでスクロール位置を即補正。

## H. ブラウザ入力と状態

- `InputFocusRouter`: `'text-edit' | 'list-edit' | 'musical-keys' | 'drum-pad' | 'transport'`。**明示的なアクティブモードとフォーカス**でショートカット衝突を回避。
- `KeyboardEvent.code`（位置ベース）で物理キーを扱い、JIS/US設定とUIラベルを分離。pressedKeysを保持しrepeatを無視。blur/visibilitychangeで release-all。
- 外部MIDI INは `navigator.requestMIDIAccess` 成功時のみ生成。イベントの `timeStamp` を Transportの単調時間基準に射影し、録音Tickに変換。

## I. 保存形式・セキュリティ

- `.midstudio` は UTF-8 JSON。`schemaVersion=1` と migration chain。`dataBase64` は SysEx/Metaのみ、SF2は参照名・hash等のみでバイナリを埋めない。
- 設定は IndexedDB、短いUI設定は localStorageでもよい。大容量の曲や自動保存をlocalStorageに置かない。
- importはバイナリ長・VLQ長・イベント数・各チャンク長・SysExサイズ・異常なTicksの防御的検証。実装に上限を設ける場合はユーザーに理由を明示し、回避策を示す。
- ファイル選択でのみローカルファイルにアクセス。JS動的evalは禁止。楽曲名などのユーザー文字列をHTMLとして埋め込まない。
- 音源のライセンスを必ず同梱/表示。第三者MIDIや音源はテスト資料に混ぜない。

## J. 非機能・性能

- 32トラック / 100,000イベント / 30分の楽曲をベンチマークする。描画は仮想化と可視領域だけ、イベント位置は事前インデックス化。
- 一操作あたりの全件クローンやDOM10万行生成を避ける。SMF解析/大規模ソート/重い書き出しは必要ならWorker化。
- スクロール/ズームは一般的な開発PCで60fpsを目標。実際に計測した値をレポートし、環境による差異は明記。
- Chrome/Edgeは外部MIDI IN優先検証、Firefox/SafariはWeb MIDI非対応時のフォールバック・ピアノロール等を検証。
