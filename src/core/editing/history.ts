// Command / Undo / Redo (ARCHITECTURE D, REQ-PRJ-07).
// Every edit is a shallow patch of top-level MidiProject fields. Untouched tracks keep their
// object identity (structural sharing), so the inverse patch is cheap: it holds references to the
// previous values only.
import type { MidiProject } from '../model/types';

export type ProjectPatch = Partial<Omit<MidiProject, 'schemaVersion' | 'id'>>;

export interface Command {
  readonly label: string;
  readonly patch: ProjectPatch;
}

export interface CommandResult {
  project: MidiProject;
  inverse: Command;
}

export function applyCommand(project: MidiProject, cmd: Command): CommandResult {
  const inversePatch: Record<string, unknown> = {};
  for (const key of Object.keys(cmd.patch) as (keyof ProjectPatch)[]) inversePatch[key] = project[key];
  return { project: { ...project, ...cmd.patch }, inverse: { label: cmd.label, patch: inversePatch as ProjectPatch } };
}

interface Entry {
  label: string;
  undo: Command;
  redo: Command;
  mergeKey?: string;
  /** events held alive by this step's undo patch (old event arrays of the tracks it changed) */
  weight: number;
}

export const DEFAULT_HISTORY_LIMIT = 500; // REQ-PRJ-07 requires at least 100
/** Steps beyond this many are dropped once the history holds more than `budgetEvents` (ADR-039). */
export const MIN_HISTORY_STEPS = 100;
/** ~16 MB of event references (each retained old track array costs 8 bytes per event). */
export const DEFAULT_HISTORY_BUDGET_EVENTS = 2_000_000;

export interface History {
  past: readonly Entry[];
  future: readonly Entry[];
  limit: number;
  budgetEvents: number;
}

export function createHistory(limit = DEFAULT_HISTORY_LIMIT, budgetEvents = DEFAULT_HISTORY_BUDGET_EVENTS): History {
  if (limit < MIN_HISTORY_STEPS) throw new RangeError('history limit must be >= 100 (REQ-PRJ-07)');
  return { past: [], future: [], limit, budgetEvents };
}

/**
 * Memory a step keeps alive: every edit replaces the event array of each track it touches, and the
 * undo patch references the old arrays. Untouched tracks are shared and cost nothing.
 */
function weightOf(undoPatch: ProjectPatch, next: MidiProject): number {
  if (!undoPatch.tracks) return 0;
  const kept = new Set(next.tracks.map((t) => t.events));
  let n = 0;
  for (const t of undoPatch.tracks) if (!kept.has(t.events)) n += t.events.length;
  return n;
}

/** Oldest steps go first when the history exceeds its size budget, but never below MIN_HISTORY_STEPS. */
function trim(past: Entry[], h: History): Entry[] {
  if (past.length > h.limit) past = past.slice(past.length - h.limit);
  let total = 0;
  for (const e of past) total += e.weight;
  let drop = 0;
  while (past.length - drop > MIN_HISTORY_STEPS && total > h.budgetEvents) total -= past[drop++].weight;
  return drop > 0 ? past.slice(drop) : past;
}

/** Events referenced by the undo steps (for diagnostics / tests). */
export function historyWeight(h: History): number {
  let n = 0;
  for (const e of h.past) n += e.weight;
  return n;
}

export interface ExecuteOptions {
  /**
   * Consecutive commands with the same mergeKey become one undo step (e.g. a continuous drag
   * committed in several parts). Pass undefined to always create a new step.
   */
  mergeKey?: string;
}

export function execute(project: MidiProject, history: History, cmd: Command, opts: ExecuteOptions = {}): { project: MidiProject; history: History } {
  if (Object.keys(cmd.patch).length === 0) return { project, history };
  const { project: next, inverse } = applyCommand(project, cmd);
  const top = history.past[history.past.length - 1];
  let past: Entry[];
  if (opts.mergeKey !== undefined && top?.mergeKey === opts.mergeKey) {
    // Undo restores the state before the first merged command; redo jumps to the latest state.
    const undoPatch = { ...inverse.patch, ...top.undo.patch };
    const redoPatch: Record<string, unknown> = {};
    for (const k of Object.keys(undoPatch)) redoPatch[k] = next[k as keyof MidiProject];
    past = [
      ...history.past.slice(0, -1),
      { label: top.label, mergeKey: top.mergeKey, undo: { label: top.label, patch: undoPatch }, redo: { label: top.label, patch: redoPatch as ProjectPatch }, weight: weightOf(undoPatch, next) },
    ];
  } else {
    past = [...history.past, { label: cmd.label, mergeKey: opts.mergeKey, undo: inverse, redo: cmd, weight: weightOf(inverse.patch, next) }];
  }
  return { project: next, history: { ...history, past: trim(past, history), future: [] } };
}

export function canUndo(h: History): boolean {
  return h.past.length > 0;
}
export function canRedo(h: History): boolean {
  return h.future.length > 0;
}

export function undo(project: MidiProject, h: History): { project: MidiProject; history: History; label?: string } {
  const entry = h.past[h.past.length - 1];
  if (!entry) return { project, history: h };
  const { project: prev } = applyCommand(project, entry.undo);
  // Merging must not continue across an undo/redo boundary: the step that is on top again is closed too
  // (a nudge after the undo would otherwise join a nudge from before it, and one Undo would revert both).
  const past = h.past.slice(0, -1).map((e, i, a) => (i === a.length - 1 && e.mergeKey !== undefined ? { ...e, mergeKey: undefined } : e));
  return { project: prev, history: { ...h, past, future: [...h.future, entry] }, label: entry.label };
}

export function redo(project: MidiProject, h: History): { project: MidiProject; history: History; label?: string } {
  const entry = h.future[h.future.length - 1];
  if (!entry) return { project, history: h };
  const { project: next } = applyCommand(project, entry.redo);
  // Merging must not continue across an undo/redo boundary.
  return { project: next, history: { ...h, past: [...h.past, { ...entry, mergeKey: undefined }], future: h.future.slice(0, -1) }, label: entry.label };
}
