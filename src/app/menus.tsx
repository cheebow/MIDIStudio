// Menu bar contents (UI_DESIGN 2, ADR-041): frequent commands stay at the top level; groups of
// related, less frequent ones are submenus. Built on every render from the current state.
import type { MidiProject, MidiTrack } from '../core/model/types';
import type { History } from '../core/editing/history';
import { canRedo, canUndo } from '../core/editing/history';
import type { ClipboardData } from '../core/editing/clipboard';
import { deleteEvents, moveTrack, sortTracksByChannel, updateTrack } from '../core/editing/operations';
import { looseNoteIds } from '../core/model/looseNotes';
import { mergeDrumTracks, mergeSameChannelTracks } from '../core/editing/trackMerge';
import { insertGsReset } from '../core/gs/gsProject';
import { gridLabel } from '../core/timing/grid';
import type { InputMode } from '../input/KeyboardRouter';
import type { InputController } from '../input/InputController';
import type { Transport } from '../playback/Transport';
import type { Menu, MenuItem } from '../ui/menu/MenuBar';
import { ALT_LABEL as ALT, IS_MAC, MOD_LABEL as MOD } from '../ui/platform';
import { arrangementZoomPatch, pianoRollZoomPatch } from '../ui/zoom';
import { setThemePref, type ThemePref } from './theme';
import { LOCALE_NAMES, LOCALES, locale, setLocale, t } from '../i18n';
import type { EditorStore } from './store/EditorStore';
import type { AppActions } from './store/context';
import type { Recorder } from './recording/Recorder';
import type { DialogKind } from './dialogs/AppDialogs';
import { errorText } from './errorText';
import { SAMPLE_SONGS } from './samples';

export interface MenuDeps {
  project: MidiProject;
  history: History;
  clipboard: ClipboardData | null;
  hasSelection: boolean;
  hasClipSelection: boolean;
  /** two or more selected clips share a track (ADR-065) */
  canMergeClips: boolean;
  selectedTrack: MidiTrack | undefined;
  inputMode: InputMode;
  sustain: boolean;
  recording: boolean;
  showInspector: boolean;
  visualOpen: boolean;
  theme: ThemePref;
  /** a sound bank is loaded: WAV export is possible */
  audioReady: boolean;
  actions: AppActions;
  store: EditorStore;
  transport: Transport;
  input: InputController;
  recorder: Recorder;
  ensureAudio: () => Promise<void>;
  setError: (m: string) => void;
  setInfo: (m: string) => void;
  setDialog: (d: DialogKind) => void;
  setMode: (m: InputMode) => void;
  tryRun: (fn: () => void) => void;
  file: {
    newProject: () => void;
    openProject: () => void;
    openRecent: () => void;
    saveToBrowser: () => void;
    saveAsFile: () => void;
    importMidi: () => void;
    openSample: (id: string) => void;
    exportMidi: () => void;
    chooseSoundFont: () => void;
  };
  setShowInspector: (v: boolean) => void;
  setVisualOpen: (v: boolean) => void;
}

const sep: MenuItem = { separator: true, label: '' };
const noSelReason = () => t('ノートやイベントを選択してください');

