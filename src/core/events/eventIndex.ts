// Event ID -> location index. Rebuilt from the immutable project when needed.
import type { MidiEvent, MidiProject, MidiTrack } from '../model/types';

export interface EventLocation {
  track: MidiTrack;
  trackIndex: number;
  event: MidiEvent;
  eventIndex: number;
}

export function buildEventIndex(project: MidiProject): Map<string, EventLocation> {
  const map = new Map<string, EventLocation>();
  project.tracks.forEach((track, trackIndex) =>
    track.events.forEach((event, eventIndex) => map.set(event.id, { track, trackIndex, event, eventIndex })),
  );
  return map;
}
