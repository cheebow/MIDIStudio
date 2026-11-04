// Shared pieces of the performance tools (ADR-077): collecting the selected notes per track and
// clip, grouping simultaneous notes into chords, and ms -> tick conversion through the tempo map.
import type { MidiProject, NoteEvent, TrackId } from '../../model/types';
import { TempoMap } from '../../timing/tempoMap';
import { TimeSignatureMap } from '../../timing/timeSignatureMap';

/** Notes of one track / clip that start (almost) together, in tick then pitch order. */
export interface ChordGroup {
  trackId: TrackId;
  /** clip the notes belong to (undefined = free notes); groups never span clips */
  clipId: string | undefined;
  /** earliest onset of the group */
  tick: number;
  /** latest note end of the group */
  endTick: number;
  notes: NoteEvent[];
}

/** Selected notes grouped per track and clip, each list sorted by tick then pitch then id. */
export function selectedNoteLists(project: MidiProject, ids: Iterable<string>): { trackId: TrackId; clipId: string | undefined; notes: NoteEvent[] }[] {
  const sel = new Set(ids);
  const clipOf = new Map<string, string>();
  for (const c of project.clips) for (const id of c.eventIds) clipOf.set(id, c.id);
  const lists: { trackId: TrackId; clipId: string | undefined; notes: NoteEvent[] }[] = [];
  for (const t of project.tracks) {
    const byClip = new Map<string | undefined, NoteEvent[]>();
    for (const e of t.events) {
      if (e.kind !== 'note' || !sel.has(e.id)) continue;
      const key = clipOf.get(e.id);
      const list = byClip.get(key);
      if (list) list.push(e);
      else byClip.set(key, [e]);
    }
    for (const [clipId, notes] of byClip) lists.push({ trackId: t.id, clipId, notes: sortNotes(notes) });
  }
  return lists;
}

export function sortNotes(notes: NoteEvent[]): NoteEvent[] {
  return [...notes].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Decides whether `note` belongs to the chord `group` (notes arrive in tick order). */
export type JoinRule = (group: ChordGroup, note: NoteEvent) => boolean;

/**
 * A played chord is not exactly simultaneous (a recorded take spreads its notes by a few ticks).
 * A note joins the chord when it starts within `CHORD_GAP_MS` of the chord's previous note, the chord
 * stays within `CHORD_SPREAD_MS`, both capped at a 32nd note so fast passages are not merged, and
 * its pitch is not in the chord yet (a repeated note starts a new chord). Spec 2.3, ADR-077 追記.
 */
export const CHORD_GAP_MS = 35;
export const CHORD_SPREAD_MS = 70;

export function playedChordRule(project: MidiProject, tempo: TempoMap = tempoMapOf(project), gapMs = CHORD_GAP_MS, spreadMs = CHORD_SPREAD_MS, capTicks = Math.floor(project.ppq / 8)): JoinRule {
  return (g, n) => {
    const last = g.notes[g.notes.length - 1].tick;
    return n.tick - last <= Math.min(msToTicks(gapMs, last, tempo), capTicks) && n.tick - g.tick <= Math.min(msToTicks(spreadMs, g.tick, tempo), capTicks) && !g.notes.some((m) => m.pitch === n.pitch);
  };
}

/** Groups notes (sorted by tick) into chords by `joins`. */
export function groupByOnset(trackId: TrackId, clipId: string | undefined, notes: readonly NoteEvent[], joins: JoinRule): ChordGroup[] {
  const groups: ChordGroup[] = [];
  let g: ChordGroup | null = null;
  for (const n of notes) {
    if (g && joins(g, n)) {
      g.notes.push(n);
      g.endTick = Math.max(g.endTick, n.tick + n.durationTicks);
    } else {
      g = { trackId, clipId, tick: n.tick, endTick: n.tick + n.durationTicks, notes: [n] };
      groups.push(g);
    }
  }
  return groups;
}

/** All selected notes of the project as chord groups, per track and clip (played chords by default). */
export function chordGroups(project: MidiProject, ids: Iterable<string>, joins: JoinRule = playedChordRule(project)): ChordGroup[][] {
  return selectedNoteLists(project, ids).map((l) => groupByOnset(l.trackId, l.clipId, l.notes, joins));
}

export function tempoMapOf(project: MidiProject): TempoMap {
  return new TempoMap(project.ppq, project.conductor.filter((c) => c.kind === 'tempo'));
}

export function signatureMapOf(project: MidiProject): TimeSignatureMap {
  return new TimeSignatureMap(project.ppq, project.conductor.filter((c) => c.kind === 'time-signature'));
}

/** Ticks that `ms` lasts starting at `atTick` (exact across tempo changes), rounded, never negative. */
export function msToTicks(ms: number, atTick: number, tempo: TempoMap): number {
  const end = tempo.secondsToTick(tempo.tickToSeconds(atTick) + ms / 1000);
  return Math.max(0, Math.round(end - atTick));
}

/** Start tick of the bar containing `tick` (may be fractional for odd PPQ / signatures). */
export function barStartOf(signature: TimeSignatureMap, tick: number): number {
  return signature.barBeatToTick(signature.tickToBarBeat(tick).bar);
}

export const clampVelocity = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));

/** Median of a list of numbers (the lower middle for even counts). */
export function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}
