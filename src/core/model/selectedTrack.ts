import type { MidiProject, MidiTrack } from './types';

/** The track the editors work on: the selected one, else the first (undefined with no tracks). */
export function selectedTrack(project: MidiProject): MidiTrack | undefined {
  return project.tracks.find((t) => t.id === project.settings.selectedTrackId) ?? project.tracks[0];
}

/**
 * Where keyboard / drum-pad input goes (ADR-080): keyboard notes to the selected track; drum-pad
 * hits to the selected track when it is a drum track, else the first drum track, else the selected
 * one. Preview sound, step input and live recording all use this, so what you hear is what is written.
 */
export function inputTargets(project: MidiProject): { piano: string | null; drum: string | null } {
  const selected = selectedTrack(project);
  const drum = selected?.displayMode === 'drum' ? selected : (project.tracks.find((t) => t.displayMode === 'drum') ?? selected);
  return { piano: selected?.id ?? null, drum: drum?.id ?? null };
}