export function buildMenus(d: MenuDeps): Menu[] {
  const { project, store, transport, actions, selectedTrack } = d;
  const settings = project.settings;
  const noSel = !d.hasSelection;
  const looseCount = selectedTrack ? looseNoteIds(project, selectedTrack).size : 0;
  const panel = (activePanel: MidiProject['settings']['activePanel']) => () => store.updateSettings({ activePanel, editorCollapsed: false });
  return [
    {
      label: t('ファイル'),
      items: [
        { label: t('新規'), action: d.file.newProject },
        { label: t('プロジェクトを開く…'), shortcut: `${MOD}O`, action: d.file.openProject },
        { label: t('最近のプロジェクト（ブラウザ内）…'), action: d.file.openRecent },
        sep,
        { label: t('ブラウザに保存'), shortcut: `${MOD}S`, action: d.file.saveToBrowser },
        { label: t('.midstudio として保存…'), action: d.file.saveAsFile },
        sep,
        { label: t('MIDI を読み込む…'), action: d.file.importMidi },
        { label: t('サンプル曲'), items: SAMPLE_SONGS.map((s) => ({ label: s.title, action: () => d.file.openSample(s.id) })) },
        { label: t('MIDI を書き出す…'), action: d.file.exportMidi },
        { label: t('WAV を書き出す…'), action: () => d.setDialog('wav'), disabled: !d.audioReady, reason: t('音源が読み込まれていません') },
        sep,
        { label: t('SoundFont を選ぶ…'), action: d.file.chooseSoundFont },
      ],
    },
    {
      label: t('編集'),
      items: [
        { label: t('元に戻す'), shortcut: `${MOD}Z`, action: actions.undo, disabled: !canUndo(d.history), reason: t('戻せる操作がありません') },
        { label: t('やり直し'), shortcut: IS_MAC ? '⇧⌘Z' : 'Ctrl+Y', action: actions.redo, disabled: !canRedo(d.history), reason: t('やり直せる操作がありません') },
        sep,
        { label: t('切り取り'), shortcut: `${MOD}X`, action: actions.cut, disabled: noSel && !d.hasClipSelection, reason: t('ノート・イベント・クリップを選択してください') },
        { label: t('コピー'), shortcut: `${MOD}C`, action: actions.copy, disabled: noSel && !d.hasClipSelection, reason: t('ノート・イベント・クリップを選択してください') },
        { label: t('貼り付け（再生位置へ）'), shortcut: `${MOD}V`, action: actions.paste, disabled: !d.clipboard, reason: t('コピーしたイベントがありません') },
        { label: t('複製'), shortcut: `${MOD}D`, action: actions.duplicate, disabled: noSel && !d.hasClipSelection, reason: t('ノート・イベント・クリップを選択してください') },
        { label: t('削除'), shortcut: 'Delete', action: actions.delete, disabled: noSel && !d.hasClipSelection, reason: t('ノート・イベント・クリップを選択してください') },
        { label: t('すべて選択（選択トラックのノート）'), shortcut: `${MOD}A`, action: actions.selectAll },
        sep,
        {
          label: t('移調'),
          disabled: noSel,
          reason: noSelReason(),
          items: [
            { label: t('+1 半音'), action: () => actions.transpose(1) },
            { label: t('−1 半音'), action: () => actions.transpose(-1) },
            { label: t('+1 オクターブ'), action: () => actions.transpose(12) },
            { label: t('−1 オクターブ'), action: () => actions.transpose(-12) },
          ],
        },
        {
          label: t('ノート'),
          items: [
            { label: t('クオンタイズ（{grid}）', { grid: gridLabel(settings.grid) }), shortcut: 'Q', action: actions.quantize, disabled: noSel, reason: noSelReason() },
            { label: t('クオンタイズ…（音符・強さ・シャッフル・長さ）'), shortcut: '⇧Q', action: actions.quantizeDialog, disabled: !selectedTrack, reason: t('トラックがありません') },
            { label: t('ノート長をグリッド（{grid}）に揃える', { grid: gridLabel(settings.grid) }), action: actions.noteLength, disabled: noSel, reason: noSelReason() },
            { label: t('ヒューマナイズ…'), action: actions.humanizeDialog, disabled: !selectedTrack, reason: t('トラックがありません') },
            { label: t('ベロシティ…'), action: actions.velocityDialog, disabled: !selectedTrack, reason: t('トラックがありません') },
          ],
        },
        {
          label: t('クリップ'),
          items: [
            { label: t('再生位置で分割'), action: actions.splitAtCursor },
            { label: t('結合'), shortcut: `${MOD}J`, action: actions.mergeClips, disabled: !d.canMergeClips, reason: t('同じトラックのクリップを 2 つ以上選択してください') },
          ],
        },
      ],
    },
    {
      label: t('表示'),
      items: [
        {
          label: t('エディター'),
          items: [
            { label: t('ピアノロール'), checked: settings.activePanel === 'piano-roll', action: panel('piano-roll') },
            { label: t('ドラムエディター'), checked: settings.activePanel === 'drum', action: panel('drum') },
            { label: t('リストエディター'), checked: settings.activePanel === 'list', action: panel('list') },
            { label: t('ミキサー'), checked: settings.activePanel === 'mixer', action: panel('mixer') },
            { label: t('コンダクター（テンポ・拍子・調号・マーカー）'), checked: settings.activePanel === 'tempo', action: panel('tempo') },
          ],
        },
        { label: t('インスペクター'), checked: d.showInspector, action: () => d.setShowInspector(!d.showInspector) },
        { label: t('ビジュアルモード（演奏表示）'), checked: d.visualOpen, action: () => d.setVisualOpen(!d.visualOpen), shortcut: 'T' },
        sep,
        {
          label: t('拡大・縮小'),
          items: [
            { label: t('トラックビューを拡大'), action: () => store.updateSettings(arrangementZoomPatch(settings, 'in')) },
            { label: t('トラックビューを縮小'), action: () => store.updateSettings(arrangementZoomPatch(settings, 'out')) },
            sep,
            { label: t('ピアノロールを拡大'), action: () => store.updateSettings(pianoRollZoomPatch(settings, 'in')) },
            { label: t('ピアノロールを縮小'), action: () => store.updateSettings(pianoRollZoomPatch(settings, 'out')) },
          ],
        },
        sep,
        { label: t('再生に追従'), shortcut: 'F', checked: settings.followPlayback, action: () => store.updateSettings({ followPlayback: !settings.followPlayback }) },
        { label: t('ゴーストノート'), checked: settings.showGhostNotes, action: () => store.updateSettings({ showGhostNotes: !settings.showGhostNotes }) },
        { label: t('コード名（推定）'), checked: settings.showChords, action: () => store.updateSettings({ showChords: !settings.showChords }) },
        sep,
        {
          label: t('テーマ'),
          items: [
            { label: t('自動（OS に合わせる）'), checked: d.theme === 'auto', action: () => setThemePref('auto') },
            { label: t('ライト'), checked: d.theme === 'light', action: () => setThemePref('light') },
            { label: t('ダーク'), checked: d.theme === 'dark', action: () => setThemePref('dark') },
          ],
        },
        {
          label: t('言語'),
          items: LOCALES.map((l) => ({ label: LOCALE_NAMES[l], checked: locale() === l, action: () => setLocale(l) })),
        },
      ],
    },
    {
      label: t('トラック'),
      items: [
        { label: t('トラックを追加'), action: actions.addTrack },
        { label: t('トラックを複製'), action: actions.duplicateTrack, disabled: !selectedTrack, reason: t('トラックを選択してください') },
        { label: t('トラックを削除'), action: actions.removeTrack, disabled: !selectedTrack, reason: t('トラックを選択してください') },
        {
          // notes outside every clip are silent (ADR-064); this is the way to get rid of them from the track view side
          label: t('クリップの外のノートを削除（{n} 個）', { n: looseCount }),
          disabled: looseCount === 0,
          reason: t('クリップの外にノートはありません'),
          action: () => selectedTrack && store.run(deleteEvents(store.project, looseNoteIds(store.project, selectedTrack), 'クリップの外のノートを削除')),
        },
        sep,
        { label: t('上へ移動'), shortcut: IS_MAC ? '⌥↑' : 'Alt+↑', action: () => selectedTrack && store.run(moveTrack(store.project, selectedTrack.id, -1)), disabled: !selectedTrack || project.tracks[0] === selectedTrack, reason: t('いちばん上のトラックです') },
        { label: t('下へ移動'), shortcut: IS_MAC ? '⌥↓' : 'Alt+↓', action: () => selectedTrack && store.run(moveTrack(store.project, selectedTrack.id, 1)), disabled: !selectedTrack || project.tracks.at(-1) === selectedTrack, reason: t('いちばん下のトラックです') },
        {
          label: t('整理'),
          items: [
            { label: t('チャンネル順に並べ替え'), action: () => store.run(sortTracksByChannel(store.project)) },
            {
              label: t('同じチャンネルのトラックをすべてまとめる'),
              action: () =>
                d.tryRun(() => {
                  const m = mergeSameChannelTracks(store.project);
                  if (m) {
                    store.run(m.command);
                    d.setInfo(t('トラックをまとめました: {list}', { list: m.merged.map((g) => g.join('・')).join(' / ') }));
                  } else d.setInfo(t('同じポート・チャンネルのトラックはありません。'));
                }),
            },
            {
              label: t('同じチャンネルのドラムトラックをまとめる'),
              action: () =>
                d.tryRun(() => {
                  const m = mergeDrumTracks(store.project);
                  if (m) {
                    store.run(m.command);
                    d.setInfo(t('ドラムトラックをまとめました: {list}', { list: m.merged.map((g) => g.join('・')).join(' / ') }));
                  } else d.setInfo(t('まとめられるドラムトラックはありません（同じポート・チャンネルのドラムトラックが2つ以上必要です）。'));
                }),
            },
          ],
        },
        sep,
        { label: t('ドラムトラックにする'), checked: selectedTrack?.displayMode === 'drum', disabled: !selectedTrack, action: () => selectedTrack && store.run(updateTrack(store.project, selectedTrack.id, { displayMode: selectedTrack.displayMode === 'drum' ? 'melodic' : 'drum' }, '表示モードを変更')) },
        { label: t('ミュート'), shortcut: 'M', checked: selectedTrack?.mute, disabled: !selectedTrack, action: () => selectedTrack && store.setTrackFlags(selectedTrack.id, { mute: !selectedTrack.mute }) },
        { label: t('ソロ'), shortcut: 'S', checked: selectedTrack?.solo, disabled: !selectedTrack, action: () => selectedTrack && store.setTrackFlags(selectedTrack.id, { solo: !selectedTrack.solo }) },
        sep,
        { label: t('ドラムマップ（ドラムエディター）'), action: panel('drum') },
      ],
    },
    {
      label: 'MIDI',
      items: [
        {
          label: t('入力モード'),
          items: [
            { label: t('編集（ショートカット）'), checked: d.inputMode === 'edit-shortcuts', action: () => d.setMode('edit-shortcuts'), shortcut: 'Esc' },
            { label: t('PC キーボード演奏'), checked: d.inputMode === 'piano-performance', action: () => d.setMode('piano-performance'), shortcut: `${ALT}K` },
            { label: t('ドラムパッド'), checked: d.inputMode === 'drum-performance', action: () => d.setMode('drum-performance'), shortcut: `${ALT}R` },
            { label: t('ステップ（鍵盤）'), checked: d.inputMode === 'step-piano', action: () => d.setMode('step-piano') },
            { label: t('ステップ（ドラム）'), checked: d.inputMode === 'step-drums', action: () => d.setMode('step-drums') },
          ],
        },
        { label: t('サステイン（PC 鍵盤）'), checked: d.sustain, action: () => d.input.setSustain(!d.sustain) },
        sep,
        {
          label: d.recording ? t('録音を停止') : t('リアルタイム録音を開始'),
          shortcut: 'R',
          action: () => (d.recording ? d.recorder.stop() : d.ensureAudio().then(() => d.recorder.start()).catch((e: unknown) => d.setError(errorText(e)))),
        },
        { label: t('録音の設定…'), action: () => d.setDialog('record') },
        { label: t('MIDI 入力の設定…'), action: () => d.setDialog('midi') },
        sep,
        {
          label: 'GS / SysEx',
          items: [
            { label: t('GS Reset を曲頭に挿入（最初のトラック）'), action: () => d.tryRun(() => store.run(insertGsReset(store.project, store.project.tracks[0].id))), disabled: project.tracks.length === 0, reason: t('トラックがありません') },
            { label: t('SysEx / イベントインスペクター…'), action: () => d.setDialog('sysex') },
          ],
        },
        sep,
        { label: t('Panic（全ノート停止）'), action: () => transport.panic() },
      ],
    },
    {
      label: t('ツール'),
      items: [
        { label: t('キー割り当て…'), action: () => d.setDialog('keys') },
        { label: t('プロジェクト診断…'), action: () => d.setDialog('diagnostics') },
      ],
    },
    {
      label: t('ヘルプ'),
      items: [
        { label: t('使い方…'), shortcut: 'F1', action: () => d.setDialog('help') },
        { label: t('入門（はじめての方へ）…'), action: () => d.setDialog('tutorial') },
        { label: t('キーボードショートカット…'), action: () => d.setDialog('shortcuts') },
        { label: t('GM / GS について…'), action: () => d.setDialog('compat') },
        sep,
        { label: t('MIDI Studio について…'), action: () => d.setDialog('about') },
      ],
    },
  ];
}
