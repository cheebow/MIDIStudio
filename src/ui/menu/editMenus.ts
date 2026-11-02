// Shared right-click menu contents for the note editors (piano roll, drum editor, list).
import type { EditActions } from '../../app/store/context';
import type { EditorStore } from '../../app/store/EditorStore';
import type { Transport } from '../../playback/Transport';
import { pasteEvents } from '../../core/editing/clipboard';
import type { MenuItem } from './MenuBar';

const sep: MenuItem = { separator: true, label: '' };

/** Menu for a right-click on a note (acts on the selection, which includes the clicked note). */
export function noteMenuItems(a: EditActions, opts: { transpose?: boolean; noteLength?: boolean } = {}): MenuItem[] {
  return [
    { label: 'コピー', action: a.copy },
    { label: '切り取り', action: a.cut },
    { label: '複製（すぐ後ろへ）', action: a.duplicate },
    sep,
    ...(opts.transpose === false
      ? []
      : [
          { label: '半音上げる', action: () => a.transpose(1) },
          { label: '半音下げる', action: () => a.transpose(-1) },
          { label: '1 オクターブ上げる', action: () => a.transpose(12) },
          { label: '1 オクターブ下げる', action: () => a.transpose(-12) },
          sep,
        ]),
    { label: 'クオンタイズ', shortcut: 'Q', action: a.quantize },
    { label: 'クオンタイズ…', shortcut: '⇧Q', action: a.quantizeDialog },
    { label: 'ヒューマナイズ…', action: a.humanizeDialog },
    { label: 'ベロシティ…', action: a.velocityDialog },
    ...(opts.noteLength === false ? [] : [{ label: 'ノート長をグリッドに揃える', action: a.noteLength }]),
    sep,
    { label: '削除', shortcut: 'Delete', action: a.delete },
  ];
}

/** Menu for a right-click on an empty spot of a track's editor. */
export function emptyMenuItems(a: EditActions, store: EditorStore, transport: Transport, trackId: string, tick: number, reportError: (m: string) => void): MenuItem[] {
  const clipboard = store.getState().clipboard;
  return [
    {
      label: 'ここに貼り付け',
      disabled: !clipboard,
      reason: 'コピーしたノートがありません',
      action: () => {
        try {
          const r = clipboard && pasteEvents(store.project, trackId, tick, clipboard);
          if (r) store.run(r.command, { select: r.ids });
        } catch (e) {
          reportError((e as Error).message);
        }
      },
    },
    { label: 'すべて選択', action: a.selectAll },
    // the dialog targets the selection, or every note of the track when nothing is selected
    { label: 'クオンタイズ…', shortcut: '⇧Q', action: a.quantizeDialog },
    sep,
    { label: '再生位置をここに移動', action: () => transport.seek(tick) },
  ];
}
