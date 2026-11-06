// Inserting a chosen guitar form (ADR-091) through the ordinary edit commands: notes go in with
// addEvents (they join the clip they land in, or get one: ADR-060), and a new guitar track is created
// in the same undo step as its Program Change and the notes. Nothing existing is replaced or deleted.
import { addEvents, addTrack, channelInsertIndex, EditError } from '../editing/operations';
import type { Command } from '../editing/history';
import type { MidiProject } from '../model/types';

/** GM Acoustic Guitar (steel), 0-based. */
export const GUITAR_PROGRAM = 25;

export type VoicingTarget = { trackId: string } | { newTrack: { name: string } };

export interface VoicingChord {
  tick: number;
  length: number;
  pitches: readonly number[];
}

export interface VoicingInsert {
  target: VoicingTarget;
  /** one chord (the voicing dialog) or a progression (ADR-091 追記) */
  chords: readonly VoicingChord[];
  velocity: number;
}

/** First port-A channel no track uses, skipping channel 10 (drums); 0 when all are taken. */
export function freeChannel(project: MidiProject): number {
  const used = new Set(project.tracks.filter((t) => t.port === 'A').map((t) => t.channel));
  return [...Array(16).keys()].find((c) => c !== 9 && !used.has(c)) ?? 0;
}

export function validateInsert(tick: number, length: number): string | null {
  if (!Number.isInteger(tick) || tick < 0) return '挿入位置が正しくありません';
  if (!Number.isInteger(length) || length < 1) return '長さは 1 Tick 以上にしてください';
  return null;
}

/** One undo step for every chord (and the new track, if any). `ids`: the new notes. */
export function buildVoicingCommand(project: MidiProject, req: VoicingInsert): { command: Command; trackId: string; ids: string[] } {
  if (req.chords.length === 0) throw new EditError('挿入するノートがありません');
  for (const c of req.chords) {
    const bad = validateInsert(c.tick, c.length);
    if (bad) throw new EditError(bad);
    if (c.pitches.length === 0 || c.pitches.length > 6) throw new EditError('ギターのフォームは 1〜6 音です');
  }
  const label = 'ギターボイシングを挿入';
  const notes = req.chords.flatMap((c) => c.pitches.map((pitch) => ({ kind: 'note' as const, tick: c.tick, pitch, velocity: req.velocity, durationTicks: c.length, releaseVelocity: 64 })));
  if ('trackId' in req.target) {
    const r = addEvents(project, req.target.trackId, notes, { label });
    if (!r) throw new EditError('挿入するノートがありません');
    return { command: r.command, trackId: req.target.trackId, ids: r.ids };
  }
  const channel = freeChannel(project);
  const t = addTrack(project, { name: req.target.newTrack.name, channel }, channelInsertIndex(project, 'A', channel), label);
  const after = { ...project, ...t.command.patch };
  const r = addEvents(after, t.trackId, [{ kind: 'program', tick: 0, program: GUITAR_PROGRAM }, ...notes], { label });
  if (!r) throw new EditError('挿入するノートがありません');
  return { command: { label, patch: { ...t.command.patch, ...r.command.patch } }, trackId: t.trackId, ids: r.ids.slice(1) };
}

/** Notes of the track already sounding somewhere in [tick, tick + length): the dialog warns, nothing is replaced. */
export function overlappingNotes(project: MidiProject, trackId: string | null, tick: number, length: number): number {
  const track = trackId ? project.tracks.find((t) => t.id === trackId) : undefined;
  if (!track) return 0;
  const end = tick + length;
  return track.events.filter((e) => e.kind === 'note' && e.tick < end && e.tick + e.durationTicks > tick).length;
}
