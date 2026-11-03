// Loose notes (ADR-064): a note that belongs to no clip of its track. Like material outside a
// region in a DAW it stays in the project (Undo, extending a clip or "take in" brings it back)
// but it is silent: playback and the MIDI / WAV exports leave it out. Controller, program and
// SysEx events are never loose; they always apply.
import type { MidiProject, MidiTrack } from './types';

/** IDs of the track's notes that belong to none of its clips. */
export function looseNoteIds(project: MidiProject, track: MidiTrack): Set<string> {
  const inClip = new Set(project.clips.filter((c) => c.trackId === track.id).flatMap((c) => c.eventIds));
  return new Set(track.events.filter((e) => e.kind === 'note' && !inClip.has(e.id)).map((e) => e.id));
}

export function looseNoteCount(project: MidiProject): number {
  return project.tracks.reduce((n, t) => n + looseNoteIds(project, t).size, 0);
}

/** The project as it sounds: loose notes removed from every track (clips untouched). */
export function withoutLooseNotes(project: MidiProject): MidiProject {
  let changed = false;
  const tracks = project.tracks.map((t) => {
    const loose = looseNoteIds(project, t);
    if (loose.size === 0) return t;
    changed = true;
    return { ...t, events: t.events.filter((e) => !loose.has(e.id)) };
  });
  return changed ? { ...project, tracks } : project;
}
