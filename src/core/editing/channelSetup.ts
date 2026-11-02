// Bank / Program / RPN setup at the start of a track (MIDI_GS_SPEC 4/6, UI_DESIGN 8). Values are
// real MIDI events so they reach the exported SMF.
import type { MidiEvent, MidiProject } from '../model/types';
import type { Command } from './history';
import { addEvents, EditError, type NewEvent } from './operations';

/**
 * The clip new setup events should join: the clip that held one of the replaced events, else the
 * clip whose range covers the tick (as createClip would group them). Keeps Program / Bank / CC
 * edits made in the inspector or mixer inside the region they belong to, so moving or deleting
 * the region takes them along.
 */
function clipFor(project: MidiProject, trackId: string, replacedIds: Iterable<string>, tick: number): string | undefined {
  const ids = new Set(replacedIds);
  const own = project.clips.filter((c) => c.trackId === trackId);
  return (own.find((c) => c.eventIds.some((id) => ids.has(id))) ?? own.find((c) => c.startTick <= tick && tick < c.endTick))?.id;
}

/** Replaces the tick-0 Bank Select (CC0/CC32) and Program Change of the track's own channel. */
export function setBankProgram(project: MidiProject, trackId: string, v: { msb: number | null; lsb: number | null; program: number }): Command {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new EditError('track not found');
  const own = (e: MidiEvent) => !('channelOverride' in e) || e.channelOverride === undefined || e.channelOverride === track.channel;
  const removed = new Set(track.events.filter((e) => e.tick === 0 && own(e) && (e.kind === 'program' || (e.kind === 'cc' && (e.controller === 0 || e.controller === 32)))).map((e) => e.id));
  const base: MidiProject = { ...project, tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, events: t.events.filter((e) => !removed.has(e.id)) } : t)), clips: project.clips.map((c) => (c.trackId === trackId ? { ...c, eventIds: c.eventIds.filter((id) => !removed.has(id)) } : c)) };
  const events: NewEvent[] = [];
  if (v.msb !== null) events.push({ kind: 'cc', tick: 0, controller: 0, value: v.msb });
  if (v.lsb !== null) events.push({ kind: 'cc', tick: 0, controller: 32, value: v.lsb });
  events.push({ kind: 'program', tick: 0, program: v.program });
  const r = addEvents(base, trackId, events, { label: '音色を設定', clipId: clipFor(project, trackId, removed, 0) })!;
  return { label: '音色を設定', patch: { clips: base.clips, ...r.command.patch } };
}

/** Pitch Bend Sensitivity (RPN 0/0) at tick 0, followed by RPN Null so later Data Entry is safe. */
export function setPitchBendRange(project: MidiProject, trackId: string, semitones: number): Command {
  if (!Number.isInteger(semitones) || semitones < 0 || semitones > 24) throw new EditError('ベンド幅は 0〜24 半音です。');
  const events: NewEvent[] = [
    { kind: 'cc', tick: 0, controller: 101, value: 0 },
    { kind: 'cc', tick: 0, controller: 100, value: 0 },
    { kind: 'cc', tick: 0, controller: 6, value: semitones },
    { kind: 'cc', tick: 0, controller: 38, value: 0 },
    { kind: 'cc', tick: 0, controller: 101, value: 127 },
    { kind: 'cc', tick: 0, controller: 100, value: 127 },
  ];
  return addEvents(project, trackId, events, { label: 'ベンド幅を設定' })!.command;
}

/** Sets (or inserts) the first value of a controller at tick 0 (mixer initial values). */
export function setInitialController(project: MidiProject, trackId: string, controller: number, value: number): Command {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new EditError('track not found');
  if (!Number.isInteger(value) || value < 0 || value > 127) throw new EditError('値は 0〜127 です。');
  const first = track.events.find((e) => e.kind === 'cc' && e.tick === 0 && e.controller === controller && (e.channelOverride === undefined || e.channelOverride === track.channel));
  if (first) {
    const tracks = project.tracks.map((t) => (t.id === trackId ? { ...t, events: t.events.map((e) => (e.id === first.id ? { ...e, value } : e)) } : t));
    return { label: 'ミキサー値を変更', patch: { tracks } };
  }
  return addEvents(project, trackId, [{ kind: 'cc', tick: 0, controller, value }], { label: 'ミキサー値を設定', clipId: clipFor(project, trackId, [], 0) })!.command;
}

const ownCc = (track: MidiProject['tracks'][number], controller: number) =>
  track.events
    .filter((e) => e.kind === 'cc' && e.controller === controller && (e.channelOverride === undefined || e.channelOverride === track.channel))
    .sort((a, b) => a.tick - b.tick || a.originOrder - b.originOrder) as Extract<MidiEvent, { kind: 'cc' }>[];

