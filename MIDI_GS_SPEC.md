# MIDI Studio — MIDI / GM / GS / SMF 技術仕様

## 1. 適合レベル

| レベル | 意味 | 必須か |
|---|---|---|
| L1 イベント互換 | 標準MIDI/Meta/SysExを読込、保持、編集、保存。未知イベントでも消さない | **必須** |
| L2 GS操作UI | 一般的なGSバンク/リズムパート/GS Reset/各種CC/対応SysExを意味付き表示・編集 | **必須**（対応項目を明記） |
| L3 SoundFont再生 | 内蔵SoundFont/SpessaSynthが対応する範囲でGM/GS音声化 | **必須** |
| L4 SC-55/SC-88Pro完全再現 | Roland実機のすべての音色・エフェクトを同一再現 | **対象外** |

SpessaSynth のドキュメントでは MIDI 1.0/GM1/GM2/GS/XGをサポートと記載。ただし実機との完全一致ではない。使用バージョンの対応表を確認し、GS個別項目の音源対応を確認する。

## 2. SMF Reader（Format 0 / 1）

- バイナリチャンク `MThd`/`MTrk` を長さ境界で解析。未知チャンクは警告し、復元可能ならraw保持する。
- PPQ分解能を元の値で保存（例: 96, 240, 480, 960, 1920）。SMPTE分解能とSMF Type2は初版読み込みを丁寧に拒否し、元ファイルを無変更で残す。
- VLQは最大4バイトの規格範囲内を扱い、異常長・破損・容量上限は構造化エラー。running statusは適切にリセット。Meta/SysExから後続チャンネル状態を誤読しない。
- NoteOn velocity=0 は NoteOffと同等。ただし元の表現とrelease velocityを保持。重複同音のポリフォニックNoteOnは曖昧性を記録、元イベントの意味を破壊しない。
- 同Tick順序、元トラック番号、チャネル番号、Meta、Event起源を記録。チャンネル共有や複数ポートも保持。
- Tempo (`FF 51`)、TimeSignature (`FF 58`)、Key Signature (`FF 59`)、Track Name (`FF 03`)、Marker (`FF 06`)、Lyrics (`FF 05`)、MIDI Port Prefix (`FF 21`)、他の未知metaを保持。Tempoの実値は µs/quarter 整数でありBPM浮動小数を正本としない。
- SysExの `F0` / `F7` イベントデータ長と本体を保持。複数分割を勝手に統合/変換せずraw再エクスポート可能とする。視覚的なGS解釈は別処理。
- バイナリ入力とイベントパーサーはUIを参照せず純粋関数でテスト可能。

## 3. SMF Writer（初版はFormat 1）

- Track0にテンポ/拍子/マーカーなどのConductorイベントを配置。非コンダクターの元メタイベントは対応するTrackに置く。
- Tick絶対時刻 → stable sort → delta VLQ。生成NoteOffは発音終了Tickに展開。ノートのゲート長が0にならないよう設定上限を検証。
- 生成イベントが同Tickの場合、Bank Select CC0/32 → Program Change → 発音に影響するCC等 → NoteOff → NoteOn を基本。ただしImport元の明示順序がある場合はその順を可能な限り保持。衝突がある場合の優先ルールをコード・テストに明記。
- NoteOff velocity、Pitch Bendの14bit signed表現、Channel Pressure/PolyPressure、RPN/NRPNのCC系列、SysEx、Metaのbytesを保証。
- SMFのMIDIチャンネルは0..15の生値、UIは1..16。Programは0..127、UIは1..128。防ぐべきoff-by-oneをテスト。
- Port Prefix `FF 21 01 pp` を該当トラックに書き出す。パート途中で変更する場合はイベントとして保持。再生エンジンが扱うポート順との整合性を検証。
- `MTrk` の終端には End of Track を正しく配置。End of Track のTickは曲データ・元EndOfTrackの意味を考慮して保存。
- インポート直後にノーオペ保存した場合は、**音楽的に同等のSMF**を目指す。バイト完全一致、running statusの同一性、チャンク並びの完全一致までは要求しない。失われるものがあればExport前に警告。

## 4. GM / GS 音色・プログラム

- 初期音色は GM 1 の128音色一覧。`Piano (1)`とMIDI program 0の差をUIと内部型で固定。
- Bank Select MSB(CC0)/LSB(CC32)とProgramChangeを別々のイベントとして保持。GSではバンク処理がSoundFont側の対応によって異なる。バンク番号の見かけ上の一致で実機同等とはみなさない。
- 標準ドラムはCH10（UI表記）/ MIDI channel 9。GM/GSによりCH10以外がリズムパートになる場合があるのでTrack.displayMode、GS Rhythmic Part情報を反映。
- ドラムマップの `pitch -> displayName, group, order, defaultVelocity, preview` はユーザーカスタマイズ可能。音名は表示上のマッピングであり、マップ変更でNote.pitchを書き換えない（明示トランスポーズは別）。
- ドラムキット選択時はBank/Programイベントが実際に必要な値として出力される。各SoundFontに存在しないキットは未提供としてフォールバック表示。
- `GS Reset` を初期化アクションに用意。曲頭へ挿入/既存曲の保持を区別。自動で勝手にSysExを上書きしない。

## 5. GS SysEx の扱い

