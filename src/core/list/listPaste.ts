// Paste at a list row (ADR-066 追記). "Overlay" puts the clipboard at the row's tick and moves
// nothing; "insert" first pushes every later event of the track back by the clipboard's span
// (Recomposer-style insertion), so the pasted material gets its own room. One undo step each.
import type { Command } from '../editing/history';
import { pasteEvents, scaleTo, type ClipboardData } from '../editing/clipboard';
import { EditError, moveEvents } from '../editing/operations';
import type { MidiProject } from '../model/types';

export type PasteMode = 'overlay' | 'insert';

export function pasteRowsAt(project: MidiProject, trackId: string, tick: number, data: ClipboardData, mode: PasteMode): { command: Command; ids: string[] } | null {
  if (mode === 'overlay') return pasteEvents(project, trackId, tick, data);
  const track = project.tracks.find((x) => x.id === trackId);
  if (!track) throw new EditError('track not found');
  let p = project;
  const patch: Record<string, unknown> = {};
  const later = track.events.filter((e) => e.tick >= tick).map((e) => e.id);
  // the room made is the clipboard's span in THIS song's ticks (the clipboard may come from another PPQ)
  const span = scaleTo(project, data, data.span);
  if (later.length && span > 0) {
    const mv = moveEvents(p, later, span, 0, '挿入して貼り付け');
    if (mv) {
      p = { ...p, ...mv.patch };
      Object.assign(patch, mv.patch);
    }
  }
  const r = pasteEvents(p, trackId, tick, data);
  if (!r) return null;
  Object.assign(patch, r.command.patch);
  return { command: { label: '挿入して貼り付け', patch }, ids: r.ids };
}
