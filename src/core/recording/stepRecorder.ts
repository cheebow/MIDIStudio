// Step recording (REQ-IN-05, INPUT_RECORDING 6). A shared StepCursor (tick) used by the piano
// roll, drum editor and list. Pure: each action returns a command (or null) and the next cursor.
import type { Command } from '../editing/history';
import { addEvents, deleteEvents, updateEvents, type NewEvent } from '../editing/operations';
import type { MidiProject, NoteEvent } from '../model/types';

export interface StepSettings {
  /** step length in ticks (exact integer; the UI only offers lengths that divide) */
  stepTicks: number;
  /** gate as a ratio of the step (0 < gate <= 1) or fixed ticks */
  gate: { ratio: number } | { ticks: number };
  /** drums default to false so several pads can share one step (I09) */
  autoAdvance: boolean;
}

export interface StepState {
  cursor: number;
  /** ids of the notes written at the last step (for tie / undo-step) */
  lastStep: { tick: number; ids: string[] } | null;
}

export function gateTicks(s: StepSettings): number {
  return Math.max(1, 'ticks' in s.gate ? s.gate.ticks : Math.round(s.stepTicks * s.gate.ratio));
}

/** Writes notes (one, or a chord) at the cursor and optionally advances. */
export function stepNotes(project: MidiProject, trackId: string, state: StepState, s: StepSettings, notes: { pitch: number; velocity: number }[]): { command: Command | null; state: StepState } {
  if (notes.length === 0) return { command: null, state };
  const events: NewEvent[] = notes.map((n) => ({ kind: 'note', tick: state.cursor, pitch: n.pitch, velocity: n.velocity, durationTicks: gateTicks(s), releaseVelocity: 64 }));
  const r = addEvents(project, trackId, events, { label: 'ステップ入力' });
  const sameStep = state.lastStep && state.lastStep.tick === state.cursor;
  const ids = [...(sameStep ? state.lastStep!.ids : []), ...(r?.ids ?? [])];
  return {
    command: r?.command ?? null,
    state: { cursor: s.autoAdvance ? state.cursor + s.stepTicks : state.cursor, lastStep: { tick: state.cursor, ids } },
  };
}

/** Rest: move forward one step without writing. */
export function stepRest(state: StepState, s: StepSettings): StepState {
  return { cursor: state.cursor + s.stepTicks, lastStep: null };
}

export function stepForward(state: StepState, s: StepSettings): StepState {
  return { ...state, cursor: state.cursor + s.stepTicks };
}

export function stepBack(state: StepState, s: StepSettings): StepState {
  return { cursor: Math.max(0, state.cursor - s.stepTicks), lastStep: null };
}

/** Tie: extend the notes of the last written step by one step, and move the cursor past them. */
export function stepTie(project: MidiProject, state: StepState, s: StepSettings): { command: Command | null; state: StepState } {
  if (!state.lastStep) return { command: null, state };
  const all = project.tracks.flatMap((t) => t.events);
  const updates = state.lastStep.ids
    .map((id) => all.find((e) => e.id === id))
    .filter((e): e is NoteEvent => e?.kind === 'note')
    .map((n) => ({ id: n.id, changes: { durationTicks: n.durationTicks + s.stepTicks } }));
  const command = updates.length ? updateEvents(project, updates, 'タイ') : null;
  // the cursor goes to the step line after the longest tied note — not to the note's end, which the
  // gate puts short of the line (90 %: every later step would be early by the missing 10 %)
  const longest = updates.reduce((m, u) => Math.max(m, u.changes.durationTicks), 0);
  const steps = Math.ceil(longest / s.stepTicks);
  return { command, state: { cursor: Math.max(state.cursor, state.lastStep.tick + steps * s.stepTicks), lastStep: state.lastStep } };
}

/** Backspace: delete what was written at the last step and move the cursor there. */
export function stepUndoLast(project: MidiProject, state: StepState): { command: Command | null; state: StepState } {
  if (!state.lastStep) return { command: null, state };
  return { command: deleteEvents(project, state.lastStep.ids, 'ステップを取り消し'), state: { cursor: state.lastStep.tick, lastStep: null } };
}
