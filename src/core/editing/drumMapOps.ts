// User drum map edits (REQ-EDT-07). Built-in maps are read-only; the first customisation creates a
// user copy in the project and points the track at it. Note pitches are never changed (E09).
import { findDrumMap, type DrumMap } from '../gm/drumMaps';
import { newId } from '../model/ids';
import type { MidiProject } from '../model/types';
import type { Command } from './history';
import { t } from '../../i18n';

export function customizeDrumMap(project: MidiProject, trackId: string, label: string, edit: (m: DrumMap) => DrumMap): Command | null {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const userMaps = project.drumMaps ?? [];
  const current = findDrumMap(track.drumMapId, userMaps);
  const base: DrumMap = current.builtIn ? { ...current, id: newId('dmap'), name: t('{name}（カスタム）', { name: current.name }), builtIn: false, entries: [...current.entries] } : current;
  const edited = edit(base);
  const drumMaps = current.builtIn ? [...userMaps, edited] : userMaps.map((m) => (m.id === edited.id ? edited : m));
  const tracks = project.tracks.map((t) => (t.id === trackId ? { ...t, drumMapId: edited.id } : t));
  return { label, patch: { drumMaps, tracks } };
}

export function hideLane(m: DrumMap, pitch: number): DrumMap {
  return { ...m, hidden: [...new Set([...(m.hidden ?? []), pitch])] };
}

export function showAllLanes(m: DrumMap): DrumMap {
  return { ...m, hidden: [] };
}

export function moveLane(m: DrumMap, pitch: number, delta: -1 | 1): DrumMap {
  const i = m.entries.findIndex((e) => e.pitch === pitch);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= m.entries.length) return m;
  const entries = [...m.entries];
  [entries[i], entries[j]] = [entries[j], entries[i]];
  return { ...m, entries };
}

export function renameLane(m: DrumMap, pitch: number, name: string): DrumMap {
  const exists = m.entries.some((e) => e.pitch === pitch);
  const entries = exists ? m.entries.map((e) => (e.pitch === pitch ? { ...e, name } : e)) : [...m.entries, { pitch, name, group: 'percussion' as const, defaultVelocity: 100 }];
  return { ...m, entries };
}
