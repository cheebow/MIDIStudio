// Pitch capture into the list from a played keyboard (ADR-066 追記). Pure state machine: the UI
// feeds note-on / note-off events and applies the returned actions.
// - The first key of a chord rewrites the K# of the current row (immediate feedback, Recomposer
//   style). Keys pressed while it is still held are inserted as new notes at the same position
//   (a copy of that row with the new pitch), so a chord replaces one note with a chord.
// - When every key is released the cursor moves to the next row with a K# after the chord.
export interface CaptureRow {
  id: string;
  tick: number;
  /** note number of the row, null when it has none (CC, SysEx …) */
  key: number | null;
}

export interface CaptureState {
  /** pitches currently held */
  held: ReadonlySet<number>;
  /** the chord being entered: the row that took the first key and the ids written so far */
  anchor: { rowId: string; tick: number; ids: string[] } | null;
}

export const CAPTURE_IDLE: CaptureState = { held: new Set(), anchor: null };

export type CaptureEvent = { type: 'note-on'; pitch: number; velocity: number } | { type: 'note-off'; pitch: number };

export type CaptureAction =
  /** rewrite the K# (and optionally VEL) of the row */
  | { type: 'set-key'; rowId: string; pitch: number; velocity: number }
  /** insert a note like `likeRowId` at `tick` with this pitch */
  | { type: 'insert'; likeRowId: string; tick: number; pitch: number; velocity: number }
  /** chord finished: move the cursor to the next row with a K# after these rows */
  | { type: 'advance'; afterIds: string[] }
  | { type: 'no-key-row' };

/**
 * @param row the current row, or null when the list is empty
 * @param allowed false when the list must stay passive (not focused, recorder running, step mode)
 */
export function captureStep(state: CaptureState, e: CaptureEvent, row: CaptureRow | null, allowed: boolean): { state: CaptureState; actions: CaptureAction[] } {
  if (e.type === 'note-off') {
    if (!state.held.has(e.pitch)) return { state, actions: [] };
    const held = new Set(state.held);
    held.delete(e.pitch);
    if (held.size > 0 || !state.anchor) return { state: { held, anchor: held.size ? state.anchor : null }, actions: [] };
    return { state: CAPTURE_IDLE, actions: [{ type: 'advance', afterIds: state.anchor.ids }] };
  }
  if (!allowed) return { state, actions: [] };
  const held = new Set(state.held);
  held.add(e.pitch);
  if (state.anchor) {
    // another key while the first is held: a chord note at the anchor's position
    return { state: { held, anchor: state.anchor }, actions: [{ type: 'insert', likeRowId: state.anchor.rowId, tick: state.anchor.tick, pitch: e.pitch, velocity: e.velocity }] };
  }
  if (!row || row.key === null) return { state: { held, anchor: null }, actions: [{ type: 'no-key-row' }] };
  return { state: { held, anchor: { rowId: row.id, tick: row.tick, ids: [row.id] } }, actions: [{ type: 'set-key', rowId: row.id, pitch: e.pitch, velocity: e.velocity }] };
}

/** Records the id of a note the UI inserted for the chord (so `advance` can skip past it). */
export function captureInserted(state: CaptureState, id: string): CaptureState {
  return state.anchor ? { ...state, anchor: { ...state.anchor, ids: [...state.anchor.ids, id] } } : state;
}
