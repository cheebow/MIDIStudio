// Menu bar contents (UI_DESIGN 2, ADR-041): frequent commands stay at the top level; groups of
// related, less frequent ones are submenus. Built on every render from the current state.
import type { MidiProject, MidiTrack } from '../core/model/types';
import type { History } from '../core/editing/history';
import { canRedo, canUndo } from '../core/editing/history';
import type { ClipboardData } from '../core/editing/clipboard';
import { moveTrack, sortTracksByChannel, updateTrack } from '../core/editing/operations';
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
import type { EditorStore } from './store/EditorStore';
import type { AppActions } from './store/context';
import type { Recorder } from './recording/Recorder';
import type { DialogKind } from './dialogs/AppDialogs';
import { errorText } from './errorText';

export interface MenuDeps {
  project: MidiProject;
  history: History;
  clipboard: ClipboardData | null;
  hasSelection: boolean;
  hasClipSelection: boolean;
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
    exportMidi: () => void;
    chooseSoundFont: () => void;
  };
  setShowInspector: (v: boolean) => void;
  setVisualOpen: (v: boolean) => void;
}

const sep: MenuItem = { separator: true, label: '' };
const noSelReason = 'ノートやイベントを選択してください';

export function buildMenus(d: MenuDeps): Menu[] {
  const { project, store, transport, actions, selectedTrack } = d;
  const settings = project.settings;
  const noSel = !d.hasSelection;
  const panel = (activePanel: MidiProject['settings']['activePanel']) => () => store.updateSettings({ activePanel, editorCollapsed: false });
  return [
    {
      label: 'ファイル',
      items: [
        { label: '新規', action: d.file.newProject },
        { label: 'プロジェクトを開く…', shortcut: `${MOD}O`, action: d.file.openProject },
        { label: '最近のプロジェクト（ブラウザ内）…', action: d.file.openRecent },
        sep,
        { label: 'ブラウザに保存', shortcut: `${MOD}S`, action: d.file.saveToBrowser },
        { label: '.midstudio として保存…', action: d.file.saveAsFile },
        sep,
        { label: 'MIDI を読み込む…', action: d.file.importMidi },
        { label: 'MIDI を書き出す…', action: d.file.exportMidi },
        { label: 'WAV を書き出す…', action: () => d.setDialog('wav'), disabled: !d.audioReady, reason: '音源が読み込まれていません' },
        sep,
        { label: 'SoundFont を選ぶ…', action: d.file.chooseSoundFont },
      ],
    },
    {
      label: '編集',
      items: [
        { label: '元に戻す', shortcut: `${MOD}Z`, action: actions.undo, disabled: !canUndo(d.history), reason: '戻せる操作がありません' },
        { label: 'やり直し', shortcut: IS_MAC ? '⇧⌘Z' : 'Ctrl+Y', action: actions.redo, disabled: !canRedo(d.history), reason: 'やり直せる操作がありません' },
        sep,
        { label: '切り取り', shortcut: `${MOD}X`, action: actions.cut, disabled: noSel, reason: noSelReason },
        { label: 'コピー', shortcut: `${MOD}C`, action: actions.copy, disabled: noSel, reason: noSelReason },
        { label: '貼り付け（再生位置へ）', shortcut: `${MOD}V`, action: actions.paste, disabled: !d.clipboard, reason: 'コピーしたイベントがありません' },
        { label: '複製', shortcut: `${MOD}D`, action: actions.duplicate, disabled: noSel, reason: noSelReason },
        { label: '削除', shortcut: 'Delete', action: actions.delete, disabled: noSel && !d.hasClipSelection, reason: 'ノート・イベント・クリップを選択してください' },
        { label: 'すべて選択（選択トラックのノート）', shortcut: `${MOD}A`, action: actions.selectAll },
        sep,
        {
          label: '移調',
          disabled: noSel,
          reason: noSelReason,
          items: [
            { label: '+1 半音', action: () => actions.transpose(1) },
            { label: '−1 半音', action: () => actions.transpose(-1) },
            { label: '+1 オクターブ', action: () => actions.transpose(12) },
            { label: '−1 オクターブ', action: () => actions.transpose(-12) },
          ],
        },
        {
          label: 'ノート',
          items: [
            { label: `クオンタイズ（${gridLabel(settings.grid)}）`, shortcut: 'Q', action: actions.quantize, disabled: noSel, reason: noSelReason },
            { label: 'クオンタイズ…（音符・強さ・シャッフル・長さ）', shortcut: '⇧Q', action: actions.quantizeDialog, disabled: !selectedTrack, reason: 'トラックがありません' },
            { label: `ノート長をグリッド（${gridLabel(settings.grid)}）に揃える`, action: actions.noteLength, disabled: noSel, reason: noSelReason },
            { label: 'ヒューマナイズ…', action: actions.humanizeDialog, disabled: !selectedTrack, reason: 'トラックがありません' },
            { label: 'ベロシティ…', action: actions.velocityDialog, disabled: !selectedTrack, reason: 'トラックがありません' },
          ],
        },
        { label: 'クリップ', items: [{ label: '再生位置で分割', action: actions.splitAtCursor }] },
      ],
    },
    {
      label: '表示',
      items: [
        {
          label: 'エディター',
          items: [
            { label: 'ピアノロール', checked: settings.activePanel === 'piano-roll', action: panel('piano-roll') },
            { label: 'ドラムエディター', checked: settings.activePanel === 'drum', action: panel('drum') },
            { label: 'リストエディター', checked: settings.activePanel === 'list', action: panel('list') },
            { label: 'ミキサー', checked: settings.activePanel === 'mixer', action: panel('mixer') },
            { label: 'コンダクター（テンポ・拍子・調号・マーカー）', checked: settings.activePanel === 'tempo', action: panel('tempo') },
          ],
        },
        { label: 'インスペクター', checked: d.showInspector, action: () => d.setShowInspector(!d.showInspector) },
        { label: 'ビジュアルモード（演奏表示）', checked: d.visualOpen, action: () => d.setVisualOpen(!d.visualOpen), shortcut: 'T' },
        sep,
        {
          label: '拡大・縮小',
          items: [
            { label: 'トラックビューを拡大', action: () => store.updateSettings(arrangementZoomPatch(settings, 'in')) },
            { label: 'トラックビューを縮小', action: () => store.updateSettings(arrangementZoomPatch(settings, 'out')) },
            sep,
            { label: 'ピアノロールを拡大', action: () => store.updateSettings(pianoRollZoomPatch(settings, 'in')) },
            { label: 'ピアノロールを縮小', action: () => store.updateSettings(pianoRollZoomPatch(settings, 'out')) },
          ],
        },
        sep,
        { label: '再生に追従', shortcut: 'F', checked: settings.followPlayback, action: () => store.updateSettings({ followPlayback: !settings.followPlayback }) },
        { label: 'ゴーストノート', checked: settings.showGhostNotes, action: () => store.updateSettings({ showGhostNotes: !settings.showGhostNotes }) },
        sep,
        {
          label: 'テーマ',
          items: [
            { label: '自動（OS に合わせる）', checked: d.theme === 'auto', action: () => setThemePref('auto') },
            { label: 'ライト', checked: d.theme === 'light', action: () => setThemePref('light') },
            { label: 'ダーク', checked: d.theme === 'dark', action: () => setThemePref('dark') },
          ],
        },
      ],
    },
    {
      label: 'トラック',
      items: [
        { label: 'トラックを追加', action: actions.addTrack },
        { label: 'トラックを複製', action: actions.duplicateTrack, disabled: !selectedTrack, reason: 'トラックを選択してください' },
        { label: 'トラックを削除', action: actions.removeTrack, disabled: !selectedTrack, reason: 'トラックを選択してください' },
        sep,
        { label: '上へ移動', shortcut: IS_MAC ? '⌥↑' : 'Alt+↑', action: () => selectedTrack && store.run(moveTrack(store.project, selectedTrack.id, -1)), disabled: !selectedTrack || project.tracks[0] === selectedTrack, reason: 'いちばん上のトラックです' },
        { label: '下へ移動', shortcut: IS_MAC ? '⌥↓' : 'Alt+↓', action: () => selectedTrack && store.run(moveTrack(store.project, selectedTrack.id, 1)), disabled: !selectedTrack || project.tracks.at(-1) === selectedTrack, reason: 'いちばん下のトラックです' },
        {
          label: '整理',
          items: [
            { label: 'チャンネル順に並べ替え', action: () => store.run(sortTracksByChannel(store.project)) },
            {
              label: '同じチャンネルのトラックをすべてまとめる',
              action: () =>
                d.tryRun(() => {
                  const m = mergeSameChannelTracks(store.project);
                  if (m) {
                    store.run(m.command);
                    d.setInfo(`トラックをまとめました: ${m.merged.map((g) => g.join('・')).join(' / ')}`);
                  } else d.setInfo('同じポート・チャンネルのトラックはありません。');
                }),
            },
            {
              label: '同じチャンネルのドラムトラックをまとめる',
              action: () =>
                d.tryRun(() => {
                  const m = mergeDrumTracks(store.project);
                  if (m) {
                    store.run(m.command);
                    d.setInfo(`ドラムトラックをまとめました: ${m.merged.map((g) => g.join('・')).join(' / ')}`);
                  } else d.setInfo('まとめられるドラムトラックはありません（同じポート・チャンネルのドラムトラックが2つ以上必要です）。');
                }),
            },
          ],
        },
        sep,
        { label: 'ドラムトラックにする', checked: selectedTrack?.displayMode === 'drum', disabled: !selectedTrack, action: () => selectedTrack && store.run(updateTrack(store.project, selectedTrack.id, { displayMode: selectedTrack.displayMode === 'drum' ? 'melodic' : 'drum' }, '表示モードを変更')) },
        { label: 'ミュート', shortcut: 'M', checked: selectedTrack?.mute, disabled: !selectedTrack, action: () => selectedTrack && store.setTrackFlags(selectedTrack.id, { mute: !selectedTrack.mute }) },
        { label: 'ソロ', shortcut: 'S', checked: selectedTrack?.solo, disabled: !selectedTrack, action: () => selectedTrack && store.setTrackFlags(selectedTrack.id, { solo: !selectedTrack.solo }) },
        { label: '録音待機', checked: selectedTrack?.recordArm, disabled: !selectedTrack, action: () => selectedTrack && store.setTrackFlags(selectedTrack.id, { recordArm: !selectedTrack.recordArm }) },
        sep,
        { label: 'ドラムマップ（ドラムエディター）', action: panel('drum') },
      ],
    },
    {
      label: 'MIDI',
      items: [
        {
          label: '入力モード',
          items: [
            { label: '編集（ショートカット）', checked: d.inputMode === 'edit-shortcuts', action: () => d.setMode('edit-shortcuts'), shortcut: 'Esc' },
            { label: 'PC キーボード演奏', checked: d.inputMode === 'piano-performance', action: () => d.setMode('piano-performance'), shortcut: `${ALT}K` },
            { label: 'ドラムパッド', checked: d.inputMode === 'drum-performance', action: () => d.setMode('drum-performance'), shortcut: `${ALT}P` },
            { label: 'ステップ（鍵盤）', checked: d.inputMode === 'step-piano', action: () => d.setMode('step-piano') },
            { label: 'ステップ（ドラム）', checked: d.inputMode === 'step-drums', action: () => d.setMode('step-drums') },
          ],
        },
        { label: 'サステイン（PC 鍵盤）', checked: d.sustain, action: () => d.input.setSustain(!d.sustain) },
        sep,
        {
          label: d.recording ? '録音を停止' : 'リアルタイム録音を開始',
          shortcut: 'R',
          action: () => (d.recording ? d.recorder.stop() : d.ensureAudio().then(() => d.recorder.start()).catch((e: unknown) => d.setError(errorText(e)))),
        },
        { label: '録音の設定…', action: () => d.setDialog('record') },
        { label: 'MIDI 入力の設定…', action: () => d.setDialog('midi') },
        sep,
        {
          label: 'GS / SysEx',
          items: [
            { label: 'GS Reset を曲頭に挿入（最初のトラック）', action: () => d.tryRun(() => store.run(insertGsReset(store.project, store.project.tracks[0].id))), disabled: project.tracks.length === 0, reason: 'トラックがありません' },
            { label: 'SysEx / イベントインスペクター…', action: () => d.setDialog('sysex') },
          ],
        },
        sep,
        { label: 'Panic（全ノート停止）', action: () => transport.panic() },
      ],
    },
    {
      label: 'ツール',
      items: [
        { label: 'キー割り当て…', action: () => d.setDialog('keys') },
        { label: 'プロジェクト診断…', action: () => d.setDialog('diagnostics') },
      ],
    },
    {
      label: 'ヘルプ',
      items: [
        { label: 'キーボードショートカット', action: () => d.setDialog('shortcuts') },
        { label: 'GM / GS 互換性について', action: () => d.setDialog('compat') },
        { label: 'ライセンス / このアプリについて', action: () => d.setDialog('about') },
      ],
    },
  ];
}
