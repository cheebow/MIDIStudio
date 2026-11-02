import type { MidiProject, MidiTrack } from './types';

/** The track the editors work on: the selected one, else the first (undefined with no tracks). */
export function selectedTrack(project: MidiProject): MidiTrack | undefined {
  return project.tracks.find((t) => t.id === project.settings.selectedTrackId) ?? project.tracks[0];
}
