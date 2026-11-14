// Shared right-click menu contents for the note editors (piano roll, drum editor, list).
import type { EditActions } from '../../app/store/context';
import { t } from '../../i18n';
import type { EditorStore } from '../../app/store/EditorStore';
import type { Transport } from '../../playback/Transport';
import { pasteEvents } from '../../core/editing/clipboard';
import type { MenuItem } from './MenuBar';
import { gridLabel, type GridSpec } from '../../core/timing/grid';
import { MOD_LABEL } from '../platform';

const sep: MenuItem = { separator: true, label: '' };

const noSelReason = () => t('ノートやイベントを選択してください');
const noTrackReason = () => t('トラックがありません');

/**
 * The three groups of note commands. The 編集 menu and every right-click menu are built from these,
 * so a command has the same name under the same parent wherever it appears (ADR-100):
 * 移調 ▸, ノート ▸ (timing / length / velocity of the notes) and 入力支援 ▸ (guitar voicing and the
 * performance tools).
 */
export function transposeMenu(a: EditActions, opts: { noSel?: boolean } = {}): MenuItem {
  return {
    label: t('移調'),
    disabled: opts.noSel,
    reason: noSelReason(),
    items: [
      { label: t('+1 半音'), action: () => a.transpose(1) },
      { label: t('−1 半音'), action: () => a.transpose(-1) },
      { label: t('+1 オクターブ'), action: () => a.transpose(12) },
      { label: t('−1 オクターブ'), action: () => a.transpose(-12) },
    ],
  };
}

export function noteMenu(a: EditActions, opts: { grid: GridSpec; noSel?: boolean; noTrack?: boolean; noteLength?: boolean; disabledReason?: string }): MenuItem {
  const sel = { disabled: opts.noSel, reason: noSelReason() };
  const trk = { disabled: opts.noTrack, reason: noTrackReason() };
  return {
    label: t('ノート'),
    disabled: opts.disabledReason !== undefined,
    reason: opts.disabledReason,
    items: [
      { label: t('クオンタイズ（{grid}）', { grid: gridLabel(opts.grid) }), shortcut: 'Q', action: a.quantize, ...sel },
      // the dialog targets the selection, or every note of the track when nothing is selected
      { label: t('クオンタイズ…（音符・強さ・シャッフル・長さ）'), shortcut: '⇧Q', action: a.quantizeDialog, ...trk },
      ...(opts.noteLength === false ? [] : [{ label: t('ノート長をグリッド（{grid}）に揃える', { grid: gridLabel(opts.grid) }), action: a.noteLength, ...sel }]),
      { label: t('ヒューマナイズ…'), action: a.humanizeDialog, ...trk },
      { label: t('ベロシティ…'), action: a.velocityDialog, ...trk },
    ],
  };
}

type AssistAt = { trackId: string; tick: number; returnFocus?: HTMLElement | null };

/**
 * 入力支援 (ADR-091 / 092): ギターボイシング ▸ (one chord / a progression) at a track and tick, and the
 * performance tools (strum, arpeggio, legato, velocity shaper) on the selected notes (or the whole
 * track). `at` may be a function, read when the item is chosen (the 編集 menu: the playhead then).
 */
export function assistMenu(a: EditActions, at: AssistAt | (() => AssistAt) | null): MenuItem {
  const where = () => (typeof at === 'function' ? at() : at!);
  const trk = { disabled: at === null, reason: noTrackReason() };
  return {
    label: t('入力支援'),
    items: [
      {
        label: t('ギターボイシング'),
        ...trk,
        items: [
          { label: t('コードを 1 つ入力…'), action: () => a.guitarVoicing(where()) },
          { label: t('コード進行を入力…'), action: () => a.guitarProgression(where()) },
        ],
      },
      { label: t('ストラム…'), action: () => a.performDialog('strum'), ...trk },
      { label: t('アルペジオ…'), action: () => a.performDialog('arpeggio'), ...trk },
      { label: t('レガート調整…'), action: () => a.performDialog('legato'), ...trk },
      { label: t('ベロシティ・シェイパー…'), action: () => a.performDialog('velocity-shaper'), ...trk },
    ],
  };
}

/** Menu for a right-click on a note (acts on the selection, which includes the clicked note). */
export function noteMenuItems(a: EditActions, opts: { grid: GridSpec; transpose?: boolean; noteLength?: boolean }): MenuItem[] {
  return [
    { label: t('切り取り'), shortcut: `${MOD_LABEL}X`, action: a.cut },
    { label: t('コピー'), shortcut: `${MOD_LABEL}C`, action: a.copy },
    { label: t('複製'), shortcut: `${MOD_LABEL}D`, action: a.duplicate },
    { label: t('削除'), shortcut: 'Delete', action: a.delete },
    sep,
    ...(opts.transpose === false ? [] : [transposeMenu(a)]),
    noteMenu(a, { grid: opts.grid, noteLength: opts.noteLength }),
  ];
}

/** 入力支援 ▸ of a right-click menu, at the right-clicked track and tick (fixed now, so moving the playhead later does not move it). */
export function assistMenuItems(a: EditActions, at: AssistAt): MenuItem[] {
  return [assistMenu(a, at)];
}

/** Menu for a right-click on an empty spot of a track's editor. */
export function emptyMenuItems(a: EditActions, store: EditorStore, transport: Transport, trackId: string, tick: number, reportError: (m: string) => void, opts: { transpose?: boolean; noteLength?: boolean } = {}): MenuItem[] {
  const clipboard = store.getState().clipboard;
  const noSel = store.getState().selection.eventIds.size === 0;
  return [
    {
      label: t('ここに貼り付け'),
      disabled: !clipboard,
      reason: t('コピーしたノートがありません'),
      action: () => {
        try {
          const r = clipboard && pasteEvents(store.project, trackId, tick, clipboard);
          if (r) store.run(r.command, { select: r.ids });
        } catch (e) {
          reportError((e as Error).message);
        }
      },
    },
    { label: t('すべて選択（選択トラックのノート）'), shortcut: `${MOD_LABEL}A`, action: a.selectAll },
    { label: t('再生位置をここに移動'), action: () => transport.seek(tick) },
    sep,
    ...(opts.transpose === false ? [] : [transposeMenu(a, { noSel })]),
    noteMenu(a, { grid: store.project.settings.grid, noSel, noteLength: opts.noteLength }),
  ];
}