export interface ControllerAt {
  /** event whose value is shown / edited: the last one at or before the tick, else the first one */
  event: Extract<MidiEvent, { kind: 'cc' }> | null;
  /** true when `event` is at or before the tick (the value in effect) */
  inEffect: boolean;
  /** number of events of this controller in the track (> 1 = automation) */
  count: number;
}

/** The controller value a mixer shows at the playhead (value in effect, or the track's first value). */
export function controllerAt(track: MidiProject['tracks'][number], controller: number, tick: number): ControllerAt {
  const list = ownCc(track, controller);
  let last: (typeof list)[number] | null = null;
  for (const e of list) {
    if (e.tick > tick) break;
    last = e;
  }
  return { event: last ?? list[0] ?? null, inEffect: last !== null, count: list.length };
}

/**
 * Mixer edit at the playhead: changes the event returned by controllerAt (the one being shown),
 * or inserts the first value at tick 0 when the track has none of this controller.
 */
export function setControllerAt(project: MidiProject, trackId: string, controller: number, value: number, tick: number): Command | null {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new EditError('track not found');
  if (!Number.isInteger(value) || value < 0 || value > 127) throw new EditError('値は 0〜127 です。');
  const { event } = controllerAt(track, controller, tick);
  if (!event) return setInitialController(project, trackId, controller, value);
  if (event.value === value) return null;
  const tracks = project.tracks.map((t) => (t.id === trackId ? { ...t, events: t.events.map((e) => (e.id === event.id ? { ...e, value } : e)) } : t));
  return { label: 'ミキサー値を変更', patch: { tracks } };
}

export interface ProgramAt {
  /** Program Change shown / edited: the last one at or before the tick, else the first one */
  event: Extract<MidiEvent, { kind: 'program' }> | null;
  /** Bank Select values in effect at that Program Change (last CC0 / CC32 at or before its tick) */
  msb: number | null;
  lsb: number | null;
  inEffect: boolean;
  count: number;
}

export function programAt(track: MidiProject['tracks'][number], tick: number): ProgramAt {
  const own = (e: MidiEvent) => !('channelOverride' in e) || e.channelOverride === undefined || e.channelOverride === track.channel;
  const sorted = [...track.events].filter(own).sort((a, b) => a.tick - b.tick || a.originOrder - b.originOrder);
  const pcs = sorted.filter((e): e is Extract<MidiEvent, { kind: 'program' }> => e.kind === 'program');
  let last: (typeof pcs)[number] | null = null;
  for (const e of pcs) {
    if (e.tick > tick) break;
    last = e;
  }
  const event = last ?? pcs[0] ?? null;
  let msb: number | null = null;
  let lsb: number | null = null;
  if (event) {
    for (const e of sorted) {
      if (e === event) break;
      if (e.kind === 'cc' && e.controller === 0) msb = e.value;
      if (e.kind === 'cc' && e.controller === 32) lsb = e.value;
    }
  }
  return { event, msb, lsb, inEffect: last !== null, count: pcs.length };
}

/**
 * Inspector edit at the playhead: rewrites the Program Change being shown (and its Bank Select at
 * the same tick, Bank -> Program order); with no Program Change in the track, sets it at tick 0.
 */
export function setProgramAt(project: MidiProject, trackId: string, v: { msb: number | null; lsb: number | null; program: number }, tick: number): Command | null {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) throw new EditError('track not found');
  const cur = programAt(track, tick);
  if (!cur.event) return setBankProgram(project, trackId, v);
  if (cur.event.program === v.program && cur.msb === v.msb && cur.lsb === v.lsb) return null;
  const at = cur.event.tick;
  const own = (e: MidiEvent) => !('channelOverride' in e) || e.channelOverride === undefined || e.channelOverride === track.channel;
  const removed = new Set(
    track.events.filter((e) => e.tick === at && own(e) && (e.id === cur.event!.id || (e.kind === 'cc' && (e.controller === 0 || e.controller === 32)))).map((e) => e.id),
  );
  const base: MidiProject = {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, events: t.events.filter((e) => !removed.has(e.id)) } : t)),
    clips: project.clips.map((c) => (c.trackId === trackId ? { ...c, eventIds: c.eventIds.filter((id) => !removed.has(id)) } : c)),
  };
  const events: NewEvent[] = [];
  // write Bank Select at this position only when it differs from what is already in effect here
  if (v.msb !== null) events.push({ kind: 'cc', tick: at, controller: 0, value: v.msb });
  if (v.lsb !== null) events.push({ kind: 'cc', tick: at, controller: 32, value: v.lsb });
  events.push({ kind: 'program', tick: at, program: v.program });
  const r = addEvents(base, trackId, events, { label: '音色を変更', clipId: clipFor(project, trackId, removed, at) })!;
  return { label: '音色を変更', patch: { clips: base.clips, ...r.command.patch } };
}
