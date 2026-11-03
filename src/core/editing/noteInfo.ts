// Note info bar (ADR-073): what the selected notes have in common, and typed edits to them.
// Pure functions (no DOM): the bar shows a summary per field and hands what the user typed here.
// Position and pitch keep the shape of a multi-note selection (the earliest / lowest note goes to
// the typed value and the rest follow), so a chord or a phrase is not collapsed onto one tick or
// one key; length, velocity and release velocity set every note to the typed value.
import type { MidiProject, NoteEvent } from '../model/types';
import { parseNoteName } from '../list/noteNames';
import type { Command } from './history';
import { moveEvents, updateEvents } from './operations';

export type NoteField = 'tick' | 'duration' | 'pitch' | 'velocity' | 'release';
export const NOTE_FIELDS: readonly NoteField[] = ['tick', 'duration', 'pitch', 'velocity', 'release'];

/** smallest and largest value of a field across the notes (equal when they all agree) */
export interface FieldRange {
  min: number;
  max: number;
}

const valueOf = (n: NoteEvent, f: NoteField): number => (f === 'tick' ? n.tick : f === 'duration' ? n.durationTicks : f === 'pitch' ? n.pitch : f === 'velocity' ? n.velocity : n.releaseVelocity);

export function summarizeNotes(notes: readonly NoteEvent[]): Record<NoteField, FieldRange> | null {
  if (notes.length === 0) return null;
  const out = {} as Record<NoteField, FieldRange>;
  for (const f of NOTE_FIELDS) {
    let min = Infinity;
    let max = -Infinity;
    for (const n of notes) {
      const v = valueOf(n, f);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[f] = { min, max };
  }
  return out;
}

/** a typed value: absolute, or relative ("+10", "-3") to each note's own value */
export type FieldInput = { kind: 'set'; value: number } | { kind: 'add'; delta: number };

const LIMITS: Record<Exclude<NoteField, 'tick'>, { min: number; max: number }> = {
  duration: { min: 1, max: Number.MAX_SAFE_INTEGER },
  pitch: { min: 0, max: 127 },
  velocity: { min: 1, max: 127 },
  release: { min: 0, max: 127 },
};

/**
 * Text → input for a field, or null when it does not read as one. A leading + or − is always
 * relative (in ticks for position and length, semitones for pitch). Position takes "bar.beat.tick"
 * through `parsePosition` (the song's signature map); pitch takes a note name ("C4", "F#3") or a
 * number. Absolute values outside the field's range are refused rather than clamped.
 */
export function parseFieldInput(text: string, field: NoteField, parsePosition: (text: string) => number | null): FieldInput | null {
  const s = text.trim();
  const rel = /^([+\-−])\s*(\d+)$/.exec(s);
  if (rel) {
    const d = Number(rel[2]);
    return { kind: 'add', delta: rel[1] === '+' ? d : -d };
  }
  if (field === 'tick') {
    const tick = parsePosition(s);
    return tick === null ? null : { kind: 'set', value: tick };
  }
  let value: number | null = /^\d+$/.test(s) ? Number(s) : null;
  if (value === null && field === 'pitch') value = parseNoteName(s);
  if (value === null) return null;
  const lim = LIMITS[field];
  return value >= lim.min && value <= lim.max ? { kind: 'set', value } : null;
}

const LABEL: Record<NoteField, string> = {
  tick: 'ノートを移動',
  duration: 'ノートの長さを変更',
  pitch: '移調',
  velocity: 'ベロシティを変更',
  release: 'リリースベロシティを変更',
};

/** One undo step that applies the input to the notes with these ids; null when nothing changes. */
export function applyFieldInput(project: MidiProject, ids: Iterable<string>, field: NoteField, input: FieldInput): Command | null {
  const wanted = new Set(ids);
  const notes: NoteEvent[] = [];
  for (const t of project.tracks) for (const e of t.events) if (e.kind === 'note' && wanted.has(e.id)) notes.push(e);
  const range = summarizeNotes(notes);
  if (!range) return null;
  if (field === 'tick' || field === 'pitch') {
    // the whole group moves by one amount; moveEvents keeps it inside tick ≥ 0 and 0..127
    const delta = input.kind === 'add' ? input.delta : input.value - range[field].min;
    if (delta === 0) return null;
    return moveEvents(project, notes.map((n) => n.id), field === 'tick' ? delta : 0, field === 'pitch' ? delta : 0, LABEL[field]);
  }
  const lim = LIMITS[field];
  const key = field === 'duration' ? 'durationTicks' : field === 'velocity' ? 'velocity' : 'releaseVelocity';
  const updates = notes
    .map((n) => {
      const v = Math.max(lim.min, Math.min(lim.max, input.kind === 'set' ? input.value : valueOf(n, field) + input.delta));
      return v === valueOf(n, field) ? null : { id: n.id, changes: { [key]: v } };
    })
    .filter((u): u is { id: string; changes: { [k: string]: number } } => u !== null);
  return updates.length ? updateEvents(project, updates, LABEL[field]) : null;
}
