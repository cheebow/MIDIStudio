// Project -> SMF snapshot for the sound engine (ARCHITECTURE F "再生設計").
// Mute / solo are applied per track by leaving out the notes of silent tracks while keeping their
// controller / program / SysEx events, so shared channels keep the right state (P09).
import { base64ToBytes } from '../model/base64';
import type { MidiEvent, MidiProject, MidiTrack } from '../model/types';
import { exportSmfBytes } from './exportSmf';

export function audibleTrackIds(project: MidiProject): Set<string> {
  const anySolo = project.tracks.some((t) => t.solo);
  return new Set(project.tracks.filter((t) => (anySolo ? t.solo : !t.mute)).map((t) => t.id));
}

function isNoteLike(e: MidiEvent): boolean {
  if (e.kind === 'note') return true;
  if (e.kind !== 'raw') return false;
  const b = base64ToBytes(e.rawBase64);
  return !!b && ((b[0] & 0xf0) === 0x90 || (b[0] & 0xf0) === 0x80);
}

export interface PlaybackSnapshot {
  smf: Uint8Array;
  /** Loop in ticks, or null when looping is off / the range is empty. */
  loop: { startTick: number; endTick: number } | null;
  audible: Set<string>;
}

/**
 * @param opts.tailTick keeps the engine running at least until this tick (recording past the end
 *   of the song, or into an empty song). Implemented as an empty text meta in the snapshot only.
 */
export function buildPlaybackSnapshot(project: MidiProject, opts: { tailTick?: number } = {}): PlaybackSnapshot {
  const audible = audibleTrackIds(project);
  const tracks: MidiTrack[] = project.tracks.map((t) => (audible.has(t.id) ? t : { ...t, events: t.events.filter((e) => !isNoteLike(e)) }));
  const loopOn = project.loop.enabled && project.loop.endTick > project.loop.startTick;
  const conductorMeta = [...project.conductorMeta];
  // The engine loops when it reaches an event at/after the loop end; guarantee one exists.
  if (loopOn) conductorMeta.push({ id: '__loop_end__', kind: 'meta', tick: project.loop.endTick, metaType: 0x01, dataBase64: '', originOrder: Number.MAX_SAFE_INTEGER });
  if (opts.tailTick) conductorMeta.push({ id: '__tail__', kind: 'meta', tick: opts.tailTick, metaType: 0x01, dataBase64: '', originOrder: Number.MAX_SAFE_INTEGER });
  const { bytes } = exportSmfBytes({ ...project, tracks, conductorMeta });
  return { smf: bytes, loop: loopOn ? { startTick: project.loop.startTick, endTick: project.loop.endTick } : null, audible };
}
