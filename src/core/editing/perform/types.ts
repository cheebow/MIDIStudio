// Performance tools (docs/PERFORMANCE_TOOLS_SPEC.md, ADR-076): pure transforms of the selected
// notes. Each returns one Command (one undo step) or null, plus what the dialog shows.
import type { Command } from '../history';

export interface TransformResult {
  command: Command | null;
  /** ids of the notes after the transform (kept originals plus new ones): the selection after Apply */
  ids: string[];
  /** one sentence for the dialog (Japanese source text; the UI shows t(notice)), or null */
  notice: string | null;
  stats: {
    /** notes the transform looked at */
    notes: number;
    /** chord groups (same onset) it found */
    groups: number;
    /** groups or notes it left alone on purpose */
    skipped: number;
  };
}

export const EMPTY_RESULT: TransformResult = { command: null, ids: [], notice: null, stats: { notes: 0, groups: 0, skipped: 0 } };
