// Shared pieces of the performance tools (ADR-076): collecting the selected notes per track and
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
 * Groups notes (sorted by tick) whose onset lies within `toleranceTicks` of the group's first
 * onset (0 = exactly simultaneous notes only), or by a custom `joins` rule.
 */
export function groupByOnset(trackId: TrackId, clipId: string | undefined, notes: readonly NoteEvent[], toleranceTicks = 0, joins?: JoinRule): ChordGroup[] {
  const groups: ChordGroup[] = [];
  let g: ChordGroup | null = null;
  for (const n of notes) {
    if (g && (joins ? joins(g, n) : n.tick - g.tick <= toleranceTicks)) {
      g.notes.push(n);
      g.endTick = Math.max(g.endTick, n.tick + n.durationTicks);
    } else {
      g = { trackId, clipId, tick: n.tick, endTick: n.tick + n.durationTicks, notes: [n] };
      groups.push(g);
    }
  }
  return groups;
}

/** All selected notes of the project as chord groups, per track and clip. */
export function chordGroups(project: MidiProject, ids: Iterable<string>, toleranceTicks = 0, joins?: JoinRule): ChordGroup[][] {
  return selectedNoteLists(project, ids).map((l) => groupByOnset(l.trackId, l.clipId, l.notes, toleranceTicks, joins));
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
