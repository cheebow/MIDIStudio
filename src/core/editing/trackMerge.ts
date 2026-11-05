// Merging tracks (e.g. one MTrk per drum instrument -> one drum track). Events keep their IDs,
// ticks and origin order, so same-tick order follows the source file; the MIDI content and the
// semantic SMF comparison are unchanged as long as the tracks share port and channel.
import type { MidiEvent, MidiProject, MidiTrack } from '../model/types';
import { sortEvents } from '../events/order';
import type { Command } from './history';
import { EditError } from './operations';
import { t } from '../../i18n';

const hasChannelData = (t: MidiTrack) => t.events.some((e) => e.kind !== 'sysex' && e.kind !== 'meta');

/** Merges `ids` into the first of them (which keeps its settings); returns the patched track list. */
function mergeInto(tracks: MidiTrack[], ids: string[], name?: string): MidiTrack[] {
  const targets = ids.map((id) => tracks.find((t) => t.id === id)).filter((t): t is MidiTrack => !!t);
  if (targets.length < 2) return tracks;
  const [first, ...rest] = targets;
  if (rest.some((t) => t.port !== first.port)) throw new EditError(t('ポートの異なるトラックはまとめられません。'));
  const events: MidiEvent[] = [...first.events];
  for (const t of rest) {
    for (const e of t.events) {
      // keep each event on its original channel when the tracks' default channels differ
      if ('channelOverride' in e || e.kind === 'note' || e.kind === 'cc' || e.kind === 'program' || e.kind === 'pitch-bend' || e.kind === 'channel-pressure' || e.kind === 'poly-pressure') {
        const ch = (e as { channelOverride?: number }).channelOverride ?? t.channel;
        if (ch === first.channel) {
          // a copy without the property (never delete it from the original: Undo still holds it, ADR-084)
          const { channelOverride: _c, ...rest } = e as MidiEvent & { channelOverride?: number };
          void _c;
          events.push(rest as MidiEvent);
        } else events.push({ ...e, channelOverride: ch } as MidiEvent);
      } else events.push(e);
    }
  }
  const merged: MidiTrack = {
    ...first,
    name: name ?? first.name,
    events: sortEvents(events),
    endOfTrackTick: targets.reduce((m, t) => Math.max(m, t.endOfTrackTick ?? 0), 0),
    mute: targets.every((t) => t.mute),
    solo: targets.some((t) => t.solo),
  };
  const drop = new Set(rest.map((t) => t.id));
  return tracks.filter((t) => !drop.has(t.id)).map((t) => (t.id === first.id ? merged : t));
}

export function mergeTracks(project: MidiProject, ids: string[], name?: string, label = 'トラックをまとめる'): Command | null {
  if (ids.length < 2) return null;
  const tracks = mergeInto(project.tracks, ids, name);
  if (tracks === project.tracks) return null;
  const target = ids[0];
  const dropped = new Set(ids.slice(1));
  const clips = project.clips.map((c) => (dropped.has(c.trackId) ? { ...c, trackId: target } : c));
  return { label, patch: { tracks, clips } };
}

/** Groups of drum tracks with channel data on the same port and channel (2 or more tracks). */
export function drumTrackGroups(project: MidiProject): MidiTrack[][] {
  const groups = new Map<string, MidiTrack[]>();
  for (const t of project.tracks) {
    if (t.displayMode !== 'drum' || !hasChannelData(t)) continue;
    const key = `${t.port}:${t.channel}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Merges every group of same-port / same-channel drum tracks into one track named "Drums". */
export function mergeDrumTracks(project: MidiProject, label = 'ドラムトラックをまとめる'): { command: Command; merged: string[][] } | null {
  const groups = drumTrackGroups(project);
  if (groups.length === 0) return null;
  let p = project;
  for (const g of groups) {
    const c = mergeTracks(p, g.map((t) => t.id), groups.length === 1 ? 'Drums' : `Drums ${g[0].port}${g[0].channel + 1}`);
    if (c) p = { ...p, ...c.patch };
  }
  return { command: { label, patch: { tracks: p.tracks, clips: p.clips } }, merged: groups.map((g) => g.map((t) => t.name)) };
}

const hasNotes = (t: MidiTrack) => t.events.some((e) => e.kind === 'note' || e.kind === 'raw');

function sameChannelGroups(project: MidiProject): MidiTrack[][] {
  const groups = new Map<string, MidiTrack[]>();
  for (const t of project.tracks) {
    if (!hasChannelData(t)) continue;
    const key = `${t.port}:${t.channel}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

function mergeGroups(project: MidiProject, groups: { into: MidiTrack; from: MidiTrack[] }[], label: string): { command: Command; merged: string[][] } | null {
  if (groups.length === 0) return null;
  let p = project;
  for (const g of groups) {
    const c = mergeTracks(p, [g.into.id, ...g.from.map((t) => t.id)]);
    if (c) p = { ...p, ...c.patch };
  }
  return { command: { label, patch: { tracks: p.tracks, clips: p.clips } }, merged: groups.map((g) => [g.into.name, ...g.from.map((t) => t.name)]) };
}

/**
 * Controller-only tracks (CC / pitch bend / pressure but no notes, e.g. "MELO_MOD", "MELO_BEND")
 * are merged into the first track with notes on the same port and channel.
 */
export function mergeControllerTracks(project: MidiProject, label = 'コントローラーのトラックをまとめる'): { command: Command; merged: string[][] } | null {
  const groups = sameChannelGroups(project)
    .map((g) => ({ into: g.find(hasNotes), from: g.filter((t) => !hasNotes(t)) }))
    .filter((g): g is { into: MidiTrack; from: MidiTrack[] } => !!g.into && g.from.length > 0);
  return mergeGroups(project, groups, label);
}

/** Every group of tracks on the same port and channel becomes one track (named after the first). */
export function mergeSameChannelTracks(project: MidiProject, label = '同じチャンネルのトラックをまとめる'): { command: Command; merged: string[][] } | null {
  const groups = sameChannelGroups(project).map((g) => ({ into: g.find(hasNotes) ?? g[0], from: g.filter((t) => t !== (g.find(hasNotes) ?? g[0])) }));
  return mergeGroups(project, groups, label);
}
