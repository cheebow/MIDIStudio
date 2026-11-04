// Shared right-click menu contents for the note editors (piano roll, drum editor, list).
import type { EditActions } from '../../app/store/context';
import { t } from '../../i18n';
import type { EditorStore } from '../../app/store/EditorStore';
import type { Transport } from '../../playback/Transport';
import { pasteEvents } from '../../core/editing/clipboard';
import type { MenuItem } from './MenuBar';

const sep: MenuItem = { separator: true, label: '' };

/** The performance tools (ADR-077), shared by the edit menu and the note right-click menu. */
export function performMenuItems(a: EditActions): MenuItem[] {
  return [
    { label: t('ギターボイシング…'), action: () => a.performDialog('voicing') },
    { label: t('ストラム…'), action: () => a.performDialog('strum') },
    { label: t('アルペジオ…'), action: () => a.performDialog('arpeggio') },
    { label: t('レガート調整…'), action: () => a.performDialog('legato') },
    { label: t('ベロシティ・シェイパー…'), action: () => a.performDialog('velocity-shaper') },
  ];
}

/** Menu for a right-click on a note (acts on the selection, which includes the clicked note). */
export function noteMenuItems(a: EditActions, opts: { transpose?: boolean; noteLength?: boolean } = {}): MenuItem[] {
  return [
    { label: t('コピー'), action: a.copy },
    { label: t('切り取り'), action: a.cut },
    { label: t('複製（すぐ後ろへ）'), action: a.duplicate },
    sep,
    ...(opts.transpose === false
      ? []
      : [
          { label: t('半音上げる'), action: () => a.transpose(1) },
          { label: t('半音下げる'), action: () => a.transpose(-1) },
          { label: t('1 オクターブ上げる'), action: () => a.transpose(12) },
          { label: t('1 オクターブ下げる'), action: () => a.transpose(-12) },
          sep,
        ]),
    { label: t('クオンタイズ'), shortcut: 'Q', action: a.quantize },
    { label: t('クオンタイズ…'), shortcut: '⇧Q', action: a.quantizeDialog },
    { label: t('ヒューマナイズ…'), action: a.humanizeDialog },
    { label: t('ベロシティ…'), action: a.velocityDialog },
    { label: t('打ち込み支援'), items: performMenuItems(a) },
    ...(opts.noteLength === false ? [] : [{ label: t('ノート長をグリッドに揃える'), action: a.noteLength }]),
    sep,
    { label: t('削除'), shortcut: 'Delete', action: a.delete },
  ];
}

/** Menu for a right-click on an empty spot of a track's editor. */
export function emptyMenuItems(a: EditActions, store: EditorStore, transport: Transport, trackId: string, tick: number, reportError: (m: string) => void): MenuItem[] {
  const clipboard = store.getState().clipboard;
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
    { label: t('すべて選択'), action: a.selectAll },
    // the dialog targets the selection, or every note of the track when nothing is selected
    { label: t('クオンタイズ…'), shortcut: '⇧Q', action: a.quantizeDialog },
    sep,
    { label: t('再生位置をここに移動'), action: () => transport.seek(tick) },
  ];
}