- GS SysExはRolandメーカーID `0x41` 等の基本形式を確認し、model ID、device ID、command、address、payload、checksumが妥当な場合にのみ意味付きデコード。
- `DT1` 等の編集は生bytesの保持と別に `decoded` のUIモデルを用意。チェックサムを含む出力コードはユニットテストする。誤認識した未知SysExのbyte改変を禁止。
- 最低限の意味付き項目: GS Reset、Use for Rhythm Part、Part-level調整（Level/Pan/Transposeなど仕様確認済み項目）、Reverb/Chorus/Delay関連の**対応確認済み**パラメータ。対応していないアドレスはRaw Hex表示のみ。
- SysExインスペクターに: Tick、Track/Port、メーカー、長さ、Hex、解釈可能なパラメータ、音源で実際に処理されるかを表示。
- 公式のアドレスマップの確認なしにハードコードした「GS SysEx完全対応」を名乗らない。
- SysExなどのデータは `.midstudio` と `.mid` の両方で保存する。`F0`/`F7` statusを保持し、無編集状態なら基本的に同じ内容を書き出す。

## 6. CC / NRPN / RPN / Pitch Bend

- General MIDIの一般的なCC: Modulation(1)、Volume(7)、Pan(10)、Expression(11)、Sustain(64)、Reverb(91)、Chorus(93)などを項目名付き表示。
- RPN/NRPNはCC選択とData Entryの**一連の時系列メッセージ**として保存し、簡易UIからパラメータ値を変更した場合のみ関連CCを生成/編集する。未知のシーケンスを勝手に整理しない。
- Pitch Bendは signed -8192..8191、MIDI上は 0..16383（センター8192）。CC14bitのLSB/MSBに注意。
- インポートした元のCC系列が演奏中の状態に影響するため、Seek時のEvent Chaseで直前のBank/Program/CC/PB/RPN/NRPN/SysExの再適用を考慮。単純に最後のイベントだけで済まないGS状態は再構築が必要。
- コントローラーレーンで毎Tickサンプルのような大量CCを誤生成しない。描画プレビューは間引き可能だが保存データは間引かない。

## 7. 再生の互換性と実機非対応

- 初版は外部MIDI OUTなし。SpessaSynth内蔵音源への出力が唯一の常用再生先。
- `spessasynth_lib`バージョンの MIDI implementation 表の対応と、組み込んだ SF2 のプリセット対応は別。音が鳴らない音色のFallback/警告を用意。
- GSエフェクト全種類をSoundFontで完全再現できるとは約束しない。
- 複数ポートのSMF (`FF 21`) について、SpessaSynthが実際に独立チャンネルを生成するか結合試験を行う。
- 未対応GS SysExは編集/保存の互換性を提供し、音色再生は未対応と表示。

## 8. バイナリとライセンス

- SF2 を取得する場合、MML Studioの `scripts/fetch-soundfont.mjs` のように固定ソース・整合性検証・配布条件確認を行う。
- ローカルSF2はブラウザで開いて音源にロードする。ユーザーファイルは外部へ送信しない。
- SoundFont配布条件は別途確認、帰属と全文ライセンスをアプリから参照できるようにする。

## 9. 必須テスト

- SMF0/1、PPQ 96/480/960、TempoChange、拍子変更、同Tick並行音、NoteOn=0、running status、SysEx F0/F7、未知meta、マルチポート。
- 128音色のUI表記とProgram 0..127の往復一致。
- RPN/NRPNの系列保持、Pitch Bend センター/端点、後続イベントの安定順。
- GS Reset/リズムパートSysExを Import→Save→Export して payload と tick が一致。
- わざと壊したVLQ/トラック長/巨大SysEx/不正chの読み込み拒否とユーザーエラー。
- SoundFontを変えてもMIDIイベントが変更されない。

## 参考情報

- https://spessasus.github.io/spessasynth_core/extra/midi-implementation/
- https://spessasus.github.io/spessasynth_core/extra/about-multi-port/
- https://spessasus.github.io/spessasynth_lib/
- https://github.com/cheebow/MMLStudio/blob/main/SPEC.md

## 10. 実装状況（Phase 7, 2026-11-01）

- 意味付きで表示・編集する GS パラメーターは `src/core/gs/gsSysex.ts` の `GS_PARAMS`（GS Reset、Master Volume / Key-Shift / Pan、Reverb Macro・Character・Pre-LPF・Level・Time・Delay Feedback、Chorus Macro・Pre-LPF・Level・Feedback・Delay・Rate・Depth・Send to Reverb、パートごとの Rx. Channel・Use for Rhythm Part・Pitch Key Shift・Part Level・Part Pan・Chorus / Reverb Send）。Roland DT1 でチェックサムが正しく、データが 1 バイトのものだけを解釈する。それ以外（Delay、EFX、ドラムマップ個別設定、複数バイトのデータ等）は 16 進で保持・編集のみ。
- アドレスは一般に公開されている GS 資料と、組み込みの spessasynth_core 4.4.3 の GS 処理（`rolandSystemExclusive`）で確認した。表のパラメーターはすべて内蔵音源が処理する。Roland 実機との照合は未実施。
- 「Use for Rhythm Part」を含む曲は、読み込み時に該当チャンネルのトラックをドラム表示にする（イベントは変更しない）。
- GS Reset の挿入はメニューから明示的に行う（自動では挿入・上書きしない）。挿入先トラックの Tick 0 の他のイベントより前に置く。
- RPN / NRPN は CC の並びのまま保持し、リストで Data Entry の行に対象パラメーター名を表示する。ベンド幅（RPN 0/0）はインスペクターから RPN Null 付きで挿入する。
- Bank Select（CC0 / CC32）と Program Change はインスペクターで Tick 0 のイベントとして設定する（Bank → Program の順）。GS ドラムキットは SoundFont のプリセット一覧と照合し、無いキットは「この SoundFont にはありません」と表示する。
- 複数ポート: SpessaSynth はポートごとに 16 チャンネルを追加する（2 ポートの曲で音源のチャンネル数が 32 以上になることを E2E で確認）。実際の音の独立性は手動試聴で確認が必要。

