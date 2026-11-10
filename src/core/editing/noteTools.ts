// Scissors and glue (ADR-095): cutting notes in two and joining notes of the same key.
// Both are ordinary edits of the song data (one undo step each); nothing here knows about the UI.
import type { MidiProject, MidiTrack, NoteEvent } from '../model/types';
import { applyCommand, type Command } from './history';
import { addEvents, deleteEvents, updateEvents, type NewEvent } from './operations';

export interface NoteToolResult {
  command: Command;
  /** the notes the edit leaves behind (both halves of every cut note / the joined notes), for the selection */
  ids: string[];
}

const isNote = (e: { kind: string }): e is NoteEvent => e.kind === 'note';

/**
 * Cuts every note of `ids` that sounds across `tick` into two notes: the first keeps its id and ends
 * at `tick`, the second starts there with the rest of the length. Pitch, velocity and channel are the
 * same on both sides. Notes that do not cross `tick` (it is at their start, their end, or outside)
 * are left alone. The second half joins the clip of the first; where the first half's clip ends
 * before the cut it is placed like any new note (ADR-059 / 060), so it is never a silent loose note.
 */
export function splitNotes(project: MidiProject, ids: Iterable<string>, tick: number, label = 'ノートを分割'): NoteToolResult | null {
  if (!Number.isInteger(tick)) return null;
  const wanted = new Set(ids);
  const cuts: { track: MidiTrack; note: NoteEvent }[] = [];
  for (const track of project.tracks) {
    for (const e of track.events) if (isNote(e) && wanted.has(e.id) && e.tick < tick && tick < e.tick + e.durationTicks) cuts.push({ track, note: e });
  }
  if (cuts.length === 0) return null;
  const shorten = updateEvents(project, cuts.map(({ note }) => ({ id: note.id, changes: { durationTicks: tick - note.tick } })), label);
  if (!shorten) return null;
  let p = applyCommand(project, shorten).project;
  const patch = { ...shorten.patch };
  const out: string[] = cuts.map((c) => c.note.id);
  // the second halves, grouped by where they go: the first half's clip when the cut lies inside it
  const groups = new Map<string, { trackId: string; clipId: string | undefined; events: NewEvent[] }>();
  for (const { track, note } of cuts) {
    const clip = project.clips.find((c) => c.trackId === track.id && c.eventIds.includes(note.id));
    const clipId = clip && tick < clip.endTick ? clip.id : undefined;
    const key = `${track.id}\n${clipId ?? ''}`;
    const g = groups.get(key) ?? { trackId: track.id, clipId, events: [] };
    g.events.push({
      kind: 'note',
      tick,
      pitch: note.pitch,
      velocity: note.velocity,
      durationTicks: note.tick + note.durationTicks - tick,
      releaseVelocity: note.releaseVelocity,
      ...(note.channelOverride !== undefined ? { channelOverride: note.channelOverride } : {}),
    });
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const added = addEvents(p, g.trackId, g.events, { clipId: g.clipId, label });
    if (!added) continue;
    p = applyCommand(p, added.command).project;
    Object.assign(patch, added.command.patch);
    out.push(...added.ids);
  }
  return { command: { label, patch }, ids: out };
}

/**
 * Joins the notes of `ids` that share a track, a channel and a pitch into one note each: the earliest
 * one grows to the latest end (a gap between them is filled) and the others are removed. It keeps
 * its own velocity and takes the release velocity of the note that ended last. Keys with only one
 * note in `ids` are left alone.
 */
export function glueNotes(project: MidiProject, ids: Iterable<string>, label = 'ノートを結合'): NoteToolResult | null {
  const wanted = new Set(ids);
  const updates: { id: string; changes: Partial<NoteEvent> }[] = [];
  const removed: string[] = [];
  const kept: string[] = [];
  for (const track of project.tracks) {
    const byKey = new Map<string, NoteEvent[]>();
    for (const e of track.events) {
      if (!isNote(e) || !wanted.has(e.id)) continue;
      const key = `${e.channelOverride ?? track.channel}:${e.pitch}`;
      byKey.set(key, [...(byKey.get(key) ?? []), e]);
    }
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => a.tick - b.tick || a.originOrder - b.originOrder);
      const first = sorted[0];
      const last = sorted.reduce((m, n) => (n.tick + n.durationTicks >= m.tick + m.durationTicks ? n : m), first);
      updates.push({ id: first.id, changes: { durationTicks: last.tick + last.durationTicks - first.tick, releaseVelocity: last.releaseVelocity } });
      kept.push(first.id);
      for (const n of sorted.slice(1)) removed.push(n.id);
    }
  }
  if (removed.length === 0) return null;
  const del = deleteEvents(project, removed, label);
  if (!del) return null;
  const p = applyCommand(project, del).project;
  const grow = updateEvents(p, updates, label);
  return { command: { label, patch: { ...del.patch, ...(grow?.patch ?? {}) } }, ids: kept };
}

/** The next note after `id` on the same track, channel and pitch (the one a glue click joins it to). */
export function nextNoteOfSameKey(project: MidiProject, id: string): NoteEvent | null {
  for (const track of project.tracks) {
    const note = track.events.find((e): e is NoteEvent => isNote(e) && e.id === id);
    if (!note) continue;
    const ch = note.channelOverride ?? track.channel;
    let best: NoteEvent | null = null;
    for (const e of track.events) {
      if (!isNote(e) || e.id === id || e.pitch !== note.pitch || (e.channelOverride ?? track.channel) !== ch) continue;
      if (e.tick < note.tick || (e.tick === note.tick && e.originOrder < note.originOrder)) continue;
      if (!best || e.tick < best.tick || (e.tick === best.tick && e.originOrder < best.originOrder)) best = e;
    }
    return best;
  }
  return null;
}

/** Glue click on one note: joins it with the next note of the same key. null when there is none. */
export function glueWithNext(project: MidiProject, id: string, label = 'ノートを結合'): NoteToolResult | null {
  const next = nextNoteOfSameKey(project, id);
  return next ? glueNotes(project, [id, next.id], label) : null;
}
